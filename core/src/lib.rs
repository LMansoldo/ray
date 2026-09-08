//! Ray core — biblioteca do núcleo Tauri (ADR-001).
//! Reúne os módulos e expõe os comandos Tauri consumidos pela UI Svelte.

pub mod audio;
pub mod capture;
pub mod ipc;
pub mod ipc_client;
pub mod logging;
pub mod permissions;
pub mod shortcuts;
pub mod sidecar;
pub mod stt;
pub mod vault;
pub mod windows;

use crate::shortcuts::ShortcutCommand;
use ipc::SuggestRequest;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU16, Ordering};
use tauri::{Emitter, Manager};

// --- Estado do sidecar ---------------------------------------------------
// Porta loopback do sidecar, registrada pelo supervisor (sidecar.rs) após
// o spawn. `suggest` usa para montar a base_url sem hardcoding.

static SIDECAR_PORT: AtomicU16 = AtomicU16::new(0);

/// Registra a porta do sidecar após o spawn. Chamado pelo supervisor
/// (`sidecar::Sidecar::start`), não pelo usuário.
pub fn set_sidecar_port(port: u16) {
    SIDECAR_PORT.store(port, Ordering::Release);
}

// --- Comandos Tauri (fronteira UI <-> núcleo) ----------------------------
// A UI Svelte invoca estes comandos via `invoke()`. O núcleo resolve
// a credencial no cofre e delega ao ipc_client para a chamada ao sidecar.

/// Alterna o modo stealth de uma janela (ADR-008).
// Not `pub`: a `pub fn` at crate root annotated `#[tauri::command]` collides
// with the macro's own `#[macro_export]`'d `__cmd__*` helper (also crate-root),
// causing E0255. The UI-facing contract is the string name registered in
// `generate_handler!` below, not Rust visibility, so this is not a break.
#[tauri::command]
fn set_stealth(window_label: String, excluded: bool) {
    windows::set_capture_excluded(&window_label, excluded);
}

/// Alterna a visibilidade da janela inteira ("panic hide", RF-504).
#[tauri::command]
fn toggle_window(window_label: String) {
    windows::toggle_visibility(&window_label);
}

/// Mostra uma janela pelo label (multi-janela: AppBar abre a janela main).
/// Usa o AppHandle diretamente — sem passar pelo registry de toggle — para
/// evitar dessincronização com o estado inicial `visible: false` do tauri.conf.json.
#[tauri::command]
fn show_window(app: tauri::AppHandle, window_label: String) -> Result<(), String> {
    app.get_webview_window(&window_label)
        .ok_or_else(|| format!("janela '{}' nao encontrada", window_label))?
        .show()
        .map_err(|e| e.to_string())
}

/// Oculta uma janela pelo label (multi-janela: botao Ocultar do AppBar).
/// Usa o AppHandle diretamente pelo mesmo motivo que show_window.
#[tauri::command]
fn hide_window(app: tauri::AppHandle, window_label: String) -> Result<(), String> {
    app.get_webview_window(&window_label)
        .ok_or_else(|| format!("janela '{}' nao encontrada", window_label))?
        .hide()
        .map_err(|e| e.to_string())
}

/// Define a opacidade de uma superfície (RF-506 — atalhos ⌘⇧+ / ⌘⇧−).
#[tauri::command]
fn set_window_opacity(window_label: String, opacity: f64) {
    windows::set_opacity(&window_label, opacity);
}

/// Alterna sempre-no-topo de uma janela (RF-505 — atalho ⌘⇧A).
#[tauri::command]
fn set_always_on_top(window_label: String, enabled: bool) {
    windows::set_always_on_top(&window_label, enabled);
}

/// Níveis de medidor por canal (RF-206 — a UI pesquisa durante a reunião).
#[tauri::command]
fn get_meter_levels() -> Vec<serde_json::Value> {
    audio::get_meter_levels()
        .into_iter()
        .map(|m| serde_json::json!({ "channelId": m.channel_id, "rms": m.rms }))
        .collect()
}

/// Alterna a captura do microfone (canal VOCÊ), preservando o OUTROS.
/// Retorna o novo estado (RF-604 — ⌘⇧D). O aviso vai por ray:analysis-hint
/// para todas as janelas — a superfície que o exibe é o Overlay flutuante.
#[tauri::command]
fn toggle_mic_capture(app: tauri::AppHandle) -> bool {
    let enabled = audio::set_mic_capture(!audio::mic_capture_enabled());
    let _ = app.emit(
        "ray:analysis-hint",
        serde_json::json!({
            "text": if enabled { "Microfone retomado." } else { "Microfone pausado (⌘⇧D)." }
        }),
    );
    enabled
}

/// Mostra a janela do Notch ancorada no topo-centro do monitor (RF-013).
#[tauri::command]
fn show_notch(app: tauri::AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window("notch")
        .ok_or_else(|| "janela 'notch' nao encontrada".to_string())?;
    if let Ok(Some(mon)) = win.current_monitor() {
        let m_size = mon.size();
        let m_pos = mon.position();
        if let Ok(size) = win.outer_size() {
            let x = m_pos.x + ((m_size.width.saturating_sub(size.width)) / 2) as i32;
            let y = m_pos.y + 8;
            let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
        }
    }
    windows::set_always_on_top("notch", true);
    win.show().map_err(|e| e.to_string())
}

/// Mostra a janela do Overlay flutuante (RF-012) — fora da janela main, como
/// Notch e AppBar. A UI pede este comando quando há conteúdo (reunião,
/// insight, aviso); a movimentação fina fica com move_window (RF-507).
/// O ancoramento no canto superior direito acontece só quando a janela está
/// oculta — a posição movida pelo usuário durante a sessão é preservada.
#[tauri::command]
fn show_overlay(app: tauri::AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window("overlay")
        .ok_or_else(|| "janela 'overlay' nao encontrada".to_string())?;
    if !win.is_visible().unwrap_or(false) {
        if let Ok(Some(mon)) = win.current_monitor() {
            let m_size = mon.size();
            let m_pos = mon.position();
            if let Ok(size) = win.outer_size() {
                let x = m_pos.x + m_size.width.saturating_sub(size.width) as i32 - 24;
                let y = m_pos.y + 60;
                let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
            }
        }
    }
    windows::set_always_on_top("overlay", true);
    win.show().map_err(|e| e.to_string())
}

/// Move uma janela por deslocamento relativo em pixels físicos
/// (RF-507 — atalhos moveModal*).
#[tauri::command]
fn move_window(
    app: tauri::AppHandle,
    window_label: String,
    dx: i32,
    dy: i32,
) -> Result<(), String> {
    let win = app
        .get_webview_window(&window_label)
        .ok_or_else(|| format!("janela '{window_label}' nao encontrada"))?;
    let pos = win.outer_position().map_err(|e| e.to_string())?;
    win.set_position(tauri::PhysicalPosition::new(pos.x + dx, pos.y + dy))
        .map_err(|e| e.to_string())
}

/// Redimensiona uma janela para tamanho lógico — o Overlay ajusta a janela
/// flutuante à altura do conteúdo (o card cresce até o teto do InsightCard).
#[tauri::command]
fn resize_window(
    app: tauri::AppHandle,
    window_label: String,
    width: f64,
    height: f64,
) -> Result<(), String> {
    app.get_webview_window(&window_label)
        .ok_or_else(|| format!("janela '{window_label}' nao encontrada"))?
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e| e.to_string())
}

/// Lista sessões recentes (RF-802) — delega ao sidecar.
#[tauri::command]
fn list_sessions() -> Result<serde_json::Value, String> {
    let port = SIDECAR_PORT.load(Ordering::Acquire);
    if port == 0 {
        return Ok(serde_json::json!({ "sessions": [] }));
    }
    unwrap_ipc(sidecar_request(port, "GET", "/sessions", None)?)
}

/// Detalhe de uma sessão (transcrição ordenada) — delega ao sidecar.
#[tauri::command]
fn get_session(session_id: String) -> Result<serde_json::Value, String> {
    let port = SIDECAR_PORT.load(Ordering::Acquire);
    if port == 0 {
        return Err("sidecar not started".into());
    }
    unwrap_ipc(sidecar_request(port, "GET", &format!("/sessions/{session_id}"), None)?)
}

/// Settings persistidos (features + atalhos) — delega ao sidecar.
#[tauri::command]
fn get_app_settings() -> Result<serde_json::Value, String> {
    let port = SIDECAR_PORT.load(Ordering::Acquire);
    if port == 0 {
        return Err("sidecar not started".into());
    }
    unwrap_ipc(sidecar_request(port, "GET", "/settings", None)?)
}

/// Persiste features (RF-700) via sidecar.
#[tauri::command]
fn save_feature_toggles(features: serde_json::Value) -> Result<serde_json::Value, String> {
    let port = SIDECAR_PORT.load(Ordering::Acquire);
    if port == 0 {
        return Err("sidecar not started".into());
    }
    let body = serde_json::json!({ "features": features });
    unwrap_ipc(sidecar_request(port, "PUT", "/settings", Some(body))?)
}

/// Resolver de credencial que consulta o cofre nativo (vault).
/// Usado como `fn` pointer injetável em `ipc_client::post_suggest_to_sidecar`.
fn vault_resolve(secret_ref: &str) -> Result<String, String> {
    vault::get_secret(secret_ref).map_err(|e| e.to_string())
}

/// Drena a fila de PCM (T-306) e processa via motor STT (T-307).
/// Retorna os segmentos de transcrição prontos (janela deslizante).
/// Chamado periodicamente pelo loop de captura de áudio.
#[tauri::command]
fn transcribe_pending_pcm(
    speaker: ipc::Speaker,
    session_id: String,
) -> Result<Vec<ipc::AppendTranscriptRequest>, String> {
    stt::drain_and_process(speaker, &session_id).map_err(|e| e.to_string())
}

/// Aciona o copiloto. O núcleo resolve a credencial do cofre (vault),
/// injeta em `InjectedCredential.secret` e delega ao sidecar via `ipc_client`.
///
/// ## Contrato de `InjectedCredential.secret`
///
/// No wire, `secret` carrega o `secret_ref` opaco vindo da UI (ponteiro no
/// banco). O núcleo resolve esse ref via `vault::get_secret` e substitui
/// pelo segredo real antes de enviar ao sidecar. O segredo é efêmero:
/// usado apenas nesta requisição, nunca logado, nunca persistido (ADR-003).
/// Emissor de produção: cada SuggestStreamEvent vira um evento Tauri
/// `suggest-stream`, consumido pelo Overlay (streaming token a token).
#[derive(Clone)]
struct TauriEmitter {
    app: tauri::AppHandle,
}

impl ipc_client::SuggestEventEmitter for TauriEmitter {
    fn emit_event(&self, event: ipc::SuggestStreamEvent) {
        use tauri::Emitter;
        let _ = self.app.emit("suggest-stream", &event);
    }
}

/// Núcleo do suggest, testável sem AppHandle (o emitter é injetável).
fn suggest_with_stream<E: ipc_client::SuggestEventEmitter>(
    port: u16,
    req: SuggestRequest,
    emitter: E,
) -> Result<(), String> {
    if port == 0 {
        return Err("sidecar not started".into());
    }
    let base_url = format!("http://127.0.0.1:{}", port);

    let handle = std::thread::spawn(move || -> Result<(), String> {
        let rt = tokio::runtime::Runtime::new()
            .map_err(|e| format!("failed to create runtime: {e}"))?;
        rt.block_on(ipc_client::stream_suggest_events(
            &base_url,
            req,
            vault_resolve,
            emitter,
        ))
        .map_err(|e| match e {
            ipc_client::IpcClientError::Credential(msg) => msg,
            ipc_client::IpcClientError::Http(msg) => msg,
        })
    });

    match handle.join() {
        Ok(Ok(())) => Ok(()),
        Ok(Err(msg)) => Err(msg),
        Err(_) => Err("sidecar request thread panicked".to_string()),
    }
}

#[tauri::command]
fn suggest(app: tauri::AppHandle, req: SuggestRequest) -> Result<(), String> {
    let port = SIDECAR_PORT.load(Ordering::Acquire);
    let emitter = TauriEmitter { app };
    suggest_with_stream(port, req, emitter)
}

/// Implementação interna injetável do comando `suggest`.
///
/// Separa a lógica SSE do AppHandle de Tauri para permitir testes sem runtime Tauri.
/// O `#[tauri::command] fn suggest` delegará a esta função com um `TauriEmitter`
/// (que chama `app.emit()`) no passo GREEN do T-303.
///
/// `emitter` recebe cada `SuggestStreamEvent` assim que parseado (sem bufferizar),
/// satisfazendo RNF-102 e a ordem `start → token* → done/error` (ADR-005, T-102).
pub(crate) async fn suggest_with_emitter<E: ipc_client::SuggestEventEmitter>(
    req: SuggestRequest,
    base_url: &str,
    emitter: E,
) -> Result<(), String> {
    ipc_client::stream_suggest_events(base_url, req, vault_resolve, emitter)
        .await
        .map_err(|e| match e {
            ipc_client::IpcClientError::Credential(msg) => msg,
            ipc_client::IpcClientError::Http(msg) => msg,
        })
}

// ── Testes do comando suggest (T-302) ──────────────────────────────────
// Valida que o comando Tauri `suggest`:
//   1. Propaga erros do vault como Err(String), discriminando do stub
//   2. Resolve a credencial do cofre (vault) via vault::get_secret
//   3. Nunca expõe o segredo em mensagens de erro (ADR-003, CA-4)
//
// O teste de injeção HTTP (body, URL, status) vive em ipc_client::tests,
// onde base_url é injetável. Aqui, SIDECAR_PORT=0 produz "sidecar not
// started" — aceito pelos asserts (não é stub nem erro de vault).

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ipc::*;
    use crate::vault;

    /// Gera um label unico por execucao para evitar colisao no keychain.
    fn unique_label(prefix: &str) -> String {
        use std::sync::atomic::{AtomicU32, Ordering};
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        format!("{}_{}_{}", prefix, std::process::id(), n)
    }

    /// Emitter no-op para os testes do comando suggest.
    fn test_emitter() -> impl ipc_client::SuggestEventEmitter {
        struct NoopEmitter;
        impl ipc_client::SuggestEventEmitter for NoopEmitter {
            fn emit_event(&self, _event: SuggestStreamEvent) {}
        }
        NoopEmitter
    }

    fn build_request(credential: InjectedCredential) -> SuggestRequest {
        SuggestRequest {
            session_id: "sess-test".into(),
            assistant_id: "asst-test".into(),
            trigger: SuggestionTrigger::Auto,
            context: vec![TranscriptContextSegment {
                speaker: Speaker::Self_,
                text: "ola".into(),
                start_ms: 0,
            }],
            user_prompt: None,
            screenshots: None,
            selection_text: None,
            credential,
        }
    }

    // ── (a) vault error → Err(String), discriminando do stub ─────────
    // core.md: Propagate with ? into Result. A #[tauri::command] that
    // can fail returns Result<T, String> — never panics across the IPC
    // boundary. Discrimina do stub: se retornar "not_implemented", o stub
    // ainda nao foi substituido.

    #[tokio::test]
    async fn suggest_vault_error_propagates() {
        // Usa um secret_ref que nao existe no keychain — vault::get_secret
        // retornara NotFound, que deve propagar como Err(String).
        let fake_ref = unique_label("suggest_nonexistent");
        let req = build_request(InjectedCredential {
            kind: ProviderKind::Openai,
            connection_mode: ProviderConnectionMode::ApiKey,
            secret: fake_ref,
            base_url: None,
            model: None,
        });

        let result = suggest_with_stream(0, req, test_emitter());
        // RED: retorna Err("not_implemented") → !contains("not_implemented") falha.
        // GREEN: retorna Err com mensagem do vault (NotFound) → passa.
        assert!(
            result.is_err(),
            "suggest must fail when vault returns error"
        );
        let msg = result.unwrap_err();
        assert!(
            !msg.contains("not_implemented"),
            "error must come from vault, not from stub: {}",
            msg
        );
    }

    // ── (b) sugest resolve credencial real do cofre ───────────────────
    // ADR-003 passo 3 / RNF-206: core busca segredo no cofre via
    // vault::get_secret e injeta na chamada ao sidecar por requisição.
    // Usa keychain real (sem mock) — mesmo caminho de T-301.

    #[tokio::test]
    async fn suggest_resolves_credential_from_vault() {
        let label = unique_label("suggest_resolve");
        let secret_value = "sk-vault-resolve-test-secret";
        let secret_ref = vault::store_secret(&label, secret_value)
            .expect("store_secret should succeed on native keychain");

        let req = build_request(InjectedCredential {
            kind: ProviderKind::Anthropic,
            connection_mode: ProviderConnectionMode::ApiKey,
            secret: secret_ref.clone(),
            base_url: None,
            model: None,
        });

        // Cleanup DEPOIS de suggest — vault::get_secret precisa da entrada
        // existir durante a resolucao.
        let result = suggest_with_stream(0, req, test_emitter());
        let _ = vault::delete_secret(&secret_ref);

        // RED: stub retorna Err("not_implemented") → contains("not_implemented") falha.
        // GREEN: SIDECAR_PORT=0 → "sidecar not started" (aceito). Ou, com porta
        // real, Ok ou Err de sidecar (connection refused). Rejeitamos "not_implemented"
        // (stub) e erros de vault ("credential not found", "vault backend error").
        match &result {
            Ok(()) => {}
            Err(msg) => {
                assert!(
                    !msg.contains("not_implemented"),
                    "stub not replaced — suggest still returns not_implemented"
                );
                assert!(
                    !msg.contains("credential not found"),
                    "vault-stage error — credential not resolved: {}",
                    msg
                );
                assert!(
                    !msg.contains("vault backend error"),
                    "vault-stage error — backend failure: {}",
                    msg
                );
                // Sidecar-stage error (e.g. connection refused) is acceptable.
            }
        }
    }

    // ── (c) suggest_with_emitter delega ao bridge SSE ────────────────
    // Pina que o comando suggest passa pelo stream_suggest_events (e não pelo
    // post_suggest_to_sidecar não-streaming).
    //
    // RED: suggest_with_emitter é todo!() → panic → FAILED com "T-303".
    // GREEN: suggest_with_emitter chama stream_suggest_events; o emitter recebe
    // pelo menos um evento do servidor fake e o assert passa.
    #[tokio::test]
    async fn suggest_delegates_to_sse_streaming() {
        use std::io::{Read, Write};
        use std::sync::{Arc, Mutex};

        struct TestEmitter(Arc<Mutex<Vec<SuggestStreamEvent>>>);
        impl crate::ipc_client::SuggestEventEmitter for TestEmitter {
            fn emit_event(&self, event: SuggestStreamEvent) {
                self.0.lock().unwrap().push(event);
            }
        }

        let captured = Arc::new(Mutex::new(Vec::<SuggestStreamEvent>::new()));
        let emitter = TestEmitter(captured.clone());

        // Minimal SSE server: sends a single Done event then closes.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let done_json = serde_json::to_string(&SuggestStreamEvent::Done {
            provider_kind: ProviderKind::Openai,
            model: None,
        })
        .unwrap();
        std::thread::spawn(move || {
            if let Ok((mut s, _)) = listener.accept() {
                let mut buf = [0u8; 4096];
                let _ = s.read(&mut buf);
                let body = format!("data: {}\n\n", done_json);
                let response = format!(
                    "HTTP/1.1 200 OK\r\n\
                     Content-Type: text/event-stream\r\n\
                     Content-Length: {}\r\n\
                     Connection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = s.write_all(response.as_bytes());
            }
        });

        let base_url = format!("http://127.0.0.1:{}", port);
        let mut req = build_request(InjectedCredential {
            kind: ProviderKind::Openai,
            connection_mode: ProviderConnectionMode::ApiKey,
            secret: "placeholder".into(),
            base_url: None,
            model: None,
        });

        // GREEN: suggest_with_emitter delega ao stream_suggest_events, que
        // resolve o secret_ref no cofre antes do POST — guarda um segredo
        // real no keychain para a resolução ter sucesso.
        let sfs_secret_ref = vault::store_secret("sse_bridge_label", "sk-sse-bridge")
            .expect("store_secret should succeed on native keychain");
        req.credential.secret = sfs_secret_ref.clone();

        let _ = suggest_with_emitter(req, &base_url, emitter).await;
        let _ = vault::delete_secret(&sfs_secret_ref);

        let events = captured.lock().unwrap();
        assert!(
            !events.is_empty(),
            "suggest_with_emitter must delegate to stream_suggest_events \
             and emit at least one event through the injected emitter"
        );
    }

    // ── (d) erro de sugest NUNCA vaza o segredo (ADR-003, CA-4) ──────
    // Always-pass no RED: o stub retorna "not_implemented" que nao contem
    // o segredo. No GREEN, protege contra implementacoes que formatam o
    // segredo na mensagem de erro (ex: "falha ao injetar sk-xxx: ...").

    #[test]
    fn suggest_error_never_leaks_secret() {
        let secret = "sk-error-leak-guard";
        let req = build_request(InjectedCredential {
            kind: ProviderKind::Openai,
            connection_mode: ProviderConnectionMode::ApiKey,
            secret: secret.into(),
            base_url: None,
            model: None,
        });

        let result = suggest_with_stream(0, req, test_emitter());
        if let Err(msg) = result {
            assert!(
                !msg.contains(secret),
                "error message must NOT contain the secret — CA-4/ADR-003: {}",
                msg
            );
        }
    }
}


// ── Meeting listening (T-306/307/100) + credenciais + assistentes ────────

/// Estado da sessão de reunião em andamento ("ouvir reunião").
struct MeetingSession {
    session_id: String,
    assistant_id: String,
    stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

static MEETING: std::sync::Mutex<Option<MeetingSession>> = std::sync::Mutex::new(None);

/// Contexto de transcrição acumulado (últimos 40 segmentos). Compartilhado
/// entre o loop de STT e os fluxos acionados por atalho (Capturar Tela /
/// Analisar Conversa) para que o copiloto receba "o que foi dito" mesmo
/// quando o gatilho sai de um atalho global, não do ciclo automático.
static CONTEXT_LOG: std::sync::Mutex<Vec<(String, String)>> = std::sync::Mutex::new(Vec::new());

/// Adiciona um segmento ao contexto (com trim para 40 entradas).
fn push_context(speaker: &str, text: String) {
    let mut log = CONTEXT_LOG.lock().unwrap_or_else(|e| e.into_inner());
    log.push((speaker.to_string(), text));
    let len = log.len();
    if len > 40 {
        log.drain(..len - 40);
    }
}

/// Últimos `n` segmentos do contexto como TranscriptContextSegment.
fn recent_context_segments(n: usize) -> Vec<ipc::TranscriptContextSegment> {
    let log = CONTEXT_LOG.lock().unwrap_or_else(|e| e.into_inner());
    log.iter().rev().take(n).rev().enumerate()
        .map(|(i, (speaker, text))| ipc::TranscriptContextSegment {
            speaker: if speaker == "self" {
                ipc::Speaker::Self_
            } else {
                ipc::Speaker::Others
            },
            text: text.clone(),
            start_ms: (i as i32) * 1_000,
        })
        .collect()
}

/// POST/GET JSON cru ao sidecar em thread dedicada (padrão dos comandos acima).
fn sidecar_request(
    port: u16,
    method: &str,
    path: &str,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let url = format!("http://127.0.0.1:{port}{path}");
    let method = method.to_string();
    let handle = std::thread::spawn(move || -> Result<serde_json::Value, String> {
        let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
        rt.block_on(async {
            let client = reqwest::Client::new();
            let mut builder = match method.as_str() {
                "GET" => client.get(&url),
                "POST" => client.post(&url),
                "DELETE" => client.delete(&url),
                other => return Err(format!("método desconhecido: {other}")),
            };
            if let Some(json) = body {
                builder = builder.json(&json);
            }
            let resp = builder.send().await.map_err(|e| e.to_string())?;
            resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())
        })
    });
    handle.join().map_err(|_| "thread panicked".to_string())?
}

/// Extrai `value` de um envelope IpcResult { ok, value, error }.
fn unwrap_ipc(value: serde_json::Value) -> Result<serde_json::Value, String> {
    if value.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        Ok(value.get("value").cloned().unwrap_or(serde_json::Value::Null))
    } else {
        let msg = value
            .pointer("/error/message")
            .and_then(|v| v.as_str())
            .unwrap_or("sidecar error");
        Err(msg.to_string())
    }
}

/// Persiste um segmento de transcrição no sidecar (sessão corrente).
fn post_transcript(port: u16, session_id: &str, req: &ipc::AppendTranscriptRequest) {
    let body = serde_json::json!({
        "sessionId": req.session_id,
        "speaker": match req.speaker {
            ipc::Speaker::Self_ => "SELF",
            ipc::Speaker::Others => "OTHERS",
        },
        "text": req.text,
        "translatedText": req.translated_text,
        "startMs": req.start_ms,
        "endMs": req.end_ms,
    });
    if let Ok(resp) = sidecar_request(port, "POST", "/sessions/transcript", Some(body)) {
        if resp.get("ok").and_then(|v| v.as_bool()) != Some(true) {
            eprintln!("[ray] appendTranscript falhou: {resp}");
        }
    }
}

/// Inicia "ouvir reunião": sessão no sidecar + captura dupla (microfone +
/// áudio do sistema via ScreenCaptureKit) + loop de transcrição que persiste
/// segmentos e emite `ray:transcript` + loop de ANÁLISE que roda o copiloto
/// (suggest streaming) sobre o contexto acumulado a cada ~25s.
#[tauri::command]
fn start_meeting(app: tauri::AppHandle, assistant_id: String) -> Result<String, String> {
    let port = SIDECAR_PORT.load(Ordering::Acquire);
    if port == 0 {
        return Err("sidecar not started".into());
    }
    if let Some(m) = MEETING
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
    {
        return Ok(m.session_id.clone());
    }

    let body = serde_json::json!({
        "userId": "local",
        "assistantId": if assistant_id.is_empty() { None } else { Some(assistant_id.clone()) },
    });
    // Nova reunião começa com contexto limpo (sem vazamento da sessão anterior).
    CONTEXT_LOG
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clear();
    let resp = sidecar_request(port, "POST", "/sessions/start", Some(body))?;
    let session_id = unwrap_ipc(resp)?
        .get("sessionId")
        .and_then(|v| v.as_str())
        .ok_or("sessions/start sem sessionId")?
        .to_string();

    // Canal VOCÊ: microfone. Canal OUTROS: áudio do sistema (a reunião).
    audio::start_capture("default");
    if !audio::start_system_capture() {
        let _ = app.emit(
            "ray:analysis-hint",
            serde_json::json!({
                "text": "Sem áudio da reunião (canal OUTROS): instale o BlackHole (brew install --cask blackhole-2ch; reinicie o Mac se não aparecer), crie um Multi-Output Device com os alto-falantes + BlackHole e defina-o como saída do app de reunião. O microfone continua sendo transcrito."
            }),
        );
    }

    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stop_loop = stop.clone();
    let sid = session_id.clone();
    let sid_store = session_id.clone();
    let app_stt = app.clone();

    std::thread::spawn(move || {
        use std::sync::atomic::Ordering;
        let channels: [(ipc::Speaker, &str); 2] = [
            (ipc::Speaker::Self_, "self"),
            (ipc::Speaker::Others, "others"),
        ];
        loop {
            if stop_loop.load(Ordering::SeqCst) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(1_500));
            for (speaker, label) in &channels {
                let requests =
                    match stt::drain_and_process(speaker.clone(), &sid) {
                        Ok(r) => r,
                        Err(e) => {
                            eprintln!("[ray] stt({label}): {e}");
                            continue;
                        }
                    };
                for req in requests {
                    push_context(label, req.text.clone());
                    let _ = app_stt.emit(
                        "ray:transcript",
                        serde_json::json!({ "speaker": label, "text": req.text }),
                    );
                    post_transcript(port, &sid, &req);
                }
            }
        }
    });

    // Loop de ANÁLISE (T-300s): a cada 25s roda o copiloto com o contexto
    // recente (mínimo 2 segmentos novos). A credencial é resolvida do cofre
    // como no suggest manual (ADR-003) — usa a primeira disponível.
    let app_analysis = app.clone();
    let sid_analysis = session_id.clone();
    let assistant = if assistant_id.is_empty() {
        String::new()
    } else {
        assistant_id
    };
    let stop_analysis = stop.clone();
    let assistant_analysis = assistant.clone();
    std::thread::spawn(move || {
        use std::sync::atomic::Ordering;
        let mut last_analyzed_len = 0usize;
        loop {
            if stop_analysis.load(Ordering::SeqCst) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25_000));
            if stop_analysis.load(Ordering::SeqCst) {
                break;
            }
            let (context, new_count) = {
                let log = CONTEXT_LOG.lock().unwrap_or_else(|e| e.into_inner());
                let recent: Vec<(String, String)> =
                    log.iter().rev().take(12).rev().cloned().collect();
                let new_count = log.len().saturating_sub(last_analyzed_len);
                (recent, new_count)
            };
            if context.len() < 2 || new_count < 2 {
                continue; // nada de novo o bastante para reanalisar
            }
            last_analyzed_len = CONTEXT_LOG
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .len();

            let Ok(raw) = sidecar_request(port, "GET", "/credentials", None) else {
                continue;
            };
            let Ok(creds) = unwrap_ipc(raw) else {
                continue;
            };
            let Some(cred) = creds
                .get("credentials")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.first())
                .cloned()
            else {
                let _ = app_analysis.emit(
                    "ray:analysis-hint",
                    serde_json::json!({ "text": "Configure uma API key para análise em tempo real." }),
                );
                continue;
            };
            let context_segments: Vec<ipc::TranscriptContextSegment> = context
                .iter()
                .enumerate()
                .map(|(i, (speaker, text))| ipc::TranscriptContextSegment {
                    speaker: if speaker == "self" {
                        ipc::Speaker::Self_
                    } else {
                        ipc::Speaker::Others
                    },
                    text: text.clone(),
                    start_ms: (i as i32) * 1_000,
                })
                .collect();
            // "Ler a tela": captura o display a cada ciclo de análise e
            // envia ao modelo multimodal (junto com o contexto de texto).
            // O arquivo persiste em captures/ e o data URL é transitório.
            let screenshots = match crate::capture::capture_screen(app_analysis.clone()) {
                Ok(image) => Some(vec![image]),
                Err(e) => {
                    eprintln!("[ray] screenshot do ciclo falhou: {e}");
                    None
                }
            };
            let req = SuggestRequest {
                session_id: sid_analysis.clone(),
                assistant_id: assistant_analysis.clone(),
                trigger: ipc::SuggestionTrigger::Auto,
                context: context_segments,
                user_prompt: None,
                screenshots,
                selection_text: None,
                credential: ipc::InjectedCredential {
                    kind: serde_json::from_value(
                        cred.get("kind").cloned().unwrap_or_default(),
                    )
                    .unwrap_or(ipc::ProviderKind::Openai),
                    connection_mode: serde_json::from_value(
                        cred.get("connectionMode").cloned().unwrap_or_default(),
                    )
                    .unwrap_or(ipc::ProviderConnectionMode::ApiKey),
                    secret: cred
                        .get("secretRef")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    base_url: cred
                        .get("baseUrl")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    model: None,
                },
            };
            let emitter = TauriEmitter { app: app_analysis.clone() };
            let p = port;
            let _ = std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().ok()?;
                let result = rt.block_on(ipc_client::stream_suggest_events(
                    &format!("http://127.0.0.1:{p}"),
                    req,
                    vault_resolve,
                    emitter,
                ));
                if let Err(e) = result {
                    eprintln!("[ray] análise automática falhou: {e:?}");
                }
                Some(())
            });
        }
    });

    let _ = app.emit(
        "ray:meeting-started",
        serde_json::json!({ "sessionId": session_id }),
    );

    *MEETING.lock().unwrap_or_else(|e| e.into_inner()) = Some(MeetingSession {
        session_id: sid_store,
        assistant_id: assistant,
        stop,
    });
    Ok(session_id)
}

#[tauri::command]
fn stop_meeting(app: tauri::AppHandle) -> Result<(), String> {
    let meeting = MEETING
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take();
    let Some(meeting) = meeting else {
        return Ok(());
    };
    meeting
        .stop
        .store(true, std::sync::atomic::Ordering::SeqCst);
    audio::stop_capture();

    let port = SIDECAR_PORT.load(Ordering::Acquire);
    let sid = meeting.session_id.clone();
    // Flush final (fora do loop — o loop já parou de drenar).
    if port != 0 {
        if let Ok(requests) = stt::finalize_transcription(ipc::Speaker::Self_, &sid) {
            for req in requests {
                let _ = app.emit(
                    "ray:transcript",
                    serde_json::json!({ "speaker": "self", "text": req.text }),
                );
                post_transcript(port, &sid, &req);
            }
        }
        let body = serde_json::json!({ "sessionId": sid, "generateSummary": false });
        if let Err(e) = sidecar_request(port, "POST", "/sessions/end", Some(body)) {
            eprintln!("[ray] sessions/end falhou: {e}");
        }
    }
    let _ = app.emit("ray:meeting-stopped", serde_json::json!({}));
    Ok(())
}

/// Valida a credencial de um slot: lê a referência no sidecar, resolve o
/// segredo no cofre nativo e roda POST /providers/validate — define
/// lastValidatedAt (RF-403), que alimenta o status "conectado" da UI.
/// Valida um slot contra o provedor (GET /credentials → cofre → validate).
/// Usado pelo comando da UI e pela validação de pendências no arranque.
fn validate_slot(port: u16, slot: &str) -> Result<serde_json::Value, String> {
    let creds = unwrap_ipc(sidecar_request(port, "GET", "/credentials", None)?)?;
    let cred = creds
        .get("credentials")
        .and_then(|v| v.as_array())
        .and_then(|arr| {
            arr.iter()
                .find(|c| c.get("slot").and_then(|s| s.as_str()) == Some(slot))
        })
        .cloned()
        .ok_or_else(|| format!("slot '{slot}' não configurado"))?;

    let secret_ref = cred
        .get("secretRef")
        .and_then(|v| v.as_str())
        .ok_or("credencial sem secretRef")?
        .to_string();
    let secret = vault::get_secret(&secret_ref).map_err(|e| e.to_string())?;

    let body = serde_json::json!({
        "slot": slot,
        "credential": {
            "kind": cred.get("kind").cloned().unwrap_or_default(),
            "connectionMode": cred.get("connectionMode").cloned().unwrap_or_default(),
            "secret": secret,
            "baseUrl": cred.get("baseUrl").cloned().unwrap_or(serde_json::Value::Null),
        }
    });
    unwrap_ipc(sidecar_request(port, "POST", "/providers/validate", Some(body))?)
}

#[tauri::command]
fn validate_credential(slot: String) -> Result<serde_json::Value, String> {
    let port = SIDECAR_PORT.load(Ordering::Acquire);
    if port == 0 {
        return Err("sidecar not started".into());
    }
    validate_slot(port, &slot)
}

/// Valida credenciais salvas que ainda não foram validadas (persistidas
/// antes da validação automática existir). Roda no arranque para que chaves
/// salvas apareçam como "Conectado" sem exigir re-salvar.
fn validate_pending_credentials(app: &tauri::AppHandle, port: u16) {
    use tauri::Emitter;
    let Ok(raw) = sidecar_request(port, "GET", "/credentials", None) else {
        return;
    };
    let Ok(creds) = unwrap_ipc(raw) else {
        return;
    };
    let Some(list) = creds.get("credentials").and_then(|v| v.as_array()) else {
        return;
    };
    for cred in list {
        let slot = match cred.get("slot").and_then(|v| v.as_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        let validated = cred
            .get("lastValidatedAt")
            .map(|v| !v.is_null())
            .unwrap_or(false);
        if validated {
            continue;
        }
        let result = validate_slot(port, &slot);
        let (valid, reason) = match result {
            Ok(v) => (
                v.get("valid").and_then(|x| x.as_bool()).unwrap_or(false),
                v.get("reason").and_then(|x| x.as_str()).map(String::from),
            ),
            Err(e) => (false, Some(e)),
        };
        let _ = app.emit(
            "ray:credentials-changed",
            serde_json::json!({ "slot": slot, "valid": valid, "reason": reason }),
        );
    }
}

/// Cria um assistente USER (RF-338) — persiste no banco via sidecar.
#[tauri::command]
fn create_assistant(
    name: String,
    category: String,
    prompt: String,
) -> Result<serde_json::Value, String> {
    let port = SIDECAR_PORT.load(Ordering::Acquire);
    if port == 0 {
        return Err("sidecar not started".into());
    }
    let body = serde_json::json!({
        "userId": "local",
        "name": name,
        "category": category,
        "prompt": prompt,
    });
    unwrap_ipc(sidecar_request(port, "POST", "/assistants", Some(body))?)
}

/// Lista assistentes (BUILTIN + USER) para a biblioteca da UI.
#[tauri::command]
fn list_assistants() -> Result<serde_json::Value, String> {
    let port = SIDECAR_PORT.load(Ordering::Acquire);
    if port == 0 {
        return Err("sidecar not started".into());
    }
    unwrap_ipc(sidecar_request(port, "GET", "/assistants", None)?)
}

// ── helpers locais de parsing de resposta do sidecar ─────────────────────

/// Monta o tray da barra de menu (menu: Mostrar Ray / Capturar Tela / Sair).
fn build_tray(app: &tauri::AppHandle) -> Result<(), tauri::Error> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;
    use tauri::{Emitter, Manager};

    let show = MenuItem::with_id(app, "tray-show", "Mostrar Ray", true, None::<&str>)?;
    let capture =
        MenuItem::with_id(app, "tray-capture", "Capturar Tela", true, None::<&str>)?;
    let settings =
        MenuItem::with_id(app, "tray-settings", "Configuracoes", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray-quit", "Sair do Ray", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &capture, &settings, &quit])?;

    let mut builder = TrayIconBuilder::with_id("ray-tray")
        .menu(&menu)
        .tooltip("Ray")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray-show" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
            "tray-settings" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
                let _ = app.emit("ray:navigate", serde_json::json!({ "surface": "settings" }));
            }
            "tray-capture" => {
                // Persiste em disco e emite só o CAMINHO — base64 de imagem
                // não é broadcast para as janelas (memória da UI).
                match capture::captures_dir(app).and_then(|dir| capture::capture_to(&dir)) {
                    Ok((path, _)) => {
                        let _ = app.emit(
                            "ray:screen-captured",
                            serde_json::json!({ "path": path.to_string_lossy() }),
                        );
                    }
                    Err(e) => eprintln!("[ray] captura do tray falhou: {e}"),
                }
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                }
            }
            "tray-quit" => app.exit(0),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}


#[derive(serde::Deserialize)]
struct SidecarResp<T> {
    ok: bool,
    value: Option<T>,
    error: Option<SidecarErr>,
}

#[derive(serde::Deserialize)]
struct SidecarErr {
    message: String,
}

fn parse_sidecar<T: serde::de::DeserializeOwned>(resp: SidecarResp<T>) -> Result<T, String> {
    if resp.ok {
        resp.value.ok_or_else(|| "sidecar returned ok without value".to_string())
    } else {
        Err(resp.error.map(|e| e.message).unwrap_or_else(|| "sidecar error".to_string()))
    }
}

// ── Persistência de credenciais (T-302/T-406) ─────────────────────────────

/// Grava o segredo no cofre nativo e persiste o `ApiKeyRef` no sidecar sem o
/// segredo (ADR-003). O campo `secret` nunca sai deste handler.
#[tauri::command]
fn save_credential(
    slot: String,
    kind: ipc::ProviderKind,
    connection_mode: ipc::ProviderConnectionMode,
    secret: String,
    base_url: Option<String>,
) -> Result<ipc::SaveCredentialResponse, String> {
    let label = format!("{:?}-{}", kind, slot);
    let secret_ref = vault::store_secret(&label, &secret).map_err(|e| e.to_string())?;

    let req = ipc::SaveCredentialRequest {
        slot,
        kind,
        connection_mode,
        label,
        secret_ref,
        base_url,
    };

    let port = SIDECAR_PORT.load(Ordering::Acquire);
    if port == 0 {
        return Err("sidecar not started".into());
    }
    let base_url_sidecar = format!("http://127.0.0.1:{}", port);

    let handle = std::thread::spawn(move || -> Result<ipc::SaveCredentialResponse, String> {
        let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
        rt.block_on(async {
            let client = reqwest::Client::new();
            let resp = client
                .post(format!("{}/credentials", base_url_sidecar))
                .json(&req)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let wrapper: SidecarResp<ipc::SaveCredentialResponse> =
                resp.json().await.map_err(|e| e.to_string())?;
            parse_sidecar(wrapper)
        })
    });

    handle.join().map_err(|_| "thread panicked".to_string())?
}

/// Remove a credencial do cofre nativo e do banco (via sidecar).
#[tauri::command]
fn delete_credential(slot: String) -> Result<(), String> {
    let port = SIDECAR_PORT.load(Ordering::Acquire);
    if port == 0 {
        return Err("sidecar not started".into());
    }
    let base_url = format!("http://127.0.0.1:{}", port);

    let handle = std::thread::spawn(move || -> Result<(), String> {
        let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
        rt.block_on(async {
            let client = reqwest::Client::new();

            // 1. Buscar o secretRef do slot no sidecar.
            let get_resp = client
                .get(format!("{}/credentials", base_url))
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let wrapper: SidecarResp<ipc::GetCredentialsResponse> =
                get_resp.json().await.map_err(|e| e.to_string())?;
            let creds = parse_sidecar(wrapper)?;

            // 2. Remover do cofre nativo se o slot existir.
            if let Some(cred) = creds.credentials.iter().find(|c| c.slot == slot) {
                vault::delete_secret(&cred.secret_ref).ok();
            }

            // 3. DELETE /credentials no sidecar.
            let del_req = ipc::DeleteCredentialRequest { slot };
            let del_resp = client
                .delete(format!("{}/credentials", base_url))
                .json(&del_req)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let del_wrapper: SidecarResp<serde_json::Value> =
                del_resp.json().await.map_err(|e| e.to_string())?;
            parse_sidecar(del_wrapper).map(|_| ())
        })
    });

    handle.join().map_err(|_| "thread panicked".to_string())?
}

/// Retorna o status de cada provedor configurado (slot + lastValidatedAt).
/// Retorna lista vazia se o sidecar não estiver disponível (estado restritivo).
#[tauri::command]
fn get_provider_statuses() -> Result<ipc::GetCredentialsResponse, String> {
    let port = SIDECAR_PORT.load(Ordering::Acquire);
    if port == 0 {
        return Ok(ipc::GetCredentialsResponse { credentials: vec![] });
    }
    let base_url = format!("http://127.0.0.1:{}", port);

    let handle = std::thread::spawn(move || -> Result<ipc::GetCredentialsResponse, String> {
        let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
        rt.block_on(async {
            let client = reqwest::Client::new();
            let resp = client
                .get(format!("{}/credentials", base_url))
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let wrapper: SidecarResp<ipc::GetCredentialsResponse> =
                resp.json().await.map_err(|e| e.to_string())?;
            parse_sidecar(wrapper)
        })
    });

    handle.join().map_err(|_| "thread panicked".to_string())?
}

/// Busca o assistente default (BUILTIN "Assistente Padrao") no sidecar.
/// A Home e o copiloto precisam de um assistantId real para o SuggestRequest.
#[tauri::command]
fn get_default_assistant() -> Result<Option<ipc::AssistantSummary>, String> {
    let port = SIDECAR_PORT.load(Ordering::Acquire);
    if port == 0 {
        return Err("sidecar not started".into());
    }
    let base_url = format!("http://127.0.0.1:{port}");

    let handle = std::thread::spawn(
        move || -> Result<Option<ipc::AssistantSummary>, String> {
            let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
            rt.block_on(async {
                let client = reqwest::Client::new();
                let resp = client
                    .get(format!("{base_url}/assistants"))
                    .send()
                    .await
                    .map_err(|e| e.to_string())?;
                let wrapper: SidecarResp<ipc::AssistantList> =
                    resp.json().await.map_err(|e| e.to_string())?;
                let list = parse_sidecar(wrapper)?;
                let assistants = list.assistants;
                let builtin = assistants
                    .iter()
                    .find(|a| a.source == "BUILTIN")
                    .cloned();
                Ok(builtin.or_else(|| assistants.into_iter().next()))
            })
        },
    );

    handle.join().map_err(|_| "thread panicked".to_string())?
}

// ── T-503 commands — logs folder + clipboard export ──────────────────────

/// Abre a pasta de logs no gerenciador de arquivos nativo (RF-1004).
#[tauri::command]
fn open_logs_folder(app: tauri::AppHandle) -> Result<(), String> {
    let dir = logging::resolve_log_dir(&app)?;
    logging::open_folder(&dir)
}

/// Copia o conteúdo do arquivo de log para a área de transferência (RF-1004).
/// Conteúdo de reunião NUNCA aparece aqui — apenas erros estruturais (T-503).
#[tauri::command]
fn copy_logs_to_clipboard(app: tauri::AppHandle) -> Result<(), String> {
    let dir = logging::resolve_log_dir(&app)?;
    logging::copy_to_clipboard(&dir)
}

// ── Atalhos globais (RF-600/RF-603, T-305 runtime) ──────────────────────
// Registra os defaults do shortcuts.rs como atalhos globais do SO via
// tauri-plugin-global-shortcut. No macOS exige permissão de Acessibilidade
// (RF-603): sem ela o registro falha e o core emite um hint à UI.

use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Combo registrado → comando. Preenchido no setup, consultado no handler.
static SHORTCUT_LOOKUP: std::sync::Mutex<Option<HashMap<Shortcut, ShortcutCommand>>> =
    std::sync::Mutex::new(None);

/// Primeira credencial persistida no sidecar (mesma seleção do ciclo de
/// análise automática).
fn first_credential(port: u16) -> Option<serde_json::Value> {
    let raw = sidecar_request(port, "GET", "/credentials", None).ok()?;
    let creds = unwrap_ipc(raw).ok()?;
    creds
        .get("credentials")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .cloned()
}

/// Roda o copiloto a partir de um atalho: monta o SuggestRequest com o
/// contexto de transcrição acumulado (se houver reunião ativa) e faz o
/// streaming para o Overlay via `suggest-stream`.
fn shortcut_suggest(
    app: &tauri::AppHandle,
    trigger: ipc::SuggestionTrigger,
    screenshots: Option<Vec<String>>,
    user_prompt: Option<String>,
) {
    let port = SIDECAR_PORT.load(Ordering::Acquire);
    if port == 0 {
        let _ = app.emit(
            "ray:analysis-hint",
            serde_json::json!({ "text": "Serviço de IA ainda não disponível — tente novamente em instantes." }),
        );
        return;
    }
    let Some(cred) = first_credential(port) else {
        let _ = app.emit(
            "ray:analysis-hint",
            serde_json::json!({ "text": "Configure uma API key em Configurações para usar o copiloto." }),
        );
        return;
    };
    // Sessão para o request: reunião contínua > sessão do push-to-listen >
    // placeholder. Assim a análise disparada ao soltar o push-to-listen fica
    // ligada à sessão onde o trecho foi persistido.
    let (session_id, assistant_id) = {
        let meeting_guard = MEETING.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(m) = meeting_guard.as_ref() {
            (m.session_id.clone(), m.assistant_id.clone())
        } else {
            drop(meeting_guard);
            let ptt_guard = PTT_SESSION.lock().unwrap_or_else(|e| e.into_inner());
            (
                ptt_guard
                    .clone()
                    .unwrap_or_else(|| "sess-shortcut".to_string()),
                String::new(),
            )
        }
    };
    let req = SuggestRequest {
        session_id,
        assistant_id,
        trigger,
        context: recent_context_segments(12),
        user_prompt,
        screenshots,
        selection_text: None,
        credential: ipc::InjectedCredential {
            kind: serde_json::from_value(cred.get("kind").cloned().unwrap_or_default())
                .unwrap_or(ipc::ProviderKind::Openai),
            connection_mode: serde_json::from_value(
                cred.get("connectionMode").cloned().unwrap_or_default(),
            )
            .unwrap_or(ipc::ProviderConnectionMode::ApiKey),
            secret: cred
                .get("secretRef")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            base_url: cred
                .get("baseUrl")
                .and_then(|v| v.as_str())
                .map(String::from),
            model: None,
        },
    };
    let emitter = TauriEmitter { app: app.clone() };
    std::thread::spawn(move || {
        use ipc_client::SuggestEventEmitter;
        if let Err(e) = suggest_with_stream(port, req, emitter.clone()) {
            eprintln!("[ray] atalho: análise falhou: {e}");
            // Falha SEM stream (vault, HTTP 4xx/5xx, conexão): emite
            // start+error para o Overlay flutuante abrir e exibir o motivo —
            // sem isso o atalho falha em silêncio total (nada aparece).
            emitter.emit_event(ipc::SuggestStreamEvent::Start {
                suggestion_id: format!(
                    "err-{}",
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis())
                        .unwrap_or(0)
                ),
                context_label: None,
                they_said: None,
            });
            emitter.emit_event(ipc::SuggestStreamEvent::Error {
                error: ipc::IpcError {
                    code: ipc::IpcErrorCode::AgentError,
                    message: e,
                    retryable: None,
                },
            });
        }
    });
}

/// Sessão persistente do modo push-to-listen: criada no primeiro segurar e
/// reutilizada — os trechos transcritos se acumulam nela como uma reunião.
static PTT_SESSION: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// True enquanto o atalho push-to-listen está pressionado.
static PTT_HOLDING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Modo push-to-listen (RF-604): captura o áudio da conversa APENAS enquanto
/// o atalho está pressionado; ao soltar, para os streams (a RAM de captura
/// sai no instante do soltar), transcreve o trecho acumulado e dispara a
/// análise do agente — o resultado faz streaming para o Overlay flutuante.
/// É o caminho leve para quem não quer gravação contínua: nada de loop de
/// STT, captura dupla ou ciclo de screenshots rodando o tempo todo.
fn dispatch_push_to_listen(app: &tauri::AppHandle, pressed: bool) {
    if pressed {
        ptt_start_hold(app);
    } else {
        ptt_release(app);
    }
}

/// Pressionou: garante sessão e liga a captura dupla (microfone + sistema).
fn ptt_start_hold(app: &tauri::AppHandle) {
    use std::sync::atomic::Ordering;
    // Key repeat do SO dispara Pressed várias vezes — só a primeira liga.
    if PTT_HOLDING.swap(true, Ordering::SeqCst) {
        return;
    }
    // Reunião contínua ativa: ela é dona das filas/streams — não disputar.
    if MEETING
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .is_some()
    {
        PTT_HOLDING.store(false, Ordering::SeqCst);
        let _ = app.emit(
            "ray:analysis-hint",
            serde_json::json!({ "text": "Reunião contínua ativa — encerre-a (⌘D) para usar o modo push-to-listen." }),
        );
        return;
    }
    let port = SIDECAR_PORT.load(Ordering::Acquire);
    if port == 0 {
        PTT_HOLDING.store(false, Ordering::SeqCst);
        let _ = app.emit(
            "ray:analysis-hint",
            serde_json::json!({ "text": "Serviço de IA ainda não disponível — tente novamente em instantes." }),
        );
        return;
    }
    // Sessão persistente do modo (criada no primeiro uso, reutilizada).
    {
        let mut guard = PTT_SESSION.lock().unwrap_or_else(|e| e.into_inner());
        if guard.is_none() {
            match sidecar_request(
                port,
                "POST",
                "/sessions/start",
                Some(serde_json::json!({ "userId": "local" })),
            ) {
                Ok(resp) => match unwrap_ipc(resp) {
                    Ok(v) => {
                        *guard = v
                            .get("sessionId")
                            .and_then(|s| s.as_str())
                            .map(String::from);
                    }
                    Err(e) => eprintln!("[ray] push-to-listen: sessão: {e}"),
                },
                Err(e) => eprintln!("[ray] push-to-listen: sessão: {e}"),
            }
            if guard.is_none() {
                // Sem sessão não há onde anexar a transcrição do trecho.
                PTT_HOLDING.store(false, Ordering::SeqCst);
                let _ = app.emit(
                    "ray:analysis-hint",
                    serde_json::json!({ "text": "Não foi possível iniciar a sessão de escuta — verifique os logs." }),
                );
                return;
            }
        }
    }
    // Captura só enquanto segurando: VOCÊ (microfone) + OUTROS (sistema).
    audio::start_capture("default");
    if !audio::start_system_capture() {
        let _ = app.emit(
            "ray:analysis-hint",
            serde_json::json!({ "text": "Sem áudio da reunião (OUTROS): instale o BlackHole (brew install --cask blackhole-2ch) e inclua-o num Multi-Output Device. O microfone segue sendo ouvido." }),
        );
    }
    let _ = app.emit(
        "ray:analysis-hint",
        serde_json::json!({ "text": "Ouvindo… solte o atalho para o Ray analisar." }),
    );
}

/// Soltou: desliga a captura, transcreve o trecho (Self + Others) e dispara
/// a análise do agente com o contexto atualizado.
fn ptt_release(app: &tauri::AppHandle) {
    use std::sync::atomic::Ordering;
    if !PTT_HOLDING.swap(false, Ordering::SeqCst) {
        return;
    }
    // Para os streams JÁ no handler do atalho: buffers do cpal e filas de
    // PCM param de crescer no instante do soltar.
    audio::stop_capture();

    let app_t = app.clone();
    std::thread::spawn(move || {
        // Transcrever pode bloquear segundos (o resultado final do Apple
        // Speech tem timeout) — por isso FORA do handler do atalho.
        let Some(session_id) =
            PTT_SESSION.lock().unwrap_or_else(|e| e.into_inner()).clone()
        else {
            return;
        };
        let port = SIDECAR_PORT.load(Ordering::Acquire);
        for (speaker, label) in [
            (ipc::Speaker::Self_, "self"),
            (ipc::Speaker::Others, "others"),
        ] {
            let mut requests =
                stt::drain_and_process(speaker.clone(), &session_id).unwrap_or_default();
            if let Ok(mut rest) = stt::finalize_transcription(speaker.clone(), &session_id) {
                requests.append(&mut rest);
            }
            for req in requests {
                push_context(label, req.text.clone());
                let _ = app_t.emit(
                    "ray:transcript",
                    serde_json::json!({ "speaker": label, "text": req.text }),
                );
                if port != 0 {
                    post_transcript(port, &session_id, &req);
                }
            }
        }
        // O trecho recém-transcrito são os ÚLTIMOS segmentos do contexto —
        // é exatamente o que o agente analisa.
        shortcut_suggest(
            &app_t,
            ipc::SuggestionTrigger::AnalyzeConversation,
            None,
            None,
        );
    });
}

// ── Push-to-look: variante visual do push-to-listen ────────────────────────
//
// Enquanto o atalho está pressionado, screenshots são SALVOS EM DISCO
// (captures/, mesma poda de sempre) em intervalos fixos; ao soltar, as
// capturas da janela viram data URLs (sob demanda) e vão ao agente — o
// resultado faz streaming no Overlay flutuante. Não conflita com a reunião
// contínua: screenshots não disputam as filas de áudio.

/// True enquanto o atalho push-to-look está pressionado.
static PTL_HOLDING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Caminhos em disco das capturas da janela corrente, em ordem de captura.
static PTL_PATHS: std::sync::Mutex<Vec<std::path::PathBuf>> = std::sync::Mutex::new(Vec::new());

/// Thread de captura da janela corrente — o release aguarda o join antes de
/// analisar (a última captura pode estar em voo).
static PTL_WORKER: std::sync::Mutex<Option<std::thread::JoinHandle<()>>> =
    std::sync::Mutex::new(None);

/// Intervalo entre capturas e teto por janela: 5 imagens ≈ 10s segurando —
/// mantém o request dentro do tamanho aceitável para modelos multimodais.
const PTL_CAPTURE_INTERVAL: std::time::Duration = std::time::Duration::from_secs(2);
const PTL_MAX_CAPTURES: usize = 5;

fn dispatch_push_to_look(app: &tauri::AppHandle, pressed: bool) {
    if pressed {
        ptl_start_hold(app);
    } else {
        ptl_release(app);
    }
}

/// Pressionou: captura imediata e loop de capturas periódicas até soltar.
fn ptl_start_hold(app: &tauri::AppHandle) {
    use std::sync::atomic::Ordering;
    // Análise anterior ainda processando o release: não misturar janelas.
    if PTL_WORKER
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_some()
    {
        let _ = app.emit(
            "ray:analysis-hint",
            serde_json::json!({ "text": "Análise anterior ainda em andamento — aguarde um instante." }),
        );
        return;
    }
    // Key repeat do SO dispara Pressed várias vezes — só a primeira vale.
    if PTL_HOLDING.swap(true, Ordering::SeqCst) {
        return;
    }
    let dir = match capture::captures_dir(app) {
        Ok(dir) => dir,
        Err(e) => {
            PTL_HOLDING.store(false, Ordering::SeqCst);
            eprintln!("[ray] push-to-look: {e}");
            let _ = app.emit(
                "ray:analysis-hint",
                serde_json::json!({ "text": "Não foi possível preparar a pasta de capturas — verifique os logs." }),
            );
            return;
        }
    };
    PTL_PATHS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clear();
    let _ = app.emit(
        "ray:analysis-hint",
        serde_json::json!({ "text": "Olhando a tela… solte o atalho para o Ray analisar." }),
    );
    let worker = std::thread::spawn(move || {
        let mut last = std::time::Instant::now();
        let mut count = 0usize;
        loop {
            if !PTL_HOLDING.load(Ordering::SeqCst) || count >= PTL_MAX_CAPTURES {
                break;
            }
            if last.elapsed() >= PTL_CAPTURE_INTERVAL {
                match capture::capture_to(&dir) {
                    Ok((path, _)) => {
                        PTL_PATHS
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .push(path);
                        count += 1;
                    }
                    Err(e) => {
                        eprintln!("[ray] push-to-look: captura falhou: {e}");
                        break;
                    }
                }
                last = std::time::Instant::now();
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    });
    *PTL_WORKER.lock().unwrap_or_else(|e| e.into_inner()) = Some(worker);
}

/// Soltou: encerra o loop de capturas, lê os arquivos da janela do disco e
/// dispara a análise visual do agente.
fn ptl_release(app: &tauri::AppHandle) {
    use std::sync::atomic::Ordering;
    if !PTL_HOLDING.swap(false, Ordering::SeqCst) {
        return;
    }
    let app_t = app.clone();
    std::thread::spawn(move || {
        // A última captura pode estar em voo — aguarda a thread de captura.
        let worker = PTL_WORKER.lock().unwrap_or_else(|e| e.into_inner()).take();
        if let Some(handle) = worker {
            let _ = handle.join();
        }
        let paths =
            std::mem::take(&mut *PTL_PATHS.lock().unwrap_or_else(|e| e.into_inner()));
        if paths.is_empty() {
            let _ = app_t.emit(
                "ray:analysis-hint",
                serde_json::json!({ "text": "Nenhuma captura foi salva — verifique a permissão de Gravação de Tela." }),
            );
            return;
        }
        let mut shots = Vec::new();
        for path in paths {
            match capture::data_url_for(&path) {
                Ok(url) => shots.push(url),
                Err(e) => eprintln!("[ray] push-to-look: {e}"),
            }
        }
        if shots.is_empty() {
            let _ = app_t.emit(
                "ray:analysis-hint",
                serde_json::json!({ "text": "As capturas ficaram vazias — verifique a permissão de Gravação de Tela." }),
            );
            return;
        }
        // Análise visual: as capturas da janela são o contexto principal.
        shortcut_suggest(&app_t, ipc::SuggestionTrigger::ScreenCapture, Some(shots), None);
    });
}

/// Ponte atalho global → ação do núcleo (RF-333/RF-706/CA-1).
/// Comandos de UI (rolagem, notch, opacidade…) são repassados via evento
/// `ray:shortcut` com o nome da ação.
fn dispatch_shortcut(app: &tauri::AppHandle, command: ShortcutCommand) {
    match command {
        ShortcutCommand::CaptureScreen => {
            // A análise faz streaming na janela flutuante do Overlay (ela se
            // abre com o evento suggest-stream start). A main permanece
            // oculta (stealth, RF-603). O evento leva só o CAMINHO em disco:
            // base64 de imagem não é broadcast para as janelas.
            match capture::captures_dir(app).and_then(|dir| capture::capture_to(&dir)) {
                Ok((path, image)) => {
                    let _ = app.emit(
                        "ray:screen-captured",
                        serde_json::json!({ "path": path.to_string_lossy() }),
                    );
                    shortcut_suggest(
                        app,
                        ipc::SuggestionTrigger::ScreenCapture,
                        Some(vec![image]),
                        None,
                    );
                }
                Err(e) => {
                    eprintln!("[ray] atalho: captura falhou: {e}");
                    let _ = app.emit(
                        "ray:analysis-hint",
                        serde_json::json!({ "text": "Captura de tela falhou — verifique a permissão de Gravação de Tela." }),
                    );
                }
            }
        }
        ShortcutCommand::ToggleVoiceRecording => {
            let active = MEETING
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .as_ref()
                .is_some();
            let result = if active {
                stop_meeting(app.clone()).map(|_| ())
            } else {
                start_meeting(app.clone(), String::new()).map(|_| ())
            };
            if let Err(e) = result {
                eprintln!("[ray] atalho: toggle de reunião falhou: {e}");
            }
        }
        ShortcutCommand::AskOrSend => {
            // RF-331/CA-1: analisa o que foi dito (contexto de transcrição
            // acumulado) e responde no Overlay flutuante — sem abrir a main
            // (stealth, RF-603).
            shortcut_suggest(
                app,
                ipc::SuggestionTrigger::AnalyzeConversation,
                None,
                None,
            );
        }
        ShortcutCommand::PushToListen => {
            // Tratado por dispatch_push_to_listen no handler (pressed E
            // released) — braço explícito para não vazar ray:shortcut à UI.
        }
        ShortcutCommand::PushToLook => {
            // Idem: dispatch_push_to_look trata os dois estados no handler.
        }
        other => {
            let _ = app.emit(
                "ray:shortcut",
                serde_json::json!({ "action": shortcuts::command_to_action_name(other) }),
            );
        }
    }
}

/// Mapa ativo de atalhos (o que de fato está registrado no SO). Preenchido
/// por apply_shortcut_map, consultado por get_shortcuts.
static ACTIVE_SHORTCUTS: std::sync::Mutex<Option<shortcuts::ShortcutMap>> =
    std::sync::Mutex::new(None);

/// Serializa um ShortcutMap para o shape do contrato (contracts/settings.ts):
/// { "<commandName>": { "enabled": bool, "modifiers": ["Cmd", …], "key": "E" } | null }.
fn shortcut_map_to_json(map: &shortcuts::ShortcutMap) -> serde_json::Value {
    let mut obj = serde_json::Map::new();
    for (&cmd, binding) in map {
        let name = shortcuts::command_to_action_name(cmd).to_string();
        let value = match binding {
            None => serde_json::Value::Null,
            Some(b) => {
                let mods: Vec<&str> = b
                    .modifiers
                    .iter()
                    .map(|m| match m {
                        shortcuts::ShortcutModifier::Cmd => "Cmd",
                        shortcuts::ShortcutModifier::Ctrl => "Ctrl",
                        shortcuts::ShortcutModifier::Alt => "Alt",
                        shortcuts::ShortcutModifier::Shift => "Shift",
                    })
                    .collect();
                serde_json::json!({ "enabled": b.enabled, "modifiers": mods, "key": b.key })
            }
        };
        obj.insert(name, value);
    }
    serde_json::Value::Object(obj)
}

/// Converte um comando do contrato (camelCase) para o enum.
fn command_from_name(name: &str) -> Option<ShortcutCommand> {
    shortcuts::ALL_SHORTCUT_COMMANDS
        .iter()
        .copied()
        .find(|&cmd| shortcuts::command_to_action_name(cmd) == name)
}

/// Faz o parse do shape do contrato para ShortcutMap. Binds ausentes ou
/// inválidos herdam o default (o UI editita sobre a base completa).
fn shortcut_map_from_json(value: serde_json::Value) -> shortcuts::ShortcutMap {
    let mut map = shortcuts::build_default_shortcuts();
    let Some(obj) = value.as_object() else {
        return map;
    };
    for (name, binding) in obj {
        let Some(cmd) = command_from_name(name) else {
            continue;
        };
        if binding.is_null() {
            map.insert(cmd, None);
            continue;
        }
        let Some(b) = binding.as_object() else { continue };
        let enabled = b.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
        let key = b
            .get("key")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let mut modifiers = Vec::new();
        if let Some(arr) = b.get("modifiers").and_then(|v| v.as_array()) {
            for m in arr {
                match m.as_str() {
                    Some("Cmd") => modifiers.push(shortcuts::ShortcutModifier::Cmd),
                    Some("Ctrl") => modifiers.push(shortcuts::ShortcutModifier::Ctrl),
                    Some("Alt") => modifiers.push(shortcuts::ShortcutModifier::Alt),
                    Some("Shift") => modifiers.push(shortcuts::ShortcutModifier::Shift),
                    _ => {}
                }
            }
        }
        if !key.is_empty() {
            map.insert(
                cmd,
                Some(shortcuts::ShortcutBinding {
                    enabled,
                    modifiers,
                    key,
                }),
            );
        }
    }
    map
}

/// Registra um mapa de atalhos no SO (substituindo o que estiver ativo),
/// atualiza lookup/mapa ativo e devolve a lista de erros por combo.
/// RF-601/RF-602: validação antes do registro; falha individual não desfaz
/// os demais (o usuário vê o erro na aba Atalhos e corrige).
fn apply_shortcut_map(
    app: &tauri::AppHandle,
    map: &shortcuts::ShortcutMap,
) -> Vec<String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let mut lookup = HashMap::new();
    let mut errors = Vec::new();
    for (&cmd, binding_opt) in map {
        let Some(binding) = binding_opt else { continue };
        if !binding.enabled {
            continue;
        }
        if let Err(e) = shortcuts::validate_binding(binding, cmd, map) {
            errors.push(format!(
                "{}: {e}",
                shortcuts::combo_string(binding)
            ));
            continue;
        }
        let combo = shortcuts::combo_string(binding);
        let Ok(shortcut) = combo.parse::<Shortcut>() else {
            errors.push(format!("{combo}: combo inválido"));
            continue;
        };
        match gs.register(shortcut) {
            Ok(()) => lookup.insert(shortcut, cmd),
            Err(e) => {
                errors.push(format!("{combo}: {e}"));
                continue;
            }
        };
    }
    *SHORTCUT_LOOKUP.lock().unwrap_or_else(|e| e.into_inner()) = Some(lookup);
    *ACTIVE_SHORTCUTS.lock().unwrap_or_else(|e| e.into_inner()) = Some(map.clone());
    errors
}

/// Registra os atalhos padrão (RF-604) no SO e popula o lookup do handler.
/// Falhas individuais não abortam o arranque — sem Acessibilidade no macOS
/// (RF-603) o app segue funcional pelos botões e pelo tray.
fn register_global_shortcuts(app: &tauri::AppHandle) {
    let map = shortcuts::build_default_shortcuts();
    let errors = apply_shortcut_map(app, &map);
    if !errors.is_empty() {
        eprintln!("[ray] atalho: falhas no registro inicial: {errors:?}");
        let _ = app.emit(
            "ray:analysis-hint",
            serde_json::json!({ "text": "Alguns atalhos globais não foram registrados — conceda a permissão de Acessibilidade ao Ray e reinicie o app (RF-603)." }),
        );
    }
}

/// Rearranque dos atalhos a partir do que está persistido no sidecar
/// (PUT /settings). Roda quando o sidecar fica pronto: o primeiro registro
/// (setup) usa defaults; este substitui pelo mapa salvo, se houver.
fn apply_stored_shortcuts(app: &tauri::AppHandle, port: u16) {
    let Ok(raw) = sidecar_request(port, "GET", "/settings", None) else {
        return;
    };
    let Ok(settings) = unwrap_ipc(raw) else {
        return;
    };
    let Some(shortcuts_json) = settings.get("shortcuts") else {
        return;
    };
    let as_object = shortcuts_json.as_object();
    if as_object.is_none_or(|o| o.is_empty()) {
        return; // nada salvo: os defaults do setup permanecem
    }
    let map = shortcut_map_from_json(shortcuts_json.clone());
    let errors = apply_shortcut_map(app, &map);
    if !errors.is_empty() {
        eprintln!("[ray] atalho: falhas ao aplicar atalhos salvos: {errors:?}");
    }
}

/// Devolve o mapa de atalhos ativo (RF-601 — a aba Atalhos hidrata dele).
#[tauri::command]
fn get_shortcuts() -> serde_json::Value {
    let guard = ACTIVE_SHORTCUTS.lock().unwrap_or_else(|e| e.into_inner());
    match guard.as_ref() {
        Some(map) => shortcut_map_to_json(map),
        None => shortcut_map_to_json(&shortcuts::build_default_shortcuts()),
    }
}

/// Aplica um novo mapa de atalhos (RF-601/RF-602): registra no SO com
/// efeito imediato e persiste no sidecar. Retorna { errors: [...] } — vazio
/// é sucesso total; erros individuais não desfaçam os demais registros.
#[tauri::command]
fn apply_shortcuts(app: tauri::AppHandle, bindings: serde_json::Value) -> Result<serde_json::Value, String> {
    let map = shortcut_map_from_json(bindings);
    let errors = apply_shortcut_map(&app, &map);
    // Persiste mesmo com erros parciais: os binds válidos são a nova base.
    let port = SIDECAR_PORT.load(Ordering::Acquire);
    if port != 0 {
        let body = serde_json::json!({ "shortcuts": shortcut_map_to_json(&map) });
        if let Err(e) = sidecar_request(port, "PUT", "/settings", Some(body)) {
            eprintln!("[ray] atalho: falha ao persistir: {e}");
        }
    }
    let _ = app.emit("ray:shortcuts-changed", shortcut_map_to_json(&map));
    Ok(serde_json::json!({ "errors": errors }))
}

/// Ponto de entrada da aplicação Tauri.
/// Registra os comandos Tauri. O sidecar é inicializado separadamente
/// via `sidecar::Sidecar::start()` + `set_sidecar_port()`.
pub fn run() {
    // T-503: inicializa o logger de erros antes de qualquer outro módulo.
    // A pasta é resolvida pelo Tauri após o builder, então usamos uma
    // inicialização lazy em open_logs_folder / copy_logs_to_clipboard.

    tauri::Builder::default()
        // T-502: plugin de auto-update assinado (RID-4 / ADR-009).
        .plugin(tauri_plugin_updater::Builder::new().build())
        // RF-600/RF-603: atalhos globais do SO — operam com o app sem foco.
        // O dispatch real vive em dispatch_shortcut (núcleo) — o handler só
        // resolve o combo → comando e age no keypress (ignora o release),
        // EXCETO o push-to-listen, que age nos DOIS estados: captura no
        // pressionar; transcreve e dispara a análise no soltar.
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    let command = SHORTCUT_LOOKUP
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .as_ref()
                        .and_then(|lookup| lookup.get(shortcut).copied());
                    let Some(command) = command else {
                        return;
                    };
                    if command == ShortcutCommand::PushToListen {
                        dispatch_push_to_listen(app, event.state == ShortcutState::Pressed);
                    } else if command == ShortcutCommand::PushToLook {
                        dispatch_push_to_look(app, event.state == ShortcutState::Pressed);
                    } else if event.state == ShortcutState::Pressed {
                        dispatch_shortcut(app, command);
                    }
                })
                .build(),
        )
        // O X vermelho da janela main destroi a WebviewWindow — depois disso
        // show_window nao consegue reabri-la (webview desvinculada). Intercepta
        // o close e esconde a janela, preservando a webview para reabertura.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            // LSUIElement (Info.plist) tira o app da Dock; o Accessory policy
            // garante o mesmo em `cargo run` (fora do bundle).
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Tray na barra de menu: presenca permanente do app sem Dock.
            build_tray(app.handle())?;

            // RF-604: registra os atalhos padrão (⌘E captura, ⌘D reunião…).
            // Requer Acessibilidade no macOS (RF-603) — falhas não abortam.
            register_global_shortcuts(app.handle());

            windows::init_registry();
            windows::init_app_handle(app.handle().clone());
            // macOS: janela sem decoracoes nao e movivel por padrao.
            // isMovableByWindowBackground=true delega o drag ao SO sem JS.
            if let Some(appbar) = app.get_webview_window("appbar") {
                windows::enable_movable_by_background(&appbar);
            }
            // Stealth ativo por padrao: o uso completo e o default e as
            // janelas nascem fora da captura de tela (ADR-008).
            for label in ["appbar", "main", "notch"] {
                if app.get_webview_window(label).is_some() {
                    windows::set_capture_excluded(label, true);
                }
            }
            // Sidecar (T-300/ADR-005): spawn em background com o banco SQLite
            // no app data dir. A porta registrada libera os comandos que
            // delegam ao sidecar (suggest/credentials/sessions).
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use tauri::{Emitter, Manager};
                let db_dir = match handle.path().app_data_dir() {
                    Ok(dir) => dir,
                    Err(e) => {
                        eprintln!("[ray] app_data_dir indisponivel: {e}");
                        return;
                    }
                };
                if let Err(e) = std::fs::create_dir_all(&db_dir) {
                    eprintln!("[ray] falha ao criar app data dir: {e}");
                    return;
                }
                let db_path = db_dir.join("ray.db");
                match sidecar::Sidecar::start(db_path).await {
                    Ok(s) => {
                        set_sidecar_port(s.port);
                        eprintln!("[ray] sidecar pronto na porta {}", s.port);
                        // Valida pendências (chaves salvas antes da validação
                        // automática existir) e notifica a UI.
                        std::thread::sleep(std::time::Duration::from_millis(500));
                        validate_pending_credentials(&handle, s.port);
                        // Atalhos persistidos (RF-601): substitui os defaults
                        // registrados no setup pelo mapa salvo no sidecar.
                        apply_stored_shortcuts(&handle, s.port);
                    }
                    Err(e) => eprintln!("[ray] sidecar falhou ao iniciar: {e}"),
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_stealth,
            toggle_window,
            show_window,
            hide_window,
            set_window_opacity,
            set_always_on_top,
            get_meter_levels,
            toggle_mic_capture,
            show_notch,
            show_overlay,
            move_window,
            resize_window,
            suggest,
            transcribe_pending_pcm,
            open_logs_folder,
            copy_logs_to_clipboard,
            save_credential,
            delete_credential,
            get_provider_statuses,
            get_default_assistant,
            start_meeting,
            stop_meeting,
            validate_credential,
            create_assistant,
            list_assistants,
            list_sessions,
            get_session,
            get_app_settings,
            save_feature_toggles,
            get_shortcuts,
            apply_shortcuts,
            permissions::get_permission_status,
            permissions::request_permission,
            permissions::request_all_permissions,
            permissions::open_permission_settings,
            capture::capture_screen,
            capture::latest_capture,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ray");
}
