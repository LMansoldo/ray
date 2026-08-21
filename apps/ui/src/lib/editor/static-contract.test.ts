import { describe, it, expect } from 'vitest'

// Contrato T-408 (integridade estrutural): o editor Milkdown é headless —
// estilizado com os tokens do design system Liquid Glass (T-400), sem CSS
// embutido conflitante (TASKS.md T-408 Contrato). Também garante que os
// módulos do contrato existem e a regra geral do repo (sem emojis). Fontes
// lidos como texto cru via import.meta.glob (?raw) do Vite — sem
// node:fs/node:path (tsconfig.app: types ["svelte", "vite/client"]).

const RAW_SOURCES: Record<string, unknown> = import.meta.glob('./**/*.{svelte,ts}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

// Headless (contrato T-408): nenhum arquivo desta peça embute bloco de estilo
// — a aparência vem dos tokens Liquid Glass (T-400), aplicados por quem
// consome o editor.
const EMBEDDED_STYLE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /<style/, label: 'bloco de estilo embutido (contrato headless)' },
]

// Contrato T-408: estilizar COM os tokens do design system Liquid Glass
// (T-400), não com estilos próprios conflitantes.
const GLASS_TOKEN_PATTERN = /glass\/(tokens|GlassPanel)/

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
      'nenhum arquivo de implementação encontrado em apps/ui/src/lib/editor/ — ' +
        'o passo GREEN deve criar editor.ts e MarkdownEditor.svelte',
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

describe('editor Milkdown — integridade estrutural (T-408)', () => {
  it('existe com os módulos do contrato T-408', () => {
    const sources = loadSources()
    for (const expected of ['editor.ts', 'MarkdownEditor.svelte']) {
      expect(sources, `a peça deve conter ${expected}`).toSatisfy((all) =>
        hasSource(all, expected),
      )
    }
  })
})

describe('editor Milkdown — headless com tokens Liquid Glass (T-408)', () => {
  it('é headless: nenhum arquivo embute bloco de estilo', () => {
    const violations = collectViolations(loadSources(), EMBEDDED_STYLE_PATTERNS)
    expect(violations, 'CSS embutido encontrado no editor').toEqual([])
  })

  it('estiliza com os tokens Liquid Glass (T-400), não com CSS próprio', () => {
    const sources = loadSources()
    const styled = sources.filter((source) => GLASS_TOKEN_PATTERN.test(source.content))
    expect(
      styled,
      'o editor deve referenciar os tokens Liquid Glass (glass/tokens ou glass/GlassPanel)',
    ).not.toEqual([])
  })
})

describe('editor Milkdown — regras gerais do repo', () => {
  it('nenhum arquivo contém emojis (regra geral do repo)', () => {
    const violations = collectViolations(loadSources(), [
      { pattern: EMOJI_PATTERN, label: 'emoji' },
    ])
    expect(violations, 'emojis encontrados na peça do editor').toEqual([])
  })
})
