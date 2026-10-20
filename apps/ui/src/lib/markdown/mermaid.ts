// Diagramas Mermaid para o renderer read-only de streaming (T-408 / ADR-011).
// O pacote é pesado (dezenas de MB) e NUNCA entra no bundle inicial: o import
// é dinâmico, então o Vite o separa em chunk carregado só quando aparece um
// bloco ```mermaid no conteúdo. initialize roda uma única vez, no primeiro
// uso (theme dark casa com o vidro escuro do card; securityLevel strict é o
// default do mermaid e fica explícito aqui por ser conteúdo de LLM).
// Esta peça nunca importa o editor (lib/editor/) — mesma fronteira do ADR-011.

type MermaidApi = (typeof import('mermaid'))['default']

let mermaidPromise: Promise<MermaidApi> | null = null

function loadMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= import('mermaid').then((module) => {
    const mermaid = module.default
    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      securityLevel: 'strict',
    })
    return mermaid
  })
  return mermaidPromise
}

// Ids únicos por render: o mermaid exige ids novos a cada chamada (reusar id
// quebrado deixa SVG órfão no DOM em re-render).
let renderCount = 0

/** Renderiza DSL Mermaid para SVG. Null = DSL inválido ou falha de carga —
 * o caller mantém o bloco como código (fallback; nunca quebra o streaming
 * por causa de um diagrama). */
export async function renderMermaid(code: string): Promise<string | null> {
  try {
    const mermaid = await loadMermaid()
    renderCount += 1
    const { svg } = await mermaid.render(`ray-mermaid-${renderCount}`, code)
    return svg
  } catch {
    return null
  }
}
