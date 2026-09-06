import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/svelte'
import ConversationActions from './ConversationActions.svelte'
import type { ConversationActionsProps } from './types'

// Contrato T-402 / RF-333: as três ações de conversa da Home disparam o
// comando Tauri `suggest` (core/src/lib.rs) com o SuggestionTrigger correto:
//   Analisar Conversa -> ANALYZE_CONVERSATION
//   Capturar Tela     -> SCREEN_CAPTURE
//   Perguntar Algo    -> ASK_ANYTHING (prompt livre)
//
// O pacote `@tauri-apps/api` ainda não é dependência de apps/ui (o passo
// GREEN o adiciona); por isso o módulo é mockado via factory e a referência
// do mock chega por vi.hoisted — este arquivo de teste não importa o pacote
// estaticamente.

const { invokeMock } = vi.hoisted(() => ({
  // Assinatura real: invoke('suggest', { req }) -> Promise do Result<(), String>.
  invokeMock: vi
    .fn<(command: string, args?: unknown) => Promise<unknown>>()
    .mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

// Espelho estrito de contracts/ipc.ts SuggestRequest (core/src/ipc.rs,
// serde camelCase). Nenhum campo novo ou renomeado: divergência aqui é bug
// de contrato, não escolha de estilo.
interface SuggestPayload {
  sessionId: string
  assistantId: string
  trigger: string
  context: Array<{ speaker: string; text: string; startMs: number }>
  userPrompt?: string
  screenshots?: string[]
  selectionText?: string
  credential: {
    kind: string
    connectionMode: string
    secret: string
    baseUrl?: string
    model?: string
  }
}

// Props tipadas contra a fonte única de tipos da superfície (types.ts),
// não via ComponentProps<ConversationActions> — ver decisions.md (o shape
// legado { $on?; $set? } do svelte-check degrada ComponentProps para never).
type Props = ConversationActionsProps

// secret = secretRef (ponteiro no banco), nunca o segredo real (ADR-003).
const baseProps: Props = {
  sessionId: 'sess-1',
  assistantId: 'asst-1',
  context: [{ speaker: 'SELF', text: 'olá pessoal', startMs: 0 }],
  credential: { kind: 'OPENAI', connectionMode: 'API_KEY', secret: 'ref:key-1' },
}

afterEach(() => {
  invokeMock.mockClear()
  cleanup()
})

// Última chamada de invoke('suggest') validada e estreitada em runtime —
// nunca `any` (regra de Type Safety do repo).
function lastSuggestPayload(): SuggestPayload {
  const call = invokeMock.mock.calls.at(-1)
  expect(call, 'invoke deve ter sido chamado').toBeDefined()
  expect(call?.[0], 'o comando invocado deve ser "suggest"').toBe('suggest')
  const args = call?.[1]
  if (typeof args !== 'object' || args === null || !('req' in args)) {
    throw new Error(`invoke("suggest") sem o argumento { req } — recebido: ${JSON.stringify(args)}`)
  }
  const req = (args as { req: unknown }).req
  if (typeof req !== 'object' || req === null) {
    throw new Error(`req inválido — recebido: ${JSON.stringify(req)}`)
  }
  return req as SuggestPayload
}

describe('ConversationActions — ações disparam o comando suggest (RF-333)', () => {
  it('"Analisar Conversa" dispara invoke("suggest") com trigger ANALYZE_CONVERSATION', async () => {
    const { getByRole } = render(ConversationActions, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: 'Analisar Conversa' }))

    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(lastSuggestPayload()).toEqual({
      sessionId: 'sess-1',
      assistantId: 'asst-1',
      trigger: 'ANALYZE_CONVERSATION',
      context: [{ speaker: 'SELF', text: 'olá pessoal', startMs: 0 }],
      credential: { kind: 'OPENAI', connectionMode: 'API_KEY', secret: 'ref:key-1' },
    })
  })

  it('"Analisar Conversa" não envia prompt, capturas nem seleção', async () => {
    const { getByRole } = render(ConversationActions, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: 'Analisar Conversa' }))

    const req = lastSuggestPayload()
    expect(req.userPrompt).toBeUndefined()
    expect(req.screenshots).toBeUndefined()
    expect(req.selectionText).toBeUndefined()
  })

  it('"Capturar Tela" captura ao vivo (capture_screen) e envia o PNG com SCREEN_CAPTURE', async () => {
    const live = 'data:image/png;base64,Q0FQVFVSQQ=='
    invokeMock.mockImplementation((command: string) =>
      command === 'capture_screen' ? Promise.resolve(live) : Promise.resolve(undefined),
    )
    const stale = ['data:image/png;base64,AAAA']
    const { getByRole } = render(ConversationActions, {
      props: { ...baseProps, screenshots: stale },
    })
    await fireEvent.click(getByRole('button', { name: 'Capturar Tela' }))

    // 1º invoke: capture_screen (captura ao vivo); 2º: suggest.
    expect(invokeMock).toHaveBeenCalledTimes(2)
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'capture_screen')
    const req = lastSuggestPayload()
    expect(req.trigger).toBe('SCREEN_CAPTURE')
    // A captura ao vivo substitui o prop desatualizado.
    expect(req.screenshots).toEqual([live])
    expect(req.userPrompt).toBeUndefined()
  })

  it('"Capturar Tela" sem captura disponível cai para o prop e omite screenshots se vazio', async () => {
    // capture_screen rejeita (ex.: Screen Recording negado) — fallback ao prop.
    invokeMock.mockImplementation((command: string) =>
      command === 'capture_screen' ? Promise.reject(new Error('denied')) : Promise.resolve(undefined),
    )
    const { getByRole } = render(ConversationActions, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: 'Capturar Tela' }))

    expect(invokeMock).toHaveBeenCalledTimes(2)
    expect(lastSuggestPayload().screenshots).toBeUndefined()
  })

  it('"Perguntar Algo" coleta o prompt livre e dispara com trigger ASK_ANYTHING', async () => {
    const { getByRole, getByPlaceholderText } = render(ConversationActions, {
      props: baseProps,
    })

    await fireEvent.click(getByRole('button', { name: 'Perguntar Algo' }))
    // Abrir o prompt não dispara nada por si só.
    expect(invokeMock).not.toHaveBeenCalled()

    await fireEvent.input(getByPlaceholderText('Digite sua pergunta'), {
      target: { value: 'resuma os pontos-chave' },
    })
    await fireEvent.click(getByRole('button', { name: 'Perguntar' }))

    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(lastSuggestPayload()).toEqual({
      sessionId: 'sess-1',
      assistantId: 'asst-1',
      trigger: 'ASK_ANYTHING',
      context: [{ speaker: 'SELF', text: 'olá pessoal', startMs: 0 }],
      userPrompt: 'resuma os pontos-chave',
      credential: { kind: 'OPENAI', connectionMode: 'API_KEY', secret: 'ref:key-1' },
    })
  })

  it('passa adiante o ponteiro de credencial, nunca um segredo (ADR-003)', async () => {
    const { getByRole } = render(ConversationActions, { props: baseProps })
    await fireEvent.click(getByRole('button', { name: 'Analisar Conversa' }))

    // A UI só conhece o secretRef (ponteiro no banco); o núcleo resolve o
    // segredo no cofre nativo. O payload deve carregar o ponteiro como veio.
    expect(lastSuggestPayload().credential.secret).toBe('ref:key-1')
  })
})

describe('ConversationActions — atalhos (RF-333)', () => {
  it('cada ação exibe sua dica de atalho em um elemento kbd', () => {
    const { container } = render(ConversationActions, { props: baseProps })
    const hints = Array.from(container.querySelectorAll('kbd')).map(
      (element) => element.textContent?.trim() ?? '',
    )
    // Dicas casam com os defaults registrados no SO (RF-604 /
    // contracts/settings.ts): ⌘↩ = Perguntar/Enviar (analyze no core) e
    // ⌘E = Capturar Tela. "Perguntar Algo" não tem atalho global — é ação
    // de UI local (sem dica enganosa).
    expect(hints).toEqual(['⌘↩', '⌘E'])
  })

  it('renderiza os três botões de ação', () => {
    const { getByRole } = render(ConversationActions, { props: baseProps })
    expect(getByRole('button', { name: 'Analisar Conversa' })).toBeDefined()
    expect(getByRole('button', { name: 'Capturar Tela' })).toBeDefined()
    expect(getByRole('button', { name: 'Perguntar Algo' })).toBeDefined()
  })
})
