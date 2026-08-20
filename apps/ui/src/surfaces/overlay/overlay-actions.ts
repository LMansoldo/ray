// Canal da ação contextual do card de insight (T-403 / RF-331): "Ver caso
// de uso" emite a ação num canal pub/sub local — padrão home/navigation.ts
// (T-402), onboarding/restart.ts (T-405) e lib/glass/opacity.ts (T-400).
// Não existe comando core para "abrir caso de uso" (core/src/lib.rs registra
// apenas set_stealth/toggle_window/suggest/transcribe_pending_pcm) e
// frontend.md proíbe a UI de inventar um — quem monta as janelas decide o
// destino quando a camada App existir.

export type OverlayAction = { type: 'viewUseCase'; suggestionId: string }

type OverlayActionListener = (action: OverlayAction) => void

const listeners = new Set<OverlayActionListener>()

/** Observa ações do overlay; o retorno cancela a inscrição. */
export function onOverlayAction(listener: OverlayActionListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Emite a ação para todos os inscritos. */
export function dispatchOverlayAction(action: OverlayAction): void {
  for (const listener of listeners) {
    listener(action)
  }
}
