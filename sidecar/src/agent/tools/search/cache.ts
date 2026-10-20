// Cache/dedupe de buscas por query (T-603): Map em memória com TTL curto e
// teto de entradas. Motivação: o mesmo pedido/disparo pode disparar buscas
// repetidas (grafo + fact-check + retry de UI) — cachear evita round-trips
// duplicados e protege o DDG de banimento (o limiter limita a taxa, o cache
// elimina o trabalho redundante).
//
// Política:
// - Chave normalizada: trim + lowercase ("Rust vs Go" e "rust vs go" são a
//   mesma entrada).
// - TTL: default 5 min — contexto web envelhece rápido; após expirar é miss.
// - Eviction: LRU simples. O Map preserva ordem de inserção; um hit
//   re-insere a entrada (delete + set) para marcá-la como recente, e o
//   estouro de capacidade descarta a chave mais antiga (primeira do Map).
//   Em 100 entradas de objetos minúsculos, o O(n) do delete é irrelevante.
// - `now` injetável para testes de TTL sem fake timers globais.

import type { SearchResult } from "./provider.js";

/** Configuração do cache. `now` é injetável para testes. */
export interface SearchCacheOptions {
  /** Tempo de vida de cada entrada, em ms (default: 5 min). */
  ttlMs?: number;
  /** Teto de entradas; o excedente mais antigo é evictado (default: 100). */
  maxEntries?: number;
  /** Relógio injetável (default: `() => Date.now()`). */
  now?: () => number;
}

interface CacheEntry {
  results: SearchResult[];
  expiresAt: number;
}

const DEFAULT_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_ENTRIES = 100;

export class SearchCache {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, CacheEntry>();

  constructor(options: SearchCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    // Wrapper (não `?? Date.now`): ler o relógio global vigente a cada chamada,
    // mesmo molde do SlidingWindowRateLimiter — evita capturar referência de
    // um fake timer descartado.
    this.now = options.now ?? ((): number => Date.now());
  }

  /** Resultados da query, se houver entrada válida (não expirada). */
  getCached(query: string): SearchResult[] | undefined {
    const key = this.normalize(query);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() >= entry.expiresAt) {
      // Expirada: remove já — set venceu a chance de servir.
      this.entries.delete(key);
      return undefined;
    }
    // Hit: re-insere para a entrada virar a mais recente (LRU).
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.results;
  }

  /** Armazena os resultados da query sob a chave normalizada. */
  setCached(query: string, results: SearchResult[]): void {
    const key = this.normalize(query);
    // Re-set (mesma chave) também move para o fim — coerente com o hit.
    this.entries.delete(key);
    this.entries.set(key, {
      results,
      expiresAt: this.now() + this.ttlMs,
    });
    // Estouro: evicta a chave mais antiga (primeira na ordem de inserção).
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  /** Limpa todo o cache — uso em testes e reset manual. */
  clear(): void {
    this.entries.clear();
  }

  /** Chave normalizada: trim + lowercase — dedupe tolerante a casing/espaços. */
  private normalize(query: string): string {
    return query.trim().toLowerCase();
  }
}

/**
 * Instância compartilhada do processo, usada pela fachada websearch.ts
 * (webSearchForRequest). Uma só = dedupe efetivo entre consumidores.
 */
export const searchCache = new SearchCache();
