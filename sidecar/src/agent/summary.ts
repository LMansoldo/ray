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
