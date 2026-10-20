// Provider Tavily (T-603): adapter de busca COM chave — alternativa ao DDG
// quando o usuário configura RAY_TAVILY_API_KEY. API simples: POST
// https://api.tavily.com/search com {api_key, query, max_results}.
//
// A chave é lida de process.env NO MOMENTO DA CHAMADA (nada em variável de
// módulo, espírito do ADR-003): trocar a env não exige reiniciar o sidecar e o
// registry (resolveSearchProvider) reavalia a cada pedido. O segredo nunca é
// logado — os warnings carregam só err.message.
//
// Registro condicional: sem chave o provider NÃO é registrado (o registry cai
// para o DDG). Com chave, falha da API resolve [] — mesmo contrato best-effort
// do DDG. Rate limiter fica na fachada, não aqui.

import type {
  SearchOptions,
  SearchProvider,
  SearchResult,
} from "./provider.js";

const TAVILY_ENDPOINT = "https://api.tavily.com/search";

/** Nome da env var que habilita o provider Tavily. */
export const TAVILY_API_KEY_ENV = "RAY_TAVILY_API_KEY";

/**
 * Chave da API Tavily da env vigente (trim aplicado). Undefined se ausente ou
 * vazia — é o sinal que o registry usa para NÃO registrar o provider.
 */
export function getTavilyApiKey(): string | undefined {
  const key = process.env[TAVILY_API_KEY_ENV]?.trim();
  return key ? key : undefined;
}

/** Payload de resultados da resposta da API Tavily (campos usados apenas). */
interface TavilyResponse {
  results?: Array<{ title?: string; url?: string; content?: string }>;
}

export const tavilySearchProvider: SearchProvider = {
  name: "tavily",

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const apiKey = getTavilyApiKey();
    // Sem chave não há o que chamar — [] (o registry nem deveria ter chegado
    // aqui; a guarda cobre a env sumindo entre resolve e chamada).
    if (!apiKey) return [];
    const { limit = 5, timeoutMs = 5000 } = options;
    try {
      const response = await fetch(TAVILY_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, query, max_results: limit }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return [];
      const payload = (await response.json()) as TavilyResponse;
      // content → snippet: é o texto de suporte da Tavily. Itens sem título ou
      // url não servem para citação markdown — descartados.
      return (payload.results ?? [])
        .map((r) => ({
          title: (r.title ?? "").trim(),
          url: (r.url ?? "").trim(),
          snippet: (r.content ?? "").trim(),
        }))
        .filter((r) => r.title !== "" && r.url !== "")
        .slice(0, limit);
    } catch (err) {
      console.warn(
        "[websearch] Tavily search failed — answering without web context:",
        (err as Error).message,
      );
      return [];
    }
  },
};
