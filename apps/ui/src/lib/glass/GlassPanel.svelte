<script lang="ts">
  // Superfície base do design system Liquid Glass (SRS section 8).
  // Todo painel translúcido da Fase 4 nasce daqui — não duplicar este material.
  //
  // O material vem dos tokens e é aplicado inline porque a intensidade do
  // vidro é calculada em tempo de execução (modo da plataforma + opacidade da
  // superfície); o bloco de estilo abaixo cuida só do arranjo das camadas.
  import type { Snippet } from 'svelte'
  import { scaleAlpha } from './color'
  import {
    DEFAULT_SURFACE_OPACITY,
    getSurfaceOpacity,
    onSurfaceOpacityChange,
    type GlassSurfaceId,
  } from './opacity'
  import { detectGlassSupport, resolveGlassMode, type GlassMode } from './platform'
  import { glassTokens } from './tokens'

  let {
    opacity,
    surface,
    mode = resolveGlassMode(detectGlassSupport()),
    children,
  }: {
    /** Opacidade explícita; prevalece sobre o valor global da superfície. */
    opacity?: number
    /** Superfície cuja opacidade em tempo real este painel segue (RF-506). */
    surface?: GlassSurfaceId
    /** Material a usar; por padrão, o que a plataforma oferece. */
    mode?: GlassMode
    children?: Snippet
  } = $props()

  let surfaceOpacity = $state(DEFAULT_SURFACE_OPACITY)

  $effect(() =>
    trackSurfaceOpacity(surface, (value) => {
      surfaceOpacity = value
    }),
  )

  const effectiveOpacity = $derived(opacity ?? surfaceOpacity)
  const fill = $derived(
    mode === 'solid' ? glassTokens.color.surfaceSolid : glassTokens.color.surface,
  )
  const panelStyle = $derived(buildPanelStyle(fill, effectiveOpacity, mode))

  const refractionStyle = `background-image: ${glassTokens.refraction.sheen};`

  function readSurfaceOpacity(id: GlassSurfaceId | undefined): number {
    if (!id) return DEFAULT_SURFACE_OPACITY
    return getSurfaceOpacity(id)
  }

  /** Sincroniza com a superfície atual e passa a observá-la. */
  function trackSurfaceOpacity(
    id: GlassSurfaceId | undefined,
    apply: (value: number) => void,
  ): (() => void) | undefined {
    apply(readSurfaceOpacity(id))
    if (!id) return undefined
    return onSurfaceOpacityChange(id, apply)
  }

  function buildPanelStyle(color: string, alpha: number, material: GlassMode): string {
    const declarations = [
      `background-color: ${scaleAlpha(color, alpha)}`,
      `border-width: ${glassTokens.border.width}`,
      'border-style: solid',
      `border-color: ${glassTokens.color.border}`,
      `border-radius: ${glassTokens.radius.surface}`,
      `padding: ${glassTokens.padding.surface}`,
      `box-shadow: ${glassTokens.shadow.background}`,
      `color: ${glassTokens.color.content}`,
      ...blurDeclarations(material),
    ]
    return `${declarations.join('; ')};`
  }

  /**
   * Só o modo backdrop simula o vidro em CSS: no macOS o material vem da
   * vibrancy da janela (SRS 8.2) e no fallback sólido não há vidro algum.
   */
  function blurDeclarations(material: GlassMode): readonly string[] {
    if (material !== 'backdrop') return []
    const blur = `blur(${glassTokens.blur.surface})`
    return [`backdrop-filter: ${blur}`, `-webkit-backdrop-filter: ${blur}`]
  }
</script>

<div class="glass-panel" data-glass-panel data-glass-mode={mode} style={panelStyle}>
  <span
    class="glass-panel__refraction"
    data-glass-refraction
    aria-hidden="true"
    style={refractionStyle}
  ></span>
  <div class="glass-panel__content">
    {@render children?.()}
  </div>
</div>

<style>
  .glass-panel {
    position: relative;
    isolation: isolate;
  }

  .glass-panel__refraction {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
  }

  .glass-panel__content {
    position: relative;
  }
</style>
