// Tests for the fact-checking pipeline (T-600).
//
// Uses a scripted fake AiProvider (no real adapter, no real API calls) and an
// INJECTED search function — no vi.mock, no network. The searchFn is a
// parameter of factCheckForRequest exactly for this testability.
//
// Acceptance criteria tested:
// 1. Section is mounted in the exact contract format (verdict, confidence,
//    justification, sources as [título](url)) — 1 search per claim with a
//    short timeout, 2 LLM calls (extraction + judgment).
// 2. No claims extracted → "" and no search at all.
// 3. Failing search (throwing or empty) → section omitted, never throws.
// 4. Trigger outside CLAIMS_TRIGGERS → nothing runs (no LLM, no search).
// 5. Best-effort: a throwing provider never propagates.
// 6. ADR-003: the credential secret never appears in the section.

import { describe, expect, it, vi } from "vitest";

import type {
  AiProvider,
  AnalyzeParams,
  CompletionChunk,
  ProviderCapabilities,
} from "../../providers/provider.js";
import type { InjectedCredential } from "../../providers/types.js";
import type { SuggestRequest } from "../../contract.js";
import type { SearchResult } from "./websearch.js";
import {
  CLAIMS_TRIGGERS,
  factCheckForRequest,
  parseClaims,
  shouldFactCheck,
} from "./claims.js";

// ---------------------------------------------------------------------------
// Fake AiProvider — respostas em fila: 1ª chamada = extração, 2ª = julgamento
// ---------------------------------------------------------------------------

class ScriptedProvider implements AiProvider {
  readonly kind = "OPENAI" as const;
  readonly capabilities: ProviderCapabilities = {
    analysis: true,
    transcription: false,
    translation: false,
  };

  /** Respostas consumidas em ordem, uma por chamada de analyzeStream. */
  responses: string[] = [];
  /** Params de cada chamada, para asserções de prompt/credential. */
  calls: AnalyzeParams[] = [];

  async validate(_credential: InjectedCredential) {
    return { valid: true };
  }

  async *analyzeStream(params: AnalyzeParams): AsyncIterable<CompletionChunk> {
    this.calls.push(params);
    const next = this.responses.shift();
    if (next === undefined) {
      throw new Error("ScriptedProvider: sem resposta na fila");
    }
    // Dois chunks para exercitar a junção do stream (mesmo padrão de rollSummary).
    const mid = Math.ceil(next.length / 2);
    yield { text: next.slice(0, mid) };
    yield { text: next.slice(mid) };
  }

  async translate(
    _credential: InjectedCredential,
    _text: string,
    _targetLanguage: string,
  ): Promise<string> {
    throw new Error("not supported");
  }
}

// ---------------------------------------------------------------------------

const CREDENTIAL: InjectedCredential = {
  kind: "OPENAI",
  connectionMode: "API_KEY",
  secret: "sk-super-secret-do-not-leak-claims-12345",
  model: "gpt-4o",
};

const NODE_RESULTS: SearchResult[] = [
  {
    title: "Node.js blog",
    url: "https://nodejs.org/en/blog/release/v24.0.0",
    snippet: "Node.js 24 becomes the active LTS release in October.",
  },
  {
    title: "Tech news",
    url: "https://example.com/news",
    snippet: "The release cadence stays at six months.",
  },
];

function makeRequest(overrides: Partial<SuggestRequest> = {}): SuggestRequest {
  return {
    sessionId: "s1",
    assistantId: "a1",
    trigger: "ANALYZE_CONVERSATION",
    context: [
      {
        speaker: "OTHERS",
        text: "Node 24 is the current LTS release.",
        startMs: 0,
      },
      {
        speaker: "SELF",
        text: "And the release cadence is six months.",
        startMs: 4000,
      },
    ],
    credential: CREDENTIAL,
    ...overrides,
  };
}

function makeSearchFn(
  results: SearchResult[] = NODE_RESULTS,
): ReturnType<typeof vi.fn> {
  return vi.fn(async (_query: string, _options?: unknown) => results);
}

// ---------------------------------------------------------------------------
// shouldFactCheck / CLAIMS_TRIGGERS
// ---------------------------------------------------------------------------

describe("CLAIMS_TRIGGERS / shouldFactCheck", () => {
  it("inclui exatamente ANALYZE_CONVERSATION e ANALYZE_SELECTION — AUTO fica fora", () => {
    expect([...CLAIMS_TRIGGERS].sort()).toEqual([
      "ANALYZE_CONVERSATION",
      "ANALYZE_SELECTION",
    ]);

    expect(shouldFactCheck(makeRequest())).toBe(true);
    expect(
      shouldFactCheck(
        makeRequest({ trigger: "ANALYZE_SELECTION", selectionText: "trecho" }),
      ),
    ).toBe(true);

    for (const trigger of ["AUTO", "SCREEN_CAPTURE", "ASK_ANYTHING"] as const) {
      expect(shouldFactCheck(makeRequest({ trigger }))).toBe(false);
    }
  });

  it("não roda sem nenhum material (contexto vazio e sem seleção)", () => {
    expect(shouldFactCheck(makeRequest({ context: [] }))).toBe(false);
    expect(
      shouldFactCheck(
        makeRequest({ context: [], selectionText: "   " }),
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// factCheckForRequest — pipeline completa
// ---------------------------------------------------------------------------

describe("factCheckForRequest (T-600)", () => {
  it("(a) monta a seção com veredito e fontes no formato exato do contrato", async () => {
    const provider = new ScriptedProvider();
    provider.responses = [
      // Extração: JSON cercado de prosa e cerca de código — parse tolerante.
      'Claro!\n```json\n["Node 24 is the current LTS release"]\n```',
      '[{"index":1,"verdict":"TRUE","confidence":"alta","justification":"O blog oficial do Node.js confirma o status LTS.","sources":[1]}]',
    ];
    const searchFn = makeSearchFn();

    const section = await factCheckForRequest(
      makeRequest(),
      CREDENTIAL,
      provider,
      searchFn,
    );

    // Formato exato compartilhado com a T-602.
    expect(section.startsWith("## Verificação de fatos\n\n")).toBe(true);
    expect(section).toContain(
      '### Claim: "Node 24 is the current LTS release"',
    );
    expect(section).toContain("**Veredito: TRUE** · confiança: alta");
    expect(section).toContain(
      "O blog oficial do Node.js confirma o status LTS.",
    );
    expect(section).toContain(
      "Fontes: [Node.js blog](https://nodejs.org/en/blog/release/v24.0.0)",
    );
    expect(section.indexOf("### Claim:")).toBeGreaterThan(
      section.indexOf("## Verificação de fatos"),
    );

    // 2 chamadas LLM (extração + julgamento) e 1 busca com timeout curto.
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0]!.system).not.toBe(provider.calls[1]!.system);
    expect(provider.calls[1]!.userPrompt).toContain(
      "Claim 1: Node 24 is the current LTS release",
    );
    expect(searchFn).toHaveBeenCalledTimes(1);
    expect(searchFn).toHaveBeenCalledWith("Node 24 is the current LTS release", {
      timeoutMs: 4000,
      limit: 3,
    });
  });

  it("veredito FALSE usa a fonte contraditória indicada pelos índices", async () => {
    const provider = new ScriptedProvider();
    provider.responses = [
      '["Node 24 is the current LTS release"]',
      '[{"index":1,"verdict":"FALSE","confidence":"média","justification":"A fonte contraria a afirmação.","sources":[2]}]',
    ];
    const searchFn = makeSearchFn();

    const section = await factCheckForRequest(
      makeRequest(),
      CREDENTIAL,
      provider,
      searchFn,
    );

    expect(section).toContain("**Veredito: FALSE** · confiança: média");
    expect(section).toContain("Fontes: [Tech news](https://example.com/news)");
    expect(section).not.toContain("[Node.js blog]");
  });

  it("extrai no máximo 2 claims (uma busca sequencial por claim)", async () => {
    const provider = new ScriptedProvider();
    provider.responses = [
      '["Primeira claim verificável do delta","Segunda claim verificável do delta","Terceira claim que deve ser cortada"]',
      '[{"index":1,"verdict":"TRUE","confidence":"alta","justification":"Fonte confirma.","sources":[1]},' +
        '{"index":2,"verdict":"UNCERTAIN","confidence":"baixa","justification":"Fonte não cobre.","sources":[]}]',
    ];
    const searchFn = makeSearchFn();

    const section = await factCheckForRequest(
      makeRequest(),
      CREDENTIAL,
      provider,
      searchFn,
    );

    expect(searchFn).toHaveBeenCalledTimes(2);
    expect(section).toContain('### Claim: "Primeira claim verificável do delta"');
    expect(section).toContain('### Claim: "Segunda claim verificável do delta"');
    expect(section).not.toContain("Terceira");
    // Claim sem fonte mantém a linha "Fontes:" estável para a UI.
    expect(section).toContain("Fontes: nenhuma");
  });

  it("(b) sem claims → string vazia e nenhuma busca", async () => {
    const provider = new ScriptedProvider();
    provider.responses = ["[]"];
    const searchFn = makeSearchFn();

    const section = await factCheckForRequest(
      makeRequest(),
      CREDENTIAL,
      provider,
      searchFn,
    );

    expect(section).toBe("");
    expect(searchFn).not.toHaveBeenCalled();
    expect(provider.calls).toHaveLength(1); // só a extração rodou
  });

  it("(c) busca que falha (lança ou resolve []) → seção omitida, sem throw", async () => {
    const provider = new ScriptedProvider();
    // Duas extrações: uma por ciclo de factCheckForRequest (o julgamento nem
    // chega a rodar — sem evidência a seção já é omitida).
    provider.responses = [
      '["Node 24 is the current LTS release"]',
      '["Node 24 is the current LTS release"]',
    ];

    const searchFnThrows = vi.fn(
      async (_query: string, _options?: unknown): Promise<SearchResult[]> => {
        throw new Error("DDG down");
      },
    );
    await expect(
      factCheckForRequest(makeRequest(), CREDENTIAL, provider, searchFnThrows),
    ).resolves.toBe("");

    const searchFnEmpty = makeSearchFn([]);
    await expect(
      factCheckForRequest(makeRequest(), CREDENTIAL, provider, searchFnEmpty),
    ).resolves.toBe("");
    expect(searchFnEmpty).toHaveBeenCalledTimes(1);
    expect(provider.calls).toHaveLength(2); // extração de cada ciclo; julgamento nem roda
  });

  it("(d) trigger fora de CLAIMS_TRIGGERS → não roda nada (nem LLM, nem busca)", async () => {
    const provider = new ScriptedProvider();
    const searchFn = makeSearchFn();

    for (const trigger of ["AUTO", "SCREEN_CAPTURE", "ASK_ANYTHING"] as const) {
      const section = await factCheckForRequest(
        makeRequest({ trigger }),
        CREDENTIAL,
        provider,
        searchFn,
      );
      expect(section).toBe("");
    }

    expect(provider.calls).toHaveLength(0);
    expect(searchFn).not.toHaveBeenCalled();
  });

  it("best-effort: provider que lança na extração → string vazia, sem throw", async () => {
    const failingProvider: AiProvider = {
      kind: "OPENAI",
      capabilities: { analysis: true, transcription: false, translation: false },
      validate: async () => ({ valid: true }),
      async *analyzeStream(): AsyncIterable<CompletionChunk> {
        throw new Error("Provider unavailable");
      },
      async translate() {
        throw new Error("not supported");
      },
    };
    const searchFn = makeSearchFn();

    await expect(
      factCheckForRequest(makeRequest(), CREDENTIAL, failingProvider, searchFn),
    ).resolves.toBe("");
    expect(searchFn).not.toHaveBeenCalled();
  });

  it("julgamento sem JSON válido → seção omitida (best-effort)", async () => {
    const provider = new ScriptedProvider();
    provider.responses = [
      '["Node 24 is the current LTS release"]',
      "Não sei classificar.", // sem array JSON
    ];

    const section = await factCheckForRequest(
      makeRequest(),
      CREDENTIAL,
      provider,
      makeSearchFn(),
    );

    expect(section).toBe("");
  });

  it("o segredo da credencial nunca aparece na seção (ADR-003)", async () => {
    const provider = new ScriptedProvider();
    provider.responses = [
      '["Node 24 is the current LTS release"]',
      '[{"index":1,"verdict":"TRUE","confidence":"alta","justification":"Confirmado.","sources":[1]}]',
    ];

    const section = await factCheckForRequest(
      makeRequest(),
      CREDENTIAL,
      provider,
      makeSearchFn(),
    );

    expect(section).not.toContain("sk-super-secret-do-not-leak-claims-12345");
    expect(section).not.toContain("secret");
  });
});

// ---------------------------------------------------------------------------
// parseClaims — parse tolerante da extração
// ---------------------------------------------------------------------------

describe("parseClaims", () => {
  it("aceita JSON cercado por texto e cercas de código", () => {
    expect(
      parseClaims(
        'Aqui estão:\n```json\n["Claim A verificável aqui","Claim B verificável aqui"]\n```\nEspero que ajude.',
      ),
    ).toEqual(["Claim A verificável aqui", "Claim B verificável aqui"]);
  });

  it("corta no máximo 2 claims", () => {
    expect(parseClaims('["a1 claim","a2 claim","a3 claim"]')).toEqual([
      "a1 claim",
      "a2 claim",
    ]);
  });

  it("saída sem JSON não vira claim (prosa jamais vira claim falsa)", () => {
    expect(parseClaims("Hello world")).toEqual([]);
    expect(parseClaims("Aqui estão as claims:")).toEqual([]);
  });

  it("normaliza whitespace e grifos da saída do modelo", () => {
    expect(parseClaims('[ "  \\"Claim   com   espaços\\"  " ]')).toEqual([
      "Claim com espaços",
    ]);
  });

  it("ignora itens não-string do array", () => {
    expect(parseClaims('[1, null, "Claim válida aqui", {"a": 1}]')).toEqual([
      "Claim válida aqui",
    ]);
  });
});
