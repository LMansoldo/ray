// Máquina de estados do stream de sugestão (T-403 / RF-332 + T-303): o core
// (ponte T-303) reemite cada SuggestStreamEvent como evento Tauri na ordem
// `start → token* → done/error` (ADR-005, T-102). Este redutor puro processa
// os eventos EM ORDEM DE CHEGADA — sem bufferizar, sem reordenar:
//   - `start` (re)inicia o stream: estado novo, texto zerado, contexto do
//     evento — também substitui um stream ativo;
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
import type { IpcError, ProviderKind, SuggestStreamEvent } from '../../../../../contracts/ipc'

export type SuggestionStreamStatus = 'idle' | 'streaming' | 'done' | 'error'

export interface SuggestionStreamState {
  status: SuggestionStreamStatus
  suggestionId: string | null
  contextLabel?: string
  theySaid?: string
  text: string
  providerKind?: ProviderKind
  model?: string
  error?: IpcError
}

export const INITIAL_SUGGESTION_STREAM: SuggestionStreamState = {
  status: 'idle',
  suggestionId: null,
  text: '',
}

/** Reduz um evento do stream no estado atual, sem mutar a entrada. */
export function reduceStreamEvent(
  state: SuggestionStreamState,
  event: SuggestStreamEvent,
): SuggestionStreamState {
  switch (event.type) {
    case 'start':
      return {
        status: 'streaming',
        suggestionId: event.suggestionId,
        contextLabel: event.contextLabel,
        theySaid: event.theySaid,
        text: '',
      }
    case 'token':
      if (state.status !== 'streaming') return state
      return { ...state, text: state.text + event.text }
    case 'done':
      if (state.status !== 'streaming') return state
      return {
        ...state,
        status: 'done',
        providerKind: event.providerKind,
        model: event.model,
      }
    case 'error':
      if (state.status !== 'streaming') return state
      return { ...state, status: 'error', error: event.error }
  }
}
