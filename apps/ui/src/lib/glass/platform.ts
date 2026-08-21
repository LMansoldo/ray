// Decisão de material por plataforma (SRS 8.2-8.3).
//
// macOS expõe vibrancy nativa na própria janela (NSVisualEffectView, ver
// core/src/windows.rs): quando ela existe o vidro NÃO é simulado em CSS.
// Fora do macOS o material vem de backdrop-filter; sem ele, resta o
// preenchimento sólido.

import { glassTokens } from './tokens'

export type GlassMode = 'native' | 'backdrop' | 'solid'

export type GlassSupport = {
  nativeVibrancyAvailable: boolean
  backdropFilterSupported: boolean
}

const MAC_PLATFORM_PATTERN = /mac/i
const MAC_USER_AGENT_PATTERN = /macintosh|mac os x/i

/** Escolhe o material: vibrancy nativa > backdrop-filter > sólido. */
export function resolveGlassMode(support: GlassSupport): GlassMode {
  if (support.nativeVibrancyAvailable) return 'native'
  if (support.backdropFilterSupported) return 'backdrop'
  return 'solid'
}

/** Lê da plataforma corrente o que está disponível para montar o vidro. */
export function detectGlassSupport(): GlassSupport {
  return {
    nativeVibrancyAvailable: isMacOs(),
    backdropFilterSupported: supportsBackdropFilter(),
  }
}

function isMacOs(): boolean {
  if (typeof navigator === 'undefined') return false
  if (MAC_PLATFORM_PATTERN.test(navigator.platform ?? '')) return true
  return MAC_USER_AGENT_PATTERN.test(navigator.userAgent ?? '')
}

function supportsBackdropFilter(): boolean {
  if (typeof CSS === 'undefined') return false
  return CSS.supports?.('backdrop-filter', `blur(${glassTokens.blur.surface})`) === true
}
