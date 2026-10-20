// Interface única de provedor de busca web (ADR-006 aplicado à camada de
// busca, T-603) — mesmo molde de src/providers/provider.ts: cada fonte
// concreta (DuckDuckGo, Tavily, ...) é um adapter que implementa SearchProvider
// e o resto do sistema (fachada websearch.ts, grafo, fact-check) permanece
// agnóstico à fonte.
//
// Tipos canônicos: SearchResult e SearchOptions agora vivem AQUI (uma única
// definição, zero duplicação); websearch.ts os reexporta para preservar os
// imports existentes (claims.ts, graph.ts, testes).
//
// Contrato de erro (best-effort, compartilhado por todos os adapters): search()
// NUNCA lança — qualquer falha (rede, timeout, API, payload inesperado) resolve
// [] e a busca vira "sem contexto web". O segredo da API nunca é logado.

/** Parâmetros de uma busca. */
export interface SearchOptions {
  /** Máximo de resultados (default: 5). */
  limit?: number;
  /** Timeout do fetch em ms (default: 5000). */
  timeoutMs?: number;
}

/** Um resultado de busca web. */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** Contrato que todo adapter de busca implementa. */
export interface SearchProvider {
  /** Identificador da fonte (ex.: "duckduckgo", "tavily") — para logs. */
  readonly name: string;
  /** Busca a query. Best-effort: falha resolve [], nunca lança. */
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}
