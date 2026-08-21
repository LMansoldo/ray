// Renderizador Markdown read-only e leve para respostas do agente em
// streaming (card "DIGA ISSO", Notch, resumos) — T-408 / ADR-011.
// Entrada: string Markdown (possivelmente parcial, no meio de um token).
// Saída: HTML com syntax highlight. O texto cru de um bloco de código
// sobrevive ao render byte a byte. Esta peça nunca importa o editor
// (lib/editor/) — o ADR-011 mantém as duas peças separadas.

import { Marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js'

// Instância única: o parser (e a extensão de highlight) é montado uma vez
// e reutilizado a cada token do streaming — renderMarkdown fica pura e barata.
const parser = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code: string, lang: string): string {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext'
      return hljs.highlight(code, { language }).value
    },
  }),
)

export function renderMarkdown(source: string): string {
  return parser.parse(source, { async: false })
}
