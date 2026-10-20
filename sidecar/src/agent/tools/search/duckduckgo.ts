// Provider DuckDuckGo (T-603): adapter concreto de busca sem chave.
//
// Zero dependências, zero API keys: scrapes https://html.duckduckgo.com/html
// com o fetch nativo. A lógica de fetch+parse migrou para cá de websearch.ts
// (que virou fachada e reexporta parseDuckDuckGoHtml — os imports antigos
// continuam válidos).
//
// Best-effort por design: toda falha (rede, timeout, drift de markup) resolve
// [] para uma busca instável nunca derrubar uma sugestão.
// SEM rate limiter aqui: o limite (scope "search", T-601) é aplicado UMA vez
// por chamada de busca efetiva, na camada da fachada (websearch.ts) — não por
// provider.

import type {
  SearchOptions,
  SearchProvider,
  SearchResult,
} from "./provider.js";

const DDG_ENDPOINT = "https://html.duckduckgo.com/html/";
// O endpoint de HTML bloqueia requests sem User-Agent de browser.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// --- Parsing do HTML do endpoint /html --------------------------------------

// O DDG envolve os links externos num redirect: //duckduckgo.com/l/?uddg=<url
// encodada>&rut=...; alguns resultados vêm com href direto.
const TITLE_RE =
  /<a\s([^>]*class="[^"]*result__a[^"]*"[^>]*)>([\s\S]*?)<\/a>/g;
const SNIPPET_RE =
  /<a\s([^>]*class="[^"]*result__snippet[^"]*"[^>]*)>([\s\S]*?)<\/a>/g;

export function parseDuckDuckGoHtml(
  html: string,
  limit: number,
): SearchResult[] {
  const titles = [...html.matchAll(TITLE_RE)];
  const snippets = [...html.matchAll(SNIPPET_RE)];
  const results: SearchResult[] = [];
  for (let i = 0; i < titles.length && results.length < limit; i++) {
    const title = stripTags(titles[i][2]);
    const href = /\bhref="([^"]*)"/.exec(titles[i][1])?.[1] ?? "";
    const url = resolveResultUrl(href);
    if (!title || !url) continue;
    results.push({
      title,
      url,
      snippet: stripTags(snippets[i]?.[2] ?? ""),
    });
  }
  return results;
}

function resolveResultUrl(href: string): string {
  const trimmed = href.trim();
  const uddg = /[?&]uddg=([^&]+)/.exec(trimmed)?.[1];
  if (uddg) {
    try {
      return decodeURIComponent(uddg);
    } catch {
      // uddg malformado — cai para o href cru.
    }
  }
  if (trimmed.startsWith("//")) return "https:" + trimmed;
  return trimmed;
}

function stripTags(html: string): string {
  // Tags primeiro, entidades depois — decodificar antes transformaria
  // &lt;script&gt; em marcação que o strip engoliria.
  return decodeEntities(
    html
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

// --- Provider -----------------------------------------------------------------

export const duckDuckGoSearchProvider: SearchProvider = {
  name: "duckduckgo",

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { limit = 5, timeoutMs = 5000 } = options;
    try {
      const response = await fetch(
        `${DDG_ENDPOINT}?q=${encodeURIComponent(query)}`,
        {
          headers: { "user-agent": USER_AGENT },
          signal: AbortSignal.timeout(timeoutMs),
        },
      );
      if (!response.ok) return [];
      const html = await response.text();
      return parseDuckDuckGoHtml(html, limit);
    } catch (err) {
      console.warn(
        "[websearch] DuckDuckGo search failed — answering without web context:",
        (err as Error).message,
      );
      return [];
    }
  },
};
