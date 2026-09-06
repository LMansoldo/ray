import { describe, it, expect } from 'vitest'
import { glassTokens, type GlassTokenLayer } from './tokens'

// Contrato T-400 / SRS 8.3: tokens de vidro (color/blur/refraction/shadow)
// com valores em rem, superfície translúcida e sombreamento de fundo.

const TOKEN_LAYERS: readonly GlassTokenLayer[] = ['color', 'blur', 'refraction', 'shadow']

describe('glassTokens — camadas de token (SRS 8.3)', () => {
  it('expõe as quatro camadas do material de vidro', () => {
    for (const layer of TOKEN_LAYERS) {
      expect(glassTokens[layer], `camada ausente: ${layer}`).toBeDefined()
    }
  })

  it('expõe os tokens de apoio (raio e respiro da superfície)', () => {
    expect(glassTokens.radius.surface).toBeDefined()
    expect(glassTokens.padding.surface).toBeDefined()
  })
})

describe('glassTokens — valores fixados pelo contrato', () => {
  it('fixa a cor translúcida da superfície', () => {
    expect(glassTokens.color.surface).toBe('rgba(22, 24, 36, 0.9)')
  })

  it('fixa a cor sólida do fallback', () => {
    expect(glassTokens.color.surfaceSolid).toBe('rgb(22, 24, 36)')
  })

  it('fixa a borda de vidro e a cor de conteúdo', () => {
    expect(glassTokens.color.border).toBe('rgba(255, 255, 255, 0.09)')
    expect(glassTokens.color.content).toBe('rgb(240, 240, 248)')
  })

  it('fixa o raio de blur em rem', () => {
    expect(glassTokens.blur.surface).toBe('2rem')
  })

  it('fixa a camada de refração como gradiente', () => {
    expect(glassTokens.refraction.sheen).toBe(
      'linear-gradient(180deg, rgba(255, 255, 255, 0.06) 0%, transparent 50%)',
    )
  })

  it('fixa o sombreamento de fundo atrás dos painéis', () => {
    expect(glassTokens.shadow.background).toBe(
      '0 2rem 6rem rgba(0, 0, 0, 0.55), 0 0.2rem 0.8rem rgba(0, 0, 0, 0.30)',
    )
  })

  it('fixa raio e respiro da superfície em rem', () => {
    expect(glassTokens.radius.surface).toBe('1.2rem')
    expect(glassTokens.padding.surface).toBe('1.6rem')
  })
})

describe('glassTokens — regras estruturais', () => {
  it('usa apenas rem para tamanhos — nunca px', () => {
    const sizes = [
      glassTokens.blur.surface,
      glassTokens.radius.surface,
      glassTokens.padding.surface,
      glassTokens.shadow.background,
    ]
    for (const size of sizes) {
      expect(size).toMatch(/rem/)
      expect(size).not.toMatch(/px/)
    }
  })

  it('mantém a superfície translúcida (alfa menor que 1)', () => {
    const alpha = alphaOf(glassTokens.color.surface)
    expect(alpha).toBeGreaterThan(0)
    expect(alpha).toBeLessThan(1)
  })

  it('mantém o fallback sólido opaco', () => {
    expect(glassTokens.color.surfaceSolid).not.toMatch(/rgba/)
  })

  it('dá cor ao sombreamento de fundo', () => {
    expect(glassTokens.shadow.background).toMatch(/rgba\(/)
  })
})

function alphaOf(color: string): number {
  const match = color.match(/rgba?\([^)]*,\s*([\d.]+)\)/)
  expect(match, `cor inesperada: ${color}`).not.toBeNull()
  return Number(match?.[1])
}
