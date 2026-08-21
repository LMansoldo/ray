import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  detectGlassSupport,
  resolveGlassMode,
  type GlassMode,
  type GlassSupport,
} from './platform'

// Contrato T-400 / SRS 8.2-8.3: vibrancy nativa quando disponível;
// backdrop-filter quando suportado; fallback sólido quando não.

function stubNavigator(platform: string | undefined, userAgent: string): void {
  Object.defineProperty(window.navigator, 'platform', {
    value: platform,
    configurable: true,
  })
  Object.defineProperty(window.navigator, 'userAgent', {
    value: userAgent,
    configurable: true,
  })
}

function stubCssSupports(result: boolean | undefined): void {
  vi.stubGlobal('CSS', result === undefined ? undefined : { supports: () => result })
}

const MAC_PLATFORM = 'MacIntel'
const MAC_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
const WINDOWS_PLATFORM = 'Win32'
const WINDOWS_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolveGlassMode — decisão de fallback', () => {
  it('usa vibrancy nativa quando disponível, mesmo sem backdrop-filter', () => {
    const support: GlassSupport = {
      nativeVibrancyAvailable: true,
      backdropFilterSupported: false,
    }
    expect(resolveGlassMode(support)).toBe('native')
  })

  it('prefere vibrancy nativa quando ambas estão disponíveis', () => {
    const support: GlassSupport = {
      nativeVibrancyAvailable: true,
      backdropFilterSupported: true,
    }
    expect(resolveGlassMode(support)).toBe('native')
  })

  it('usa backdrop-filter quando a vibrancy nativa não existe', () => {
    const support: GlassSupport = {
      nativeVibrancyAvailable: false,
      backdropFilterSupported: true,
    }
    expect(resolveGlassMode(support)).toBe('backdrop')
  })

  it('usa fallback sólido quando nada é suportado', () => {
    const support: GlassSupport = {
      nativeVibrancyAvailable: false,
      backdropFilterSupported: false,
    }
    expect(resolveGlassMode(support)).toBe('solid')
  })

  it('cobre os três modos do contrato', () => {
    const modes = new Set<GlassMode>()
    for (const nativeVibrancyAvailable of [true, false]) {
      for (const backdropFilterSupported of [true, false]) {
        modes.add(resolveGlassMode({ nativeVibrancyAvailable, backdropFilterSupported }))
      }
    }
    expect(modes).toEqual(new Set(['native', 'backdrop', 'solid']))
  })
})

describe('detectGlassSupport — detecção de plataforma', () => {
  it('detecta macOS pela platform e suporte a backdrop-filter pelo CSS', () => {
    stubNavigator(MAC_PLATFORM, WINDOWS_USER_AGENT)
    stubCssSupports(true)
    expect(detectGlassSupport()).toEqual({
      nativeVibrancyAvailable: true,
      backdropFilterSupported: true,
    })
  })

  it('detecta macOS pelo user agent quando a platform é vazia', () => {
    stubNavigator('', MAC_USER_AGENT)
    stubCssSupports(true)
    expect(detectGlassSupport().nativeVibrancyAvailable).toBe(true)
  })

  it('mantém vibrancy nativa disponível no macOS mesmo sem CSS backdrop-filter', () => {
    stubNavigator(MAC_PLATFORM, MAC_USER_AGENT)
    stubCssSupports(false)
    expect(detectGlassSupport()).toEqual({
      nativeVibrancyAvailable: true,
      backdropFilterSupported: false,
    })
  })

  it('não oferece vibrancy nativa fora do macOS', () => {
    stubNavigator(WINDOWS_PLATFORM, WINDOWS_USER_AGENT)
    stubCssSupports(true)
    expect(detectGlassSupport()).toEqual({
      nativeVibrancyAvailable: false,
      backdropFilterSupported: true,
    })
  })

  it('reporta fallback sólido fora do macOS sem backdrop-filter', () => {
    stubNavigator(WINDOWS_PLATFORM, WINDOWS_USER_AGENT)
    stubCssSupports(false)
    expect(detectGlassSupport()).toEqual({
      nativeVibrancyAvailable: false,
      backdropFilterSupported: false,
    })
  })

  it('trata ausência de CSS.supports como sem suporte a backdrop-filter', () => {
    stubNavigator(WINDOWS_PLATFORM, WINDOWS_USER_AGENT)
    stubCssSupports(undefined)
    expect(detectGlassSupport().backdropFilterSupported).toBe(false)
  })
})
