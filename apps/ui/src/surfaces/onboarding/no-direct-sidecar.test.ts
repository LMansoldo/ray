import { describe, it, expect } from 'vitest'

// Contrato T-405 (frontend.md / ADR-001, ADR-005): a superfície Onboarding
// fala APENAS com o núcleo Rust via invoke() — nunca com o sidecar (HTTP em
// loopback). Este teste varre os fontes da superfície e falha se algum
// arquivo abrir conexão direta com o sidecar. Também garante que os módulos
// do contrato existem e que não há emojis (regra geral do repo).
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
      'nenhum arquivo de implementação encontrado em apps/ui/src/surfaces/onboarding/ — ' +
        'o passo GREEN deve criar Onboarding.svelte, state-feed.ts, restart.ts e types.ts',
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

describe('superfície Onboarding — integridade estrutural (T-405)', () => {
  it('existe com os módulos do contrato T-405', () => {
    const sources = loadSources()
    for (const expected of ['Onboarding.svelte', 'state-feed.ts', 'restart.ts', 'types.ts']) {
      expect(sources, `a superfície deve conter ${expected}`).toSatisfy((all) =>
        hasSource(all, expected),
      )
    }
  })
})

describe('superfície Onboarding — sem acesso direto ao sidecar (ADR-001 / ADR-005)', () => {
  it('nenhum arquivo abre conexão com o sidecar; tudo passa por invoke()', () => {
    const violations = collectViolations(loadSources(), SIDECAR_ACCESS_PATTERNS)
    expect(violations, 'acesso direto ao sidecar encontrado').toEqual([])
  })

  it('nenhum arquivo contém emojis (regra geral do repo)', () => {
    const violations = collectViolations(loadSources(), [
      { pattern: EMOJI_PATTERN, label: 'emoji' },
    ])
    expect(violations, 'emojis encontrados na superfície').toEqual([])
  })
})
