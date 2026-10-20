import { describe, it, expect, afterEach } from 'vitest'
import {
  DEFAULT_ASSISTANTS_STATE,
  readAssistantsState,
  resetAssistantsStateFeed,
  setAssistantsStateFeed,
} from './assistants-feed'
import type { AssistantView, AssistantsState } from './types'

// Contrato T-407: adaptador local de estado da biblioteca de assistentes —
// mesmo padrão do state-feed.ts (T-405) e settings-feed.ts (T-406). O comando
// core que forneceria a lista e o assistente ativo ainda não existe
// (core/src/lib.rs registra apenas set_stealth/toggle_window/suggest/
// transcribe_pending_pcm) — quando existir, o feed padrão passa a lê-lo via
// invoke(). Por ora o padrão é um placeholder RESTRITIVO: lista vazia, nenhum
// ativo — a biblioteca nunca exibe assistentes inventados sem dado real.

describe('assistants-feed — placeholder restritivo (sem comando core)', () => {
  it('o padrão declara lista vazia e nenhum assistente ativo', () => {
    const state = readAssistantsState()

    expect(state).toEqual(DEFAULT_ASSISTANTS_STATE)
    expect(state.assistants).toEqual([])
    expect(state.activeAssistantId).toBeNull()
  })
})

describe('assistants-feed — injeção e leitura', () => {
  afterEach(() => {
    resetAssistantsStateFeed()
  })

  it('a leitura reavalia o feed a cada chamada (sem cache)', () => {
    const state: AssistantsState = {
      assistants: [{ id: 'a1', name: 'Generalista', category: 'GENERAL', prompt: 'Prompt.', source: 'USER' }],
      activeAssistantId: 'a1',
    }

    setAssistantsStateFeed(() => state)
    expect(readAssistantsState().assistants).toHaveLength(1)

    state.assistants = []
    state.activeAssistantId = null
    expect(readAssistantsState().assistants).toEqual([])
    expect(readAssistantsState().activeAssistantId).toBeNull()
  })

  it('o feed injetado entrega a lista completa com o ativo', () => {
    const state: AssistantsState = {
      assistants: [
        { id: 'a1', name: 'Generalista', category: 'GENERAL', prompt: 'Você é geral.', source: 'USER' },
        { id: 'a2', name: 'Resumo de vendas', category: 'SALES', prompt: 'Qualifique.', source: 'USER' },
      ],
      activeAssistantId: 'a2',
    }

    setAssistantsStateFeed(() => state)
    const read = readAssistantsState()

    expect(read.assistants.map((assistant: AssistantView) => assistant.id)).toEqual(['a1', 'a2'])
    expect(read.activeAssistantId).toBe('a2')
  })

  it('resetAssistantsStateFeed() volta ao placeholder restritivo', () => {
    setAssistantsStateFeed(() => ({
      assistants: [{ id: 'a1', name: 'Generalista', category: 'GENERAL', prompt: 'Prompt.', source: 'USER' }],
      activeAssistantId: 'a1',
    }))
    expect(readAssistantsState().assistants).toHaveLength(1)

    resetAssistantsStateFeed()

    expect(readAssistantsState()).toEqual(DEFAULT_ASSISTANTS_STATE)
  })
})
