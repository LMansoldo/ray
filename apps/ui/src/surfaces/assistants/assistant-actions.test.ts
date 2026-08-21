import { describe, it, expect } from 'vitest'
import {
  dispatchAssistantAction,
  dispatchPromptImport,
  onAssistantAction,
  onPromptImport,
} from './assistant-actions'
import type { AssistantAction } from './assistant-actions'

// Contrato T-407 / RF-336, RF-337, RF-338: canal de ações declaradas da
// superfície Assistentes — a fronteira de SAÍDA do estado da UI (mesmo padrão
// de settings-actions.ts T-406, navigation.ts T-402, restart.ts T-405 e
// lib/glass/opacity.ts T-400). Nenhum comando core existe para listar/buscar/
// criar/trocar assistente (core/src/lib.rs registra apenas set_stealth/
// toggle_window/suggest/transcribe_pending_pcm): as ações saem por este canal
// pub/sub local e, quando os comandos existirem, o canal passa a chamá-los via
// invoke() — a UI NUNCA inventa um nome de comando por conta própria
// (general.md / frontend.md: o contrato é a fronteira). O canal de ENTRADA de
// prompt importado (onPromptImport/dispatchPromptImport) é o par assimétrico:
// o futuro leitor de arquivo nativo (core) entrega o Markdown aqui, e o
// criador o recebe no editor T-408.

describe('assistant-actions — canal de ações declaradas', () => {
  it('entrega assistantSelect ao listener inscrito com o payload completo', () => {
    const received: AssistantAction[] = []
    const unsubscribe = onAssistantAction((action: AssistantAction) => received.push(action))

    const action: AssistantAction = { type: 'assistantSelect', assistantId: 'a1' }
    dispatchAssistantAction(action)

    expect(received).toEqual([action])
    unsubscribe()
  })

  it('entrega assistantCreate ao listener inscrito com o payload completo (RF-338)', () => {
    const received: AssistantAction[] = []
    const unsubscribe = onAssistantAction((action: AssistantAction) => received.push(action))

    const action: AssistantAction = {
      type: 'assistantCreate',
      name: 'Novo resumo',
      category: 'MEETINGS',
      prompt: 'Resuma decisões e ações.',
    }
    dispatchAssistantAction(action)

    expect(received).toEqual([action])
    unsubscribe()
  })

  it('o retorno da inscrição cancela a entrega', () => {
    const received: AssistantAction[] = []
    const unsubscribe = onAssistantAction((action: AssistantAction) => received.push(action))

    unsubscribe()
    dispatchAssistantAction({ type: 'assistantSelect', assistantId: 'a1' })

    expect(received).toEqual([])
  })

  it('entrega a todos os listeners inscritos (fan-out)', () => {
    const first: AssistantAction[] = []
    const second: AssistantAction[] = []
    const unsubscribeFirst = onAssistantAction((action: AssistantAction) => first.push(action))
    const unsubscribeSecond = onAssistantAction((action: AssistantAction) => second.push(action))

    dispatchAssistantAction({ type: 'promptImportRequest' })

    expect(first).toEqual([{ type: 'promptImportRequest' }])
    expect(second).toEqual([{ type: 'promptImportRequest' }])
    unsubscribeFirst()
    unsubscribeSecond()
  })
})

describe('assistant-actions — canal de entrada de prompt importado', () => {
  it('dispatchPromptImport entrega o Markdown importado ao criador inscrito', () => {
    const received: string[] = []
    const unsubscribe = onPromptImport((prompt: string) => received.push(prompt))

    dispatchPromptImport('# Prompt\n\n```ts\nconst x = 1\n```')

    expect(received).toEqual(['# Prompt\n\n```ts\nconst x = 1\n```'])
    unsubscribe()
  })

  it('o retorno da inscrição do import cancela a entrega', () => {
    const received: string[] = []
    const unsubscribe = onPromptImport((prompt: string) => received.push(prompt))

    unsubscribe()
    dispatchPromptImport('conteúdo órfão')

    expect(received).toEqual([])
  })
})
