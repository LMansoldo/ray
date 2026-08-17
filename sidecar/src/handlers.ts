// Handlers stub de todos os endpoints do contrato IPC.
// Cada função tem a assinatura ditada pelo contrato; o corpo é placeholder.
// TASK: preencher cada handler mantendo a assinatura.

import {
  ipcErr,
  type IpcResult,
  type ValidateCredentialRequest,
  type ValidateCredentialResponse,
  type SuggestRequest,
  type SuggestStreamEvent,
  type AnalyzeResponse,
  type CreateAssistantRequest,
  type CreateAssistantResponse,
  type StartSessionRequest,
  type StartSessionResponse,
  type AppendTranscriptRequest,
  type EndSessionRequest,
  type EndSessionResponse,
  type TranslateRequest,
  type TranslateResponse,
} from "./contract.js";
import { prisma } from "./db.js";
import { getProvider } from "./providers/registry.js";

// --- Provedores -------------------------------------------------------

export async function validateCredential(
  req: ValidateCredentialRequest,
): Promise<IpcResult<ValidateCredentialResponse>> {
  // TASK: delegar ao adapter e mapear o resultado.
  try {
    const provider = getProvider(req.credential.kind);
    const r = await provider.validate(req.credential);
    return { ok: true, value: r };
  } catch (e) {
    return ipcErr("INTERNAL", (e as Error).message);
  }
}

// --- Copiloto (streaming) --------------------------------------------

import { runSuggestStream, runAnalyze } from "./agent/graph.js";
import { generateSummary } from "./agent/summary.js";

async function loadAssistant(assistantId: string) {
  const assistant = await prisma.assistant.findUnique({
    where: { id: assistantId },
  });
  if (!assistant) {
    throw new Error(`Assistant not found: ${assistantId}`);
  }
  return assistant;
}

/**
 * Gera eventos SSE do copiloto: start → token* → done.
 * Carrega o assistente via Prisma, resolve o provedor via registry, delega ao
 * grafo LangGraph (provider-agnostic). Emite erro se o assistente não existir.
 */
export async function* suggestStream(
  req: SuggestRequest,
): AsyncIterable<SuggestStreamEvent> {
  try {
    const assistant = await loadAssistant(req.assistantId);
    const provider = getProvider(req.credential.kind);
    yield* runSuggestStream(req, assistant.prompt, provider);
  } catch (err) {
    yield {
      type: "error",
      error: { code: "AGENT_ERROR", message: (err as Error).message },
    };
  }
}

/**
 * Versão não-streaming: consolida todos os tokens em um AnalyzeResponse.
 */
export async function analyze(
  req: SuggestRequest,
): Promise<IpcResult<AnalyzeResponse>> {
  try {
    const assistant = await loadAssistant(req.assistantId);
    const provider = getProvider(req.credential.kind);
    const value = await runAnalyze(req, assistant.prompt, provider);
    return { ok: true, value };
  } catch (err) {
    return ipcErr("AGENT_ERROR", (err as Error).message);
  }
}

// --- Assistentes ------------------------------------------------------

export async function createAssistant(
  req: CreateAssistantRequest,
): Promise<IpcResult<CreateAssistantResponse>> {
  if (!req.name || req.name.trim().length === 0) {
    return ipcErr("BAD_REQUEST", "Assistant name must not be empty");
  }
  try {
    const assistant = await prisma.assistant.create({
      data: {
        userId: req.userId,
        name: req.name,
        category: req.category,
        source: "USER",
        prompt: req.prompt,
        icon: req.icon ?? null,
      },
    });
    return { ok: true, value: { assistantId: assistant.id } };
  } catch (e) {
    return ipcErr("DB_ERROR", (e as Error).message);
  }
}

// --- Sessões ----------------------------------------------------------

export async function startSession(
  req: StartSessionRequest,
): Promise<IpcResult<StartSessionResponse>> {
  try {
    const session = await prisma.session.create({
      data: {
        userId: req.userId,
        assistantId: req.assistantId ?? null,
        platform: req.platform ?? "OTHER",
        sourceLanguage: req.sourceLanguage ?? null,
        targetLanguage: req.targetLanguage ?? null,
      },
    });
    return { ok: true, value: { sessionId: session.id } };
  } catch (e) {
    return ipcErr("DB_ERROR", (e as Error).message);
  }
}

export async function appendTranscript(
  req: AppendTranscriptRequest,
): Promise<IpcResult<{ segmentId: string }>> {
  try {
    const session = await prisma.session.findUnique({
      where: { id: req.sessionId },
    });
    if (!session) {
      return ipcErr("DB_ERROR", `Session not found: ${req.sessionId}`);
    }

    const segment = await prisma.transcriptSegment.create({
      data: {
        sessionId: req.sessionId,
        speaker: req.speaker,
        text: req.text,
        translatedText: req.translatedText ?? null,
        startMs: req.startMs,
        endMs: req.endMs,
      },
    });
    return { ok: true, value: { segmentId: segment.id } };
  } catch (e) {
    return ipcErr("DB_ERROR", (e as Error).message);
  }
}

export async function endSession(
  req: EndSessionRequest,
): Promise<IpcResult<EndSessionResponse>> {
  try {
    let summaryId: string | undefined;

    if (req.generateSummary && req.credential) {
      const segments = await prisma.transcriptSegment.findMany({
        where: { sessionId: req.sessionId },
      });
      const provider = getProvider(req.credential.kind);
      const summaryResult = await generateSummary(
        segments,
        req.credential,
        provider,
      );

      const summary = await prisma.summary.create({
        data: {
          sessionId: req.sessionId,
          text: summaryResult.text,
          actionItems: summaryResult.actionItems,
        },
      });
      summaryId = summary.id;
    }

    const session = await prisma.session.update({
      where: { id: req.sessionId },
      data: {
        status: "ENDED",
        endedAt: new Date(),
      },
    });

    return { ok: true, value: { sessionId: session.id, summaryId } };
  } catch (e) {
    return ipcErr("DB_ERROR", (e as Error).message);
  }
}

// --- Tradução ---------------------------------------------------------

export async function translate(
  req: TranslateRequest,
): Promise<IpcResult<TranslateResponse>> {
  // TASK: delegar ao adapter (capability translation).
  return ipcErr("INTERNAL", "not_implemented");
}
