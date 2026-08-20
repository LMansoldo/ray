// Tokens do design system Liquid Glass (SRS 8.1-8.3).
// Fonte única de verdade do material de vidro: qualquer superfície da Fase 4
// consome estes valores em vez de redeclarar cor, blur ou sombra.
// Tamanhos sempre em rem (1rem = 10px, ver apps/ui/src/app.css).

/** Camadas que compõem o material de vidro. */
export type GlassTokenLayer = 'color' | 'blur' | 'refraction' | 'shadow'

export const glassTokens = {
  color: {
    /** Preenchimento translúcido padrão da superfície de vidro. */
    surface: 'rgba(255, 255, 255, 0.56)',
    /** Preenchimento opaco do fallback sem vidro (SRS 8.3). */
    surfaceSolid: 'rgb(248, 246, 250)',
    border: 'rgba(255, 255, 255, 0.64)',
    content: 'rgb(24, 22, 31)',
  },
  blur: {
    /** Raio do desfoque de fundo aplicado atrás da superfície. */
    surface: '1.6rem',
  },
  refraction: {
    /** Brilho diagonal que simula a refração da luz no vidro. */
    sheen:
      'linear-gradient(135deg, rgba(255, 255, 255, 0.85) 0%, rgba(255, 255, 255, 0.08) 100%)',
  },
  shadow: {
    /** Sombreamento que descola o painel do fundo. */
    background: '0 0.8rem 3.2rem rgba(8, 6, 13, 0.28)',
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
