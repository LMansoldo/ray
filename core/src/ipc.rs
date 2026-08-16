//! Structs de fronteira IPC (ADR-005/010) — FONTE DE VERDADE.
//! `#[derive(TS)]` gera `contracts/ipc.ts` via `cargo test export_bindings`
//! (ts-rs exporta os tipos anotados). O `contracts/ipc.ts` no repo é o espelho
//! gerado; NÃO editar à mão depois que a geração estiver ligada.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum ProviderKind {
    Openai,
    Anthropic,
    Gemini,
    Deepseek,
    Openrouter,
    Generic,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum ProviderConnectionMode {
    ApiKey,
    Subscription,
    Aggregator,
    CompatibleEndpoint,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum AiFunction {
    Transcription,
    Analysis,
    Translation,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum SuggestionTrigger {
    Auto,
    AnalyzeConversation,
    ScreenCapture,
    AskAnything,
    AnalyzeSelection,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum Speaker {
    Self_,
    Others,
}

/// Credencial injetada por requisição (ADR-003). Efêmera; nunca logar.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InjectedCredential {
    pub kind: ProviderKind,
    pub connection_mode: ProviderConnectionMode,
    pub secret: String,
    #[ts(optional)]
    pub base_url: Option<String>,
    #[ts(optional)]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TranscriptContextSegment {
    pub speaker: Speaker,
    pub text: String,
    pub start_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
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
#[ts(export)]
#[serde(tag = "type", rename_all = "snake_case")]
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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct IpcError {
    pub code: String,
    pub message: String,
    #[ts(optional)]
    pub retryable: Option<bool>,
}
