// LangGraph agent graph — provider-agnostic suggestion engine (T-102).
//
// This module depends on the AiProvider interface, never on a concrete adapter.
// Swapping the active assistant changes the system prompt, not the graph shape.
//
// ADR-003: credential.secret is used in memory for one call only — never logged,
// never persisted, never in a module-level variable that outlives the request.

import { randomUUID } from "node:crypto";
import type { AiProvider } from "../providers/provider.js";
import type { ProviderKind } from "../providers/types.js";
import type {
  SuggestRequest,
  SuggestStreamEvent,
  AnalyzeResponse,
} from "../contract.js";

// --- Streaming (SSE) -------------------------------------------------------

/**
 * Stream suggestion events: start → token* → done (or error on failure).
 * Provider-agnostic — receives the resolved AiProvider and the assistant's
 * system prompt; the graph shape is invariant across providers.
 */
export async function* runSuggestStream(
  req: SuggestRequest,
  assistantSystemPrompt: string,
  provider: AiProvider,
): AsyncIterable<SuggestStreamEvent> {
  const suggestionId = randomUUID();

  yield { type: "start", suggestionId };

  try {
    const stream = provider.analyzeStream({
      credential: req.credential,
      system: assistantSystemPrompt,
      context: req.context,
      userPrompt: req.userPrompt,
      screenshots: req.screenshots,
    });

    for await (const chunk of stream) {
      yield { type: "token", text: chunk.text };
    }

    yield {
      type: "done",
      providerKind: req.credential.kind,
      model: req.credential.model,
    };
  } catch (err) {
    yield {
      type: "error",
      error: {
        code: "AGENT_ERROR",
        message: (err as Error).message,
      },
    };
  }
}

// --- Consolidated analysis (non-streaming) ----------------------------------

/**
 * Run the same provider call as suggestStream but collect all tokens into a
 * single AnalyzeResponse. Provider-agnostic — same contract as the streaming
 * variant, different consumption pattern.
 */
export async function runAnalyze(
  req: SuggestRequest,
  assistantSystemPrompt: string,
  provider: AiProvider,
): Promise<AnalyzeResponse> {
  const suggestionId = randomUUID();
  const chunks: string[] = [];

  const stream = provider.analyzeStream({
    credential: req.credential,
    system: assistantSystemPrompt,
    context: req.context,
    userPrompt: req.userPrompt,
    screenshots: req.screenshots,
  });

  for await (const chunk of stream) {
    chunks.push(chunk.text);
  }

  return {
    suggestionId,
    sayThis: chunks.join(""),
    providerKind: req.credential.kind,
    model: req.credential.model,
  };
}
