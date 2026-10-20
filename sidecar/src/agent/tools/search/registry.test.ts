// Tests for the search provider registry (T-603).
//
// Acceptance criteria:
// 1. With RAY_TAVILY_API_KEY set (even whitespace-only → not configured), the
//    registry resolves the Tavily provider; without it, falls back to DDG.
// 2. End-to-end through the facade: webSearchForRequest hits the Tavily
//    endpoint when the env is set and the DDG endpoint when it is not, with
//    the provider response mapped to SearchResult in both paths.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SuggestRequest } from "../../../contract.js";
import { getLimiter } from "../../ratelimit.js";
import { searchCache } from "./cache.js";
import { duckDuckGoSearchProvider } from "./duckduckgo.js";
import { resolveSearchProvider } from "./registry.js";
import { TAVILY_API_KEY_ENV, tavilySearchProvider } from "./tavily.js";
import { webSearchForRequest } from "../websearch.js";

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

const TAVILY_BODY = {
  results: [
    {
      title: "Node.js — Tavily result",
      url: "https://nodejs.org",
      content: "Fresh from Tavily",
    },
  ],
};

const DDG_HTML = `
<div class="result results_links results_links_deep web-result">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="https://nodejs.org">Node.js — DDG result</a>
  </h2>
  <div class="links_main links_deep result__body">
    <a class="result__snippet" href="https://nodejs.org">Fresh from DDG</a>
  </div>
</div>
`;

beforeEach(() => {
  // A fachada é stateful (limiter + cache compartilhados no processo).
  getLimiter("search").reset();
  searchCache.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("resolveSearchProvider", () => {
  it("resolves the key provider when RAY_TAVILY_API_KEY is set", () => {
    vi.stubEnv(TAVILY_API_KEY_ENV, "tvly-secret");
    expect(resolveSearchProvider()).toBe(tavilySearchProvider);
  });

  it("falls back to DuckDuckGo without the env (or with whitespace only)", () => {
    vi.stubEnv(TAVILY_API_KEY_ENV, "");
    expect(resolveSearchProvider()).toBe(duckDuckGoSearchProvider);

    vi.stubEnv(TAVILY_API_KEY_ENV, "   ");
    expect(resolveSearchProvider()).toBe(duckDuckGoSearchProvider);
  });
});

describe("webSearchForRequest over the registry", () => {
  it("uses Tavily when the env is set, mapping content to snippet", async () => {
    vi.stubEnv(TAVILY_API_KEY_ENV, "tvly-secret");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => TAVILY_BODY,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const results = await webSearchForRequest(makeRequest());

    expect(results).toEqual([
      {
        title: "Node.js — Tavily result",
        url: "https://nodejs.org",
        snippet: "Fresh from Tavily",
      },
    ]);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://api.tavily.com/search");
  });

  it("falls back to DuckDuckGo without the env", async () => {
    vi.stubEnv(TAVILY_API_KEY_ENV, "");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => DDG_HTML,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const results = await webSearchForRequest(makeRequest());

    expect(results).toEqual([
      {
        title: "Node.js — DDG result",
        url: "https://nodejs.org",
        snippet: "Fresh from DDG",
      },
    ]);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://html.duckduckgo.com/html/?q=what%20is%20new%20in%20node%2024%3F");
  });
});
