// T-604: testes do handler de relatório (getSessionReport).
//
// Mocka o Prisma no módulo (mesmo padrão de handlers.test.ts) com um store
// em memória que já devolve o resultado do findUnique com os includes usados
// pelo handler (assistant, transcripts, summary, suggestions). O handler NÃO
// chama provider/LLM — a montagem é pura (agent/report.ts) —, então nenhum
// credential é necessário.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Store em memória — sessão composta com os includes do handler
// ---------------------------------------------------------------------------

interface ComposedSession {
  id: string;
  status: string;
  startedAt: Date;
  endedAt: Date | null;
  assistant: { name: string } | null;
  transcripts: Array<{
    speaker: string;
    text: string;
    translatedText: string | null;
    startMs: number;
  }>;
  summary: { text: string; actionItems: string } | null;
  suggestions: Array<{
    trigger: string;
    contextLabel: string | null;
    theySaid: string | null;
    sayThis: string;
    createdAt: Date;
  }>;
}

let sessionRow: ComposedSession | null = null;

function seedSession(overrides: Partial<ComposedSession> = {}): ComposedSession {
  sessionRow = {
    id: "sess-1",
    status: "ENDED",
    startedAt: new Date("2026-01-15T12:30:00.000Z"),
    endedAt: new Date("2026-01-15T13:00:00.000Z"),
    assistant: { name: "Copiloto de Reuniões" },
    transcripts: [
      {
        speaker: "SELF",
        text: "Bom dia",
        translatedText: null,
        startMs: 0,
      },
      {
        speaker: "OTHERS",
        text: "Olá! Vamos começar?",
        translatedText: null,
        startMs: 2500,
      },
    ],
    summary: {
      text: "Reunião de abertura do projeto.",
      actionItems: JSON.stringify(["Enviar ata"]),
    },
    suggestions: [
      {
        trigger: "AUTO",
        contextLabel: "Reunião de kick-off",
        theySaid: "Quem lidera o projeto?",
        sayThis: "A Ana lidera; você apoia na parte técnica.",
        createdAt: new Date("2026-01-15T12:31:00.000Z"),
      },
    ],
    ...overrides,
  };
  return sessionRow;
}

// ---------------------------------------------------------------------------
// Mock do Prisma — vi.mock roda antes da avaliação do módulo
// ---------------------------------------------------------------------------

vi.mock("./db.js", () => ({
  prisma: {
    session: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        // O handler consulta com include; o mock devolve a sessão composta
        // (ou null) — os includes já estão "resolvidos" no store.
        if (sessionRow && sessionRow.id === where.id) {
          return { ...sessionRow };
        }
        return null;
      }),
    },
  },
}));

// Importa DEPOIS do mock — o handlers.ts consome o prisma mockado.
import { getSessionReport } from "./handlers.js";

beforeEach(() => {
  seedSession();
});

afterEach(() => {
  sessionRow = null;
});

describe("getSessionReport (T-604)", () => {
  it("format=md: ok com as três seções e filename .md", async () => {
    const result = await getSessionReport({ sessionId: "sess-1", format: "md" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.format).toBe("md");
    expect(result.value.filename).toBe("relatorio-sessao-2026-01-15.md");
    expect(result.value.content).toContain("## Resumo");
    expect(result.value.content).toContain("Action items:");
    expect(result.value.content).toContain("- [ ] Enviar ata");
    expect(result.value.content).toContain("## Transcrição");
    expect(result.value.content).toContain("[00:00:00] VOCÊ: Bom dia");
    expect(result.value.content).toContain("[00:00:02] OUTROS: Olá! Vamos começar?");
    expect(result.value.content).toContain("## Insights");
    expect(result.value.content).toContain("Sugestão: A Ana lidera; você apoia na parte técnica.");
  });

  it("format=html: documento HTML com as mesmas seções", async () => {
    const result = await getSessionReport({ sessionId: "sess-1", format: "html" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.format).toBe("html");
    expect(result.value.filename).toBe("relatorio-sessao-2026-01-15.html");
    expect(result.value.content).toContain("<!DOCTYPE html>");
    expect(result.value.content).toContain("<h2>Resumo</h2>");
    expect(result.value.content).toContain("<h2>Transcrição</h2>");
    expect(result.value.content).toContain("<h2>Insights</h2>");
  });

  it("format ausente cai em md (default)", async () => {
    const result = await getSessionReport({ sessionId: "sess-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.format).toBe("md");
  });

  it("format inválido recusa com BAD_REQUEST", async () => {
    const result = await getSessionReport({ sessionId: "sess-1", format: "pdf" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BAD_REQUEST");
  });

  it("sessão inexistente devolve DB_ERROR (mesmo padrão de getSessionDetail)", async () => {
    const result = await getSessionReport({ sessionId: "sess-404" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DB_ERROR");
    expect(result.error.message).toContain("sess-404");
  });

  it("sessão sem resumo e sem insights: ok, sem crash, sem as seções", async () => {
    seedSession({ summary: null, suggestions: [] });
    const result = await getSessionReport({ sessionId: "sess-1", format: "md" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).not.toContain("## Resumo");
    expect(result.value.content).not.toContain("## Insights");
    expect(result.value.content).toContain("## Transcrição");
  });

  it("assistantName ausente (assistente removido) não quebra os metadados", async () => {
    seedSession({ assistant: null });
    const result = await getSessionReport({ sessionId: "sess-1", format: "md" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).not.toContain("Assistente:");
    expect(result.value.content).toContain("Sessão: sess-1");
  });
});
