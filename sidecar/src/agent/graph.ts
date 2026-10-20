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
  SuggestionTrigger,
} from "../contract.js";
import { webSearchForRequest, withSearchResults } from "./tools/websearch.js";
import { factCheckForRequest } from "./tools/claims.js";

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

// Campos canônicos do card de insight (RF-331) que o evento `start` carrega
// para o Overlay: contextLabel descreve a situação, theySaid é a fala do
// OUTRO falante que motivou a sugestão. Ambos são derivados AQUI, do
// próprio request — determinístico, sem chamada extra de LLM. Sem isso o
// bloco "ELES DISSERAM" do card nascia permanentemente vazio (o core e a
// UI apenas repassam o que o sidecar emite).

const TRIGGER_CONTEXT_LABELS: Record<SuggestionTrigger, string> = {
  AUTO: "Acompanhamento ao vivo",
  ANALYZE_CONVERSATION: "Análise da conversa",
  SCREEN_CAPTURE: "Análise de tela",
  ASK_ANYTHING: "Pergunta rápida",
  ANALYZE_SELECTION: "Trecho selecionado",
};

function deriveContextLabel(req: SuggestRequest): string {
  return TRIGGER_CONTEXT_LABELS[req.trigger] ?? "Acompanhamento ao vivo";
}

/**
 * Última fala do interlocutor ([OTHERS]) no contexto — a que motivou a
 * sugestão. Undefined quando o contexto não tem fala do outro lado (ex.:
 * só screenshot, ou pergunta pura do usuário).
 */
function deriveTheySaid(req: SuggestRequest): string | undefined {
  const others = req.context.filter((s) => s.speaker === "OTHERS");
  const last = others.at(-1);
  const text = last?.text.trim();
  return text ? text : undefined;
}

/**
 * Anexa o resumo rolante da reunião ao system prompt do assistente. É o
 * único ponto de injeção — os adapters recebem o `system` pronto, então a
 * memória da reunião alcança todos os provedores sem mudança de contrato.
 * O resumo cobre tudo ANTES da janela verbatim; os segmentos do request
 * seguem sendo o trecho mais recente.
 */
function withMeetingSummary(
  assistantSystemPrompt: string,
  meetingSummary?: string | null,
): string {
  const summary = meetingSummary?.trim();
  if (!summary) return assistantSystemPrompt;
  return (
    assistantSystemPrompt +
    "\n\n## Memória da reunião (resumo rolante de tudo que foi dito até agora)\n" +
    summary +
    "\n\nOs segmentos de transcrição deste pedido são apenas o trecho mais " +
    "recente — trate o resumo acima como a memória de tudo que aconteceu " +
    "antes dele e use os dois juntos ao responder."
  );
}

/**
 * Monta o system prompt final: prompt do assistente + resumo rolante +
 * resultados da busca web (quando o trigger pede) + seção de fact-check
 * (T-600, quando o trigger pede). Busca e fact-check são best-effort —
 * falha vira []/"" e a sugestão segue sem a seção correspondente.
 *
 * Latência (T-600): o fact-check roda AQUI, antes do primeiro token — o
 * evento `start` já foi emitido antes de buildSystemPrompt, então o card
 * abre na hora; só os tokens atrasam (1–2 chamadas LLM extras + buscas com
 * timeout curto de 4s dentro de factCheckForRequest).
 */
async function buildSystemPrompt(
  req: SuggestRequest,
  assistantSystemPrompt: string,
  provider: AiProvider,
  meetingSummary?: string | null,
): Promise<string> {
  const base = withSearchResults(
    withMeetingSummary(assistantSystemPrompt, meetingSummary),
    await webSearchForRequest(req),
  );
  // Seção "## Verificação de fatos" — string vazia significa "sem seção".
  const factCheck = await factCheckForRequest(req, req.credential, provider);
  return factCheck ? base + "\n\n" + factCheck : base;
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
  meetingSummary?: string | null,
): AsyncIterable<SuggestStreamEvent> {
  const suggestionId = randomUUID();

  // start sai ANTES da busca web — o Overlay abre na hora e o usuário vê o
  // card com cursor enquanto o DDG responde (limitado a timeoutMs).
  yield {
    type: "start",
    suggestionId,
    contextLabel: deriveContextLabel(req),
    theySaid: deriveTheySaid(req),
  };

  try {
    const stream = provider.analyzeStream({
      credential: req.credential,
      system: await buildSystemPrompt(
        req,
        assistantSystemPrompt,
        provider,
        meetingSummary,
      ),
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
  meetingSummary?: string | null,
): Promise<AnalyzeResponse> {
  const suggestionId = randomUUID();
  const chunks: string[] = [];

  const stream = provider.analyzeStream({
    credential: req.credential,
    system: await buildSystemPrompt(
      req,
      assistantSystemPrompt,
      provider,
      meetingSummary,
    ),
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
