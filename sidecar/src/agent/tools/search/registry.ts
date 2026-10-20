// Registro de provedores de busca (ADR-006 aplicado à camada de busca, T-603)
// — mesmo molde de src/providers/registry.ts: resolve a fonte concreta.
//
// Política de resolução: se a env de um provider com chave estiver configurada
// (hoje, RAY_TAVILY_API_KEY), ele vence; senão cai para o DDG (sem chave,
// sempre disponível). Reavaliado A CADA chamada — a leitura da env é feita no
// momento da resolução, então configurar/limpar a chave vale sem reiniciar.
//
// O rate limiter NÃO vive aqui: fica na fachada (websearch.ts), aplicado uma
// única vez por chamada de busca efetiva, independente do provider resolvido.

import type { SearchProvider } from "./provider.js";
import { duckDuckGoSearchProvider } from "./duckduckgo.js";
import { getTavilyApiKey, tavilySearchProvider } from "./tavily.js";

/**
 * Provider de busca para o pedido vigente: o provider com chave se a env
 * existir, senão o DDG.
 */
export function resolveSearchProvider(): SearchProvider {
  return getTavilyApiKey() !== undefined
    ? tavilySearchProvider
    : duckDuckGoSearchProvider;
}
