import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/svelte'
import App from '../../App.svelte'
import { glassTokens } from './tokens'

// TASKS.md T-400 "Pronto quando": um componente de exemplo renderiza com vidro.
// O App deve exibir uma superfície de vidro (translucidez + sombreamento).

vi.mock('./platform', () => ({
  detectGlassSupport: vi.fn(() => ({
    nativeVibrancyAvailable: false,
    backdropFilterSupported: true,
  })),
  resolveGlassMode: vi.fn(
    (support: { nativeVibrancyAvailable: boolean; backdropFilterSupported: boolean }) =>
      support.nativeVibrancyAvailable ? 'native' : support.backdropFilterSupported ? 'backdrop' : 'solid',
  ),
}))

afterEach(() => {
  cleanup()
})

function alphaOf(color: string): number {
  const match = color.match(/rgba?\([^)]*,\s*([\d.]+)\)/)
  expect(match, `cor inesperada: ${color}`).not.toBeNull()
  return Number(match?.[1])
}

describe('App — exemplo de vidro (T-400 Pronto quando)', () => {
  it('renderiza uma superfície de vidro', () => {
    const { container } = render(App)
    const panel = container.querySelector<HTMLElement>('[data-glass-panel]')
    expect(panel, 'o App deve renderizar um componente de vidro').not.toBeNull()
  })

  it('aplica translucidez na superfície de exemplo', () => {
    const { container } = render(App)
    const panel = container.querySelector<HTMLElement>('[data-glass-panel]')!
    const alpha = alphaOf(getComputedStyle(panel).backgroundColor)
    expect(alpha).toBeGreaterThan(0)
    expect(alpha).toBeLessThan(1)
  })

  it('aplica o sombreamento de fundo na superfície de exemplo', () => {
    const { container } = render(App)
    const panel = container.querySelector<HTMLElement>('[data-glass-panel]')!
    expect(getComputedStyle(panel).boxShadow.replace(/\s+/g, '')).toBe(
      glassTokens.shadow.background.replace(/\s+/g, ''),
    )
  })
})
