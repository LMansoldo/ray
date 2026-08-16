// =====================================================================
// Ray — Contrato de fronteira IPC (núcleo Rust  <->  sidecar Node)
// =====================================================================
//
// STATUS: ESPECIFICAÇÃO. Este arquivo é a definição LEGÍVEL do contrato.
// A FONTE DE VERDADE em runtime é o Rust + ts-rs (ADR-010): os structs Rust
// anotados com #[derive(TS)] geram os tipos TS equivalentes a estes. Estes
// tipos devem ser mantidos em espelho com os structs Rust; divergência entre
// os dois é um bug de contrato.
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
// Espelho dos enums de domínio usados na fronteira.
// (Em runtime, importar de @prisma/client; reproduzidos como union types
//  aqui apenas para tornar a especificação auto-contida e legível.)
// ---------------------------------------------------------------------
export type ProviderKind =
  | "OPENAI" | "ANTHROPIC" | "GEMINI" | "DEEPSEEK" | "OPENROUTER" | "GENERIC";

export type ProviderConnectionMode =
  | "API_KEY" | "SUBSCRIPTION" | "AGGREGATOR" | "COMPATIBLE_ENDPOINT";

export type AiFunction = "TRANSCRIPTION" | "ANALYSIS" | "TRANSLATION";

export type SuggestionTrigger =
  | "AUTO" | "ANALYZE_CONVERSATION" | "SCREEN_CAPTURE"
  | "ASK_ANYTHING" | "ANALYZE_SELECTION";

export type Speaker = "SELF" | "OTHERS";

// ---------------------------------------------------------------------
// Envelope comum de resposta. Todo endpoint não-streaming responde Result<T>.
// ---------------------------------------------------------------------
export type IpcError = {
  /** Código estável para o Rust ramificar decisões (não é mensagem de UI). */
  code:
    | "INVALID_CREDENTIAL"
    | "PROVIDER_UNAVAILABLE"
    | "RATE_LIMITED"
    | "BAD_REQUEST"
    | "DB_ERROR"
    | "AGENT_ERROR"
    | "INTERNAL";
  /** Mensagem legível para diagnóstico. NUNCA inclui segredos. */
  message: string;
  /** Se aplicável, sugere se o Rust deve tentar de novo. */
  retryable?: boolean;
};

export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: IpcError };

// ---------------------------------------------------------------------
// Credencial injetada pelo Rust por requisição (ADR-003).
// O sidecar usa em memória e NÃO persiste. Presente apenas nas chamadas
// que precisam falar com um provedor.
// ---------------------------------------------------------------------
export type InjectedCredential = {
  kind: ProviderKind;
  connectionMode: ProviderConnectionMode;
  /** O segredo em si (chave/token). Efêmero. Nunca logar. */
  secret: string;
  /** Base URL para COMPATIBLE_ENDPOINT; ausente nos demais modos. */
  baseUrl?: string;
  /** Modelo a usar; ausente = padrão do provedor. */
  model?: string;
};

// =====================================================================
// 1. CICLO DE VIDA / SAÚDE
// =====================================================================

/** GET /health — o Rust confirma que o sidecar subiu e está pronto. */
export type HealthResponse = {
  status: "ok";
  /** Versão do sidecar, para checagem de compatibilidade de contrato. */
  version: string;
  /** true quando Prisma conectou ao Postgres. */
  dbReady: boolean;
};

// =====================================================================
// 2. VALIDAÇÃO DE CREDENCIAL (RF-403)
// =====================================================================

/** POST /providers/validate — testa uma credencial antes de salvar. */
export type ValidateCredentialRequest = {
  credential: InjectedCredential;
};

export type ValidateCredentialResponse = {
  valid: boolean;
  /** Modelos disponíveis descobertos na validação, quando o provedor expõe. */
  availableModels?: string[];
  /** Motivo, quando valid=false (ex.: "unauthorized"). Sem segredos. */
  reason?: string;
};

// =====================================================================
// 3. COPILOTO — geração de sugestão em streaming (RF-332/305)
// =====================================================================

/** Contexto de transcrição enviado ao agente para gerar uma sugestão. */
export type TranscriptContextSegment = {
  speaker: Speaker;
  text: string;
  /** Offset em ms a partir do início da sessão. */
  startMs: number;
};

/**
 * POST /copilot/suggest  (resposta em STREAMING via SSE).
 * O Rust encaminha o gatilho, o assistente ativo e o contexto; o sidecar
 * roda o grafo LangGraph com a credencial injetada e devolve tokens.
 */
export type SuggestRequest = {
  sessionId: string;
  /** Id do assistente ativo (define o prompt/comportamento no grafo). */
  assistantId: string;
  trigger: SuggestionTrigger;
  /** Janela de transcrição relevante (o Rust decide o tamanho). */
  context: TranscriptContextSegment[];
  /** Prompt livre do usuário, quando trigger = ASK_ANYTHING. */
  userPrompt?: string;
  /**
   * Frames de tela em base64, quando trigger = SCREEN_CAPTURE (RF-333/706).
   * Sequência curta amostrada, não vídeo contínuo (ADR/limite de latência).
   */
  screenshots?: string[];
  /** Texto selecionado, quando trigger = ANALYZE_SELECTION (RF-335). */
  selectionText?: string;
  credential: InjectedCredential;
};

/** Eventos SSE emitidos por /copilot/suggest, em ordem. */
export type SuggestStreamEvent =
  /** Metadados iniciais, uma vez, antes dos tokens. */
  | { type: "start"; suggestionId: string; contextLabel?: string; theySaid?: string }
  /** Token incremental do campo "DIGA ISSO". */
  | { type: "token"; text: string }
  /** Fim com sucesso: o sidecar já persistiu a Suggestion via Prisma. */
  | { type: "done"; providerKind: ProviderKind; model?: string }
  /** Falha no meio do streaming. */
  | { type: "error"; error: IpcError };

// =====================================================================
// 4. ANÁLISE DE CONVERSA / TELA (RF-333) — resposta única (não streaming)
//    Reaproveita SuggestRequest com trigger específico; retorno consolidado.
// =====================================================================

export type AnalyzeResponse = {
  suggestionId: string;
  contextLabel?: string;
  theySaid?: string;
  sayThis: string;
  providerKind: ProviderKind;
  model?: string;
};

// =====================================================================
// 5. ASSISTENTES (RF-336..339) — operações de biblioteca
// =====================================================================

export type CreateAssistantRequest = {
  userId: string;
  name: string;
  category:
    | "GENERAL" | "MEETINGS" | "SALES" | "TRANSLATION"
    | "INTERVIEW" | "STUDY" | "CUSTOM";
  prompt: string;
  icon?: string;
};

/** Retorna o Assistant criado (tipo de domínio do Prisma). */
export type CreateAssistantResponse = {
  assistantId: string;
};

// =====================================================================
// 6. SESSÕES E CONTEÚDO (RF-800) — persistência via sidecar (ADR-002)
// =====================================================================

export type StartSessionRequest = {
  userId: string;
  assistantId?: string;
  platform?:
    | "ZOOM" | "GOOGLE_MEET" | "MICROSOFT_TEAMS" | "HANGOUTS" | "OTHER";
  sourceLanguage?: string;
  targetLanguage?: string;
};

export type StartSessionResponse = { sessionId: string };

/** Persiste um segmento de transcrição já finalizado (com ou sem tradução). */
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
  /** Se true, o sidecar dispara a geração de resumo (RF-803) usando credencial. */
  generateSummary: boolean;
  credential?: InjectedCredential;
};

export type EndSessionResponse = {
  sessionId: string;
  summaryId?: string;
};

// =====================================================================
// 7. TRADUÇÃO AO VIVO (RF-303/RF-303) — segmento a segmento
// =====================================================================

export type TranslateRequest = {
  sessionId: string;
  text: string;
  targetLanguage: string;
  credential: InjectedCredential;
};

export type TranslateResponse = {
  translatedText: string;
};

// =====================================================================
// Índice de endpoints (mapa nome -> request/response) para referência.
// Endpoints de streaming marcam a resposta como `SSE<...>`.
// =====================================================================
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
};
