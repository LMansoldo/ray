// Tipos da superfície Overlay (T-403 / RF-012 + RF-331): fonte única dos
// contratos de props — precedente T-402 attempt 3: ComponentProps<.svelte>
// degrada para never sob o svelte-check (shape legado Svelte 4).
import type { SuggestionStreamState } from './stream'

/** Posição do overlay em pixels de deslocamento (controlada pelo core). */
export interface OverlayPosition {
  x: number
  y: number
}

export interface OverlayProps {
  position?: OverlayPosition
}

/** O card recebe o estado derivado do stream; 'idle' nunca chega a ele. */
export interface InsightCardProps {
  state: SuggestionStreamState
}
