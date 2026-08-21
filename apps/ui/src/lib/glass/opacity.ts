// Opacidade por superfície, ajustável em tempo real (RF-506 / SRS 8.4).
//
// Registro observável no lado da UI. É o ponto de acoplamento para o comando
// de opacidade exposto pelo core (core/src/windows.rs): quando ele existir,
// basta chamar setSurfaceOpacity() ao receber o evento — nenhum componente
// de vidro precisa mudar.

/** Superfícies com opacidade independente (SRS section 3). */
export type GlassSurfaceId = 'overlay' | 'notch' | 'home'

/** Opacidade de partida: vidro em intensidade total. */
export const DEFAULT_SURFACE_OPACITY = 1

type SurfaceOpacityListener = (value: number) => void

const values = new Map<GlassSurfaceId, number>()
const listeners = new Map<GlassSurfaceId, Set<SurfaceOpacityListener>>()

export function getSurfaceOpacity(surface: GlassSurfaceId): number {
  return values.get(surface) ?? DEFAULT_SURFACE_OPACITY
}

export function setSurfaceOpacity(surface: GlassSurfaceId, value: number): void {
  const clamped = clampUnit(value)
  values.set(surface, clamped)
  notify(surface, clamped)
}

export function resetSurfaceOpacity(surface: GlassSurfaceId): void {
  values.delete(surface)
  notify(surface, DEFAULT_SURFACE_OPACITY)
}

/** Observa uma superfície; o retorno cancela a inscrição. */
export function onSurfaceOpacityChange(
  surface: GlassSurfaceId,
  listener: SurfaceOpacityListener,
): () => void {
  const registered = listeners.get(surface) ?? new Set<SurfaceOpacityListener>()
  registered.add(listener)
  listeners.set(surface, registered)
  return () => {
    registered.delete(listener)
  }
}

function notify(surface: GlassSurfaceId, value: number): void {
  for (const listener of listeners.get(surface) ?? []) {
    listener(value)
  }
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value))
}
