// Rate limiter de janela deslizante, zero dependências.
//
// Motivação: múltiplos consumidores (busca DDG, futuros adapters de LLM)
// compartilham os mesmos endpoints sem coordenação — em sessões longas isso
// vira HTTP 429/banimento. O limiter é compartilhado por escopo via registry
// (`getLimiter`), e `acquireSlot()` SÓ resolve quando a chamada pode
// prosseguir, esperando o MÍNIMO necessário (expiração do timestamp mais
// antigo da janela) — diferente de um throttle fixo, que desperdiçaria
// capacidade quando o tráfego é rajadado.
//
// Semântica da janela: no máximo `maxRequests` aquisições em qualquer
// intervalo de `windowMs`. O timestamp é registrado APÓS adquirir o slot
// (no instante da concessão), não na chegada — assim esperantes na fila não
// consomem capacidade antes da hora.
//
// Thread-safety: JS é single-threaded, mas chamadas simultâneas (chegadas
// antes de qualquer await entre elas) disputam a mesma janela. A fila FIFO
// garante que excedentes sejam atendidos em ordem de chegada, cada um
// reavaliado quando a janela libera.

/** Configuração do limiter. `now` é injetável para testes com fake timers. */
export interface RateLimiterOptions {
  /** Máximo de aquisições em qualquer janela de `windowMs`. */
  maxRequests: number;
  /** Tamanho da janela deslizante, em ms. */
  windowMs: number;
  /** Relógio injetável (default: `Date.now`). */
  now?: () => number;
}

/** Estado por escopo dentro de uma instância. */
interface ScopeState {
  /** Timestamps das concessões ainda dentro da janela, ordenado crescente. */
  timestamps: number[];
  /** Fila FIFO de esperantes; a ordem de chegada define a ordem de concessão. */
  queue: Array<{ resolve: () => void; reject: (err: Error) => void }>;
  /** Timer agendado para rodar o drain (um por escopo, no máximo). */
  drainTimer: ReturnType<typeof setTimeout> | undefined;
}

export class SlidingWindowRateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly states = new Map<string, ScopeState>();

  constructor(options: RateLimiterOptions) {
    if (options.maxRequests < 1) {
      throw new Error("SlidingWindowRateLimiter: maxRequests deve ser >= 1");
    }
    if (options.windowMs <= 0) {
      throw new Error("SlidingWindowRateLimiter: windowMs deve ser > 0");
    }
    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowMs;
    // Wrapper (não `?? Date.now`): capturar a função congelaria a referência
    // — sob fake timers reinstalados entre testes, `now()` apontaria para o
    // relógio velho, já descartado, e a janela nunca expiraria. O wrapper
    // lê o Date.now GLOBAL vigente a cada chamada.
    this.now = options.now ?? ((): number => Date.now());
  }

  /**
   * Adquire um slot no escopo dado. Resolve imediatamente se há capacidade na
   * janela; caso contrário enfileira o chamador (FIFO) e resolve no instante
   * mínimo em que a janela deslizante permitir.
   */
  async acquireSlot(scope: string): Promise<void> {
    const state = this.stateFor(scope);
    this.prune(state);
    // Só passa na frente se não houver ninguém esperando (justiça FIFO) e a
    // janela tenha capacidade. Ambos os testes rodam sem await entre eles,
    // então não há corrida: chegadas simultâneas caem na fila em ordem.
    if (state.queue.length === 0 && state.timestamps.length < this.maxRequests) {
      state.timestamps.push(this.now());
      return;
    }
    return new Promise<void>((resolve, reject) => {
      state.queue.push({ resolve, reject });
      this.scheduleDrain(state);
    });
  }

  /**
   * Limpa o estado (janelas e filas) — uso em testes. Sem argumento, reseta
   * todos os escopos da instância. Esperantes são rejeitados para não
   * pendurar promessas para sempre.
   */
  reset(scope?: string): void {
    const scopes = scope === undefined ? [...this.states.keys()] : [scope];
    for (const s of scopes) {
      const state = this.states.get(s);
      if (!state) continue;
      if (state.drainTimer !== undefined) {
        clearTimeout(state.drainTimer);
      }
      for (const waiter of state.queue.splice(0)) {
        waiter.reject(new Error(`Rate limiter reset enquanto esperava (scope "${s}")`));
      }
      this.states.delete(s);
    }
  }

  // --- Internos -------------------------------------------------------------

  private stateFor(scope: string): ScopeState {
    let state = this.states.get(scope);
    if (!state) {
      state = { timestamps: [], queue: [], drainTimer: undefined };
      this.states.set(scope, state);
    }
    return state;
  }

  /** Descarta timestamps que já saíram da janela (t + windowMs <= agora). */
  private prune(state: ScopeState): void {
    const cutoff = this.now() - this.windowMs;
    // timestamps é ordenado; o prefixo expirado pode ser descartado.
    let i = 0;
    while (i < state.timestamps.length && state.timestamps[i] <= cutoff) i++;
    if (i > 0) state.timestamps.splice(0, i);
  }

  /**
   * Agenda o drain no instante mínimo: expiração do timestamp mais antigo.
   * Um timer por escopo; o drain reavalia e reagenda se ainda restarem
   * esperantes (janelas com maxRequests > 1 liberam de mais de uma vez).
   */
  private scheduleDrain(state: ScopeState): void {
    if (state.drainTimer !== undefined) return;
    const oldest = state.timestamps[0];
    const waitMs = Math.max(0, (oldest ?? this.now()) + this.windowMs - this.now());
    state.drainTimer = setTimeout(() => {
      state.drainTimer = undefined;
      this.drain(state);
    }, waitMs);
    // Um timer pendente não deve segurar o processo do sidecar vivo.
    const t = state.drainTimer as Partial<{ unref: () => void }>;
    if (typeof t.unref === "function") t.unref();
  }

  private drain(state: ScopeState): void {
    this.prune(state);
    while (state.queue.length > 0 && state.timestamps.length < this.maxRequests) {
      const waiter = state.queue.shift()!;
      // Timestamp registrado APÓS adquirir — a concessão é "agora".
      state.timestamps.push(this.now());
      waiter.resolve();
    }
    if (state.queue.length > 0) this.scheduleDrain(state);
  }
}

// --- Registry de scopes -------------------------------------------------------

type ScopeConfig = { maxRequests: number; windowMs: number };

/** Defaults por escopo. "search" → 10 req/min (o DDG HTML endpoint bane
 * agressivamente acima disso). Escopos desconhecidos herdam o mesmo teto
 * conservador até ganharem entrada própria. */
const SCOPE_DEFAULTS: Record<string, ScopeConfig> = {
  search: { maxRequests: 10, windowMs: 60_000 },
};

const GENERIC_DEFAULT: ScopeConfig = { maxRequests: 10, windowMs: 60_000 };

const registry = new Map<string, SlidingWindowRateLimiter>();

/**
 * Cria/cacheia um limiter por escopo. Mesmo escopo → mesma instância (logo,
 * mesma janela compartilhada entre todos os consumidores do processo).
 * `config` só é honrado na primeira criação do escopo.
 */
export function getLimiter(
  scope: string,
  config?: Partial<ScopeConfig>,
): SlidingWindowRateLimiter {
  let limiter = registry.get(scope);
  if (!limiter) {
    const defaults = SCOPE_DEFAULTS[scope] ?? GENERIC_DEFAULT;
    limiter = new SlidingWindowRateLimiter({
      maxRequests: config?.maxRequests ?? defaults.maxRequests,
      windowMs: config?.windowMs ?? defaults.windowMs,
    });
    registry.set(scope, limiter);
  }
  return limiter;
}

/**
 * Atalho para consumidores: `await acquireSlot("search")` já resolve o
 * registry e a instância. Pensado para os adapters de LLM futuros — o
 * escopo é a chave de coordenação entre processos consumidores.
 */
export async function acquireSlot(scope: string): Promise<void> {
  return getLimiter(scope).acquireSlot(scope);
}
