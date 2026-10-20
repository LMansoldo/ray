import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/svelte'
import Home from './Home.svelte'
import type { HomeProps } from './types'

// T-604: ação "Exportar" no detalhe da sessão. A Home fala APENAS com o
// núcleo via invoke() (ADR-001/ADR-005 — ver no-direct-sidecar.test.ts);
// a entrega do arquivo usa download via blob URL no webview, com fallback
// de área de transferência.

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi
    .fn<(command: string, args?: unknown) => Promise<unknown>>()
    .mockResolvedValue(undefined),
  listenMock: vi.fn<() => Promise<() => void>>().mockResolvedValue(() => {}),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
// Eventos Tauri não existem no jsdom (sem __TAURI_INTERNALS__); o onMount da
// Home só registra os listeners — mock resolvido evita rejeições órfãs.
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))

const baseProps: HomeProps = {
  sessions: [{ id: 'sess-1', title: 'Reunião de planejamento' }],
  assistant: { name: 'Copiloto de Reuniões', category: 'MEETINGS' },
  memoryItems: [],
  sessionId: 'sess-1',
  assistantId: 'asst-1',
  context: [],
  credential: { kind: 'OPENAI', connectionMode: 'API_KEY', secret: 'ref:key-1' },
}

const SESSION_DETAIL = {
  id: 'sess-1',
  assistantName: 'Copiloto de Reuniões',
  startedAt: '2026-01-15T12:30:00.000Z',
  transcript: [{ speaker: 'SELF', text: 'bom dia', startMs: 0 }],
}

const REPORT_MD = {
  sessionId: 'sess-1',
  format: 'md',
  filename: 'relatorio-sessao-2026-01-15.md',
  content: '# Relatório da sessão\n\n## Transcrição\n',
}

type CoreHandlers = Record<string, (args?: unknown) => unknown>

/** Registra os comandos do core esperados pelo teste (demais: undefined). */
function mockCore(handlers: CoreHandlers): void {
  invokeMock.mockImplementation((command: string, args?: unknown) => {
    const handler = handlers[command]
    if (handler) {
      return Promise.resolve(handler(args))
    }
    return Promise.resolve(undefined)
  })
}

let createObjectURLMock: ReturnType<typeof vi.fn>
let revokeObjectURLMock: ReturnType<typeof vi.fn>
let clickSpy: ReturnType<typeof vi.spyOn> | undefined

function stubDownload(): void {
  createObjectURLMock = vi.fn(() => 'blob:mock-url')
  revokeObjectURLMock = vi.fn(() => undefined)
  URL.createObjectURL = createObjectURLMock as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = revokeObjectURLMock as unknown as typeof URL.revokeObjectURL
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
}

afterEach(() => {
  clickSpy?.mockRestore()
  clickSpy = undefined
  invokeMock.mockReset()
  invokeMock.mockResolvedValue(undefined)
  cleanup()
})

/** Abre o detalhe da sessão (a ação Exportar só existe no detalhe). */
async function openDetail(container: HTMLElement): Promise<void> {
  const row = container.querySelector('[data-recent-session="sess-1"]') as HTMLElement
  await fireEvent.click(row)
}

describe('Home — export de relatório da sessão (T-604)', () => {
  it('o detalhe da sessão expõe as duas opções de exportação', async () => {
    stubDownload()
    mockCore({ get_session: () => SESSION_DETAIL })
    const { container } = render(Home, { props: baseProps })
    await openDetail(container)

    expect(container.querySelector('[data-session-export]')).not.toBeNull()
    expect(container.querySelector('[data-export-report="md"]')).not.toBeNull()
    expect(container.querySelector('[data-export-report="html"]')).not.toBeNull()
  })

  it('clicar em Markdown invoca o comando core com format md e baixa o arquivo', async () => {
    stubDownload()
    mockCore({
      get_session: () => SESSION_DETAIL,
      export_session_report: () => REPORT_MD,
    })

    const { container } = render(Home, { props: baseProps })
    await openDetail(container)

    const button = container.querySelector('[data-export-report="md"]') as HTMLElement
    await fireEvent.click(button)

    expect(invokeMock).toHaveBeenCalledWith('export_session_report', {
      sessionId: 'sess-1',
      format: 'md',
    })
    // Download via blob URL: um âncora com o filename foi acionada.
    expect(createObjectURLMock).toHaveBeenCalledTimes(1)
    const blob = createObjectURLMock.mock.calls[0]?.[0] as Blob
    expect(blob).toBeInstanceOf(Blob)
    expect(await blob.text()).toContain('Relatório da sessão')
    expect(clickSpy).toHaveBeenCalledTimes(1)
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toBe('relatorio-sessao-2026-01-15.md')
    // Feedback visível no padrão da Home.
    expect(container.querySelector('[data-export-feedback]')?.textContent).toContain(
      'relatorio-sessao-2026-01-15.md',
    )
  })

  it('opção HTML repassa format html', async () => {
    stubDownload()
    mockCore({
      get_session: () => SESSION_DETAIL,
      export_session_report: () => ({
        ...REPORT_MD,
        format: 'html',
        filename: 'relatorio-sessao-2026-01-15.html',
      }),
    })

    const { container } = render(Home, { props: baseProps })
    await openDetail(container)

    await fireEvent.click(container.querySelector('[data-export-report="html"]') as HTMLElement)
    expect(invokeMock).toHaveBeenCalledWith('export_session_report', {
      sessionId: 'sess-1',
      format: 'html',
    })
    const anchor = clickSpy?.mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toBe('relatorio-sessao-2026-01-15.html')
  })

  it('sem suporte a download, copia o conteúdo para a área de transferência', async () => {
    createObjectURLMock = vi.fn(() => {
      throw new Error('download unsupported')
    })
    URL.createObjectURL = createObjectURLMock as unknown as typeof URL.createObjectURL
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    mockCore({
      get_session: () => SESSION_DETAIL,
      export_session_report: () => REPORT_MD,
    })

    const { container } = render(Home, { props: baseProps })
    await openDetail(container)

    await fireEvent.click(container.querySelector('[data-export-report="md"]') as HTMLElement)
    expect(writeText).toHaveBeenCalledWith(REPORT_MD.content)
    expect(container.querySelector('[data-export-feedback]')?.textContent).toContain(
      'copiado para a área de transferência',
    )
  })

  it('falha do comando aparece como erro de exportação', async () => {
    stubDownload()
    mockCore({
      get_session: () => SESSION_DETAIL,
      export_session_report: () => {
        throw new Error('sidecar not started')
      },
    })

    const { container } = render(Home, { props: baseProps })
    await openDetail(container)

    await fireEvent.click(container.querySelector('[data-export-report="md"]') as HTMLElement)
    expect(container.querySelector('[data-export-error]')?.textContent).toContain(
      'Falha ao exportar',
    )
    expect(container.querySelector('[data-export-feedback]')).toBeNull()
  })
})
