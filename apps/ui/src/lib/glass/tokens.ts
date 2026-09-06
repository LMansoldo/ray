// Tokens do design system Liquid Glass (SRS 8.1-8.3).
// Fonte única de verdade do material de vidro: qualquer superfície da Fase 4
// consome estes valores em vez de redeclarar cor, blur ou sombra.
// Tamanhos sempre em rem (1rem = 10px, ver apps/ui/src/app.css).

/** Camadas que compõem o material de vidro. */
export type GlassTokenLayer = 'color' | 'blur' | 'refraction' | 'shadow'

export const glassTokens = {
  color: {
    /** Preenchimento translúcido padrão da superfície de vidro. */
    surface: 'rgba(22, 24, 36, 0.9)',
    /** Preenchimento opaco do fallback sem vidro (SRS 8.3). */
    surfaceSolid: 'rgb(22, 24, 36)',
    border: 'rgba(255, 255, 255, 0.09)',
    content: 'rgb(240, 240, 248)',
  },
  blur: {
    /** Raio do desfoque de fundo aplicado atrás da superfície. */
    surface: '2rem',
  },
  refraction: {
    /** Brilho sutil no topo que separa o painel do fundo escuro. */
    sheen:
      'linear-gradient(180deg, rgba(255, 255, 255, 0.06) 0%, transparent 50%)',
  },
  shadow: {
    /** Sombreamento que descola o painel do fundo escuro. */
    background: '0 2rem 6rem rgba(0, 0, 0, 0.55), 0 0.2rem 0.8rem rgba(0, 0, 0, 0.30)',
  },
  radius: {
    surface: '1.2rem',
  },
  padding: {
    surface: '1.6rem',
  },
  border: {
    width: '0.1rem',
  },
} as const
