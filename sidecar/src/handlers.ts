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
  // TASK: prisma.assistant.create(...) e retornar o id.
  return ipcErr("INTERNAL", "not_implemented");
}

// --- Sessões ----------------------------------------------------------

export async function startSession(
  req: StartSessionRequest,
): Promise<IpcResult<StartSessionResponse>> {
  // TASK: prisma.session.create(...).
  return ipcErr("INTERNAL", "not_implemented");
}

export async function appendTranscript(
  req: AppendTranscriptRequest,
): Promise<IpcResult<{ segmentId: string }>> {
  // TASK: prisma.transcriptSegment.create(...).
  return ipcErr("INTERNAL", "not_implemented");
}

export async function endSession(
  req: EndSessionRequest,
): Promise<IpcResult<EndSessionResponse>> {
  // TASK: marcar sessão ENDED; se generateSummary, gerar e persistir Summary.
  return ipcErr("INTERNAL", "not_implemented");
}

// --- Tradução ---------------------------------------------------------

export async function translate(
  req: TranslateRequest,
): Promise<IpcResult<TranslateResponse>> {
  // TASK: delegar ao adapter (capability translation).
  return ipcErr("INTERNAL", "not_implemented");
}
