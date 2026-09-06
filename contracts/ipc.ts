// =====================================================================
// Ray — Contrato de fronteira IPC (núcleo Rust <-> sidecar Node)
// =====================================================================
//
// STATUS: GERADO (ADR-010). Fonte de verdade em runtime: os structs Rust
// anotados com `#[derive(TS)]` em core/src/ipc.rs. Para regenerar este
// arquivo, ver o comando em core/src/ipc.rs (comentário de topo) ou em
// contracts/README.md. NÃO editar as declarações geradas abaixo à mão —
// exceto os dois blocos explicitamente marcados como "mantido à mão".
//
// Transporte: HTTP em loopback (127.0.0.1), porta efêmera por sessão (ADR-005).
// Streaming (tokens do copiloto) via SSE/chunked. O Rust é o ÚNICO cliente.
//
// Regras de segurança embutidas no contrato:
// - Segredos de credencial trafegam APENAS em `InjectedCredential`, dentro do
//   corpo de requisições efêmeras, nunca em query string, nunca logados (ADR-003).
// - Nenhum endpoint retorna segredos. `ApiKeyRef` circula sem o segredo.
//
// Tipos de DOMÍNIO (Session, Assistant, etc.) NÃO são redefinidos aqui: são
// importados dos tipos gerados pelo Prisma (ADR-010, camada 1). Este arquivo
// cobre só a camada 2: os payloads que cruzam a fronteira.
// =====================================================================

// ---------------------------------------------------------------------
// BEGIN mantido à mão — `IpcResult<T>` é um envelope genérico com tag
// booleana (`ok: true | false`); `ts-rs`/`serde` não têm uma representação
// de enum interno-tagueado por booleano, então este tipo não é derivável de
// um struct Rust e continua escrito aqui à mão.
// ---------------------------------------------------------------------
export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: IpcError };
// END mantido à mão
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// BEGIN gerado por ts-rs a partir de core/src/ipc.rs — não editar à mão.
// Ordem alfabética: decisão do próprio `ts-rs`, não editorial.
// ---------------------------------------------------------------------
export type AiFunction = "TRANSCRIPTION" | "ANALYSIS" | "TRANSLATION";

/**
 * Resposta consolidada de POST /copilot/analyze (RF-333).
 */
export type AnalyzeResponse = { suggestionId: string, contextLabel?: string, theySaid?: string, sayThis: string, providerKind: ProviderKind, model?: string, };

/**
 * POST /sessions/transcript — persiste um segmento de transcrição já
 * finalizado (com ou sem tradução).
 */
export type AppendTranscriptRequest = { sessionId: string, speaker: Speaker, text: string, translatedText?: string, startMs: number, endMs: number, };

/**
 * Categoria de um assistente (RF-336..339).
 */
export type AssistantCategory = "GENERAL" | "MEETINGS" | "SALES" | "TRANSLATION" | "INTERVIEW" | "STUDY" | "CUSTOM";

/**
 * POST /assistants — cria um assistente (RF-336/338).
 */
export type CreateAssistantRequest = { userId: string, name: string, category: AssistantCategory, prompt: string, icon?: string, };

/**
 * Retorna o id do Assistant criado (o objeto em si é tipo de domínio do
 * Prisma, ADR-010 camada 1).
 */
export type CreateAssistantResponse = { assistantId: string, };

/**
 * Resumo de uma credencial sem o segredo. `secret_ref` é ponteiro opaco —
 * sua presença não viola ADR-003.
 */
export type CredentialSummary = { id: string, slot: string, kind: ProviderKind, connectionMode: ProviderConnectionMode, secretRef: string, baseUrl?: string, 
/**
 * ISO-8601. None = nunca validada.
 */
lastValidatedAt?: string, };

/**
 * Payload de DELETE /credentials.
 */
export type DeleteCredentialRequest = { slot: string, };

/**
 * POST /sessions/end.
 */
export type EndSessionRequest = { sessionId: string, 
/**
 * Se true, o sidecar dispara a geração de resumo (RF-803) usando
 * `credential`.
 */
generateSummary: boolean, credential?: InjectedCredential, };

export type EndSessionResponse = { sessionId: string, summaryId?: string, };

/**
 * Resposta de GET /credentials.
 */
export type GetCredentialsResponse = { credentials: Array<CredentialSummary>, };

/**
 * GET /health — o Rust confirma que o sidecar subiu e está pronto.
 */
export type HealthResponse = { status: "ok", version: string, dbReady: boolean, };

/**
 * Credencial injetada por requisição (ADR-003). Efêmera; nunca logar.
 */
export type InjectedCredential = { kind: ProviderKind, connectionMode: ProviderConnectionMode, secret: string, baseUrl?: string, model?: string, };

/**
 * Envelope comum de erro IPC. Mensagem legível para diagnóstico — NUNCA
 * inclui segredos (ADR-003).
 */
export type IpcError = { code: IpcErrorCode, message: string, retryable?: boolean, };

/**
 * Códigos estáveis de erro IPC (para o Rust ramificar decisões; não é
 * mensagem de UI).
 */
export type IpcErrorCode = "INVALID_CREDENTIAL" | "PROVIDER_UNAVAILABLE" | "RATE_LIMITED" | "BAD_REQUEST" | "DB_ERROR" | "AGENT_ERROR" | "INTERNAL";

/**
 * Plataforma de reunião detectada/selecionada para a sessão.
 */
export type MeetingPlatform = "ZOOM" | "GOOGLE_MEET" | "MICROSOFT_TEAMS" | "HANGOUTS" | "OTHER";

export type ProviderConnectionMode = "API_KEY" | "SUBSCRIPTION" | "AGGREGATOR" | "COMPATIBLE_ENDPOINT";

export type ProviderKind = "OPENAI" | "ANTHROPIC" | "GEMINI" | "DEEPSEEK" | "OPENROUTER" | "GENERIC";

/**
 * Payload de POST /credentials (core → sidecar).
 * O segredo NUNCA aparece aqui — apenas o secretRef opaco (ADR-003).
 */
export type SaveCredentialRequest = { slot: string, kind: ProviderKind, connectionMode: ProviderConnectionMode, label: string, 
/**
 * Ponteiro opaco do cofre — não é o segredo (ADR-003).
 */
secretRef: string, baseUrl?: string, };

export type SaveCredentialResponse = { id: string, secretRef: string, };

export type Speaker = "SELF" | "OTHERS";

/**
 * POST /sessions/start (RF-800).
 */
export type StartSessionRequest = { userId: string, assistantId?: string, platform?: MeetingPlatform, sourceLanguage?: string, targetLanguage?: string, };

export type StartSessionResponse = { sessionId: string, };

/**
 * POST /copilot/suggest (resposta em streaming via SSE) — também reutilizado
 * por POST /copilot/analyze (resposta única consolidada).
 */
export type SuggestRequest = { sessionId: string, assistantId: string, trigger: SuggestionTrigger, context: Array<TranscriptContextSegment>, userPrompt?: string, screenshots?: Array<string>, selectionText?: string, credential: InjectedCredential, };

/**
 * Eventos SSE do copiloto (espelha o union type de ipc.ts).
 */
export type SuggestStreamEvent = { "type": "start", suggestionId: string, contextLabel?: string, theySaid?: string, } | { "type": "token", text: string, } | { "type": "done", providerKind: ProviderKind, model?: string, } | { "type": "error", error: IpcError, };

export type SuggestionTrigger = "AUTO" | "ANALYZE_CONVERSATION" | "SCREEN_CAPTURE" | "ASK_ANYTHING" | "ANALYZE_SELECTION";

/**
 * Contexto de transcrição enviado ao agente para gerar uma sugestão.
 */
export type TranscriptContextSegment = { speaker: Speaker, text: string, startMs: number, };

/**
 * POST /translate — tradução ao vivo, segmento a segmento (RF-303).
 */
export type TranslateRequest = { sessionId: string, text: string, targetLanguage: string, credential: InjectedCredential, };

export type TranslateResponse = { translatedText: string, };

/**
 * POST /providers/validate — testa uma credencial antes de salvar.
 */
export type ValidateCredentialRequest = { credential: InjectedCredential, 
/**
 * Slot de provedor na UI (opcional). Quando presente, o sidecar atualiza
 * `lastValidatedAt` no banco após validação bem-sucedida (ADR-003).
 */
slot?: string, };

export type ValidateCredentialResponse = { valid: boolean, availableModels?: Array<string>, reason?: string, };
// END gerado por ts-rs
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// BEGIN mantido à mão — índice de rotas puramente documental (as chaves são
// literais de rota como "GET /health"); não é um payload serializável, então
// não há struct Rust equivalente para `ts-rs` derivar.
// ---------------------------------------------------------------------
export type IpcEndpoints = {
  "GET /health": { req: void; res: HealthResponse };
  "POST /providers/validate": { req: ValidateCredentialRequest; res: IpcResult<ValidateCredentialResponse> };
  "POST /copilot/suggest": { req: SuggestRequest; res: "SSE<SuggestStreamEvent>" };
  "POST /copilot/analyze": { req: SuggestRequest; res: IpcResult<AnalyzeResponse> };
  "POST /assistants": { req: CreateAssistantRequest; res: IpcResult<CreateAssistantResponse> };
  "POST /sessions/start": { req: StartSessionRequest; res: IpcResult<StartSessionResponse> };
  "POST /sessions/transcript": { req: AppendTranscriptRequest; res: IpcResult<{ segmentId: string }> };
  "POST /sessions/end": { req: EndSessionRequest; res: IpcResult<EndSessionResponse> };
  "POST /translate": { req: TranslateRequest; res: IpcResult<TranslateResponse> };
  "POST /credentials": { req: SaveCredentialRequest; res: IpcResult<SaveCredentialResponse> };
  "DELETE /credentials": { req: DeleteCredentialRequest; res: IpcResult<{ deleted: boolean }> };
  "GET /credentials": { req: void; res: IpcResult<GetCredentialsResponse> };
};
// END mantido à mão
// ---------------------------------------------------------------------
