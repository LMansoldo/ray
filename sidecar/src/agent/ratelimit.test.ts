// Tests for the sliding-window rate limiter.
//
// Vitest fake timers mock both setTimeout and Date (default `toFake`
// includes "Date"), so the injected `now: () => Date.now()` advances in
// lockstep with `advanceTimersByTimeAsync` — no real waits anywhere.
// Coverage:
// (a) N calls within the limit pass with zero wait (no timers scheduled);
// (b) the (N+1)-th call waits the MINIMUM and resolves exactly when the
//     window frees;
// (c) FIFO — simultaneous calls beyond the limit are granted in arrival
//     order, spaced by the window;
// (d) scopes are independent windows;
// plus reset() and the per-scope registry (getLimiter defaults).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SlidingWindowRateLimiter,
  acquireSlot,
  getLimiter,
} from "./ratelimit.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// (a) Dentro do limite: passa sem espera
// ---------------------------------------------------------------------------

describe("SlidingWindowRateLimiter — dentro do limite", () => {
  it("concede N chamadas sem agendar nenhum timer", async () => {
    const limiter = new SlidingWindowRateLimiter({
      maxRequests: 3,
      windowMs: 1000,
      now: () => Date.now(),
    });

    await expect(limiter.acquireSlot("s")).resolves.toBeUndefined();
    await expect(limiter.acquireSlot("s")).resolves.toBeUndefined();
    await expect(limiter.acquireSlot("s")).resolves.toBeUndefined();

    // Zero espera = zero timers pendentes.
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (b) (N+1)-ésima: espera o MÍNIMO e resolve quando a janela libera
// ---------------------------------------------------------------------------

describe("SlidingWindowRateLimiter — espera mínima", () => {
  it("a 3ª chamada resolve exatamente na expiração do timestamp mais antigo", async () => {
    const limiter = new SlidingWindowRateLimiter({
      maxRequests: 2,
      windowMs: 1000,
      now: () => Date.now(),
    });

    await limiter.acquireSlot("s"); // t=0
    await vi.advanceTimersByTimeAsync(200);
    await limiter.acquireSlot("s"); // t=200

    const third = limiter.acquireSlot("s"); // precisa esperar t=0+1000
    let resolved = false;
    void third.then(() => {
      resolved = true;
    });

    // t=999: o mais antigo (t=0) ainda está dentro da janela (0+1000 > 999).
    await vi.advanceTimersByTimeAsync(799);
    expect(resolved).toBe(false);

    // t=1000: janela libera — resolve no tick exato, nem um ms a mais.
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (c) FIFO: chegadas simultâneas além do limite, atendidas em ordem
// ---------------------------------------------------------------------------

describe("SlidingWindowRateLimiter — FIFO", () => {
  it("atende chamadas simultâneas em ordem de chegada, espaçadas pela janela", async () => {
    const limiter = new SlidingWindowRateLimiter({
      maxRequests: 1,
      windowMs: 1000,
      now: () => Date.now(),
    });

    const order: number[] = [];
    await limiter.acquireSlot("s").then((_) => order.push(0)); // t=0, concedido

    // Duas chamadas simultâneas além do limite — ambas enfileiradas em t=0.
    const p1 = limiter.acquireSlot("s").then(() => order.push(1));
    const p2 = limiter.acquireSlot("s").then(() => order.push(2));

    // Primeira janela libera: só a 1ª da fila passa (a concessão dela ocupa
    // a janela de novo), em t=1000.
    await vi.advanceTimersByTimeAsync(1000);
    expect(order).toEqual([0, 1]);

    // A 2ª esperante só é atendida quando a concessão anterior expira, t=2000
    // — espaçamento de exatamente windowMs entre concessões.
    await vi.advanceTimersByTimeAsync(1000);
    expect(order).toEqual([0, 1, 2]);

    await Promise.all([p1, p2]);
  });
});

// ---------------------------------------------------------------------------
// (d) Scopes independentes + reset
// ---------------------------------------------------------------------------

describe("SlidingWindowRateLimiter — scopes e reset", () => {
  it("escopos distintos têm janelas independentes", async () => {
    const limiter = new SlidingWindowRateLimiter({
      maxRequests: 1,
      windowMs: 1000,
      now: () => Date.now(),
    });

    await limiter.acquireSlot("a"); // esgota o scope "a" em t=0
    // Scope "b" não sabe nada da janela de "a": passa sem esperar.
    await expect(limiter.acquireSlot("b")).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);

    // "a" segue limitado pela própria janela.
    const secondA = limiter.acquireSlot("a");
    let resolved = false;
    void secondA.then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
  });

  it("reset(scope) limpa só o escopo alvo", async () => {
    const limiter = new SlidingWindowRateLimiter({
      maxRequests: 1,
      windowMs: 60_000,
      now: () => Date.now(),
    });

    await limiter.acquireSlot("a");
    limiter.reset("a");

    // Janela de "a" zerada: passa na hora, sem timer pendente.
    await expect(limiter.acquireSlot("a")).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);

    // E um escopo nunca tocado segue funcionando normalmente.
    await expect(limiter.acquireSlot("b")).resolves.toBeUndefined();
  });

  it("reset rejeita esperantes em vez de pendurá-los para sempre", async () => {
    const limiter = new SlidingWindowRateLimiter({
      maxRequests: 1,
      windowMs: 60_000,
      now: () => Date.now(),
    });

    await limiter.acquireSlot("a");
    const pending = limiter.acquireSlot("a"); // enfileirado
    const expectation = expect(pending).rejects.toThrow(/reset/i);

    limiter.reset("a");
    await expectation;
  });
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe("getLimiter", () => {
  it("cacheia a mesma instância por scope e separa instâncias por scope", () => {
    expect(getLimiter("search")).toBe(getLimiter("search"));
    expect(getLimiter("llm:openai")).not.toBe(getLimiter("search"));
  });

  it("aplica o default de 10 req/min ao scope search", async () => {
    const limiter = getLimiter("search");
    limiter.reset();

    for (let i = 0; i < 10; i++) {
      await limiter.acquireSlot("search");
    }
    expect(vi.getTimerCount()).toBe(0); // 10 dentro do limite: nada pendente

    const eleventh = limiter.acquireSlot("search");
    let resolved = false;
    void eleventh.then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(59_999);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1); // t=60s: janela de 1 min libera
    expect(resolved).toBe(true);

    limiter.reset();
  });

  it("o atalho acquireSlot compartilha a MESMA janela do registry", async () => {
    // max=1 para tornar o compartilhamento observável.
    const limiter = getLimiter("shared-scope-test", {
      maxRequests: 1,
      windowMs: 60_000,
    });
    limiter.reset();

    await acquireSlot("shared-scope-test"); // consome a única vaga

    // Se o atalho usasse outra instância, esta chamada resolveria na hora.
    const second = limiter.acquireSlot("shared-scope-test");
    let resolved = false;
    void second.then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);

    limiter.reset();
  });
});
