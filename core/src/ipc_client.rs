//! Cliente HTTP loopback do sidecar (ADR-005).
//!
//! POST tipado para endpoints de `contracts/ipc.ts` usando `base_url()` de
//! T-300. O segredo trafega APENAS no corpo (`InjectedCredential`), nunca em
//! query string (ADR-005). A resolução de credencial é injetável via
//! `fn` pointer para que testes unitários não dependam do keychain.

use crate::ipc::SuggestRequest;

/// Erros do cliente IPC.
#[derive(Debug)]
pub enum IpcClientError {
    /// Falha na resolução da credencial (vault).
    Credential(String),
    /// Falha na comunicação HTTP com o sidecar.
    Http(String),
}

/// Envia `POST /copilot/suggest` ao sidecar.
///
/// A resolução da credencial é injetável: `resolve` recebe o `secret_ref`
/// (string opaca do banco) e devolve o segredo real do cofre. Isso permite
/// que testes unitários forneçam um resolver fake sem depender do keychain
/// nativo; o teste de integração usa `vault::get_secret` diretamente.
///
/// ADR-005: o segredo trafega APENAS no corpo da requisição (`credential.secret`),
/// nunca em query string.
pub async fn post_suggest_to_sidecar(
    base_url: &str,
    mut req: SuggestRequest,
    resolve: fn(&str) -> Result<String, String>,
) -> Result<(), IpcClientError> {
    // 1. Resolver o segredo a partir do secret_ref (injetável para testes).
    let secret = resolve(&req.credential.secret)
        .map_err(IpcClientError::Credential)?;

    // 2. Injetar o segredo resolvido no campo secret do credential.
    //    O secret_ref original é substituído — o sidecar recebe o segredo
    //    real, não o ponteiro opaco.
    req.credential.secret = secret;

    // 3. POST ao sidecar via loopback. O segredo vai APENAS no corpo
    //    (InjectedCredential), nunca em query string (ADR-005).
    let url = format!("{}/copilot/suggest", base_url);
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .json(&req)
        .send()
        .await
        .map_err(|e| IpcClientError::Http(e.to_string()))?;

    if response.status().is_server_error() {
        return Err(IpcClientError::Http(format!(
            "sidecar returned {}",
            response.status()
        )));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ipc::*;
    use crate::vault;
    use std::io::Read;
    use std::sync::mpsc;

    /// Label unico por execucao para evitar colisao no keychain.
    fn unique_label(prefix: &str) -> String {
        use std::sync::atomic::{AtomicU32, Ordering};
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        format!("{}_{}_{}", prefix, std::process::id(), n)
    }

    /// Resolver real que consulta o keychain via vault.
    fn test_resolve_from_vault(secret_ref: &str) -> Result<String, String> {
        vault::get_secret(secret_ref).map_err(|e| e.to_string())
    }

    /// Resolver fake que devolve valor fixo — sem dependencia de keychain.
    fn fake_resolver_ok(_: &str) -> Result<String, String> {
        Ok("sk-fake-fixed-secret".into())
    }

    /// Resolver que simula falha do vault.
    fn fake_resolver_err(_: &str) -> Result<String, String> {
        Err("vault_locked".into())
    }

    fn build_test_request(secret_ref: &str) -> SuggestRequest {
        SuggestRequest {
            session_id: "sess-1".into(),
            assistant_id: "asst-1".into(),
            trigger: SuggestionTrigger::Auto,
            context: vec![TranscriptContextSegment {
                speaker: Speaker::Self_,
                text: "hello".into(),
                start_ms: 0,
            }],
            user_prompt: None,
            screenshots: None,
            selection_text: None,
            credential: InjectedCredential {
                kind: ProviderKind::Openai,
                connection_mode: ProviderConnectionMode::ApiKey,
                secret: secret_ref.to_string(),
                base_url: None,
                model: None,
            },
        }
    }

    /// Servidor HTTP fake em loopback que captura corpo e URL da requisicao
    /// e responde HTTP 200 (reqwest exige resposta para nao retornar erro).
    fn spawn_capture_server() -> (u16, mpsc::Receiver<String>, mpsc::Receiver<String>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let (body_tx, body_rx) = mpsc::channel();
        let (url_tx, url_rx) = mpsc::channel();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = vec![0u8; 8192];
                if let Ok(n) = stream.read(&mut buf) {
                    let raw = String::from_utf8_lossy(&buf[..n]);
                    // Captura URL da request line: "POST /path HTTP/1.1"
                    if let Some(line_end) = raw.find("\r\n") {
                        let line = &raw[..line_end];
                        if let Some(space) = line.find(' ') {
                            let after_method = &line[space + 1..];
                            if let Some(end) = after_method.find(' ') {
                                let _ = url_tx.send(after_method[..end].to_string());
                            }
                        }
                    }
                    // Captura corpo
                    if let Some(body_start) = raw.find("\r\n\r\n") {
                        let _ = body_tx.send(raw[body_start + 4..].to_string());
                    }
                }
                // Responde HTTP 200 — reqwest exige resposta completa.
                use std::io::Write;
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\n\
                      Content-Length: 0\r\n\
                      Connection: close\r\n\r\n",
                );
            }
        });
        (port, body_rx, url_rx)
    }

    // ── (a) segredo chega no corpo HTTP como credential.secret ─────────
    // ADR-005: segredo APENAS no corpo, nunca na query string.

    #[tokio::test]
    async fn secret_appears_in_request_body() {
        let (port, body_rx, _url_rx) = spawn_capture_server();
        let base_url = format!("http://127.0.0.1:{}", port);
        let req = build_test_request("placeholder");

        let result = post_suggest_to_sidecar(&base_url, req, fake_resolver_ok).await;
        assert!(result.is_ok(), "post_suggest_to_sidecar must succeed");

        let body = body_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("server did not receive request");
        let val: serde_json::Value =
            serde_json::from_str(&body).expect("body must be valid JSON");
        assert_eq!(val["credential"]["secret"], "sk-fake-fixed-secret");
        assert_eq!(val["credential"]["kind"], "OPENAI");
        assert_eq!(val["credential"]["connectionMode"], "API_KEY");
    }

    // ── (b) fluxo completo: keychain real -> injecao -> corpo HTTP ─────
    // ADR-003 passo 3 / RNF-206: core busca segredo no cofre e injeta.

    #[tokio::test]
    async fn vault_secret_injected_into_request_body() {
        let label = unique_label("inject");
        let secret_value = "sk-real-vault-secret-777";
        let secret_ref = vault::store_secret(&label, secret_value)
            .expect("store_secret should succeed on native keychain");

        let (port, body_rx, _url_rx) = spawn_capture_server();
        let base_url = format!("http://127.0.0.1:{}", port);
        let req = build_test_request(&secret_ref);

        let result = post_suggest_to_sidecar(&base_url, req, test_resolve_from_vault).await;

        // Cleanup DEPOIS — test_resolve_from_vault precisa da entrada
        // existir durante a chamada.
        let _ = vault::delete_secret(&secret_ref);

        assert!(result.is_ok(), "must succeed with real vault");

        let body = body_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("server did not receive request");
        let val: serde_json::Value =
            serde_json::from_str(&body).expect("body must be JSON");
        assert_eq!(val["credential"]["secret"], secret_value);
    }

    // ── (c) secret_ref opaco — nao contem o segredo em claro ──────────
    // ADR-003: ApiKeyRef no banco nao contem segredo.

    #[test]
    fn secret_ref_is_opaque() {
        let label = unique_label("opaque_ref");
        let secret = "super-secret-do-not-leak";
        let secret_ref = vault::store_secret(&label, secret).expect("store should succeed");
        assert!(
            !secret_ref.contains(secret),
            "secret_ref must NOT contain plaintext secret — ADR-003"
        );
        let _ = vault::delete_secret(&secret_ref);
    }

    // ── (d) erro do vault propagado como IpcClientError::Credential ────
    // core.md: Propagate with ? into Result.

    #[tokio::test]
    async fn vault_error_propagates_as_credential_error() {
        let (port, _body_rx, _url_rx) = spawn_capture_server();
        let base_url = format!("http://127.0.0.1:{}", port);
        let req = build_test_request("some_ref");

        let result = post_suggest_to_sidecar(&base_url, req, fake_resolver_err).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            IpcClientError::Credential(_) => {} // expected
            other => panic!("expected Credential error, got: {:?}", other),
        }
    }

    // ── (f) erro HTTP do sidecar propagado como IpcClientError::Http ───

    #[tokio::test]
    async fn sidecar_error_propagates_as_http_error() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            use std::io::Write;
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 1024];
                let _ = stream.read(&mut buf);
                let _ = stream.write_all(
                    b"HTTP/1.1 500 Internal Server Error\r\n\
                      Content-Length: 0\r\n\
                      Connection: close\r\n\r\n",
                );
            }
        });

        let base_url = format!("http://127.0.0.1:{}", port);
        let req = build_test_request("placeholder");

        let result = post_suggest_to_sidecar(&base_url, req, fake_resolver_ok).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            IpcClientError::Http(msg) => {
                assert!(
                    msg.contains("500"),
                    "error must mention status 500, got: {}",
                    msg
                );
            }
            other => panic!("expected Http error, got: {:?}", other),
        }
    }

    // ── (g) segredo NUNCA na URL capturada da requisicao real ──────────
    // ADR-005: segredo vai APENAS no corpo, URL fica limpa.

    const TEST_URL_SECRET: &str = "sk-must-not-appear-in-url";

    fn fake_resolver_with_test_secret(_: &str) -> Result<String, String> {
        Ok(TEST_URL_SECRET.into())
    }

    #[tokio::test]
    async fn request_url_does_not_contain_secret() {
        let (port, _body_rx, url_rx) = spawn_capture_server();
        let base_url = format!("http://127.0.0.1:{}", port);
        let req = build_test_request("placeholder");

        let result =
            post_suggest_to_sidecar(&base_url, req, fake_resolver_with_test_secret).await;
        assert!(result.is_ok(), "must succeed to check URL");

        let url = url_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("server must receive a request");
        assert!(
            !url.contains(TEST_URL_SECRET),
            "secret must not appear in request URL, got: {}",
            url
        );
        // Pin endpoint path: POST /copilot/suggest (ipc.rs:198, contracts/ipc.ts)
        assert_eq!(
            url, "/copilot/suggest",
            "must POST to /copilot/suggest, got: {}",
            url
        );
    }

    // ── (h) segredo NUNCA em mensagens de erro (CA-4 / ADR-003) ───────
    // Always-pass no RED: o stub retorna Http("not_implemented") que nao
    // contem o segredo do request. No GREEN, protege contra implementacoes
    // que formatam credential.secret na mensagem de erro.

    #[tokio::test]
    async fn error_message_never_contains_secret() {
        let secret = "sk-must-not-leak-in-errors";
        let (port, _body_rx, _url_rx) = spawn_capture_server();
        let base_url = format!("http://127.0.0.1:{}", port);
        let req = build_test_request(secret);

        // Usa resolver que falha — o caminho de erro deve propagar
        // SEM vazar o segredo que estava no request.
        let result = post_suggest_to_sidecar(&base_url, req, fake_resolver_err).await;
        match &result {
            Err(IpcClientError::Credential(msg)) => {
                assert!(
                    !msg.contains(secret),
                    "Credential error leaks secret: {}",
                    msg
                );
            }
            Err(IpcClientError::Http(msg)) => {
                assert!(
                    !msg.contains(secret),
                    "Http error leaks secret: {}",
                    msg
                );
            }
            Ok(()) => {}
        }
    }
}
