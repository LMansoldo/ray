// Web search tool for the agent graph — FACHADA compatível (T-603).
//
// Desde a T-603 a implementação concreta vive em tools/search/: a interface
// SearchProvider (molde ADR-006), o provider DuckDuckGo (scraping do endpoint
// HTML), o provider Tavily (com chave via RAY_TAVILY_API_KEY), o cache/dedupe
// por query e o registry que resolve qual usar. Este arquivo mantém TODOS os
// exports públicos de antes (consumers: ../graph.ts, claims.ts, testes) e
// concentra as políticas transversais:
//
// - Rate limiter (T-601): scope "search", adquirido UMA vez por chamada de
//   busca efetiva — aqui na fachada, nunca dentro dos providers.
// - Cache: consultado antes de qualquer rede; só entra no cache o sucesso com
//   resultados — falha best-effort ([]) não deve envenenar o cache por 5 min.
// - Best-effort: nenhum caminho lança; [] significa "sem contexto web".
//
// O contexto entra no system prompt via withSearchResults (mesmo padrão de
// withMeetingSummary em ../graph.ts — o adapter recebe o `system` pronto, e a
// web chega a todo provider sem mudança de contrato).

import { acquireSlot } from "../ratelimit.js";
import type { SuggestRequest, SuggestionTrigger } from "../../contract.js";
import { duckDuckGoSearchProvider } from "./search/duckduckgo.js";
import { searchCache } from "./search/cache.js";
import { resolveSearchProvider } from "./search/registry.js";

// Tipos canônicos agora vivem em search/provider.ts; o reexport preserva os
// imports existentes (`import { type SearchResult } from "./websearch.js"`).
export type { SearchOptions, SearchResult } from "./search/provider.js";
export { parseDuckDuckGoHtml } from "./search/duckduckgo.js";

import type {
  SearchOptions,
  SearchProvider,
  SearchResult,
} from "./search/provider.js";

// Triggers onde o usuário faz uma pergunta pontual ou seleciona um trecho —
// é aí que informação fresca da web ajuda. Os triggers de acompanhamento ao
// vivo (AUTO, ANALYZE_CONVERSATION, SCREEN_CAPTURE) ficam sem busca: um
// round-trip ao DDG a cada intervalo de análise atrasaria todo o fluxo.
const SEARCH_TRIGGERS: ReadonlySet<SuggestionTrigger> = new Set([
  "ASK_ANYTHING",
  "ANALYZE_SELECTION",
]);

export function shouldWebSearch(req: SuggestRequest): boolean {
  return (
    SEARCH_TRIGGERS.has(req.trigger) && deriveSearchQuery(req) !== undefined
  );
}

const MAX_QUERY_LENGTH = 300;

/**
 * Query de busca derivada do pedido: a pergunta digitada no ASK_ANYTHING,
 * o trecho selecionado no ANALYZE_SELECTION.
 */
export function deriveSearchQuery(req: SuggestRequest): string | undefined {
  const raw =
    req.trigger === "ANALYZE_SELECTION" ? req.selectionText : req.userPrompt;
  const query = raw?.trim();
  if (!query) return undefined;
  return query.length > MAX_QUERY_LENGTH
    ? query.slice(0, MAX_QUERY_LENGTH)
    : query;
}

/**
 * Busca DuckDuckGo direta (sem cache). Mantida como API pública — é o default
 * injetável do fact-check (claims.ts). O rate limiter continua aplicado aqui:
 * consumers fora do grafo não podem furar o teto do endpoint.
 */
export async function searchDuckDuckGo(
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  try {
    // Rate limit ANTES do AbortSignal.timeout (do provider): a espera do
    // limiter não consome o timeout do fetch — o pedido em si continua
    // garantido de `timeoutMs` completos.
    await acquireSlot("search");
    return await duckDuckGoSearchProvider.search(query, options);
  } catch (err) {
    // Só chega aqui se o próprio limiter falhar (ex.: reset com esperantes);
    // o provider já resolve [] nas falhas dele.
    console.warn(
      "[websearch] DuckDuckGo search failed — answering without web context:",
      (err as Error).message,
    );
    return [];
  }
}

/**
 * Ponto de entrada usado pelo grafo: decide pela heurística de trigger,
 * resolve o provider no registry (Tavily se RAY_TAVILY_API_KEY existir, senão
 * DDG), serve do cache e — no miss — adquire o slot de rate limit, busca e
 * cacheia o sucesso. Sempre resolve — [] significa "sem contexto web".
 */
export async function webSearchForRequest(
  req: SuggestRequest,
): Promise<SearchResult[]> {
  if (!shouldWebSearch(req)) return [];
  const query = deriveSearchQuery(req)!;

  // Dedupe primeiro: hit não consome slot do limiter nem rede.
  const cached = searchCache.getCached(query);
  if (cached !== undefined) return cached;

  const provider: SearchProvider = resolveSearchProvider();
  try {
    await acquireSlot("search");
    const results = await provider.search(query);
    // Só cacheia sucesso COM resultados: [] pode ser falha transitória
    // (rede, banimento) — cacheá-lo congelaria "sem contexto" por 5 min.
    if (results.length > 0) searchCache.setCached(query, results);
    return results;
  } catch (err) {
    // Idem searchDuckDuckGo: cobre falha do limiter; providers resolvem []
    // nas falhas deles. A sugestão nunca falha por causa da busca.
    console.warn(
      "[websearch] web search failed — answering without web context:",
      (err as Error).message,
    );
    return [];
  }
}

/**
 * Anexa os resultados da busca ao system prompt. Mesmo molde de
 * withMeetingSummary: o prompt base vem primeiro, a seção web depois.
 */
export function withSearchResults(
  system: string,
  results: SearchResult[],
): string {
  if (results.length === 0) return system;
  const lines = results
    .map(
      (r, i) =>
        `${i + 1}. [${r.title}](${r.url})${r.snippet ? ` — ${r.snippet}` : ""}`,
    )
    .join("\n");
  return (
    system +
    "\n\n## Resultados da web (busca DuckDuckGo feita agora neste pedido)\n" +
    lines +
    "\n\nUse os resultados acima quando ajudarem a responder e cite as " +
    "fontes relevantes como links markdown. Se um resultado contradizer o " +
    "que você sabe, prefira o resultado da web e deixe isso explícito. " +
    "Ignore os resultados irrelevantes para a pergunta."
  );
}
