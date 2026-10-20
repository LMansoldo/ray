// Summary generation for session end (T-103, RF-803).
//
// Generates a summary (text + action items) from transcript context using
// the active AiProvider. Provider-agnostic — depends on AiProvider interface,
// never on a concrete adapter.
//
// ADR-003: credential.secret is used in memory for one call only — never
// logged, never persisted, never in a module-level variable that outlives
// the request.

import type { AiProvider } from "../providers/provider.js";
import type { TranscriptContextSegment, InjectedCredential } from "../contract.js";

/** Result of summary generation — text + action items list. */
export type SummaryResult = {
  text: string;
  actionItems: string[];
};

/** System prompt that instructs the provider to produce a summary + action items. */
const SUMMARY_SYSTEM_PROMPT =
  "You are a meeting assistant. Summarize the following transcript and extract action items. " +
  "Format action items as a numbered list (1. ..., 2. ..., etc.) at the end of your response.";

/** Parse numbered action items (1. ..., 2. ..., etc.) from summary text. */
function parseActionItems(text: string): string[] {
  const matches = text.match(/(?:^|\n)\s*\d+\.\s+(.+)/g);
  if (!matches) return [];
  return matches.map((m) => m.replace(/^\s*\d+\.\s+/, "").trim());
}

/**
 * Generate a session summary from transcript context via the provider.
 *
 * @param segments — transcript segments from the session
 * @param credential — injected provider credential (ADR-003)
 * @param provider — resolved AiProvider (provider-agnostic)
 * @returns summary text + action items
 */
export async function generateSummary(
  segments: TranscriptContextSegment[],
  credential: InjectedCredential,
  provider: AiProvider,
): Promise<SummaryResult> {
  const stream = provider.analyzeStream({
    credential,
    system: SUMMARY_SYSTEM_PROMPT,
    context: segments,
  });

  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk.text);
  }

  const text = chunks.join("");
  const actionItems = parseActionItems(text);

  return { text, actionItems };
}

// ---------------------------------------------------------------------------
// Resumo rolante (contexto completo do copiloto — fase 1)
// ---------------------------------------------------------------------------

/**
 * System prompt do rolamento: recebe o resumo anterior (quando existir) e
 * os segmentos que acabaram de sair da janela verbatim do copiloto, e
 * devolve o resumo ATUALIZADO da reunião inteira. A saída é limitada para
 * caber no prompt de todas as análises seguintes sem estourar a janela do
 * modelo — o pipeline refine (resumo anterior + lote novo) mantém o custo
 * por rolamento constante, não importando há quanto tempo a reunião roda.
 */
const ROLLING_SUMMARY_SYSTEM_PROMPT =
  "You maintain the rolling summary of a live meeting. " +
  "You will receive the previous rolling summary (if any) and the newest " +
  "transcript segments, which have just left the copilot's recent-context " +
  "window. Produce the UPDATED rolling summary of the whole meeting so far. " +
  "Rules: " +
  "1. Respond in the predominant language of the transcript, keeping " +
  "technical terms, API names, and versions in their original form (in " +
  "English when that is the original). " +
  "2. Keep it under 400 words. " +
  "3. Structure the output with these headings, in this order: " +
  "'Pontos principais' (bullets chronológicos), 'Decisões e compromissos', " +
  "'Nomes, números e fatos', 'Perguntas abertas / action items'. " +
  "4. Merge the new segments into the previous summary; never drop a " +
  "previously captured fact unless it was explicitly corrected or " +
  "superseded later in the meeting. " +
  "5. Generalizations without a specific source stay marked as uncertain — " +
  "prefer the exact value or name that was actually said; if it wasn't " +
  "clear, mark it with '(?)'. " +
  "6. Before asserting a fact, actively look in what was said for " +
  "counterevidence or a later correction; if it was corrected, record the " +
  "final version and mark the earlier one as superseded. " +
  "7. Output ONLY the summary text — no preamble, no commentary.";

/**
 * Gera o resumo rolante atualizado (pipeline refine): resumo anterior +
 * lote novo de segmentos → resumo consolidado.
 *
 * Provider-agnostic — usa apenas a interface AiProvider; o segredo da
 * credencial vive só na chamada (ADR-003) e nunca aparece no retorno.
 *
 * @param previousSummary — resumo rolante vigente (null no primeiro corte)
 * @param newSegments — segmentos que saíram da janela verbatim, em ordem
 * @param credential — credencial injetada pelo core (ADR-003)
 * @param provider — AiProvider resolvido para a credencial
 */
export async function rollSummary(
  previousSummary: string | null,
  newSegments: TranscriptContextSegment[],
  credential: InjectedCredential,
  provider: AiProvider,
): Promise<string> {
  const stream = provider.analyzeStream({
    credential,
    system: ROLLING_SUMMARY_SYSTEM_PROMPT,
    context: newSegments,
    userPrompt: previousSummary
      ? "Previous rolling summary (merge these new segments into it):\n" +
        previousSummary
      : undefined,
  });

  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk.text);
  }

  return chunks.join("").trim();
}
