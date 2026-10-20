// Tests for the DuckDuckGo web search tool.
//
// Stubs globalThis.fetch with a realistic fixture of the /html endpoint —
// no real network, no API keys. Acceptance criteria:
// 1. Parsing extracts title/url/snippet, decodes the uddg redirect and HTML
//    entities, and strips inline tags.
// 2. The trigger heuristic searches only ASK_ANYTHING / ANALYZE_SELECTION
//    with a non-empty query source.
// 3. searchDuckDuckGo is best-effort: any failure resolves to [] (never
//    throws), with a console.warn breadcrumb.
// 4. withSearchResults appends the web section to the system prompt and
//    leaves it untouched when there are no results.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SuggestRequest } from "../../contract.js";
import { getLimiter } from "../ratelimit.js";
import { searchCache } from "./search/cache.js";
import {
  deriveSearchQuery,
  parseDuckDuckGoHtml,
  searchDuckDuckGo,
  shouldWebSearch,
  webSearchForRequest,
  withSearchResults,
} from "./websearch.js";

// ---------------------------------------------------------------------------
// Fixture — markup no formato real do endpoint html.duckduckgo.com/html
// ---------------------------------------------------------------------------

const DDG_FIXTURE = `
<div class="result results_links results_links_deep web-result">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnodejs.org%2Fapi.html&amp;rut=aaa1">Node.js <b>API</b> docs</a>
  </h2>
  <div class="links_main links_deep result__body">
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnodejs.org%2Fapi.html&amp;rut=aaa1">Official API reference for the Node.js &amp; runtime</a>
  </div>
</div>
<div class="result results_links results_links_deep web-result">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="https://direct.example.com/guide">Direct guide &quot;page&quot;</a>
  </h2>
  <div class="links_main links_deep result__body">
    <a class="result__snippet" href="https://direct.example.com/guide">A guide with entities: &lt;code&gt; &amp; &#x27;quotes&#x27;</a>
  </div>
</div>
`;

const NO_RESULTS_FIXTURE = `
<div class="no-results">No results for this query.</div>
<div class="result-link">Did you mean something else?</div>
`;

const CREDENTIAL = {
  kind: "OPENAI" as const,
  connectionMode: "API_KEY" as const,
  secret: "sk-test",
  model: "gpt-4o",
};

function makeRequest(overrides: Partial<SuggestRequest> = {}): SuggestRequest {
  return {
    sessionId: "s1",
    assistantId: "a1",
    trigger: "ASK_ANYTHING",
    context: [],
    userPrompt: "what is new in node 24?",
    credential: CREDENTIAL,
    ...overrides,
  };
}

// A busca agora passa pelo rate limiter (scope "search", 10 req/min
// compartilhados no processo). Os testes fazem poucas chamadas, mas o reset
// garante janela zerada a cada teste — nenhuma espera real, mesmo que a
// suíte cresça. O cache de buscas (T-603) também é zerado: é uma instância
// compartilhada do processo e hits vazando entre testes os tornaria
// dependentes de ordem.
beforeEach(() => {
  getLimiter("search").reset();
  searchCache.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

describe("parseDuckDuckGoHtml", () => {
  it("extracts title, decoded uddg url and snippet from the results markup", () => {
    const results = parseDuckDuckGoHtml(DDG_FIXTURE, 5);

    expect(results).toHaveLength(2);

    expect(results[0].title).toBe("Node.js API docs"); // <b> stripped
    expect(results[0].url).toBe("https://nodejs.org/api.html"); // uddg decoded
    expect(results[0].snippet).toBe("Official API reference for the Node.js & runtime");

    expect(results[1].title).toBe('Direct guide "page"'); // &quot; decoded
    expect(results[1].url).toBe("https://direct.example.com/guide"); // href direto
    expect(results[1].snippet).toBe("A guide with entities: <code> & 'quotes'");
  });

  it("respects the limit", () => {
    expect(parseDuckDuckGoHtml(DDG_FIXTURE, 1)).toHaveLength(1);
  });

  it("returns [] when there are no results in the markup", () => {
    expect(parseDuckDuckGoHtml(NO_RESULTS_FIXTURE, 5)).toEqual([]);
    expect(parseDuckDuckGoHtml("", 5)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Heurística de trigger + query
// ---------------------------------------------------------------------------

describe("shouldWebSearch / deriveSearchQuery", () => {
  it("searches ASK_ANYTHING with a userPrompt", () => {
    const req = makeRequest();
    expect(shouldWebSearch(req)).toBe(true);
    expect(deriveSearchQuery(req)).toBe("what is new in node 24?");
  });

  it("searches ANALYZE_SELECTION from the selectionText", () => {
    const req = makeRequest({
      trigger: "ANALYZE_SELECTION",
      selectionText: "  Rust vs Go for CLIs  ",
    });
    expect(shouldWebSearch(req)).toBe(true);
    expect(deriveSearchQuery(req)).toBe("Rust vs Go for CLIs");
  });

  it("does not search without a query source", () => {
    expect(shouldWebSearch(makeRequest({ userPrompt: undefined }))).toBe(false);
    expect(shouldWebSearch(makeRequest({ userPrompt: "   " }))).toBe(false);
    expect(
      shouldWebSearch(
        makeRequest({ trigger: "ANALYZE_SELECTION", selectionText: undefined }),
      ),
    ).toBe(false);
  });

  it("never searches the live-tracking triggers", () => {
    for (const trigger of [
      "AUTO",
      "ANALYZE_CONVERSATION",
      "SCREEN_CAPTURE",
    ] as const) {
      expect(shouldWebSearch(makeRequest({ trigger }))).toBe(false);
    }
  });

  it("truncates oversized queries", () => {
    const req = makeRequest({ userPrompt: "x".repeat(500) });
    expect(deriveSearchQuery(req)).toHaveLength(300);
  });
});

// ---------------------------------------------------------------------------
// searchDuckDuckGo — stub de fetch
// ---------------------------------------------------------------------------

describe("searchDuckDuckGo", () => {
  it("GETs the html endpoint with the encoded query and a browser user-agent", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => DDG_FIXTURE,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchDuckDuckGo("rust vs go", { limit: 2 });

    expect(results).toHaveLength(2);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://html.duckduckgo.com/html/?q=rust%20vs%20go");
    expect((init.headers as Record<string, string>)["user-agent"]).toContain(
      "Mozilla/5.0",
    );
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns [] on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 403 })),
    );
    expect(await searchDuckDuckGo("query")).toEqual([]);
  });

  it("returns [] and warns when fetch rejects (network/timeout)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("The operation was aborted");
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await searchDuckDuckGo("query")).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[websearch]"),
      "The operation was aborted",
    );
  });
});

// ---------------------------------------------------------------------------
// webSearchForRequest — porta de entrada do grafo
// ---------------------------------------------------------------------------

describe("webSearchForRequest", () => {
  it("searches only when the heuristic allows it", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => DDG_FIXTURE,
    }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await webSearchForRequest(makeRequest())).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    expect(
      await webSearchForRequest(makeRequest({ trigger: "AUTO" })),
    ).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves [] when the search fails — the suggestion must not fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("aborted");
      }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await webSearchForRequest(makeRequest())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cache/dedupe na fachada (T-603) — mesma query não bate na rede duas vezes
// ---------------------------------------------------------------------------

describe("webSearchForRequest caching", () => {
  it("serves a repeated query from the cache — one fetch only", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => DDG_FIXTURE,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await webSearchForRequest(makeRequest());
    const second = await webSearchForRequest(makeRequest());

    expect(first).toHaveLength(2);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes the cache key — casing/whitespace variants still hit", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => DDG_FIXTURE,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await webSearchForRequest(makeRequest({ userPrompt: "what is new in node 24?" }));
    await webSearchForRequest(
      makeRequest({ userPrompt: "  WHAT IS NEW IN NODE 24?  " }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache empty results — a failed search is retried", async () => {
    let failing = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (failing) throw new Error("boom");
        return { ok: true, text: async () => DDG_FIXTURE };
      }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await webSearchForRequest(makeRequest())).toEqual([]);

    failing = false;
    expect(await webSearchForRequest(makeRequest())).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Injeção no system prompt
// ---------------------------------------------------------------------------

describe("withSearchResults", () => {
  it("appends the web section with markdown links after the base prompt", () => {
    const system = withSearchResults("You are a general assistant.", [
      {
        title: "Node.js API docs",
        url: "https://nodejs.org/api.html",
        snippet: "Official API reference",
      },
    ]);

    expect(system.startsWith("You are a general assistant.")).toBe(true);
    expect(system).toContain("## Resultados da web");
    expect(system).toContain("[Node.js API docs](https://nodejs.org/api.html)");
    expect(system).toContain("Official API reference");
    expect(system.indexOf("You are a general assistant.")).toBeLessThan(
      system.indexOf("## Resultados da web"),
    );
  });

  it("keeps the prompt untouched when there are no results", () => {
    const system = "You are a general assistant.";
    expect(withSearchResults(system, [])).toBe(system);
  });
});
