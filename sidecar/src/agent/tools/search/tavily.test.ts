// Tests for the Tavily search provider (T-603).
//
// Stubs globalThis.fetch — no real network. The API key comes from
// process.env.RAY_TAVILY_API_KEY at call time (vi.stubEnv / explicit deletes).
// Acceptance criteria:
// 1. Success: POSTs the Tavily endpoint with {api_key, query, max_results},
//    maps results to SearchResult (content → snippet), respects the limit and
//    drops entries without title/url.
// 2. No key: resolves [] WITHOUT calling fetch (provider not usable).
// 3. Failure (non-ok response, fetch rejection, invalid JSON): resolves []
//    — same best-effort contract as DuckDuckGo. The key is never logged.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TAVILY_API_KEY_ENV,
  getTavilyApiKey,
  tavilySearchProvider,
} from "./tavily.js";

const TAVILY_FIXTURE = {
  query: "rust vs go",
  results: [
    {
      title: "Rust language",
      url: "https://rust-lang.org",
      content: "Systems programming language",
    },
    {
      title: "Go language",
      url: "https://go.dev",
      content: "Google's language  ",
    },
    // Sem url — não serve para citação markdown; deve ser descartado.
    { title: "No url here", content: "orphan" },
    // Título vazio — idem.
    { title: "   ", url: "https://empty.example.com", content: "blank title" },
  ],
};

function okResponse(body: unknown): {
  ok: boolean;
  json: () => Promise<unknown>;
} {
  return { ok: true, json: async () => body };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getTavilyApiKey", () => {
  it("reads the trimmed key from the env", () => {
    vi.stubEnv(TAVILY_API_KEY_ENV, "  tvly-secret  ");
    expect(getTavilyApiKey()).toBe("tvly-secret");
  });

  it("is undefined when the env is missing, empty or whitespace", () => {
    vi.stubEnv(TAVILY_API_KEY_ENV, "");
    expect(getTavilyApiKey()).toBeUndefined();

    vi.stubEnv(TAVILY_API_KEY_ENV, "   ");
    expect(getTavilyApiKey()).toBeUndefined();
  });
});

describe("tavilySearchProvider", () => {
  it("POSTs {api_key, query, max_results} and maps content to snippet", async () => {
    vi.stubEnv(TAVILY_API_KEY_ENV, "tvly-secret");
    const fetchMock = vi.fn(async () => okResponse(TAVILY_FIXTURE));
    vi.stubGlobal("fetch", fetchMock);

    const results = await tavilySearchProvider.search("rust vs go", { limit: 5 });

    expect(tavilySearchProvider.name).toBe("tavily");
    // Itens sem título/url descartados antes do slice.
    expect(results).toEqual([
      {
        title: "Rust language",
        url: "https://rust-lang.org",
        snippet: "Systems programming language",
      },
      { title: "Go language", url: "https://go.dev", snippet: "Google's language" },
    ]);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.tavily.com/search");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      api_key: "tvly-secret",
      query: "rust vs go",
      max_results: 5,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("respects the limit", async () => {
    vi.stubEnv(TAVILY_API_KEY_ENV, "tvly-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okResponse({
          results: Array.from({ length: 10 }, (_, i) => ({
            title: `t${i}`,
            url: `https://x.example.com/${i}`,
            content: `c${i}`,
          })),
        }),
      ),
    );

    expect(await tavilySearchProvider.search("q", { limit: 3 })).toHaveLength(3);
  });

  it("resolves [] without touching fetch when there is no key", async () => {
    vi.stubEnv(TAVILY_API_KEY_ENV, "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await tavilySearchProvider.search("query")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves [] on a non-ok response", async () => {
    vi.stubEnv(TAVILY_API_KEY_ENV, "tvly-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401 })),
    );

    expect(await tavilySearchProvider.search("query")).toEqual([]);
  });

  it("resolves [] and warns when fetch rejects — the key is never logged", async () => {
    vi.stubEnv(TAVILY_API_KEY_ENV, "tvly-super-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("The operation was aborted");
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await tavilySearchProvider.search("query")).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[websearch]"),
      "The operation was aborted",
    );
    // O segredo não vaza em nenhum log.
    const logged = warn.mock.calls.flat().join("\n");
    expect(logged).not.toContain("tvly-super-secret");
  });

  it("resolves [] on an invalid JSON payload", async () => {
    vi.stubEnv(TAVILY_API_KEY_ENV, "tvly-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => {
          throw new Error("Unexpected token < in JSON");
        },
      })),
    );

    expect(await tavilySearchProvider.search("query")).toEqual([]);
  });
});
