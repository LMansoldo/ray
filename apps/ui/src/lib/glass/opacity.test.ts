import { describe, it, expect, afterEach } from 'vitest'
import {
  DEFAULT_SURFACE_OPACITY,
  getSurfaceOpacity,
  onSurfaceOpacityChange,
  resetSurfaceOpacity,
  setSurfaceOpacity,
  type GlassSurfaceId,
} from './opacity'

// SRS 8.4 / RF-506: opacidade das superfícies ajustável em tempo real.
// Mecanismo consumível pelo futuro comando de opacidade do core (T-304).

const SURFACES: readonly GlassSurfaceId[] = ['overlay', 'notch', 'home']

afterEach(() => {
  for (const surface of SURFACES) {
    resetSurfaceOpacity(surface)
  }
})

describe('opacity — estado padrão', () => {
  it('expõe a opacidade padrão total', () => {
    expect(DEFAULT_SURFACE_OPACITY).toBe(1)
  })

  it('reporta a opacidade padrão para todas as superfícies', () => {
    for (const surface of SURFACES) {
      expect(getSurfaceOpacity(surface)).toBe(DEFAULT_SURFACE_OPACITY)
    }
  })
})

describe('opacity — ajuste em tempo real', () => {
  it('propaga o valor definido para a superfície', () => {
    setSurfaceOpacity('overlay', 0.4)
    expect(getSurfaceOpacity('overlay')).toBe(0.4)
  })

  it('isola a opacidade por superfície', () => {
    setSurfaceOpacity('overlay', 0.4)
    expect(getSurfaceOpacity('notch')).toBe(DEFAULT_SURFACE_OPACITY)
    expect(getSurfaceOpacity('home')).toBe(DEFAULT_SURFACE_OPACITY)
  })

  it('restaura a opacidade padrão com reset', () => {
    setSurfaceOpacity('notch', 0.25)
    resetSurfaceOpacity('notch')
    expect(getSurfaceOpacity('notch')).toBe(DEFAULT_SURFACE_OPACITY)
  })

  it('notifica mudanças apenas na superfície observada', () => {
    const calls: number[] = []
    const unsubscribe = onSurfaceOpacityChange('home', (value: number) => {
      calls.push(value)
    })

    setSurfaceOpacity('overlay', 0.6)
    expect(calls).toEqual([])

    setSurfaceOpacity('home', 0.3)
    expect(calls).toEqual([0.3])

    unsubscribe()
    setSurfaceOpacity('home', 0.8)
    expect(calls).toEqual([0.3])
  })
})
