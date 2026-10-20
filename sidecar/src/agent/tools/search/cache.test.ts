// Tests for the search cache (T-603).
//
// Pure unit tests against the class with an INJECTED clock — no fake timers,
// no I/O. Acceptance criteria:
// 1. set/get round-trip and misses return undefined.
// 2. TTL expires entries (deterministic via the injected `now`).
// 3. Keys are normalized (trim + lowercase) — casing/whitespace variants dedupe.
// 4. Eviction respects maxEntries, dropping the least recently used entry.
// 5. clear() wipes everything.

import { describe, expect, it } from "vitest";
import { SearchCache } from "./cache.js";
import type { SearchResult } from "./provider.js";

const RESULT_A: SearchResult[] = [
  { title: "A", url: "https://a.example.com", snippet: "snippet a" },
];
const RESULT_B: SearchResult[] = [
  { title: "B", url: "https://b.example.com", snippet: "snippet b" },
];

function makeCache(
  options: { ttlMs?: number; maxEntries?: number } = {},
): { cache: SearchCache; advance: (ms: number) => void } {
  let nowMs = 1_000_000;
  const cache = new SearchCache({ ...options, now: () => nowMs });
  return { cache, advance: (ms) => (nowMs += ms) };
}

describe("SearchCache", () => {
  it("round-trips set/get and misses return undefined", () => {
    const { cache } = makeCache();
    expect(cache.getCached("rust vs go")).toBeUndefined();

    cache.setCached("rust vs go", RESULT_A);
    expect(cache.getCached("rust vs go")).toEqual(RESULT_A);
  });

  it("expires entries after the TTL", () => {
    const ttlMs = 5 * 60_000;
    const { cache, advance } = makeCache({ ttlMs });

    cache.setCached("q", RESULT_A);
    advance(ttlMs - 1);
    expect(cache.getCached("q")).toEqual(RESULT_A); // ainda dentro do TTL

    advance(1); // exatamente expiresAt — expira
    expect(cache.getCached("q")).toBeUndefined();
  });

  it("normalizes keys: trim + lowercase dedupe variants", () => {
    const { cache } = makeCache();

    cache.setCached("  Rust vs Go  ", RESULT_A);

    expect(cache.getCached("rust vs go")).toEqual(RESULT_A);
    expect(cache.getCached("RUST VS GO")).toEqual(RESULT_A);
    expect(cache.getCached("rust vs go ")).toEqual(RESULT_A);
    // Mas queries genuinamente distintas não colidem.
    expect(cache.getCached("rust vs go!")).toBeUndefined();
  });

  it("evicts the least recently used entry when over maxEntries", () => {
    const { cache } = makeCache({ maxEntries: 2 });

    cache.setCached("a", RESULT_A);
    cache.setCached("b", RESULT_B);
    // Hit em "a" — vira a mais recente; "b" é agora o LRU.
    expect(cache.getCached("a")).toEqual(RESULT_A);

    cache.setCached("c", RESULT_A); // estouro: evicta "b", não "a"

    expect(cache.getCached("a")).toEqual(RESULT_A);
    expect(cache.getCached("b")).toBeUndefined();
    expect(cache.getCached("c")).toEqual(RESULT_A);
  });

  it("re-setting the same key refreshes it without evicting itself", () => {
    const { cache } = makeCache({ maxEntries: 2 });

    cache.setCached("a", RESULT_A);
    cache.setCached("b", RESULT_B);
    cache.setCached("a", RESULT_B); // "a" atualizada → mais recente
    cache.setCached("c", RESULT_A); // evicta "b"

    expect(cache.getCached("a")).toEqual(RESULT_B);
    expect(cache.getCached("b")).toBeUndefined();
  });

  it("clear() wipes all entries", () => {
    const { cache } = makeCache();

    cache.setCached("a", RESULT_A);
    cache.setCached("b", RESULT_B);
    cache.clear();

    expect(cache.getCached("a")).toBeUndefined();
    expect(cache.getCached("b")).toBeUndefined();
  });

  it("uses the defaults: 5 min TTL and 100 entries", () => {
    const cache = new SearchCache({ now: () => Date.now() });

    for (let i = 0; i < 120; i++) {
      cache.setCached(`query-${i}`, RESULT_A);
    }
    // Teto de 100: as 20 mais antigas foram evictadas.
    expect(cache.getCached("query-0")).toBeUndefined();
    expect(cache.getCached("query-119")).toEqual(RESULT_A);
  });
});
