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

// O campo trigger nunca chega ao provider — sem uma instrução, o screenshot
// entra "mudo" no request e o modelo responde só descrevendo a tela,
// ignorando o contexto de transcrição.
const SCREEN_CAPTURE_PROMPT =
  "The user just captured their screen — the screenshot is attached. " +
  "Analyze what is visible on screen and, when transcript context is present, " +
  "connect it to the conversation: relate what is on screen to what is being " +
  "discussed and suggest useful insights or next steps. " +
  "Do not merely describe the screen.";

function resolveUserPrompt(req: SuggestRequest): string | undefined {
  const triggerPrompt =
    req.trigger === "SCREEN_CAPTURE" ? SCREEN_CAPTURE_PROMPT : undefined;
  if (triggerPrompt && req.userPrompt) {
    return triggerPrompt + "\n\n" + req.userPrompt;
  }
  return req.userPrompt ?? triggerPrompt;
}

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
      userPrompt: resolveUserPrompt(req),
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
    userPrompt: resolveUserPrompt(req),
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
