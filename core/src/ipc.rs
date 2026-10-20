//! Structs de fronteira IPC (ADR-005/010) — FONTE DE VERDADE.
//!
//! `#[derive(TS)]` + `#[ts(export)]` fazem o `ts-rs` gerar `contracts/ipc.ts`
//! automaticamente sempre que `cargo test` roda (é assim que `ts-rs` funciona:
//! cada tipo anotado ganha um teste oculto que o exporta). Todo tipo aqui
//! aponta `#[ts(export_to = "ipc.ts")]` para que o `ts-rs` funda todos num
//! único arquivo, em vez de um arquivo por tipo.
//!
//! ## Como regenerar `contracts/ipc.ts`
//!
//! ```sh
//! cd core && cargo test
//! ./core/scripts/gen-ipc-contract.sh
//! ```
//!
//! O primeiro passo faz o `ts-rs` escrever a fusão de todos os tipos em
//! `core/target/ipc-ts-rs/ipc.ts` (diretório de staging apontado por
//! `TS_RS_EXPORT_DIR`, configurado em `core/.cargo/config.toml`; já dentro de
//! `/core/target/`, portanto ignorado pelo git). O segundo passo funde esse
//! arquivo gerado com os dois blocos mantidos à mão (ver abaixo) e escreve o
//! `contracts/ipc.ts` final. NÃO editar `contracts/ipc.ts` à mão depois disso
//! — editar os structs Rust abaixo e rodar os dois comandos de novo.
//!
//! ## Duas exceções mantidas à mão
//!
//! `IpcResult<T>` (tag booleano `ok: true | false`) e `IpcEndpoints` (mapa de
//! documentação nome-de-rota -> request/response, com chaves tipo `"GET
//! /health"`) não são structs de payload serializáveis por `serde`/`ts-rs` —
//! são, respectivamente, um envelope genérico com tag booleana (sem
//! equivalente direto em enum interno-tagueado do serde) e um tipo puramente
//! de documentação, sem forma de wire. Ambos continuam escritos à mão dentro
//! de `core/scripts/gen-ipc-contract.sh` e colados no arquivo final pelo
//! script — não pelo `ts-rs`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProviderKind {
    Openai,
    Anthropic,
    Gemini,
    Deepseek,
    Openrouter,
    Generic,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProviderConnectionMode {
    ApiKey,
    Subscription,
    Aggregator,
    CompatibleEndpoint,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AiFunction {
    Transcription,
    Analysis,
    Translation,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SuggestionTrigger {
    Auto,
    AnalyzeConversation,
    ScreenCapture,
    AskAnything,
    AnalyzeSelection,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Speaker {
    #[serde(rename = "SELF")]
    #[ts(rename = "SELF")]
    Self_,
    Others,
}

/// Códigos estáveis de erro IPC (para o Rust ramificar decisões; não é
/// mensagem de UI).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IpcErrorCode {
    InvalidCredential,
    ProviderUnavailable,
    RateLimited,
    BadRequest,
    DbError,
    AgentError,
    Internal,
}

/// Categoria de um assistente (RF-336..339).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AssistantCategory {
    General,
    Meetings,
    Sales,
    Translation,
    Interview,
    Study,
    Custom,
}

/// Plataforma de reunião detectada/selecionada para a sessão.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MeetingPlatform {
    Zoom,
    GoogleMeet,
    MicrosoftTeams,
    Hangouts,
    Other,
}

/// Envelope comum de erro IPC. Mensagem legível para diagnóstico — NUNCA
/// inclui segredos (ADR-003).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
pub struct IpcError {
    pub code: IpcErrorCode,
    pub message: String,
    #[ts(optional)]
    pub retryable: Option<bool>,
}

/// Credencial injetada por requisição (ADR-003). Efêmera; nunca logar.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "camelCase")]
pub struct InjectedCredential {
    pub kind: ProviderKind,
    pub connection_mode: ProviderConnectionMode,
    pub secret: String,
    #[ts(optional)]
    pub base_url: Option<String>,
    #[ts(optional)]
    pub model: Option<String>,
}

/// GET /health — o Rust confirma que o sidecar subiu e está pronto.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    #[ts(type = "\"ok\"")]
    pub status: String,
    pub version: String,
    pub db_ready: bool,
}

/// POST /providers/validate — testa uma credencial antes de salvar.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
pub struct ValidateCredentialRequest {
    pub credential: InjectedCredential,
    /// Slot de provedor na UI (opcional). Quando presente, o sidecar atualiza
    /// `lastValidatedAt` no banco após validação bem-sucedida (ADR-003).
    #[ts(optional)]
    pub slot: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "camelCase")]
pub struct ValidateCredentialResponse {
    pub valid: bool,
    #[ts(optional)]
    pub available_models: Option<Vec<String>>,
    #[ts(optional)]
    pub reason: Option<String>,
}

/// Contexto de transcrição enviado ao agente para gerar uma sugestão.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "camelCase")]
pub struct TranscriptContextSegment {
    pub speaker: Speaker,
    pub text: String,
    // i32, não i64: `ts-rs` mapeia i64 para `bigint` (por causa de
    // Number.MAX_SAFE_INTEGER), mas o contrato usa `number` — um offset em ms
    // dentro de uma sessão cabe confortavelmente em i32 (~24 dias).
    pub start_ms: i32,
}

/// POST /copilot/suggest (resposta em streaming via SSE) — também reutilizado
/// por POST /copilot/analyze (resposta única consolidada).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "camelCase")]
pub struct SuggestRequest {
    pub session_id: String,
    pub assistant_id: String,
    pub trigger: SuggestionTrigger,
    pub context: Vec<TranscriptContextSegment>,
    #[ts(optional)]
    pub user_prompt: Option<String>,
    #[ts(optional)]
    pub screenshots: Option<Vec<String>>,
    #[ts(optional)]
    pub selection_text: Option<String>,
    pub credential: InjectedCredential,
}

/// Eventos SSE do copiloto (espelha o union type de ipc.ts).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum SuggestStreamEvent {
    Start {
        suggestion_id: String,
        #[ts(optional)]
        context_label: Option<String>,
        #[ts(optional)]
        they_said: Option<String>,
    },
    Token {
        text: String,
    },
    Done {
        provider_kind: ProviderKind,
        #[ts(optional)]
        model: Option<String>,
    },
    Error {
        error: IpcError,
    },
}

/// Resposta consolidada de POST /copilot/analyze (RF-333).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeResponse {
    pub suggestion_id: String,
    #[ts(optional)]
    pub context_label: Option<String>,
    #[ts(optional)]
    pub they_said: Option<String>,
    pub say_this: String,
    pub provider_kind: ProviderKind,
    #[ts(optional)]
    pub model: Option<String>,
}

/// POST /assistants — cria um assistente (RF-336/338).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "camelCase")]
pub struct CreateAssistantRequest {
    pub user_id: String,
    pub name: String,
    pub category: AssistantCategory,
    pub prompt: String,
    #[ts(optional)]
    pub icon: Option<String>,
}

/// Retorna o id do Assistant criado (o objeto em si é tipo de domínio do
/// Prisma, ADR-010 camada 1).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "camelCase")]
pub struct CreateAssistantResponse {
    pub assistant_id: String,
}

/// POST /sessions/start (RF-800).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "camelCase")]
pub struct StartSessionRequest {
    pub user_id: String,
    #[ts(optional)]
    pub assistant_id: Option<String>,
    #[ts(optional)]
    pub platform: Option<MeetingPlatform>,
    #[ts(optional)]
    pub source_language: Option<String>,
    #[ts(optional)]
    pub target_language: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "camelCase")]
pub struct StartSessionResponse {
    pub session_id: String,
}

/// POST /sessions/transcript — persiste um segmento de transcrição já
/// finalizado (com ou sem tradução).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "camelCase")]
pub struct AppendTranscriptRequest {
    pub session_id: String,
    pub speaker: Speaker,
    pub text: String,
    #[ts(optional)]
    pub translated_text: Option<String>,
    // i32, não i64: ver comentário em `TranscriptContextSegment::start_ms`.
    pub start_ms: i32,
    pub end_ms: i32,
}

/// POST /sessions/end.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "camelCase")]
pub struct EndSessionRequest {
    pub session_id: String,
    /// Se true, o sidecar dispara a geração de resumo (RF-803) usando
    /// `credential`.
    pub generate_summary: bool,
    #[ts(optional)]
    pub credential: Option<InjectedCredential>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "camelCase")]
pub struct EndSessionResponse {
    pub session_id: String,
    #[ts(optional)]
    pub summary_id: Option<String>,
}

/// POST /sessions/summary/roll (core → sidecar): dispara a atualização do
/// resumo rolante da sessão — a camada de memória que dá ao copiloto o
/// contexto completo da reunião, além da janela verbatim de segmentos.
/// O sidecar decide o corte real (contagem de segmentos no banco); o core
/// só sinaliza que há volume novo. Credencial injetada pelo core como no
/// suggest (ADR-003): o segredo real entra APENAS no corpo, resolvido do
/// cofre na hora da chamada.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "camelCase")]
pub struct RollSummaryRequest {
    pub session_id: String,
    pub credential: InjectedCredential,
}

/// Resposta do rolamento. `updated: false` cobre os no-ops: volume abaixo
/// do lote mínimo ou rolamento já em andamento para a sessão.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "camelCase")]
pub struct RollSummaryResponse {
    pub updated: bool,
    #[ts(optional)]
    pub summary: Option<String>,
    #[ts(optional)]
    pub summarized_segment_count: Option<u64>,
}

// ── Persistência de credenciais (T-302/T-406) ────────────────────────────

/// Payload de POST /credentials (core → sidecar).
/// O segredo NUNCA aparece aqui — apenas o secretRef opaco (ADR-003).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "camelCase")]
pub struct SaveCredentialRequest {
    pub slot: String,
    pub kind: ProviderKind,
    pub connection_mode: ProviderConnectionMode,
    pub label: String,
    /// Ponteiro opaco do cofre — não é o segredo (ADR-003).
    pub secret_ref: String,
    #[ts(optional)]
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "camelCase")]
pub struct SaveCredentialResponse {
    pub id: String,
    pub secret_ref: String,
}

/// Payload de DELETE /credentials.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
pub struct DeleteCredentialRequest {
    pub slot: String,
}

/// Resumo de uma credencial sem o segredo. `secret_ref` é ponteiro opaco —
/// sua presença não viola ADR-003.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "camelCase")]
pub struct CredentialSummary {
    pub id: String,
    pub slot: String,
    pub kind: ProviderKind,
    pub connection_mode: ProviderConnectionMode,
    pub secret_ref: String,
    #[ts(optional)]
    pub base_url: Option<String>,
    /// ISO-8601. None = nunca validada.
    #[ts(optional)]
    pub last_validated_at: Option<String>,
}

/// Resposta de GET /credentials.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "camelCase")]
pub struct GetCredentialsResponse {
    pub credentials: Vec<CredentialSummary>,
}

/// POST /translate — tradução ao vivo, segmento a segmento (RF-303).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "camelCase")]
pub struct TranslateRequest {
    pub session_id: String,
    pub text: String,
    pub target_language: String,
    pub credential: InjectedCredential,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "camelCase")]
pub struct TranslateResponse {
    pub translated_text: String,
}

/// Resumo de um assistente para a UI (GET /assistants).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "camelCase")]
pub struct AssistantSummary {
    pub id: String,
    pub name: String,
    pub category: String,
    pub source: String,
    pub icon: Option<String>,
}

/// Resposta de GET /assistants.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "ipc.ts")]
#[serde(rename_all = "camelCase")]
pub struct AssistantList {
    pub assistants: Vec<AssistantSummary>,
}
