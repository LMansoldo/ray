// Template HTML+CSS do Overlay customizado (sem JavaScript): o usuário escreve
// o próprio card e o Ray substitui os placeholders {{var}} por substituição de
// string. O resultado renderiza num <iframe sandbox="allow-same-origin"> —
// SEM allow-scripts, então o template NÃO executa JS (o sandbox isola o
// conteúdo do IPC do Tauri); allow-same-origin mantém a origem do pai para o
// componente conseguir ler contentDocument e fazer o auto-scroll (RF-701).
//
// Contrato dos placeholders (docs vivos para o editor da aba Overlay):
//   {{contextLabel}}  texto puro do contexto — SEMPRE escapado
//   {{theySaid}}      texto puro da fala do outro — SEMPRE escapado
//   {{bodyHtml}}      HTML JÁ RENDERIZADO do markdown (pipeline do T-408:
//                     transformVerdictBlocks + renderMarkdown) — verbatim,
//                     NUNCA escapado (mesma confiança do InsightCard)
//   {{status}}        'streaming' | 'done' | 'error' — escapado; a convenção
//                     é o template carregá-lo em data-ray-overlay-status na
//                     raiz, que liga cursor de streaming e caixa de erro
//   {{error}}         texto puro da mensagem de erro — SEMPRE escapado
//
// O corpo rolável DEVE ser marcado com [data-ray-body]: é o alvo do
// auto-scroll (RF-701) e do atalho overlayScroll* (RF-604).
import { renderMarkdown } from './markdown/markdown'
import { transformVerdictBlocks } from './markdown/verdict'

/** Variáveis disponíveis para o autor do template (documentação em constante). */
export const OVERLAY_TEMPLATE_VARS = [
  { name: 'contextLabel', kind: 'texto puro (escapado)', description: 'Contexto da situação (ex.: "Reunião de vendas").' },
  { name: 'theySaid', kind: 'texto puro (escapado)', description: 'A fala/pergunta do outro falante.' },
  { name: 'bodyHtml', kind: 'HTML pronto (verbatim)', description: 'A resposta sugerida já renderizada do markdown — não escapar.' },
  { name: 'status', kind: 'texto puro (escapado)', description: "'streaming' | 'done' | 'error'. Use em data-ray-overlay-status na raiz." },
  { name: 'error', kind: 'texto puro (escapado)', description: 'Mensagem de erro (vazia fora do estado error).' },
] as const

/** Dados que alimentam renderOverlayTemplate (campos na forma final). */
export interface OverlayTemplateData {
  contextLabel: string
  theySaid: string
  bodyHtml: string
  status: string
  error: string
}

/** Escapa texto para interpolação segura em HTML (mesma postura de verdict.ts). */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Substitui os placeholders {{var}} do template pelos dados do stream.
 * contextLabel/theySaid/status/error passam por escapeHtml; bodyHtml entra
 * verbatim (já vem do nosso renderizador). Placeholder desconhecido fica
 * intacto — o autor pode usar {{assim}} como conteúdo literal sem crash.
 */
export function renderOverlayTemplate(template: string, data: OverlayTemplateData): string {
  return template.replace(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (match, name: string) => {
    switch (name) {
      case 'contextLabel':
        return escapeHtml(data.contextLabel)
      case 'theySaid':
        return escapeHtml(data.theySaid)
      case 'bodyHtml':
        return data.bodyHtml
      case 'status':
        return escapeHtml(data.status)
      case 'error':
        return escapeHtml(data.error)
      default:
        return match
    }
  })
}

/**
 * Produz o bodyHtml do template a partir do markdown acumulado — o MESMO
 * pipeline do InsightCard (MarkdownView): pré-processador de veredito (T-602)
 * + renderizador read-only de streaming (T-408/ADR-011).
 */
export function renderOverlayBodyHtml(markdown: string): string {
  return renderMarkdown(transformVerdictBlocks(markdown))
}

/**
 * Template default: replica o card canônico (InsightCard) em HTML+CSS puro —
 * dark glass, cabeçalho de contexto com ícone, ELES DISSERAM, DIGA ISSO
 * rolável, cursor de streaming e caixa de erro. O documento vive num iframe,
 * então os tokens do app (:root) não existem aqui: os valores são os mesmos
 * do design system, declarados direto no CSS do template (html com
 * font-size 62.5% preserva a convenção 1rem = 10px do app).
 */
export const DEFAULT_OVERLAY_TEMPLATE = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<style>
  /* Convenção do app: 1rem = 10px — os valores abaixo espelham o card
     canônico (InsightCard.svelte) e os tokens do tema (app.css :root). */
  html { font-size: 62.5%; }
  html, body { margin: 0; padding: 0; background: transparent; }

  .ray-card {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 1.4rem;
    width: 100%;
    height: 100%;
    min-height: 12rem;
    padding: 1.44rem;
    background: rgba(20, 22, 36, 0.93);
    border: 0.1rem solid rgba(255, 255, 255, 0.13);
    border-radius: 1.4rem;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07);
    overflow: hidden;
    color: #f0f0f8;
    font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
    font-size: 1.3rem;
    line-height: 1.6;
    cursor: default;
  }

  .ray-context { display: flex; align-items: center; gap: 0.8rem; }
  .ray-context__icon {
    width: 2.4rem; height: 2.4rem; border-radius: 6px;
    background: rgba(90, 87, 232, 0.15);
    border: 0.1rem solid rgba(90, 87, 232, 0.28);
    display: inline-flex; align-items: center; justify-content: center;
    color: #5a57e8; flex-shrink: 0;
  }
  .ray-context__label { font-size: 1.235rem; color: rgba(240, 240, 248, 0.52); font-weight: 500; }

  .ray-block { display: flex; flex-direction: column; gap: 0.6rem; min-height: 0; }
  .ray-heading {
    margin: 0; font-size: 1.045rem; font-weight: 700;
    letter-spacing: 0.09em; text-transform: uppercase;
    color: rgba(240, 240, 248, 0.3);
  }
  .ray-quote { margin: 0; font-size: 1.52rem; font-style: italic; color: rgba(240, 240, 248, 0.52); line-height: 1.5; }

  /* DIGA ISSO: o corpo rolável — alvo do auto-scroll (RF-701) e do atalho
     overlayScroll*. data-ray-body é OBRIGATÓRIO neste elemento. */
  .ray-say { flex: 1; min-height: 3rem; }
  .ray-body {
    max-height: 24rem; overflow-y: auto; padding-right: 0.4rem;
    font-size: 1.33rem; line-height: 1.6; color: #f0f0f8;
    min-width: 0; overflow-wrap: anywhere;
  }

  /* Markdown básico (bodyHtml vem do renderizador T-408). */
  .ray-body p { margin: 0 0 0.6em; overflow-wrap: anywhere; }
  .ray-body p:last-child { margin-bottom: 0; }
  .ray-body ul, .ray-body ol { margin: 0 0 0.6em; padding-left: 1.6em; }
  .ray-body li { margin: 0.2em 0; }
  .ray-body code {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 4px; padding: 0.1em 0.35em; overflow-wrap: anywhere;
  }
  .ray-body pre {
    max-width: 100%; margin: 0 0 0.6em; padding: 0.7em 0.9em;
    background: rgba(255, 255, 255, 0.05);
    border: 0.1rem solid rgba(255, 255, 255, 0.09);
    border-radius: 0.7rem; overflow-x: auto;
    white-space: pre-wrap; overflow-wrap: anywhere;
  }
  .ray-body pre code { background: transparent; padding: 0; }
  .ray-body h1, .ray-body h2, .ray-body h3, .ray-body h4 {
    margin: 0.8em 0 0.4em; line-height: 1.3; color: #f0f0f8; overflow-wrap: anywhere;
  }
  .ray-body h1 { font-size: 1.5em; }
  .ray-body h2 { font-size: 1.3em; }
  .ray-body h3 { font-size: 1.15em; }
  .ray-body h4 { font-size: 1em; }
  .ray-body blockquote {
    margin: 0.6em 0; padding: 0.2em 0 0.2em 1em;
    border-left: 0.25rem solid rgba(255, 255, 255, 0.16);
    color: rgba(240, 240, 248, 0.52);
  }
  .ray-body a { color: #8f8dff; text-decoration: underline; overflow-wrap: anywhere; }
  .ray-body table { border-collapse: collapse; margin: 0.6em 0; max-width: 100%; }
  .ray-body th, .ray-body td {
    border: 0.1rem solid rgba(255, 255, 255, 0.13);
    padding: 0.3em 0.7em; text-align: left; overflow-wrap: anywhere;
  }
  .ray-body th { background: rgba(255, 255, 255, 0.05); }

  /* Card de verificação de fatos (classes emitidas por verdict.ts). */
  .ray-body .ray-verdict {
    display: flex; flex-direction: column; gap: 0.5em;
    margin: 0.6em 0; padding: 0.9em 1em;
    max-width: 100%; min-width: 0; overflow-wrap: anywhere;
    border: 0.1rem solid rgba(255, 255, 255, 0.09);
    border-radius: 0.9rem; background: rgba(255, 255, 255, 0.04);
  }
  .ray-body .ray-verdict__top { display: flex; align-items: center; gap: 0.7em; flex-wrap: wrap; min-width: 0; }
  .ray-body .ray-verdict__chip {
    display: inline-flex; align-items: center;
    padding: 0.15em 0.7em; border-radius: 999px;
    font-size: 0.82em; font-weight: 700; letter-spacing: 0.07em; white-space: nowrap;
  }
  .ray-body .ray-verdict__chip--true { color: #30d158; background: rgba(48, 209, 88, 0.14); border: 0.1rem solid rgba(48, 209, 88, 0.35); }
  .ray-body .ray-verdict__chip--false { color: #ff453a; background: rgba(255, 69, 58, 0.14); border: 0.1rem solid rgba(255, 69, 58, 0.35); }
  .ray-body .ray-verdict__chip--uncertain { color: #ff9f0a; background: rgba(255, 159, 10, 0.14); border: 0.1rem solid rgba(255, 159, 10, 0.35); }
  .ray-body .ray-verdict__confidence { display: inline-flex; align-items: center; gap: 0.3em; }
  .ray-body .ray-verdict__dot { width: 0.55em; height: 0.55em; border-radius: 50%; background: rgba(255, 255, 255, 0.16); }
  .ray-body .ray-verdict__dot--on { background: rgba(240, 240, 248, 0.52); }
  .ray-body .ray-verdict__claim { margin: 0; font-weight: 700; color: #f0f0f8; line-height: 1.4; }
  .ray-body .ray-verdict__why { margin: 0; color: rgba(240, 240, 248, 0.52); line-height: 1.5; }
  .ray-body .ray-verdict__sources { display: flex; flex-wrap: wrap; gap: 0.4em; margin: 0; padding: 0; list-style: none; min-width: 0; }
  .ray-body .ray-verdict__source {
    display: inline-flex; align-items: center;
    padding: 0.2em 0.7em; max-width: 100%; overflow-wrap: anywhere;
    border-radius: 999px; font-size: 0.88em;
    color: #8f8dff; background: rgba(90, 87, 232, 0.15);
    border: 0.1rem solid rgba(90, 87, 232, 0.32);
    text-decoration: none;
  }

  /* Cursor de streaming: visível SOMENTE com status="streaming". */
  .ray-cursor { display: none; }
  [data-ray-overlay-status="streaming"] .ray-cursor {
    display: inline-block; width: 2px; height: 1em;
    margin-top: -0.2em; background: #5a57e8;
    animation: ray-blink 1s step-end infinite;
  }
  @keyframes ray-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) {
    [data-ray-overlay-status="streaming"] .ray-cursor { animation: none; }
  }

  /* Caixa de erro: visível SOMENTE com status="error". */
  .ray-error { display: none; }
  [data-ray-overlay-status="error"] .ray-error {
    display: block; margin: 0; padding: 0.8rem 1rem;
    font-size: 1.235rem; color: #ff453a;
    border: 0.1rem solid rgba(255, 255, 255, 0.09);
    border-radius: 0.8rem; background: rgba(255, 69, 58, 0.08);
  }
</style>
</head>
<body>
  <div class="ray-card" data-ray-overlay-status="{{status}}">
    <header class="ray-context">
      <span class="ray-context__icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="14" height="14">
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"></circle>
          <circle cx="8" cy="8" r="2" fill="currentColor"></circle>
        </svg>
      </span>
      <span class="ray-context__label">{{contextLabel}}</span>
    </header>
    <section class="ray-block">
      <h2 class="ray-heading">Eles disseram</h2>
      <p class="ray-quote">{{theySaid}}</p>
    </section>
    <section class="ray-block ray-say">
      <h2 class="ray-heading">Diga isso</h2>
      <div class="ray-body" data-ray-body>{{bodyHtml}}</div>
      <span class="ray-cursor" aria-hidden="true"></span>
    </section>
    <p class="ray-error" role="alert">{{error}}</p>
  </div>
</body>
</html>
`

/**
 * Amostra realista para o preview ao vivo da aba Overlay: exercita markdown
 * rico E um bloco de veredito completo (T-602) — o mesmo pipeline que o
 * overlay real executa por token.
 */
const SAMPLE_MARKDOWN = [
  'Abra com um **roteiro em três passos** e cite a ferramenta:',
  '',
  '1. Meça com um `heap snapshot` antes e depois do pico',
  '2. Compare os *retainers* do objeto que cresceu',
  '3. Corte a referência forte e prefira `WeakRef`',
  '',
  '```bash',
  'node --inspect --heap-prof server.js',
  '```',
  '',
  '> Se o pico sumir com o snapshot, a suspeita é cache em memória.',
  '',
  '## Verificação de fatos',
  '',
  '### Claim: "WeakRef elimina qualquer fuga de memória"',
  '**Veredito: UNCERTAIN** · confiança: média',
  'WeakRef só ajuda quando não resta outra referência forte ativa.',
  'Fontes: [MDN WeakRef](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/WeakRef)',
].join('\n')

/** Dados de exemplo do preview das Configurações (status done, sem erro). */
export const SAMPLE_OVERLAY_DATA: OverlayTemplateData = {
  contextLabel: 'Você está em uma entrevista técnica',
  theySaid: 'Como você depuraria uma fuga de memória em produção?',
  bodyHtml: renderOverlayBodyHtml(SAMPLE_MARKDOWN),
  status: 'done',
  error: '',
}
