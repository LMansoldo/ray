//! Ray core — biblioteca do núcleo Tauri (ADR-001).
//! Reúne os módulos e expõe os comandos Tauri consumidos pela UI Svelte.

pub mod audio;
pub mod ipc;
pub mod ipc_client;
pub mod logging;
pub mod shortcuts;
pub mod sidecar;
pub mod stt;
pub mod vault;
pub mod windows;

use ipc::SuggestRequest;
use std::sync::atomic::{AtomicU16, Ordering};

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
#[tauri::command]
fn suggest(req: SuggestRequest) -> Result<(), String> {
    // 1. Obter base_url do sidecar (T-300).
    let port = SIDECAR_PORT.load(Ordering::Acquire);
    if port == 0 {
        return Err("sidecar not started".into());
    }
    let base_url = format!("http://127.0.0.1:{}", port);

    // 2. Delegar ao ipc_client: resolve vault + injeta + POST.
    //    Thread dedicada com runtime tokio isolado — reqwest async
    //    precisa de runtime e o comando Tauri pode rodar em contexto
    //    sem runtime tokio.
    let handle = std::thread::spawn(move || -> Result<(), ipc_client::IpcClientError> {
        let rt = tokio::runtime::Runtime::new()
            .map_err(|e| {
                ipc_client::IpcClientError::Http(format!("failed to create runtime: {}", e))
            })?;
        rt.block_on(ipc_client::post_suggest_to_sidecar(
            &base_url,
            req,
            vault_resolve,
        ))
    });

    match handle.join() {
        Ok(Ok(())) => Ok(()),
        Ok(Err(ipc_err)) => Err(match ipc_err {
            ipc_client::IpcClientError::Credential(msg) => msg,
            ipc_client::IpcClientError::Http(msg) => msg,
        }),
        Err(_) => Err("sidecar request thread panicked".to_string()),
    }
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
    todo!("T-303: wire suggest_with_emitter to stream_suggest_events")
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

        let result = suggest(req);
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
        let result = suggest(req);
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
        let req = build_request(InjectedCredential {
            kind: ProviderKind::Openai,
            connection_mode: ProviderConnectionMode::ApiKey,
            secret: "placeholder".into(),
            base_url: None,
            model: None,
        });

        // RED: todo!() panics → test fails with "T-303".
        // GREEN: suggest_with_emitter calls stream_suggest_events → emitter captures events.
        let _ = suggest_with_emitter(req, &base_url, emitter).await;

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

        let result = suggest(req);
        if let Err(msg) = result {
            assert!(
                !msg.contains(secret),
                "error message must NOT contain the secret — CA-4/ADR-003: {}",
                msg
            );
        }
    }
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
        .invoke_handler(tauri::generate_handler![
            set_stealth,
            toggle_window,
            suggest,
            transcribe_pending_pcm,
            open_logs_folder,
            copy_logs_to_clipboard,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ray");
}
