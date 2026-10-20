// T-604: testes de unidade da montagem do relatório (funções puras).
//
// buildSessionReport não toca banco nem LLM — os testes cobrem os três
// requisitos do documento (resumo + action items, transcrição com offsets
// [HH:MM:SS] e speaker, insights persistidos) nos dois formatos, além dos
// casos tolerantes (sem resumo, sem insights, sem segmentos).

import { describe, expect, it } from "vitest";
import {
  buildSessionReport,
  formatOffsetMs,
  parseStoredActionItems,
  type ReportInsight,
  type ReportSegment,
  type ReportSession,
  type ReportSummary,
} from "./report.js";

const BASE_SESSION: ReportSession = {
  id: "sess-1",
  startedAt: "2026-01-15T12:30:00.000Z",
  endedAt: "2026-01-15T13:00:00.000Z",
  assistantName: "Copiloto de Reuniões",
};

const BASE_SUMMARY: ReportSummary = {
  text: "A reunião cobriu o roadmap do trimestre.",
  actionItems: ["Follow up do deploy", "Agendar revisão"],
};

const BASE_SEGMENTS: ReportSegment[] = [
  { speaker: "SELF", text: "Bom dia, vamos começar.", startMs: 0 },
  { speaker: "OTHERS", text: "Hello there.", startMs: 1500 },
  { speaker: "OTHERS", text: "Após uma hora.", startMs: 3_661_000 },
];

const BASE_INSIGHTS: ReportInsight[] = [
  {
    trigger: "AUTO",
    contextLabel: "Você está em uma entrevista técnica",
    theySaid: "Explique sua experiência com Rust",
    sayThis: "Construí o núcleo do Ray em Rust com Tauri 2.",
  },
];

describe("formatOffsetMs — offsets relativos ao início da sessão (HH:MM:SS)", () => {
  it("zero vira 00:00:00", () => {
    expect(formatOffsetMs(0)).toBe("00:00:00");
  });

  it("arredonda para baixo (floor) o restante em ms", () => {
    expect(formatOffsetMs(1500)).toBe("00:00:01");
  });

  it("compõe horas, minutos e segundos", () => {
    expect(formatOffsetMs(3_661_000)).toBe("01:01:01");
  });

  it("valor negativo (dado inválido) não quebra — cai em 00:00:00", () => {
    expect(formatOffsetMs(-5)).toBe("00:00:00");
  });
});

describe("parseStoredActionItems — coluna String com JSON (SQLite)", () => {
  it("converte array de strings", () => {
    expect(parseStoredActionItems(JSON.stringify(["a", "b"]))).toEqual(["a", "b"]);
  });

  it("null/undefined/vazio devolvem lista vazia", () => {
    expect(parseStoredActionItems(null)).toEqual([]);
    expect(parseStoredActionItems(undefined)).toEqual([]);
    expect(parseStoredActionItems("")).toEqual([]);
  });

  it("JSON inválido ou shape inesperado devolvem lista vazia (sem lançar)", () => {
    expect(parseStoredActionItems("não é json")).toEqual([]);
    expect(parseStoredActionItems('{"x":1}')).toEqual([]);
    expect(parseStoredActionItems("[1,2]")).toEqual([]);
  });
});

describe("buildSessionReport — Markdown", () => {
  it("contém as três seções: Resumo, Transcrição e Insights", () => {
    const md = buildSessionReport(
      BASE_SESSION,
      BASE_SUMMARY,
      BASE_SEGMENTS,
      "md",
      BASE_INSIGHTS,
    );
    expect(md).toContain("# Relatório da sessão");
    expect(md).toContain("## Resumo");
    expect(md).toContain("## Transcrição");
    expect(md).toContain("## Insights");
  });

  it("seção Resumo traz texto e action items como checklist", () => {
    const md = buildSessionReport(BASE_SESSION, BASE_SUMMARY, [], "md");
    expect(md).toContain("A reunião cobriu o roadmap do trimestre.");
    expect(md).toContain("Action items:");
    expect(md).toContain("- [ ] Follow up do deploy");
    expect(md).toContain("- [ ] Agendar revisão");
  });

  it("transcrição é lista [HH:MM:SS] SPEAKER: texto com offsets relativos", () => {
    const md = buildSessionReport(BASE_SESSION, BASE_SUMMARY, BASE_SEGMENTS, "md");
    expect(md).toContain("[00:00:00] VOCÊ: Bom dia, vamos começar.");
    expect(md).toContain("[00:00:01] OUTROS: Hello there.");
    expect(md).toContain("[01:01:01] OUTROS: Após uma hora.");
  });

  it("ordena os segmentos por startMs mesmo se recebidos fora de ordem", () => {
    const foraDeOrdem: ReportSegment[] = [
      { speaker: "OTHERS", text: "segundo", startMs: 2000 },
      { speaker: "SELF", text: "primeiro", startMs: 0 },
    ];
    const md = buildSessionReport(BASE_SESSION, BASE_SUMMARY, foraDeOrdem, "md");
    expect(md.indexOf("primeiro")).toBeLessThan(md.indexOf("segundo"));
  });

  it("seção Insights traz contexto, fala e sugestão", () => {
    const md = buildSessionReport(
      BASE_SESSION,
      BASE_SUMMARY,
      BASE_SEGMENTS,
      "md",
      BASE_INSIGHTS,
    );
    expect(md).toContain("Contexto: Você está em uma entrevista técnica");
    expect(md).toContain("Eles disseram: Explique sua experiência com Rust");
    expect(md).toContain("Sugestão: Construí o núcleo do Ray em Rust com Tauri 2.");
  });

  it("tradução do segmento aparece junto à fala original quando existir", () => {
    const segments: ReportSegment[] = [
      { speaker: "SELF", text: "Olá", startMs: 0, translatedText: "Hello" },
    ];
    const md = buildSessionReport(BASE_SESSION, BASE_SUMMARY, segments, "md");
    expect(md).toContain("[00:00:00] VOCÊ: Olá");
    expect(md).toContain("→ Hello");
  });
});

describe("buildSessionReport — HTML", () => {
  it("é um documento autossuficiente com as três seções", () => {
    const html = buildSessionReport(
      BASE_SESSION,
      BASE_SUMMARY,
      BASE_SEGMENTS,
      "html",
      BASE_INSIGHTS,
    );
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('<html lang="pt-BR">');
    expect(html).toContain("<h2>Resumo</h2>");
    expect(html).toContain("<h2>Transcrição</h2>");
    expect(html).toContain("<h2>Insights</h2>");
    // CSS inline, sem link/asset externo.
    expect(html).toContain("<style>");
    expect(html).not.toContain("<link");
    expect(html).not.toContain("<script");
  });

  it("timestamp e speaker aparecem na transcrição HTML", () => {
    const html = buildSessionReport(BASE_SESSION, BASE_SUMMARY, BASE_SEGMENTS, "html");
    expect(html).toContain("[00:00:00]");
    expect(html).toContain("VOCÊ:");
    expect(html).toContain("[01:01:01]");
  });

  it("escapa HTML do conteúdo (texto da transcrição não vira marcação)", () => {
    const segments: ReportSegment[] = [
      { speaker: "OTHERS", text: "<script>alert('x')</script> & done", startMs: 0 },
    ];
    const html = buildSessionReport(BASE_SESSION, BASE_SUMMARY, segments, "html");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp; done");
    expect(html).not.toContain("<script>alert");
  });
});

describe("buildSessionReport — casos tolerantes", () => {
  it("sessão SEM resumo não crasha: seção Resumo omitida, resto intacto", () => {
    const md = buildSessionReport(BASE_SESSION, null, BASE_SEGMENTS, "md");
    expect(md).not.toContain("## Resumo");
    expect(md).toContain("## Transcrição");
    expect(md).toContain("[00:00:00] VOCÊ: Bom dia, vamos começar.");

    const html = buildSessionReport(BASE_SESSION, null, BASE_SEGMENTS, "html");
    expect(html).toContain("<h2>Transcrição</h2>");
    expect(html).not.toContain("<h2>Resumo</h2>");
  });

  it("resumo vazio (texto em branco e sem action items) é omitido como null", () => {
    const md = buildSessionReport(
      BASE_SESSION,
      { text: "   ", actionItems: [] },
      BASE_SEGMENTS,
      "md",
    );
    expect(md).not.toContain("## Resumo");
  });

  it("SEM insights a seção Insights é omitida, sem erro", () => {
    const md = buildSessionReport(BASE_SESSION, BASE_SUMMARY, BASE_SEGMENTS, "md", []);
    expect(md).not.toContain("## Insights");
    const html = buildSessionReport(BASE_SESSION, BASE_SUMMARY, BASE_SEGMENTS, "html", []);
    expect(html).not.toContain("<h2>Insights</h2>");
  });

  it("SEM segmentos mostra estado próprio, sem crash", () => {
    const md = buildSessionReport(BASE_SESSION, BASE_SUMMARY, [], "md");
    expect(md).toContain("_Sem transcrição nesta sessão._");
    const html = buildSessionReport(BASE_SESSION, BASE_SUMMARY, [], "html");
    expect(html).toContain("Sem transcrição nesta sessão.");
  });
});
