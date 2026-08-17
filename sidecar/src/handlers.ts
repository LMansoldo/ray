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

/**
 * Gera eventos SSE do copiloto. Stub: emite start + done sem tokens.
 * TASK: carregar o assistente (Prisma), rodar o grafo LangGraph com o
 * provedor resolvido e emitir 'token' conforme o streaming do provedor.
 */
export async function* suggestStream(
  req: SuggestRequest,
): AsyncIterable<SuggestStreamEvent> {
  const suggestionId = "stub-suggestion";
  yield { type: "start", suggestionId };
  // TASK: emitir eventos { type: "token", text } aqui.
  yield { type: "done", providerKind: req.credential.kind, model: req.credential.model };
}

export async function analyze(
  req: SuggestRequest,
): Promise<IpcResult<AnalyzeResponse>> {
  // TASK: versão não-streaming; consolidar a resposta e persistir Suggestion.
  return ipcErr("INTERNAL", "not_implemented");
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
    const session = await prisma.session.update({
      where: { id: req.sessionId },
      data: {
        status: "ENDED",
        endedAt: new Date(),
      },
    });
    return { ok: true, value: { sessionId: session.id } };
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
