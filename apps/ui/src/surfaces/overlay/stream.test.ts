import { describe, it, expect } from 'vitest'
import {
  INITIAL_SUGGESTION_STREAM,
  reduceStreamEvent,
  type SuggestionStreamState,
} from './stream'
import type { SuggestStreamEvent } from '../../../../../contracts/ipc'

// Contrato T-403 / RF-332 + T-303: a máquina de estados do stream de sugestão.
// O core (T-303) reemite cada SuggestStreamEvent como evento Tauri na ordem
// `start → token* → done/error` (ADR-005, T-102). Este redutor puro processa
// os eventos EM ORDEM DE CHEGADA — sem bufferizar, sem reordenar. Semântica
// pinada (GREEN deve implementar exatamente isto):
//   - `start` (re)inicia o stream: estado novo, texto zerado, contexto do evento;
//   - `token` em streaming concatena em ordem exata de chegada;
//   - `done` em streaming finaliza e registra providerKind/model;
//   - `error` em streaming finaliza, PRESERVA o texto acumulado e registra o
//     IpcError completo;
//   - `done`/`error` são terminais até o próximo `start` (eventos posteriores
//     ignorados);
//   - `done`/`token`/`error` sem `start` prévio são tolerados (estado
//     inalterado, sem crash) — frontend.md: "don't assume done can arrive
//     without a preceding start";
//   - o redutor nunca muta o estado de entrada (função pura).

// Eventos de teste espelham o union SuggestStreamEvent (contracts/ipc.ts:130)
// 1:1 — nenhum campo novo ou renomeado (divergência é bug de contrato).
function startEvent(
  suggestionId: string,
  contextLabel?: string,
  theySaid?: string,
): SuggestStreamEvent {
  return { type: 'start', suggestionId, contextLabel, theySaid }
}

function tokenEvent(text: string): SuggestStreamEvent {
  return { type: 'token', text }
}

function doneEvent(
  providerKind: 'DEEPSEEK' | 'OPENAI' | 'ANTHROPIC' | 'GEMINI' | 'OPENROUTER' | 'GENERIC',
  model?: string,
): SuggestStreamEvent {
  return { type: 'done', providerKind, model }
}

function errorEvent(code: 'AGENT_ERROR' | 'PROVIDER_UNAVAILABLE', message: string): SuggestStreamEvent {
  return { type: 'error', error: { code, message } }
}

describe('stream — estado inicial e start (RF-332, T-303)', () => {
  it('o estado inicial é ocioso, sem sugestão e sem texto', () => {
    expect(INITIAL_SUGGESTION_STREAM).toEqual({
      status: 'idle',
      suggestionId: null,
      text: '',
    })
  })

  it('o start inicia o stream e semeia o contexto do card (RF-331)', () => {
    const state = reduceStreamEvent(
      INITIAL_SUGGESTION_STREAM,
      startEvent('s-1', 'Reunião de vendas', 'Qual o preço?'),
    )

    expect(state).toEqual({
      status: 'streaming',
      suggestionId: 's-1',
      contextLabel: 'Reunião de vendas',
      theySaid: 'Qual o preço?',
      text: '',
    })
  })

  it('o start sem contexto não preenche contexto nem fala do outro', () => {
    const state = reduceStreamEvent(INITIAL_SUGGESTION_STREAM, startEvent('s-2'))

    expect(state.status).toBe('streaming')
    expect(state.suggestionId).toBe('s-2')
    expect(state.contextLabel).toBeUndefined()
    expect(state.theySaid).toBeUndefined()
    expect(state.text).toBe('')
  })
})

describe('stream — tokens acumulam em ordem exata (RF-332)', () => {
  it('concatena os tokens na ordem de chegada, byte a byte', () => {
    let state: SuggestionStreamState = reduceStreamEvent(
      INITIAL_SUGGESTION_STREAM,
      startEvent('s-1'),
    )
    state = reduceStreamEvent(state, tokenEvent('Olá'))
    state = reduceStreamEvent(state, tokenEvent(' **mundo**'))
    state = reduceStreamEvent(state, tokenEvent('!'))

    // Ordem pinada: qualquer reordenação ou buffer-then-flatten muda a string.
    expect(state.text).toBe('Olá **mundo**!')
    expect(state.status).toBe('streaming')
  })

  it('tokens preservam espaços e formatação markdown exatamente como chegam', () => {
    let state: SuggestionStreamState = reduceStreamEvent(
      INITIAL_SUGGESTION_STREAM,
      startEvent('s-1'),
    )
    state = reduceStreamEvent(state, tokenEvent('\n- item 1\n- item 2\n'))

    expect(state.text).toBe('\n- item 1\n- item 2\n')
  })
})

describe('stream — done e error são terminais (RF-332, T-303)', () => {
  it('o done finaliza e registra providerKind e model', () => {
    let state: SuggestionStreamState = reduceStreamEvent(
      INITIAL_SUGGESTION_STREAM,
      startEvent('s-1'),
    )
    state = reduceStreamEvent(state, tokenEvent('Olá'))
    state = reduceStreamEvent(state, doneEvent('DEEPSEEK', 'deepseek-chat'))

    expect(state.status).toBe('done')
    expect(state.providerKind).toBe('DEEPSEEK')
    expect(state.model).toBe('deepseek-chat')
    expect(state.text).toBe('Olá')
  })

  it('o erro no meio do stream preserva o texto acumulado e registra o IpcError', () => {
    let state: SuggestionStreamState = reduceStreamEvent(
      INITIAL_SUGGESTION_STREAM,
      startEvent('s-1'),
    )
    state = reduceStreamEvent(state, tokenEvent('Olá'))
    state = reduceStreamEvent(state, errorEvent('AGENT_ERROR', 'provedor falhou'))

    expect(state.status).toBe('error')
    expect(state.error).toEqual({ code: 'AGENT_ERROR', message: 'provedor falhou' })
    expect(state.text, 'o texto acumulado antes do erro não pode ser perdido').toBe('Olá')
  })

  it('após o done, tokens e um novo erro são ignorados (estado fechado)', () => {
    let state: SuggestionStreamState = reduceStreamEvent(
      INITIAL_SUGGESTION_STREAM,
      startEvent('s-1'),
    )
    state = reduceStreamEvent(state, tokenEvent('Olá'))
    state = reduceStreamEvent(state, doneEvent('DEEPSEEK'))
    const afterDone = state

    state = reduceStreamEvent(state, tokenEvent(' **ignorado**'))
    expect(state).toEqual(afterDone)

    state = reduceStreamEvent(state, errorEvent('AGENT_ERROR', 'tarde demais'))
    expect(state).toEqual(afterDone)
  })

  it('após o error, tokens e um done são ignorados (estado fechado)', () => {
    let state: SuggestionStreamState = reduceStreamEvent(
      INITIAL_SUGGESTION_STREAM,
      startEvent('s-1'),
    )
    state = reduceStreamEvent(state, tokenEvent('Olá'))
    state = reduceStreamEvent(state, errorEvent('PROVIDER_UNAVAILABLE', 'sem conexão'))
    const afterError = state

    state = reduceStreamEvent(state, tokenEvent(' **ignorado**'))
    expect(state).toEqual(afterError)

    state = reduceStreamEvent(state, doneEvent('DEEPSEEK'))
    expect(state).toEqual(afterError)
  })
})

describe('stream — robustez sem start prévio (frontend.md)', () => {
  it('um done sem start prévio é tolerado: estado inalterado, sem crash', () => {
    const state = reduceStreamEvent(INITIAL_SUGGESTION_STREAM, doneEvent('DEEPSEEK'))

    expect(state).toEqual(INITIAL_SUGGESTION_STREAM)
  })

  it('um token sem start prévio é ignorado', () => {
    const state = reduceStreamEvent(INITIAL_SUGGESTION_STREAM, tokenEvent('solto'))

    expect(state).toEqual(INITIAL_SUGGESTION_STREAM)
  })

  it('um error sem start prévio é ignorado', () => {
    const state = reduceStreamEvent(
      INITIAL_SUGGESTION_STREAM,
      errorEvent('AGENT_ERROR', 'sem stream'),
    )

    expect(state).toEqual(INITIAL_SUGGESTION_STREAM)
  })
})

describe('stream — um novo start substitui o stream anterior', () => {
  it('reinicia com o novo suggestionId, contexto novo e texto zerado', () => {
    let state: SuggestionStreamState = reduceStreamEvent(
      INITIAL_SUGGESTION_STREAM,
      startEvent('s-1', 'Reunião de vendas', 'Qual o preço?'),
    )
    state = reduceStreamEvent(state, tokenEvent('Olá'))
    state = reduceStreamEvent(
      state,
      startEvent('s-2', 'Suporte técnico', 'O app não abre'),
    )

    expect(state).toEqual({
      status: 'streaming',
      suggestionId: 's-2',
      contextLabel: 'Suporte técnico',
      theySaid: 'O app não abre',
      text: '',
    })
  })

  it('reinicia mesmo depois de done ou error (novo ciclo)', () => {
    let state: SuggestionStreamState = reduceStreamEvent(
      INITIAL_SUGGESTION_STREAM,
      startEvent('s-1'),
    )
    state = reduceStreamEvent(state, doneEvent('DEEPSEEK'))
    state = reduceStreamEvent(state, startEvent('s-2'))
    state = reduceStreamEvent(state, tokenEvent('Novo'))

    expect(state.status).toBe('streaming')
    expect(state.suggestionId).toBe('s-2')
    expect(state.text).toBe('Novo')
    expect(state.providerKind).toBeUndefined()
  })
})

describe('stream — pureza do redutor', () => {
  it('não muta o estado de entrada', () => {
    const before: SuggestionStreamState = { ...INITIAL_SUGGESTION_STREAM }
    const beforeSnapshot = { ...before }

    reduceStreamEvent(before, startEvent('s-1', 'contexto'))
    expect(before).toEqual(beforeSnapshot)
    expect(before).toEqual(INITIAL_SUGGESTION_STREAM)
  })
})
