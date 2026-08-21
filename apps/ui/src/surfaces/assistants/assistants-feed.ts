// Adaptador local de estado da biblioteca de assistentes (T-407) — mesmo
// padrão do state-feed.ts (T-405) e settings-feed.ts (T-406). O comando core
// que forneceria a lista e o assistente ativo ainda não existe
// (core/src/lib.rs registra apenas set_stealth/toggle_window/suggest/
// transcribe_pending_pcm) — quando existir, o feed padrão passa a lê-lo via
// invoke(). Por ora o padrão é um placeholder RESTRITIVO: lista vazia,
// nenhum ativo — a biblioteca nunca exibe assistentes inventados sem dado
// real.
import type { AssistantsState } from './types'

/** Fonte de estado da biblioteca: reavaliada a cada leitura, sem cache. */
export type AssistantsStateFeed = () => AssistantsState

/** Placeholder restritivo: lista vazia, nenhum assistente ativo. */
export const DEFAULT_ASSISTANTS_STATE: AssistantsState = {
  assistants: [],
  activeAssistantId: null,
}

let activeFeed: AssistantsStateFeed = () => DEFAULT_ASSISTANTS_STATE

/** Injeta uma fonte de estado (usada pelos testes e, no futuro, pelo core). */
export function setAssistantsStateFeed(feed: AssistantsStateFeed): void {
  activeFeed = feed
}

/** Volta ao placeholder restritivo. */
export function resetAssistantsStateFeed(): void {
  activeFeed = () => DEFAULT_ASSISTANTS_STATE
}

/** Lê o estado atual, reavaliando o feed a cada chamada (sem cache). */
export function readAssistantsState(): AssistantsState {
  return activeFeed()
}
