import { describe, it, expect } from 'vitest'

// Contrato T-407 (frontend.md / ADR-001, ADR-005, ADR-011): a superfície
// Assistentes fala APENAS com o núcleo Rust via invoke()/eventos Tauri —
// nunca com o sidecar (HTTP em loopback). Este teste varre os fontes da
// superfície e falha se algum arquivo abrir conexão direta com o sidecar.
// Também garante que os módulos do contrato existem, que o campo de prompt
// do criador USA o editor Milkdown do T-408 (ADR-011: campo de input Markdown
// = editor; o renderizador read-only é para saída de streaming, e a linha da
// biblioteca mostra o prompt como texto plano — RF-336 pede "mostra o
// prompt", não renderização), que a superfície não alcança @milkdown/
// prosemirror por trás do wrapper do T-408 (DRY), que nenhum {@html} injeta
// HTML (sem round-trip Markdown->HTML), que o material Liquid Glass do T-400
// é reusado (frontend.md) e que não há emojis (regra geral do repo).
//
// Os fontes são lidos como texto cru via import.meta.glob (?raw) do Vite —
// sem node:fs/node:path, cujos tipos não entram no tsconfig.app
// (types: ["svelte", "vite/client"]).

const RAW_SOURCES: Record<string, unknown> = import.meta.glob('./**/*.{svelte,ts}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

// O sidecar vive em 127.0.0.1 com porta efêmera (ADR-005) e anuncia
// RAY_SIDECAR_PORT; a UI não conhece nem um nem outro.
const SIDECAR_ACCESS_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /127\.0\.0\.1/, label: 'IP de loopback literal (ADR-005: sidecar)' },
  { pattern: /\blocalhost\b/, label: 'hostname localhost' },
  { pattern: /RAY_SIDECAR_PORT/, label: 'porta anunciada pelo sidecar' },
  { pattern: /\bfetch\s*\(/, label: 'chamada fetch()' },
  { pattern: /\bEventSource\s*\(/, label: 'conexão EventSource()' },
  { pattern: /\bWebSocket\s*\(/, label: 'conexão WebSocket()' },
  { pattern: /\bXMLHttpRequest\b/, label: 'XMLHttpRequest' },
]

// Regra do repo: sem emojis em UI nem em código/comentários.
const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u

// ADR-011 (positivo): o campo de prompt do criador é um campo de input
// Markdown — usa o editor Milkdown do T-408 via o wrapper lib/editor
// (TASKS.md T-408: "consumido por T-407 (edição de prompt de assistente)").
const EDITOR_USAGE = { pattern: /from\s+['"][^'"]*lib\/editor/, label: 'editor T-408' }

// ADR-011 (negativo): a linha da biblioteca mostra o prompt como texto plano
// (RF-336), e o renderizador read-only é para saída de streaming — nenhum
// fonte desta superfície importa lib/markdown.
const MARKDOWN_RENDERER_IMPORT = { pattern: /from\s+['"][^'"]*lib\/markdown/, label: 'renderizador lib/markdown' }

// DRY: a superfície usa o wrapper do T-408 (MarkdownEditor.svelte) — nunca
// importa @milkdown/prosemirror diretamente (o wrapper já encapsula a API).
const RAW_EDITOR_IMPORT_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /from\s+['"][^'"]*@milkdown/, label: 'import direto do @milkdown' },
  { pattern: /from\s+['"][^'"]*prosemirror/, label: 'import direto do prosemirror' },
]

// ADR-011: Markdown entra e Markdown sai — nenhum {@html} injeta HTML na
// superfície (sem round-trip para HTML).
const RAW_HTML_PATTERN = { pattern: /{@html/, label: 'injeção {@html}' }

// Pin FRACO de propósito (precedente T-401/403/404/406/408): basta uma
// referência ao design system — até uma menção em comentário passa. A regra
// real de frontend.md é reusar o vidro existente (lib/glass) em vez de
// duplicar o material numa superfície nova.
const GLASS_MENTION = { pattern: /\bglass\b|GlassPanel|glassTokens/, label: 'Liquid Glass' }

interface SourceFile {
  path: string
  content: string
}

// Fontes de implementação da superfície (exclui os próprios *.test.ts).
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
      'nenhum arquivo de implementação encontrado em apps/ui/src/surfaces/assistants/ — ' +
        'o passo GREEN deve criar Assistants.svelte, types.ts, library.ts, ' +
        'assistant-actions.ts e assistants-feed.ts',
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

describe('superfície Assistentes — integridade estrutural (T-407)', () => {
  it('existe com os módulos do contrato T-407', () => {
    const sources = loadSources()
    for (const expected of [
      'Assistants.svelte',
      'types.ts',
      'library.ts',
      'assistant-actions.ts',
      'assistants-feed.ts',
    ]) {
      expect(sources, `a superfície deve conter ${expected}`).toSatisfy((all) =>
        hasSource(all, expected),
      )
    }
  })
})

describe('superfície Assistentes — sem acesso direto ao sidecar (ADR-001 / ADR-005)', () => {
  it('nenhum arquivo abre conexão com o sidecar; tudo passa por invoke()/eventos Tauri', () => {
    const violations = collectViolations(loadSources(), SIDECAR_ACCESS_PATTERNS)
    expect(violations, 'acesso direto ao sidecar encontrado').toEqual([])
  })
})

describe('superfície Assistentes — Markdown no criador (ADR-011, T-408)', () => {
  it('o campo de prompt usa o editor Milkdown do T-408 (lib/editor)', () => {
    const sources = loadSources()
    const mentions = sources.filter((source) => EDITOR_USAGE.pattern.test(source.content))
    expect(mentions.length, 'nenhum fonte importa o editor do T-408').toBeGreaterThan(0)
  })

  it('a biblioteca não importa o renderizador read-only (prompt exibido como texto plano)', () => {
    const violations = collectViolations(loadSources(), [MARKDOWN_RENDERER_IMPORT])
    expect(violations, 'lib/markdown importado na superfície de biblioteca').toEqual([])
  })

  it('não importa @milkdown/prosemirror diretamente (usa o wrapper do T-408)', () => {
    const violations = collectViolations(loadSources(), RAW_EDITOR_IMPORT_PATTERNS)
    expect(violations, 'import direto do stack do editor encontrado').toEqual([])
  })

  it('nenhum {@html} injeta HTML (Markdown entra e Markdown sai)', () => {
    const violations = collectViolations(loadSources(), [RAW_HTML_PATTERN])
    expect(violations, 'injeção de HTML cru encontrada').toEqual([])
  })
})

describe('superfície Assistentes — design system (T-400)', () => {
  it('os fontes referenciam o design system Liquid Glass em vez de criar material próprio', () => {
    const sources = loadSources()
    const mentions = sources.filter((source) => GLASS_MENTION.pattern.test(source.content))
    expect(mentions.length, 'nenhuma referência a lib/glass nos fontes').toBeGreaterThan(0)
  })
})

describe('superfície Assistentes — regras gerais do repo', () => {
  it('nenhum arquivo contém emojis (regra geral do repo)', () => {
    const violations = collectViolations(loadSources(), [
      { pattern: EMOJI_PATTERN, label: 'emoji' },
    ])
    expect(violations, 'emojis encontrados na superfície').toEqual([])
  })
})
