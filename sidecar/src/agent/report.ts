// Montagem do relatório exportável da sessão (T-604).
//
// Funções PURAS: recebem os dados já carregados do banco (sessão, resumo,
// segmentos, insights) e devolvem o documento completo em Markdown ou HTML.
// Sem I/O, sem LLM, sem dependências — trivialmente testável. A busca dos
// dados vive no handler (handlers.ts); este módulo só formata.
//
// Regra do repo: nenhum conteúdo de reunião vai para logs — aqui nada é
// logado por construção (não há efeito colateral).

/** Sessão no formato consumido pelo relatório (datas em ISO-8601). */
export type ReportSession = {
  id: string;
  startedAt: string;
  endedAt?: string | null;
  assistantName?: string | null;
};

/** Resumo persistido (modelo Summary). Null = sessão sem resumo. */
export type ReportSummary = {
  text: string;
  actionItems: string[];
};

/** Segmento de transcrição no formato do relatório. */
export type ReportSegment = {
  speaker: string;
  text: string;
  /** Offset em ms a partir do INÍCIO da sessão (ver schema.prisma). */
  startMs: number;
  translatedText?: string | null;
};

/** Insight persistido (modelo Suggestion — card do copiloto, RF-331). */
export type ReportInsight = {
  trigger?: string | null;
  contextLabel?: string | null;
  theySaid?: string | null;
  sayThis: string;
};

export type ReportFormat = "md" | "html";

/** Rótulo de exibição do falante. SELF/OTHERS são os valores persistidos
 *  (SQLite não tem enums — mesma conversão de endSession); valores
 *  desconhecidos caem no próprio valor, em caixa alta. */
export function speakerLabel(speaker: string): string {
  if (speaker === "SELF") return "VOCÊ";
  if (speaker === "OTHERS") return "OUTROS";
  return speaker.toUpperCase();
}

/**
 * Formata um offset (ms desde o início da sessão) como HH:MM:SS.
 * Os offsets do schema já são relativos ao início da sessão, então o
 * formatador é um floor para segundos — sem fuso, sem data base.
 */
export function formatOffsetMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Datas do relatório: dia e hora em UTC extraídos do próprio ISO-8601.
 * Formato fixo (não toLocaleString) para ser determinístico em teste e
 * estável entre máquinas.
 */
export function formatIsoDate(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}

/**
 * Converte a coluna Summary.actionItems (String com JSON — SQLite não tem
 * tipo Json) na lista de strings. Tolerante: lixo ou shape inesperado
 * devolve lista vazia, nunca lança.
 */
export function parseStoredActionItems(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

/** Escapa texto para inclusão em HTML (atributos e conteúdo). */
function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Segmentos em ordem cronológica (defensivo: o handler já ordena). */
function sortedSegments(segments: ReportSegment[]): ReportSegment[] {
  return [...segments].sort((a, b) => a.startMs - b.startMs);
}

/** Linha da transcrição no formato `[HH:MM:SS] SPEAKER: texto`. */
function transcriptLine(segment: ReportSegment): string {
  const timestamp = formatOffsetMs(segment.startMs);
  const line = `[${timestamp}] ${speakerLabel(segment.speaker)}: ${segment.text}`;
  // Tradução inline (RF-303) quando existir — indicada após a fala original.
  if (segment.translatedText) {
    return `${line}\n    → ${segment.translatedText}`;
  }
  return line;
}

/** Há conteúdo de resumo a exibir? (evita seções vazias no documento). */
function hasSummaryContent(summary: ReportSummary | null): boolean {
  return Boolean(
    summary && (summary.text.trim().length > 0 || summary.actionItems.length > 0),
  );
}

/** Bloco da seção Resumo + action items. Null quando não há resumo. */
function summaryBlock(summary: ReportSummary | null): string | null {
  if (!hasSummaryContent(summary) || !summary) {
    return null;
  }
  const parts: string[] = [];
  if (summary.text.trim()) {
    parts.push(summary.text.trim());
  }
  if (summary.actionItems.length > 0) {
    const items = summary.actionItems.map((item) => `- [ ] ${item}`);
    parts.push(["Action items:", ...items].join("\n"));
  }
  return parts.join("\n\n");
}

/** Bloco da seção Insights. Null quando não há insights persistidos. */
function insightsBlock(insights: ReportInsight[]): string | null {
  if (insights.length === 0) return null;
  const items = insights.map((insight, index) => {
    const lines: string[] = [`${index + 1}.`];
    if (insight.trigger) lines.push(`   Tipo: ${insight.trigger}`);
    if (insight.contextLabel) lines.push(`   Contexto: ${insight.contextLabel}`);
    if (insight.theySaid) lines.push(`   Eles disseram: ${insight.theySaid}`);
    lines.push(`   Sugestão: ${insight.sayThis}`);
    return lines.join("\n");
  });
  return items.join("\n\n");
}

/** Metadados da sessão (id, datas, assistente) como lista Markdown. */
function metadataLines(session: ReportSession): string[] {
  const lines = [`- Sessão: ${session.id}`];
  lines.push(`- Início: ${formatIsoDate(session.startedAt)} UTC`);
  if (session.endedAt) {
    lines.push(`- Fim: ${formatIsoDate(session.endedAt)} UTC`);
  }
  if (session.assistantName) {
    lines.push(`- Assistente: ${session.assistantName}`);
  }
  return lines;
}

/** Relatório em Markdown: headings por seção, transcrição em lista. */
function buildMarkdown(
  session: ReportSession,
  summary: ReportSummary | null,
  segments: ReportSegment[],
  insights: ReportInsight[],
): string {
  const title = `# Relatório da sessão — ${formatIsoDate(session.startedAt)} UTC`;
  const sections: string[] = [title, ...metadataLines(session)];

  const summaryText = summaryBlock(summary);
  if (summaryText) {
    sections.push("## Resumo", summaryText);
  }

  sections.push("## Transcrição");
  if (segments.length === 0) {
    sections.push("_Sem transcrição nesta sessão._");
  } else {
    sections.push(sortedSegments(segments).map(transcriptLine).join("\n"));
  }

  const insightsText = insightsBlock(insights);
  if (insightsText) {
    sections.push("## Insights", insightsText);
  }

  return sections.join("\n\n") + "\n";
}

/** CSS inline mínimo do relatório HTML — autossuficiente e legível para
 *  imprimir/PDF (sem dependências externas). */
const REPORT_CSS = `
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         color: #1c1c1e; max-width: 50rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.55; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  h2 { font-size: 1.15rem; margin-top: 2rem; padding-bottom: 0.25rem; border-bottom: 1px solid #d8d8dc; }
  .meta { color: #555; font-size: 0.9rem; margin: 0; padding: 0; list-style: none; }
  .transcript { list-style: none; margin: 0; padding: 0; }
  .transcript li { margin-bottom: 0.6rem; }
  .ts { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 0.85rem; color: #6e6e73; margin-right: 0.5rem; }
  .speaker { font-weight: 600; margin-right: 0.4rem; }
  .translation { color: #555; margin: 0.15rem 0 0 0; font-size: 0.95rem; }
  .insight { border: 1px solid #d8d8dc; border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 0.75rem; }
  .insight p { margin: 0.2rem 0; }
  .insight .label { font-weight: 600; }
  .empty { color: #6e6e73; font-style: italic; }
  @media print { body { margin: 0; } }
`;

/** Um insight como bloco HTML (já escapado). */
function insightHtml(insight: ReportInsight): string {
  const rows: string[] = [];
  if (insight.trigger) {
    rows.push(`<p><span class="label">Tipo:</span> ${escapeHtml(insight.trigger)}</p>`);
  }
  if (insight.contextLabel) {
    rows.push(`<p><span class="label">Contexto:</span> ${escapeHtml(insight.contextLabel)}</p>`);
  }
  if (insight.theySaid) {
    rows.push(`<p><span class="label">Eles disseram:</span> ${escapeHtml(insight.theySaid)}</p>`);
  }
  rows.push(`<p><span class="label">Sugestão:</span> ${escapeHtml(insight.sayThis)}</p>`);
  return `<div class="insight">${rows.join("")}</div>`;
}

/** Relatório em HTML: documento simples e autossuficiente (CSS inline). */
function buildHtml(
  session: ReportSession,
  summary: ReportSummary | null,
  segments: ReportSegment[],
  insights: ReportInsight[],
): string {
  const title = `Relatório da sessão — ${formatIsoDate(session.startedAt)} UTC`;

  const metaItems = metadataLines(session)
    .map((line) => `<li>${escapeHtml(line.replace("- ", ""))}</li>`)
    .join("");

  let summarySection = "";
  if (summary && hasSummaryContent(summary)) {
    const paragraphs = escapeHtml(summary.text.trim()).replaceAll("\n", "<br>");
    const itemsHtml =
      summary.actionItems.length > 0
        ? `<ul>${summary.actionItems
            .map((item) => `<li>${escapeHtml(item)}</li>`)
            .join("")}</ul>`
        : "";
    summarySection = `<h2>Resumo</h2><p>${paragraphs}</p>${itemsHtml}`;
  }

  const transcriptItems = sortedSegments(segments)
    .map((segment) => {
      const translation = segment.translatedText
        ? `<p class="translation">→ ${escapeHtml(segment.translatedText)}</p>`
        : "";
      return (
        `<li><span class="ts">[${formatOffsetMs(segment.startMs)}]</span>` +
        `<span class="speaker">${escapeHtml(speakerLabel(segment.speaker))}:</span>` +
        `${escapeHtml(segment.text)}${translation}</li>`
      );
    })
    .join("");

  const transcriptSection =
    `<h2>Transcrição</h2>` +
    (segments.length === 0
      ? `<p class="empty">Sem transcrição nesta sessão.</p>`
      : `<ol class="transcript">${transcriptItems}</ol>`);

  const insightsSection =
    insights.length === 0
      ? ""
      : `<h2>Insights</h2>${insights.map(insightHtml).join("")}`;

  return (
    `<!DOCTYPE html>\n` +
    `<html lang="pt-BR">\n` +
    `<head>\n` +
    `<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${escapeHtml(title)}</title>\n` +
    `<style>${REPORT_CSS}</style>\n` +
    `</head>\n` +
    `<body>\n` +
    `<h1>${escapeHtml(title)}</h1>\n` +
    `<ul class="meta">${metaItems}</ul>\n` +
    summarySection +
    "\n" +
    transcriptSection +
    "\n" +
    insightsSection +
    `\n</body>\n</html>\n`
  );
}

/**
 * Monta o relatório completo da sessão (T-604).
 *
 * @param session — metadados da sessão (datas ISO-8601)
 * @param summary — resumo + action items persistidos (null = sem resumo;
 *                  a seção é omitida, sem erro)
 * @param segments — transcrição completa (offsets em ms desde o início)
 * @param format — "md" (Markdown) ou "html" (documento autossuficiente)
 * @param insights — cards de sugestão persistidos (modelo Suggestion);
 *                   omitidos da saída quando a lista vem vazia
 */
export function buildSessionReport(
  session: ReportSession,
  summary: ReportSummary | null,
  segments: ReportSegment[],
  format: ReportFormat,
  insights: ReportInsight[] = [],
): string {
  if (format === "html") {
    return buildHtml(session, summary, segments, insights);
  }
  return buildMarkdown(session, summary, segments, insights);
}
