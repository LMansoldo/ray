// Histórico de insights do Notch (T-404 / RF-334): lista ORDENADA dos
// insights concluídos, indexada por suggestionId, com o markdown acumulado do
// insight (byte a byte — a renderização fica por conta do T-408 na exibição).
// Um insight entra no histórico exatamente quando o `done` chega com um stream
// EM ANDAMENTO (status 'streaming') — a mesma máquina de estados do T-403
// (reduceStreamEvent, reusada de ../overlay/stream, mesmo union
// SuggestStreamEvent de contracts/ipc.ts) fornece o estado corrente com o
// texto acumulado.
//
// O redutor é PURO: recebe (histórico, estado ANTES do evento, evento) e
// devolve o novo histórico, sem mutar a entrada. Evento ignorado devolve a
// MESMA referência (no-op de identidade, padrão do reduceStreamEvent T-403).
import type { ProviderKind, SuggestStreamEvent } from '../../../../../contracts/ipc'
import type { SuggestionStreamState } from '../overlay/stream'

export interface InsightHistoryEntry {
  suggestionId: string
  text: string
  providerKind?: ProviderKind
  model?: string
}

/**
 * Reduz um evento no histórico. Só o `done` com corrente em streaming anexa;
 * `token`, `start` e `error` nunca anexam, `done` sem start prévio é tolerado
 * (frontend.md) e um `done` após o terminal não duplica a entrada.
 */
export function reduceInsightHistory(
  history: readonly InsightHistoryEntry[],
  current: SuggestionStreamState,
  event: SuggestStreamEvent,
): readonly InsightHistoryEntry[] {
  if (event.type !== 'done') return history
  if (current.status !== 'streaming') return history
  if (current.suggestionId === null) return history

  const entry: InsightHistoryEntry = {
    suggestionId: current.suggestionId,
    text: current.text,
    providerKind: event.providerKind,
  }
  if (event.model !== undefined) {
    entry.model = event.model
  }
  return [...history, entry]
}
