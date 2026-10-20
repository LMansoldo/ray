// Blocos de fact-checking ("Verificação de fatos") no renderer read-only de
// streaming (T-602). A resposta do agente pode trazer trechos na convenção v1:
//
//   ## Verificação de fatos
//
//   ### Claim: "<afirmação textual, normalizada>"
//   **Veredito: TRUE|FALSE|UNCERTAIN** · confiança: alta|média|baixa
//   <1-2 frases de justificativa>
//   Fontes: [título](url) · [título](url)
//
// Abordagem: PRÉ-PROCESSAMENTO do markdown (string -> string) executado pelo
// MarkdownView ANTES do renderMarkdown. Um bloco que casa com a convenção é
// trocado por um bloco de HTML cru (<div class="ray-verdict" ...>) que o
// marked repassa verbatim (CommonMark: HTML block tipo 7 termina em linha em
// branco — o HTML emitido não tem linhas em branco). Estilos ficam no
// MarkdownView.svelte via :global(), como os diagramas mermaid.
//
// Streaming: o parser casa bloco a bloco e exige a forma mínima identificável
// (linha de claim com aspas fechadas + linha de veredito). Enquanto essa forma
// não existe (streaming cortado antes), NADA é alterado — o trecho parcial
// renderiza como markdown normal, sem crash. Depois que o veredito fecha, o
// card aparece e ganha justificativa/fontes conforme os tokens chegam.
//
// Segurança: o HTML emitido entra via {@html} sem sanitizador (mesma postura
// do marked no markdown.ts), então TODO texto interpolado (claim, justificativa,
// títulos e URLs) passa por escapeHtml; URLs só viram href com esquema seguro.

/** Tipos de veredito da convenção v1 (contrato compartilhado — não mudar). */
export type VerdictKind = 'TRUE' | 'FALSE' | 'UNCERTAIN'

/** Níveis de confiança da convenção v1. */
export type VerdictConfidence = 'alta' | 'média' | 'baixa'

interface VerdictSource {
  title: string
  url: string
}

interface VerdictBlock {
  kind: VerdictKind
  confidence: VerdictConfidence | null
  claim: string
  justification: string | null
  sources: VerdictSource[]
}

// Linha de claim: exige aspas de fechamento (streaming cortado no meio do
// texto não casa — degrada para markdown normal).
const CLAIM_LINE_RE = /^### Claim: "(.+)"\s*$/

// Linha de veredito: **Veredito: KIND** seguido opcionalmente de
// " · confiança: nível" (o corte do streaming antes do fim da linha não casa).
const VERDICT_LINE_RE =
  /^\*\*Veredito: (TRUE|FALSE|UNCERTAIN)\*\*(?:\s*·\s*confiança:\s*(alta|média|baixa))?\s*$/

// Linha de fontes: "Fontes:" + links markdown separados por "·".
const SOURCES_LINE_RE = /^Fontes:\s*(.+)$/

// Link markdown [título](url) — url sem parênteses nem espaços (convenção v1).
const MD_LINK_RE = /\[([^\]]+)\]\(([^()\s]+)\)/g

// Fronteiras do bloco: linha em branco, heading ou cerca de código encerram a
// coleta de justificativa/fontes (o que vier depois é markdown comum).
const HEADING_LINE_RE = /^#{1,6}(?:\s|$)/
const FENCE_LINE_RE = /^```/

// Esquemas permitidos em href; qualquer outro vira chip sem link.
const SAFE_URL_RE = /^(https?:|mailto:)/i

// Pontos do indicador de confiança (alta=3, média=2, baixa=1).
const CONFIDENCE_DOTS: Record<VerdictConfidence, number> = {
  alta: 3,
  média: 2,
  baixa: 1,
}

/** Escapa texto para interpolação segura em HTML cru. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Extrai os pares [título](url) de uma linha de fontes. */
function parseSources(line: string): VerdictSource[] {
  const sources: VerdictSource[] = []
  for (const match of line.matchAll(MD_LINK_RE)) {
    sources.push({ title: match[1], url: match[2] })
  }
  return sources
}

/** Renderiza o HTML cru do card de veredito (sem linhas em branco: o bloco
 * de HTML do CommonMark termina na primeira linha em branco). */
function renderVerdictHtml(block: VerdictBlock): string {
  const kind = block.kind.toLowerCase()
  const lines: string[] = []

  lines.push(`<div class="ray-verdict" data-verdict="${kind}">`)
  lines.push('<div class="ray-verdict__top">')
  lines.push(
    `<span class="ray-verdict__chip ray-verdict__chip--${kind}">${block.kind}</span>`,
  )
  if (block.confidence !== null) {
    const dots = CONFIDENCE_DOTS[block.confidence]
    const markers = Array.from({ length: 3 }, (_, index) => {
      const on = index < dots ? ' ray-verdict__dot--on' : ''
      return `<span class="ray-verdict__dot${on}"></span>`
    }).join('')
    lines.push(
      `<span class="ray-verdict__confidence" role="img" aria-label="confiança ${block.confidence}">${markers}</span>`,
    )
  }
  lines.push('</div>')
  lines.push(`<p class="ray-verdict__claim">${escapeHtml(block.claim)}</p>`)
  if (block.justification !== null && block.justification !== '') {
    lines.push(
      `<p class="ray-verdict__why">${escapeHtml(block.justification)}</p>`,
    )
  }
  if (block.sources.length > 0) {
    const chips = block.sources
      .map(({ title, url }) => {
        const label = escapeHtml(title)
        if (!SAFE_URL_RE.test(url)) {
          // Esquema não permitido: chip sem link (conteúdo preservado).
          return `<li><span class="ray-verdict__source">${label}</span></li>`
        }
        const href = escapeHtml(url)
        return `<li><a class="ray-verdict__source" href="${href}" target="_blank" rel="noopener noreferrer">${label}</a></li>`
      })
      .join('')
    lines.push(
      `<ul class="ray-verdict__sources" aria-label="Fontes">${chips}</ul>`,
    )
  }
  lines.push('</div>')
  return lines.join('\n')
}

/** Pré-processador: troca blocos completos da convenção de veredito por HTML
 * cru estilizável; qualquer outra coisa volta EXATAMENTE como entrou. */
export function transformVerdictBlocks(markdown: string): string {
  // Fast path: sem a marca de claim o texto é intocado byte a byte.
  if (!markdown.includes('### Claim:')) return markdown

  const lines = markdown.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const claimMatch = CLAIM_LINE_RE.exec(lines[i])
    const verdictMatch =
      claimMatch !== null && i + 1 < lines.length
        ? VERDICT_LINE_RE.exec(lines[i + 1])
        : null

    if (claimMatch === null || verdictMatch === null) {
      out.push(lines[i])
      i += 1
      continue
    }

    // Forma mínima casou: coleta justificativa e fontes até a fronteira
    // (linha em branco, heading ou cerca). No streaming, o que ainda não
    // chegou simplesmente não está no card ainda.
    const block: VerdictBlock = {
      kind: verdictMatch[1] as VerdictKind,
      confidence: (verdictMatch[2] as VerdictConfidence | undefined) ?? null,
      claim: claimMatch[1],
      justification: null,
      sources: [],
    }
    let j = i + 2
    const justificationLines: string[] = []
    while (
      j < lines.length &&
      lines[j] !== '' &&
      !HEADING_LINE_RE.test(lines[j]) &&
      !FENCE_LINE_RE.test(lines[j])
    ) {
      const sourcesMatch = SOURCES_LINE_RE.exec(lines[j])
      if (sourcesMatch !== null) {
        block.sources = parseSources(sourcesMatch[1])
      } else {
        justificationLines.push(lines[j])
      }
      j += 1
    }
    if (justificationLines.length > 0) {
      block.justification = justificationLines.join(' ')
    }

    // Linhas em branco ao redor isolam o bloco de HTML cru: garante que o
    // marked não o engula como parágrafo (antes) nem engula a próxima linha
    // de markdown (depois) — HTML block termina só em linha em branco.
    out.push('')
    out.push(renderVerdictHtml(block))
    out.push('')
    i = j
  }
  return out.join('\n')
}
