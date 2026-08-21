// Composição de cor dos tokens de vidro.
//
// A opacidade da superfície escala o ALFA do preenchimento, nunca a
// propriedade CSS `opacity` da raiz — esta apagaria também o conteúdo e
// destruiria a legibilidade do painel.

const RGB_PATTERN = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/
const ALPHA_PRECISION = 1e4

/**
 * Multiplica o alfa de uma cor rgb()/rgba() por um fator em [0, 1].
 * Cores fora desse formato passam intactas (não há alfa para escalar).
 */
export function scaleAlpha(color: string, factor: number): string {
  const channels = RGB_PATTERN.exec(color)
  if (!channels) return color

  const [, red, green, blue, alpha] = channels
  const scaled = roundAlpha(clampUnit(Number(alpha ?? 1) * clampUnit(factor)))
  if (scaled >= 1) return `rgb(${red}, ${green}, ${blue})`
  return `rgba(${red}, ${green}, ${blue}, ${scaled})`
}

function roundAlpha(value: number): number {
  return Math.round(value * ALPHA_PRECISION) / ALPHA_PRECISION
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value))
}
