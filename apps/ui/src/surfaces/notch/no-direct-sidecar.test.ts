import { describe, it, expect } from 'vitest'

// Contrato T-404 (frontend.md / ADR-001, ADR-005, ADR-011): o Notch fala
// APENAS com o núcleo Rust via invoke()/eventos Tauri — nunca com o sidecar
// (HTTP em loopback). Este teste varre os fontes da superfície e falha se
// algum arquivo abrir conexão direta com o sidecar. Também garante que os
// módulos do contrato existem, que a exibição ao vivo NUNCA importa o editor
// Milkdown (ADR-011: o renderizador de streaming é read-only e leve), que o
// renderizador T-408 é de fato usado, que o material Liquid Glass do T-400 é
// reusado (frontend.md: "don't duplicate a translucent panel/card that
// already exists") e que não há emojis (regra geral do repo).
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

// ADR-011: a exibição de tokens ao vivo usa o renderizador read-only do T-408
// (lib/markdown) — NUNCA o editor Milkdown. Padrões em forma de IMPORT (não
// de prosa): um comentário explicando que "o editor não deve ser usado" não
// pode virar falsa violação; um import sim.
const EDITOR_IMPORT_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /from\s+['"][^'"]*lib\/editor/, label: 'import do editor Milkdown (ADR-011)' },
  { pattern: /from\s+['"][^'"]*@milkdown/, label: 'import do @milkdown' },
  { pattern: /from\s+['"][^'"]*prosemirror/, label: 'import do prosemirror' },
  { pattern: /Editor\.make/, label: 'API do editor Editor.make()' },
]

// O renderizador T-408 precisa ser USADO (não apenas "não proibido"): pelo
// menos um fonte deve referenciar MarkdownView ou renderMarkdown.
const RENDERER_MENTION = { pattern: /\bMarkdownView\b|\brenderMarkdown\b/, label: 'renderizador T-408' }

// Pin FRACO de propósito (precedente T-401/T-403/T-408): basta uma referência
// ao design system — até uma menção em comentário passa. Pinar cosméticos
// (raio/cor) seria sobre-pinar; a regra real de frontend.md é reusar o vidro
// existente (lib/glass) em vez de duplicar o material numa superfície nova.
// O consumo real da decisão de material (resolveGlassMode/detectGlassSupport)
// é pinado em Notch.test.ts via data-notch-material.
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
      'nenhum arquivo de implementação encontrado em apps/ui/src/surfaces/notch/ — ' +
        'o passo GREEN deve criar Notch.svelte e history.ts',
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

describe('superfície Notch — integridade estrutural (T-404)', () => {
  it('existe com os módulos do contrato T-404', () => {
    const sources = loadSources()
    for (const expected of ['Notch.svelte', 'history.ts']) {
      expect(sources, `a superfície deve conter ${expected}`).toSatisfy((all) =>
        hasSource(all, expected),
      )
    }
  })
})

describe('superfície Notch — sem acesso direto ao sidecar (ADR-001 / ADR-005)', () => {
  it('nenhum arquivo abre conexão com o sidecar; tudo passa por invoke()/eventos Tauri', () => {
    const violations = collectViolations(loadSources(), SIDECAR_ACCESS_PATTERNS)
    expect(violations, 'acesso direto ao sidecar encontrado').toEqual([])
  })
})

describe('superfície Notch — streaming read-only (ADR-011, T-408)', () => {
  it('nenhum fonte importa o editor Milkdown para exibir tokens ao vivo', () => {
    const violations = collectViolations(loadSources(), EDITOR_IMPORT_PATTERNS)
    expect(violations, 'editor Milkdown importado na superfície de streaming').toEqual([])
  })

  it('os fontes usam o renderizador de streaming read-only do T-408', () => {
    const sources = loadSources()
    const mentions = sources.filter((source) => RENDERER_MENTION.pattern.test(source.content))
    expect(mentions.length, 'nenhuma referência a MarkdownView/renderMarkdown nos fontes').toBeGreaterThan(0)
  })
})

describe('superfície Notch — design system (T-400)', () => {
  it('os fontes referenciam o design system Liquid Glass em vez de criar material próprio', () => {
    const sources = loadSources()
    const mentions = sources.filter((source) => GLASS_MENTION.pattern.test(source.content))
    expect(mentions.length, 'nenhuma referência a lib/glass nos fontes').toBeGreaterThan(0)
  })
})

describe('superfície Notch — regras gerais do repo', () => {
  it('nenhum arquivo contém emojis (regra geral do repo)', () => {
    const violations = collectViolations(loadSources(), [
      { pattern: EMOJI_PATTERN, label: 'emoji' },
    ])
    expect(violations, 'emojis encontrados na superfície').toEqual([])
  })
})
