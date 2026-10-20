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
  meetingActive?: boolean
  /** Aviso transitório do núcleo (driver ausente, atalho não registrado…) */
  hint?: string
  /** RF-701: acompanhar a resposta mais recente (toggle Recursos). */
  autoScroll?: boolean
  /**
   * Template HTML+CSS do overlay customizado. null = built-in (InsightCard).
   * Resolvido pelo OverlayWindow a partir de get_app_settings e mantido ao
   * vivo via ray:overlay-template-changed.
   */
  customTemplate?: string | null
}

/** O card recebe o estado derivado do stream; 'idle' nunca chega a ele. */
export interface InsightCardProps {
  state: SuggestionStreamState
  /** RF-701: seguir o fim do conteúdo enquanto renderiza. */
  autoScroll?: boolean
}

/**
 * Card de overlay com template HTML+CSS do usuário (sem JS). O template chega
 * já resolvido (overlay-template.ts); o `state` é o mesmo SuggestionStreamState
 * do InsightCard — a troca de card é transparente para o stream.
 */
export interface CustomOverlayCardProps extends InsightCardProps {
  /** Template HTML+CSS com placeholders {{var}}. String não vazia. */
  template: string
}
