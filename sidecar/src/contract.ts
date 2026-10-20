// Espelho dos tipos de contrato IPC para uso interno do sidecar.
// Fonte de verdade em runtime: contracts/ipc.ts (gerado do Rust via ts-rs, ADR-010).
// Mantido em espelho; divergência é bug de contrato.

export type ProviderKind =
  | "OPENAI" | "ANTHROPIC" | "GEMINI" | "DEEPSEEK" | "OPENROUTER" | "GENERIC";
export type ProviderConnectionMode =
  | "API_KEY" | "SUBSCRIPTION" | "AGGREGATOR" | "COMPATIBLE_ENDPOINT";
export type AiFunction = "TRANSCRIPTION" | "ANALYSIS" | "TRANSLATION";
export type SuggestionTrigger =
  | "AUTO" | "ANALYZE_CONVERSATION" | "SCREEN_CAPTURE"
  | "ASK_ANYTHING" | "ANALYZE_SELECTION";
export type Speaker = "SELF" | "OTHERS";

export type IpcError = {
  code:
    | "INVALID_CREDENTIAL" | "PROVIDER_UNAVAILABLE" | "RATE_LIMITED"
    | "BAD_REQUEST" | "DB_ERROR" | "AGENT_ERROR" | "INTERNAL";
  message: string;
  retryable?: boolean;
};

export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: IpcError };

export type InjectedCredential = {
  kind: ProviderKind;
  connectionMode: ProviderConnectionMode;
  secret: string;
  baseUrl?: string;
  model?: string;
};

export type HealthResponse = { status: "ok"; version: string; dbReady: boolean };

export type ValidateCredentialRequest = { credential: InjectedCredential; slot?: string };
export type ValidateCredentialResponse = {
  valid: boolean;
  availableModels?: string[];
  reason?: string;
};

export type TranscriptContextSegment = {
  speaker: Speaker;
  text: string;
  startMs: number;
};

export type SuggestRequest = {
  sessionId: string;
  assistantId: string;
  trigger: SuggestionTrigger;
  context: TranscriptContextSegment[];
  userPrompt?: string;
  screenshots?: string[];
  selectionText?: string;
  credential: InjectedCredential;
};

export type SuggestStreamEvent =
  | { type: "start"; suggestionId: string; contextLabel?: string; theySaid?: string }
  | { type: "token"; text: string }
  | { type: "done"; providerKind: ProviderKind; model?: string }
  | { type: "error"; error: IpcError };

export type AnalyzeResponse = {
  suggestionId: string;
  contextLabel?: string;
  theySaid?: string;
  sayThis: string;
  providerKind: ProviderKind;
  model?: string;
};

export type CreateAssistantRequest = {
  userId: string;
  name: string;
  category:
    | "GENERAL" | "MEETINGS" | "SALES" | "TRANSLATION"
    | "INTERVIEW" | "STUDY" | "CUSTOM";
  prompt: string;
  icon?: string;
};
export type CreateAssistantResponse = { assistantId: string };

export type StartSessionRequest = {
  userId: string;
  assistantId?: string;
  platform?: "ZOOM" | "GOOGLE_MEET" | "MICROSOFT_TEAMS" | "HANGOUTS" | "OTHER";
  sourceLanguage?: string;
  targetLanguage?: string;
};
export type StartSessionResponse = { sessionId: string };

export type AppendTranscriptRequest = {
  sessionId: string;
  speaker: Speaker;
  text: string;
  translatedText?: string;
  startMs: number;
  endMs: number;
};

export type EndSessionRequest = {
  sessionId: string;
  generateSummary: boolean;
  credential?: InjectedCredential;
};
export type EndSessionResponse = { sessionId: string; summaryId?: string };

// Espelho de RollSummaryRequest/RollSummaryResponse (contracts/ipc.ts).
// Dispara a atualização do resumo rolante da sessão; `updated: false`
// cobre os no-ops (volume abaixo do lote mínimo ou já em andamento).
export type RollSummaryRequest = {
  sessionId: string;
  credential: InjectedCredential;
};
export type RollSummaryResponse = {
  updated: boolean;
  summary?: string;
  summarizedSegmentCount?: number;
};

export type TranslateRequest = {
  sessionId: string;
  text: string;
  targetLanguage: string;
  credential: InjectedCredential;
};
export type TranslateResponse = { translatedText: string };

// ── Persistência de credenciais (T-302/T-406) ─────────────────────────────

export type SaveCredentialRequest = {
  slot: string;
  kind: ProviderKind;
  connectionMode: ProviderConnectionMode;
  label: string;
  secretRef: string;
  baseUrl?: string;
};

export type SaveCredentialResponse = {
  id: string;
  secretRef: string;
};

export type DeleteCredentialRequest = {
  slot: string;
};

export type CredentialSummary = {
  id: string;
  slot: string;
  kind: ProviderKind;
  connectionMode: ProviderConnectionMode;
  secretRef: string;
  baseUrl?: string;
  lastValidatedAt?: string;
};

export type GetCredentialsResponse = {
  credentials: CredentialSummary[];
};

/** Helper para montar erros de contrato de forma consistente. */
export function ipcErr(
  code: IpcError["code"],
  message: string,
  retryable = false,
): IpcResult<never> {
  return { ok: false, error: { code, message, retryable } };
}
