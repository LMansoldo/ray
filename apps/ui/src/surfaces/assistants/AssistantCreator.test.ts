import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte'
import Assistants from './Assistants.svelte'
import { dispatchPromptImport, onAssistantAction } from './assistant-actions'
import type { AssistantAction } from './assistant-actions'

// Contrato T-407 / RF-338 — criador de assistente: o prompt entra num campo
// Markdown via o editor Milkdown do T-408 (MarkdownEditor, lib/editor) — o
// item T-408 declara "consumido por T-407 (edição de prompt de assistente)".
// Markdown entra e Markdown sai: nenhum round-trip para HTML (ADR-011). A
// criação despacha assistantCreate pelo canal declarado (assistant-actions.ts)
// — nenhum comando core de criação existe (core/src/lib.rs registra apenas
// set_stealth/toggle_window/suggest/transcribe_pending_pcm); o POST
// /assistants do contrato (CreateAssistantRequest) é a metade sidecar/core —
// coverageMap com coveredBy vazio. O prompt importado chega pelo canal
// onPromptImport (o leitor de arquivo nativo é core-side). A UI NUNCA inventa
// um comando invoke() (frontend.md): o mock é uma GUARDA.

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi
    .fn<(command: string, args?: unknown) => Promise<unknown>>()
    .mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

// Fixture do T-408 (MarkdownEditor.test.ts): o bloco de código precisa
// sobreviver ao round-trip pelo modelo Milkdown sem corrupção, byte a byte
// (a cerca de fechamento deixa UMA quebra de linha no conteúdo serializado —
// CommonMark; os testes do T-408 pinam CODE + '\n').
const CODE = `const x = "olá"; // <&>\nfunction f(): void {\n  return x\n}`
const FENCED = '```ts\n' + CODE + '\n```'
const INITIAL = 'Intro\n\n' + FENCED

function extractCodeBlock(markdown: string): string {
  const match = markdown.match(/```ts\n([\s\S]*?)```/)
  expect(match, 'o markdown deve conter um bloco de código ```ts').not.toBeNull()
  return match![1]
}

function elementOrThrow(container: HTMLElement, selector: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(selector)
  if (!element) {
    throw new Error(`${selector} não encontrado`)
  }
  return element
}

async function openCreator() {
  const result = render(Assistants)
  await fireEvent.click(result.getByRole('button', { name: /novo assistente/i }))

  expect(result.container.querySelector('[data-assistant-creator]')).not.toBeNull()

  // O editor Milkdown monta de forma assíncrona (Editor.make()); o handle é
  // entregue via onready antes da .ProseMirror existir no DOM (T-408).
  await waitFor(
    () => {
      expect(result.container.querySelector('.ProseMirror')).not.toBeNull()
    },
    { timeout: 5000 },
  )
  return result
}

async function typeName(container: HTMLElement, value: string): Promise<void> {
  await fireEvent.input(elementOrThrow(container, '[data-assistant-name-input]'), {
    target: { value },
  })
}

async function selectCreatorCategory(container: HTMLElement, value: string): Promise<void> {
  await fireEvent.change(elementOrThrow(container, '[data-assistant-category-select]'), {
    target: { value },
  })
}

afterEach(() => {
  cleanup()
  invokeMock.mockClear()
})

describe('criador — contrato do formulário (RF-338, T-408)', () => {
  it('abre com o editor Milkdown do T-408 e os campos de nome e categoria', async () => {
    const { container, getByRole } = await openCreator()

    expect(container.querySelector('[data-assistant-library]')).toBeNull()
    expect(container.querySelector('[data-markdown-editor]')).not.toBeNull()
    expect(elementOrThrow(container, '[data-assistant-name-input]')).not.toBeNull()
    expect(getByRole('button', { name: /criar assistente/i })).not.toBeNull()
    expect(getByRole('button', { name: /voltar/i })).not.toBeNull()
  })

  it('oferece as 7 categorias do contrato na ordem, com GENERAL como padrão', async () => {
    const { container } = await openCreator()
    const select = elementOrThrow(container, '[data-assistant-category-select]')
    const options = Array.from(select.querySelectorAll('option'))

    expect(options.map((option) => option.value)).toEqual([
      'GENERAL',
      'MEETINGS',
      'SALES',
      'TRANSLATION',
      'INTERVIEW',
      'STUDY',
      'CUSTOM',
    ])
    expect((select as HTMLSelectElement).value).toBe('GENERAL')
  })

  it("'Voltar' retorna à biblioteca e desmonta o editor", async () => {
    const { container, getByRole } = await openCreator()

    await fireEvent.click(getByRole('button', { name: /voltar/i }))

    expect(container.querySelector('[data-assistant-library]')).not.toBeNull()
    expect(container.querySelector('[data-assistant-creator]')).toBeNull()
    expect(container.querySelector('.ProseMirror')).toBeNull()
  })
})

describe('criador — round-trip do prompt pelo editor (RF-338, ADR-011)', () => {
  it('cria com o prompt importado cruzando o editor como Markdown fiel (bloco intacto, sem HTML)', async () => {
    const received: AssistantAction[] = []
    const unsubscribe = onAssistantAction((action: AssistantAction) => received.push(action))
    const { container, getByRole } = await openCreator()

    dispatchPromptImport(INITIAL)
    const proseMirror = elementOrThrow(container, '.ProseMirror')
    await waitFor(
      () => {
        expect(proseMirror.textContent ?? '').toContain('Intro')
      },
      { timeout: 5000 },
    )

    await typeName(container, 'Novo resumo')
    await selectCreatorCategory(container, 'MEETINGS')
    await fireEvent.click(getByRole('button', { name: /criar assistente/i }))

    expect(received).toHaveLength(1)
    const [action] = received
    expect(action, 'a criação deve despachar assistantCreate').toMatchObject({
      type: 'assistantCreate',
      name: 'Novo resumo',
      category: 'MEETINGS',
    })
    if (!action || action.type !== 'assistantCreate') {
      throw new Error('ação inesperada: esperado assistantCreate')
    }

    // O prompt despachado é o Markdown serializado pelo modelo Milkdown
    // (parse -> serialize), não HTML do DOM: o bloco de código sobrevive
    // byte a byte e nenhum artefato HTML aparece (ADR-011).
    const prompt = action.prompt
    expect(extractCodeBlock(prompt)).toBe(CODE + '\n')
    expect(prompt).toContain('Intro')
    expect(prompt).toContain('```ts')
    for (const htmlArtifact of ['<pre', '<p>', '<code', '<strong']) {
      expect(prompt, 'o prompt deve sair como Markdown, não HTML').not.toContain(htmlArtifact)
    }
    unsubscribe()
  })

  it('nome vazio não despacha criação', async () => {
    const received: AssistantAction[] = []
    const unsubscribe = onAssistantAction((action: AssistantAction) => received.push(action))
    const { container, getByRole } = await openCreator()

    dispatchPromptImport(INITIAL)
    await waitFor(
      () => {
        expect(elementOrThrow(container, '.ProseMirror').textContent ?? '').toContain('Intro')
      },
      { timeout: 5000 },
    )
    await fireEvent.click(getByRole('button', { name: /criar assistente/i }))

    expect(received).toEqual([])
    unsubscribe()
  })

  it('prompt vazio não despacha criação', async () => {
    const received: AssistantAction[] = []
    const unsubscribe = onAssistantAction((action: AssistantAction) => received.push(action))
    const { container, getByRole } = await openCreator()

    await typeName(container, 'Sem prompt')
    await fireEvent.click(getByRole('button', { name: /criar assistente/i }))

    expect(received).toEqual([])
    unsubscribe()
  })

  it('nenhum fluxo do criador chama invoke() (não existem comandos core)', async () => {
    const { container, getByRole } = await openCreator()

    dispatchPromptImport(INITIAL)
    await waitFor(
      () => {
        expect(elementOrThrow(container, '.ProseMirror').textContent ?? '').toContain('Intro')
      },
      { timeout: 5000 },
    )
    await typeName(container, 'Novo resumo')
    await selectCreatorCategory(container, 'SALES')
    await fireEvent.click(getByRole('button', { name: /criar assistente/i }))

    expect(invokeMock).not.toHaveBeenCalled()
  })
})
