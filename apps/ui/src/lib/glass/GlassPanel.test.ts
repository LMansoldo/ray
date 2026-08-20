import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/svelte'
import { createRawSnippet } from 'svelte'
import GlassPanel from './GlassPanel.svelte'
import { glassTokens } from './tokens'
import { resetSurfaceOpacity, setSurfaceOpacity } from './opacity'

// Contrato T-400 / SRS 8: componente base de vidro — translucidez, blur,
// refração, sombreamento de fundo, slot de conteúdo e opacidade ajustável.

// Em jsdom não há macOS nem backdrop-filter real; a detecção de plataforma é
// mockada. A lógica real de resolveGlassMode é testada em platform.test.ts.
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
  resetSurfaceOpacity('overlay')
  resetSurfaceOpacity('notch')
  resetSurfaceOpacity('home')
  cleanup()
})

function renderPanel(props: Record<string, unknown> = {}) {
  return render(GlassPanel, { props: { mode: 'backdrop', ...props } })
}

function panelElement(container: HTMLElement): HTMLElement {
  const panel = container.querySelector<HTMLElement>('[data-glass-panel]')
  expect(panel, 'o painel deve marcar a raiz com data-glass-panel').not.toBeNull()
  return panel!
}

function alphaOf(color: string): number {
  const match = color.match(/rgba?\([^)]*,\s*([\d.]+)\)/)
  expect(match, `cor inesperada: ${color}`).not.toBeNull()
  return Number(match?.[1])
}

function despace(value: string): string {
  return value.replace(/\s+/g, '')
}

describe('GlassPanel — smoke', () => {
  it('renderiza sem estourar com as opções padrão', () => {
    const { container } = render(GlassPanel)
    expect(panelElement(container)).toBeInstanceOf(HTMLElement)
  })
})

describe('GlassPanel — camada de tokens aplicada (SRS 8.1)', () => {
  it('aplica o fundo translúcido do token na superfície', () => {
    const { container } = renderPanel()
    const panel = panelElement(container)
    expect(despace(getComputedStyle(panel).backgroundColor)).toBe(
      despace(glassTokens.color.surface),
    )
  })

  it('aplica o blur de fundo via backdrop-filter no modo backdrop', () => {
    const { container } = renderPanel()
    const panel = panelElement(container)
    expect(despace(getComputedStyle(panel).backdropFilter)).toBe(
      despace(`blur(${glassTokens.blur.surface})`),
    )
  })

  it('aplica o sombreamento de fundo atrás do painel', () => {
    const { container } = renderPanel()
    const panel = panelElement(container)
    expect(despace(getComputedStyle(panel).boxShadow)).toBe(
      despace(glassTokens.shadow.background),
    )
  })

  it('aplica a borda e o raio da superfície', () => {
    const { container } = renderPanel()
    const panel = panelElement(container)
    expect(despace(getComputedStyle(panel).borderColor)).toBe(despace(glassTokens.color.border))
    expect(getComputedStyle(panel).borderRadius).toBe(glassTokens.radius.surface)
  })

  it('renderiza a camada de refração com o gradiente do token', () => {
    const { container } = renderPanel()
    const refraction = container.querySelector('[data-glass-refraction]')
    expect(refraction, 'o painel deve renderizar a camada de refração').not.toBeNull()
    expect(despace(refraction!.getAttribute('style') ?? '')).toContain(
      despace(glassTokens.refraction.sheen),
    )
  })

  it('renderiza o conteúdo do slot', () => {
    // Svelte 5: o slot padrão é o prop `children` (Snippet); montagem
    // imperativa usa createRawSnippet para fornecê-lo.
    const children = createRawSnippet(() => ({ render: () => 'Conteúdo do painel de vidro' }))
    const { getByText } = render(GlassPanel, { props: { mode: 'backdrop', children } })
    expect(getByText('Conteúdo do painel de vidro')).toBeDefined()
  })
})

describe('GlassPanel — modos de plataforma (SRS 8.2-8.3)', () => {
  it('não aplica backdrop-filter quando a vibrancy nativa está disponível', () => {
    const { container } = renderPanel({ mode: 'native' })
    const panel = panelElement(container)
    // 'none' é o valor inicial que o jsdom resolve quando a propriedade não
    // foi declarada — ou seja, nenhum blur em CSS (o material vem da janela).
    expect(getComputedStyle(panel).backdropFilter).toBe('none')
  })

  it('mantém a superfície translúcida no modo nativo (o material vem da janela)', () => {
    const { container } = renderPanel({ mode: 'native' })
    const panel = panelElement(container)
    expect(despace(getComputedStyle(panel).backgroundColor)).toBe(
      despace(glassTokens.color.surface),
    )
  })

  it('usa o fundo sólido e dispensa blur no fallback sólido', () => {
    const { container } = renderPanel({ mode: 'solid' })
    const panel = panelElement(container)
    expect(despace(getComputedStyle(panel).backgroundColor)).toBe(
      despace(glassTokens.color.surfaceSolid),
    )
    expect(getComputedStyle(panel).backdropFilter).toBe('none')
  })

  it('resolve o modo pela detecção de plataforma quando não informado', () => {
    // detectGlassSupport mockado reporta backdrop-filter disponível.
    const { container } = render(GlassPanel)
    const panel = panelElement(container)
    expect(despace(getComputedStyle(panel).backdropFilter)).toBe(
      despace(`blur(${glassTokens.blur.surface})`),
    )
  })
})

describe('GlassPanel — opacidade ajustável (SRS 8.4 / RF-506)', () => {
  it('escala o alfa do vidro com a prop de opacidade', () => {
    const { container } = renderPanel({ opacity: 0.5 })
    const panel = panelElement(container)
    const baseAlpha = alphaOf(glassTokens.color.surface)
    expect(alphaOf(getComputedStyle(panel).backgroundColor)).toBeCloseTo(baseAlpha * 0.5, 2)
  })

  it('usa opacidade total por padrão', () => {
    const { container } = renderPanel()
    const panel = panelElement(container)
    expect(alphaOf(getComputedStyle(panel).backgroundColor)).toBeCloseTo(
      alphaOf(glassTokens.color.surface),
      2,
    )
  })

  it('preserva a legibilidade: a raiz não recebe CSS opacity', () => {
    const { container } = renderPanel({ opacity: 0.5 })
    const panel = panelElement(container)
    expect(getComputedStyle(panel).opacity).toBe('1')
  })

  it('segue o valor global da superfície quando não há prop explícita', async () => {
    const { container } = renderPanel({ surface: 'overlay' })
    const panel = panelElement(container)
    const baseAlpha = alphaOf(glassTokens.color.surface)

    await act(() => {
      setSurfaceOpacity('overlay', 0.25)
    })
    expect(alphaOf(getComputedStyle(panel).backgroundColor)).toBeCloseTo(baseAlpha * 0.25, 2)
  })

  it('retorna à opacidade padrão quando a superfície é resetada', async () => {
    const { container } = renderPanel({ surface: 'overlay' })
    const panel = panelElement(container)
    const baseAlpha = alphaOf(glassTokens.color.surface)

    await act(() => {
      setSurfaceOpacity('overlay', 0.25)
    })
    await act(() => {
      resetSurfaceOpacity('overlay')
    })
    expect(alphaOf(getComputedStyle(panel).backgroundColor)).toBeCloseTo(baseAlpha, 2)
  })

  it('deixa a prop explícita prevalecer sobre o valor global da superfície', async () => {
    const { container } = renderPanel({ surface: 'overlay', opacity: 0.9 })
    const panel = panelElement(container)
    const baseAlpha = alphaOf(glassTokens.color.surface)

    await act(() => {
      setSurfaceOpacity('overlay', 0.3)
    })
    expect(alphaOf(getComputedStyle(panel).backgroundColor)).toBeCloseTo(baseAlpha * 0.9, 2)
  })
})
