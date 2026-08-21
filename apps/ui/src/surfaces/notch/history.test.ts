import { describe, it, expect } from 'vitest'
import {
  INITIAL_SUGGESTION_STREAM,
  reduceStreamEvent,
  type SuggestionStreamState,
} from '../overlay/stream'
import type { SuggestStreamEvent } from '../../../../../contracts/ipc'
import { reduceInsightHistory, type InsightHistoryEntry } from './history'

// Contrato T-404 / RF-334: o histórico de insights do Notch é a lista
// ORDENADA de insights concluídos, indexada por suggestionId, com o markdown
// acumulado do insight. Um insight entra no histórico exatamente quando o
// evento `done` chega com um stream EM ANDAMENTO (status 'streaming') — a
// mesma máquina de estados do T-403 (reduceStreamEvent, reusada de
// ../overlay/stream — o mesmo union SuggestStreamEvent de contracts/ipc.ts)
// fornece o estado corrente com o texto acumulado.
//
// O redutor do histórico é PURO: recebe (histórico, estado ANTES do evento,
// evento) e devolve o novo histórico, sem mutar a entrada. Regras pinadas:
//   - `done` com corrente em streaming anexa { suggestionId, text,
//     providerKind, model } — o texto é o markdown acumulado ATÉ o done,
//     byte a byte (a renderização fica por conta do T-408 na exibição);
//   - `token`, `start` e `error` NUNCA anexam;
//   - `done` sem start prévio (frontend.md: "don't assume done can arrive
//     without a preceding start") é tolerado e não anexa;
//   - um segundo `done` após o terminal não duplica a entrada;
//   - evento ignorado devolve a MESMA referência (no-op de identidade,
//     padrão do reduceStreamEvent do T-403).

// Compõe as duas máquinas como o componente fará: o histórico é reduzido com
// o estado ANTES do evento; o estado corrente é reduzido com o evento.
function apply(
  current: SuggestionStreamState,
  history: readonly InsightHistoryEntry[],
  event: SuggestStreamEvent,
): { current: SuggestionStreamState; history: readonly InsightHistoryEntry[] } {
  return {
    current: reduceStreamEvent(current, event),
    history: reduceInsightHistory(history, current, event),
  }
}

describe('histórico de insights — conclusão de um insight (RF-334)', () => {
  it('o done anexa o insight concluído: suggestionId, markdown acumulado, provider e modelo', () => {
    let current = INITIAL_SUGGESTION_STREAM
    let history: readonly InsightHistoryEntry[] = []

    ;({ current } = apply(current, history, { type: 'start', suggestionId: 's-1' }))
    ;({ current } = apply(current, history, { type: 'token', text: 'Olá **mundo**' }))
    ;({ current, history } = apply(current, history, {
      type: 'done',
      providerKind: 'DEEPSEEK',
      model: 'deepseek-chat',
    }))

    expect(history).toEqual([
      { suggestionId: 's-1', text: 'Olá **mundo**', providerKind: 'DEEPSEEK', model: 'deepseek-chat' },
    ])
  })

  it('insights concluídos entram em ordem, cada um com seu id e seu texto', () => {
    let current = INITIAL_SUGGESTION_STREAM
    let history: readonly InsightHistoryEntry[] = []

    ;({ current } = apply(current, history, { type: 'start', suggestionId: 's-1' }))
    ;({ current } = apply(current, history, { type: 'token', text: 'Primeiro' }))
    ;({ current, history } = apply(current, history, { type: 'done', providerKind: 'DEEPSEEK' }))

    ;({ current } = apply(current, history, { type: 'start', suggestionId: 's-2' }))
    ;({ current } = apply(current, history, { type: 'token', text: 'Segundo' }))
    ;({ current, history } = apply(current, history, { type: 'done', providerKind: 'OPENAI' }))

    expect(history).toEqual([
      { suggestionId: 's-1', text: 'Primeiro', providerKind: 'DEEPSEEK' },
      { suggestionId: 's-2', text: 'Segundo', providerKind: 'OPENAI' },
    ])
  })

  it('o texto é preservado byte a byte, inclusive quebras de linha de markdown', () => {
    let current = INITIAL_SUGGESTION_STREAM
    let history: readonly InsightHistoryEntry[] = []

    ;({ current } = apply(current, history, { type: 'start', suggestionId: 's-1' }))
    ;({ current } = apply(current, history, { type: 'token', text: '\n- item 1\n- item 2\n' }))
    ;({ current, history } = apply(current, history, { type: 'done', providerKind: 'DEEPSEEK' }))

    expect(history[0]?.text).toBe('\n- item 1\n- item 2\n')
  })
})

describe('histórico de insights — o que NÃO entra (RF-334, frontend.md)', () => {
  it('token e start em andamento não anexam nada', () => {
    let current = INITIAL_SUGGESTION_STREAM
    let history: readonly InsightHistoryEntry[] = []

    ;({ current } = apply(current, history, { type: 'start', suggestionId: 's-1' }))
    ;({ current, history } = apply(current, history, { type: 'token', text: 'ainda não concluído' }))
    ;({ current, history } = apply(current, history, { type: 'token', text: '...' }))

    expect(history).toEqual([])
    expect(current.status).toBe('streaming')
  })

  it('erro não anexa o insight ao histórico, mesmo com texto acumulado', () => {
    let current = INITIAL_SUGGESTION_STREAM
    let history: readonly InsightHistoryEntry[] = []

    ;({ current } = apply(current, history, { type: 'start', suggestionId: 's-1' }))
    ;({ current } = apply(current, history, { type: 'token', text: 'Falhou' }))
    ;({ current, history } = apply(current, history, {
      type: 'error',
      error: { code: 'AGENT_ERROR', message: 'provedor falhou' },
    }))

    expect(history, 'erro não conclui insight').toEqual([])
    expect(current.status).toBe('error')
  })

  it('done sem start prévio é tolerado: não anexa nada e não quebra', () => {
    const current = INITIAL_SUGGESTION_STREAM
    const history: readonly InsightHistoryEntry[] = []

    const next = apply(current, history, { type: 'done', providerKind: 'DEEPSEEK' })

    expect(next.current.status).toBe('idle')
    expect(next.history).toEqual([])
  })

  it('done após o terminal não duplica a entrada', () => {
    let current = INITIAL_SUGGESTION_STREAM
    let history: readonly InsightHistoryEntry[] = []

    ;({ current } = apply(current, history, { type: 'start', suggestionId: 's-1' }))
    ;({ current } = apply(current, history, { type: 'token', text: 'Único' }))
    ;({ current, history } = apply(current, history, { type: 'done', providerKind: 'DEEPSEEK' }))

    const after = apply(current, history, { type: 'done', providerKind: 'OPENAI' })
    expect(after.history).toEqual([
      { suggestionId: 's-1', text: 'Único', providerKind: 'DEEPSEEK' },
    ])
  })
})

describe('histórico de insights — pureza e robustez do redutor', () => {
  it('nunca muta o histórico de entrada', () => {
    const frozen: readonly InsightHistoryEntry[] = [
      { suggestionId: 's-0', text: 'Antigo', providerKind: 'DEEPSEEK' },
    ]
    const current: SuggestionStreamState = {
      status: 'streaming',
      suggestionId: 's-1',
      text: 'Novo',
    }

    const next = reduceInsightHistory(frozen, current, { type: 'done', providerKind: 'OPENAI' })

    expect(frozen).toEqual([{ suggestionId: 's-0', text: 'Antigo', providerKind: 'DEEPSEEK' }])
    expect(frozen).toHaveLength(1)
    expect(next).toHaveLength(2)
    expect(next[0]).toBe(frozen[0])
  })

  it('evento ignorado devolve a MESMA referência (no-op de identidade)', () => {
    const frozen: readonly InsightHistoryEntry[] = []
    const current: SuggestionStreamState = {
      status: 'streaming',
      suggestionId: 's-1',
      text: 'em andamento',
    }

    const result = reduceInsightHistory(frozen, current, { type: 'token', text: 'x' })
    expect(result).toBe(frozen)
  })

  it('estado streaming sem suggestionId (defensivo) não anexa nem quebra', () => {
    const current: SuggestionStreamState = {
      status: 'streaming',
      suggestionId: null,
      text: 'sem id',
    }
    const history: readonly InsightHistoryEntry[] = []

    const next = reduceInsightHistory(history, current, { type: 'done', providerKind: 'DEEPSEEK' })
    expect(next).toEqual([])
  })
})
