import { describe, it, expect } from 'vitest'

// Contrato T-408 / ADR-011 (integridade estrutural): o renderizador read-only
// de lib/markdown/ é uma peça SEPARADA do editor Milkdown (lib/editor/) — o
// renderer de streaming nunca importa Milkdown/ProseMirror nem o módulo do
// editor (remontar o editor a cada token é o peso que o ADR manda evitar).
// Também garante que os módulos do contrato existem e a regra geral do repo
// (sem emojis). Fontes lidos como texto cru via import.meta.glob (?raw) do
// Vite — sem node:fs/node:path (tsconfig.app: types ["svelte", "vite/client"]).

const RAW_SOURCES: Record<string, unknown> = import.meta.glob('./**/*.{svelte,ts}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

// ADR-011: o renderer de streaming é read-only e leve — o editor completo
// (Milkdown/ProseMirror) não pode ser importado aqui.
const EDITOR_COUPLING_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /@milkdown/, label: 'import de pacote Milkdown' },
  { pattern: /prosemirror/, label: 'import de pacote ProseMirror' },
  { pattern: /from ['"]\.\.\/editor['"]/, label: 'import do módulo lib/editor' },
  { pattern: /Editor\.make/, label: 'uso da API core do Milkdown' },
]

// Regra do repo: sem emojis em UI nem em código/comentários.
const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u

interface SourceFile {
  path: string
  content: string
}

// Fontes de implementação da peça (exclui os próprios *.test.ts).
// RED: nenhum arquivo ainda -> erro aqui é o motivo certo da falha.
function loadSources(): SourceFile[] {
  const sources = Object.entries(RAW_SOURCES)
    .filter(([path]) => !path.endsWith('.test.ts'))
    .map(([path, content]): SourceFile => {
      if (typeof content !== 'string') {
        throw new Error(`conteúdo de ${path} não é texto cru: ${typeof content}`)
      }
      return { path, content }
    })
  if (sources.length === 0) {
    throw new Error(
      'nenhum arquivo de implementação encontrado em apps/ui/src/lib/markdown/ — ' +
        'o passo GREEN deve criar markdown.ts e MarkdownView.svelte',
    )
  }
  return sources
}

function hasSource(sources: SourceFile[], expected: string): boolean {
  return sources.some((source) => source.path.endsWith(`/${expected}`))
}

function collectViolations(
  sources: SourceFile[],
  patterns: Array<{ pattern: RegExp; label: string }>,
): string[] {
  const violations: string[] = []
  for (const source of sources) {
    const lines = source.content.split('\n')
    for (const { pattern, label } of patterns) {
      lines.forEach((line, index) => {
        if (pattern.test(line)) {
          violations.push(`${source.path}:${index + 1} — ${label}: ${line.trim()}`)
        }
      })
    }
  }
  return violations
}

describe('renderer markdown — integridade estrutural (T-408)', () => {
  it('existe com os módulos do contrato T-408', () => {
    const sources = loadSources()
    for (const expected of ['markdown.ts', 'MarkdownView.svelte']) {
      expect(sources, `a peça deve conter ${expected}`).toSatisfy((all) =>
        hasSource(all, expected),
      )
    }
  })
})

describe('renderer markdown — nunca acopla ao editor (ADR-011)', () => {
  it('nenhum arquivo importa Milkdown/ProseMirror nem lib/editor', () => {
    const violations = collectViolations(loadSources(), EDITOR_COUPLING_PATTERNS)
    expect(violations, 'acoplamento com o editor encontrado no renderer').toEqual([])
  })
})

describe('renderer markdown — regras gerais do repo', () => {
  it('nenhum arquivo contém emojis (regra geral do repo)', () => {
    const violations = collectViolations(loadSources(), [
      { pattern: EMOJI_PATTERN, label: 'emoji' },
    ])
    expect(violations, 'emojis encontrados na peça markdown').toEqual([])
  })
})
