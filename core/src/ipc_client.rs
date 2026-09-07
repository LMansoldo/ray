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

    // 4xx e 5xx são falhas com retorno visível: o chamador converte o Err em
    // evento de erro para o Overlay não ficar mudo (ex.: provedor rejeitando
    // screenshot). Corpo truncado — só diagnóstico.
    let status = response.status();
    if status.is_client_error() || status.is_server_error() {
        let body = response.text().await.unwrap_or_default();
        let snippet: String = body.chars().take(300).collect();
        return Err(IpcClientError::Http(format!(
            "sidecar returned {status}: {snippet}"
        )));
    }

    Ok(())
}

/// Abstração de emissão de eventos para permitir testes sem AppHandle do Tauri.
/// A implementação real em lib.rs usa `app.emit()`; testes usam ChannelEmitter.
pub trait SuggestEventEmitter: Send + 'static {
    fn emit_event(&self, event: crate::ipc::SuggestStreamEvent);
}

/// Consome a resposta SSE de POST /copilot/suggest e emite cada SuggestStreamEvent
/// via `emitter` assim que parseado. Não bufferiza — token a token (RNF-102).
///
/// Sequência garantida pelo sidecar (T-102): start → token* → done/error.
/// ADR-005: transporte via SSE/chunked sobre loopback; Rust é o único cliente.
pub async fn stream_suggest_events<E: SuggestEventEmitter>(
    base_url: &str,
    mut req: SuggestRequest,
    resolve: fn(&str) -> Result<String, String>,
    emitter: E,
) -> Result<(), IpcClientError> {
    // 1. Resolver o segredo a partir do secret_ref e injetar no corpo
    //    (mesmo contrato do POST não-streaming — ADR-005).
    let secret = resolve(&req.credential.secret).map_err(IpcClientError::Credential)?;
    req.credential.secret = secret;

    // 2. POST ao sidecar com resposta SSE chunked.
    let url = format!("{}/copilot/suggest", base_url);
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .json(&req)
        .send()
        .await
        .map_err(|e| IpcClientError::Http(e.to_string()))?;

    // 4xx e 5xx são falhas com retorno visível: o chamador converte o Err em
    // evento de erro para o Overlay não ficar mudo (ex.: provedor rejeitando
    // screenshot). Corpo truncado — só diagnóstico.
    let status = response.status();
    if status.is_client_error() || status.is_server_error() {
        let body = response.text().await.unwrap_or_default();
        let snippet: String = body.chars().take(300).collect();
        return Err(IpcClientError::Http(format!(
            "sidecar returned {status}: {snippet}"
        )));
    }

    // 3. Consome o stream: frames SSE separados por linha em branco; cada
    //    linha útil é `data: <json>` de um SuggestStreamEvent. Emitido assim
    //    que parseado — sem bufferização de eventos (RNF-102).
    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    let mut buffer: Vec<u8> = Vec::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| IpcClientError::Http(e.to_string()))?;
        buffer.extend_from_slice(&chunk);

        // Processa todos os frames completos presentes no buffer.
        while let Some((frame_len, sep_len)) = find_frame(&buffer) {
            let frame: Vec<u8> = buffer.drain(..frame_len).collect();
            buffer.drain(..sep_len);

            let text = String::from_utf8_lossy(&frame);
            for line in text.lines() {
                let Some(json) = line.strip_prefix("data: ") else {
                    continue;
                };
                let json = json.trim();
                if json.is_empty() {
                    continue;
                }
                match serde_json::from_str::<crate::ipc::SuggestStreamEvent>(json) {
                    Ok(event) => emitter.emit_event(event),
                    Err(e) => {
                        return Err(IpcClientError::Http(format!("frame SSE inválido: {e}")))
                    }
                }
            }
        }
    }

    Ok(())
}

/// Localiza o próximo frame SSE completo: retorna (tamanho do frame, tamanho
/// do separador). Frames terminam em `\n\n` ou `\r\n\r\n`.
fn find_frame(buf: &[u8]) -> Option<(usize, usize)> {
    for (i, w) in buf.windows(4).enumerate() {
        if w == b"\r\n\r\n" {
            return Some((i, 4));
        }
    }
    buf.windows(2)
        .position(|w| w == b"\n\n")
        .map(|i| (i, 2))
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

// ── Testes SSE (T-303) ─────────────────────────────────────────────────────
// Valida que stream_suggest_events:
//   (a) emite start → token* → done em ordem exata com payloads corretos
//   (b) emite Error como último evento quando SSE fecha com erro; sem Done
//   (c) não entra em panic quando Done chega sem Start (dado externo inválido)
//   (d) desserializa o wire format SSE (tag "type" + camelCase) via reqwest stream

#[cfg(test)]
mod sse_tests {
    use super::*;
    use crate::ipc::*;
    use std::io::{Read, Write};
    use std::sync::mpsc;

    // Channel-based emitter que captura eventos para asserções de teste.
    struct ChannelEmitter {
        tx: mpsc::SyncSender<SuggestStreamEvent>,
    }

    impl SuggestEventEmitter for ChannelEmitter {
        fn emit_event(&self, event: SuggestStreamEvent) {
            let _ = self.tx.send(event);
        }
    }

    fn make_channel_emitter() -> (ChannelEmitter, mpsc::Receiver<SuggestStreamEvent>) {
        let (tx, rx) = mpsc::sync_channel(64);
        (ChannelEmitter { tx }, rx)
    }

    // Async emitter — tokio unbounded channel allows non-blocking await on recv().
    // Required by sse_incremental_token_arrives_before_stream_completes which must
    // NOT block the tokio executor while waiting for events.
    struct TokioUnboundedEmitter {
        tx: tokio::sync::mpsc::UnboundedSender<SuggestStreamEvent>,
    }

    impl SuggestEventEmitter for TokioUnboundedEmitter {
        fn emit_event(&self, event: SuggestStreamEvent) {
            let _ = self.tx.send(event);
        }
    }

    fn build_sse_request() -> SuggestRequest {
        SuggestRequest {
            session_id: "sess-sse".into(),
            assistant_id: "asst-sse".into(),
            trigger: SuggestionTrigger::Auto,
            context: vec![TranscriptContextSegment {
                speaker: Speaker::Self_,
                text: "context".into(),
                start_ms: 0,
            }],
            user_prompt: None,
            screenshots: None,
            selection_text: None,
            credential: InjectedCredential {
                kind: ProviderKind::Openai,
                connection_mode: ProviderConnectionMode::ApiKey,
                secret: "placeholder".into(),
                base_url: None,
                model: None,
            },
        }
    }

    fn fake_ok_resolver(_: &str) -> Result<String, String> {
        Ok("sk-fake-sse-test".into())
    }

    /// Spawn a fake SSE HTTP server. Binds before spawning to avoid races.
    /// Sends each string in `event_jsons` as `data: {json}\n\n` with Content-Length.
    fn spawn_fake_sse_server(event_jsons: Vec<String>) -> u16 {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            // Drain the HTTP request
            let mut buf = vec![0u8; 8192];
            let _ = stream.read(&mut buf);

            let body: String = event_jsons
                .into_iter()
                .map(|json| format!("data: {}\n\n", json))
                .collect();

            let headers = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(headers.as_bytes());
            let _ = stream.write_all(body.as_bytes());
        });
        port
    }

    /// Chunked SSE server: emite `early_events` imediatamente, aguarda `delay_ms`,
    /// depois emite `late_events` e fecha o stream.
    ///
    /// `set_nodelay(true)` desativa o algoritmo de Nagle para garantir que cada
    /// chunk seja enviado ao kernel sem esperar o buffer encher. Isso permite
    /// ao cliente ler eventos incrementalmente antes do servidor enviar o restante.
    ///
    /// Uma implementação que acumula o body completo antes de parsear (buffering)
    /// só entrega eventos depois do `delay_ms` + close — falha no timeout do teste.
    fn spawn_chunked_sse_server_with_delay(
        early_events: Vec<String>,
        delay_ms: u64,
        late_events: Vec<String>,
    ) -> u16 {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            // Disable Nagle: each write_all becomes its own TCP segment.
            stream.set_nodelay(true).ok();
            // Drain the HTTP request.
            let mut buf = vec![0u8; 8192];
            let _ = stream.read(&mut buf);

            // HTTP headers — chunked encoding, no Content-Length.
            let _ = stream.write_all(
                b"HTTP/1.1 200 OK\r\n\
                  Content-Type: text/event-stream\r\n\
                  Cache-Control: no-cache\r\n\
                  Transfer-Encoding: chunked\r\n\r\n",
            );

            // Early events: flushed immediately so the client can read before delay.
            for json in &early_events {
                let sse = format!("data: {}\n\n", json);
                let chunk = format!("{:x}\r\n{}\r\n", sse.len(), sse);
                let _ = stream.write_all(chunk.as_bytes());
            }

            // Simulate latency between bursts (e.g. provider thinking time).
            std::thread::sleep(std::time::Duration::from_millis(delay_ms));

            // Late events.
            for json in &late_events {
                let sse = format!("data: {}\n\n", json);
                let chunk = format!("{:x}\r\n{}\r\n", sse.len(), sse);
                let _ = stream.write_all(chunk.as_bytes());
            }

            // HTTP/1.1 chunked terminator.
            let _ = stream.write_all(b"0\r\n\r\n");
        });
        port
    }

    // (a) Happy path: start → token → token → done — ordem exata, payloads corretos.
    // RNF-102: streaming token a token, sem bufferizar/achatar.
    // ADR-005: SSE sobre loopback, Rust é o único cliente.
    #[tokio::test]
    async fn sse_happy_path_emits_events_in_order() {
        let start_json = serde_json::to_string(&SuggestStreamEvent::Start {
            suggestion_id: "sid-001".into(),
            context_label: None,
            they_said: None,
        })
        .unwrap();
        let token1_json =
            serde_json::to_string(&SuggestStreamEvent::Token { text: "Olá".into() }).unwrap();
        let token2_json =
            serde_json::to_string(&SuggestStreamEvent::Token { text: " mundo".into() }).unwrap();
        let done_json = serde_json::to_string(&SuggestStreamEvent::Done {
            provider_kind: ProviderKind::Openai,
            model: Some("gpt-4o".into()),
        })
        .unwrap();

        let port = spawn_fake_sse_server(vec![start_json, token1_json, token2_json, done_json]);
        let base_url = format!("http://127.0.0.1:{}", port);
        let (emitter, rx) = make_channel_emitter();

        let result =
            stream_suggest_events(&base_url, build_sse_request(), fake_ok_resolver, emitter)
                .await;

        assert!(result.is_ok(), "stream must complete without error: {:?}", result);

        let events: Vec<SuggestStreamEvent> = rx.try_iter().collect();
        assert_eq!(events.len(), 4, "must receive exactly 4 events, got {}", events.len());

        match &events[0] {
            SuggestStreamEvent::Start { suggestion_id, context_label, they_said } => {
                assert_eq!(suggestion_id, "sid-001");
                assert!(context_label.is_none());
                assert!(they_said.is_none());
            }
            other => panic!("event[0] must be Start, got: {:?}", other),
        }
        match &events[1] {
            SuggestStreamEvent::Token { text } => assert_eq!(text, "Olá"),
            other => panic!("event[1] must be Token('Olá'), got: {:?}", other),
        }
        match &events[2] {
            SuggestStreamEvent::Token { text } => assert_eq!(text, " mundo"),
            other => panic!("event[2] must be Token(' mundo'), got: {:?}", other),
        }
        match &events[3] {
            SuggestStreamEvent::Done { provider_kind, model } => {
                assert!(matches!(provider_kind, ProviderKind::Openai));
                assert_eq!(model.as_deref(), Some("gpt-4o"));
            }
            other => panic!("event[3] must be Done, got: {:?}", other),
        }
    }

    // (b) Erro no meio do stream: start → token → SSE Error event.
    // O último evento emitido deve ser Error; Done NUNCA deve ser emitido.
    #[tokio::test]
    async fn sse_error_mid_stream_last_event_is_error_no_done() {
        let start_json = serde_json::to_string(&SuggestStreamEvent::Start {
            suggestion_id: "sid-002".into(),
            context_label: None,
            they_said: None,
        })
        .unwrap();
        let token_json =
            serde_json::to_string(&SuggestStreamEvent::Token { text: "parcial".into() }).unwrap();
        let error_json = serde_json::to_string(&SuggestStreamEvent::Error {
            error: IpcError {
                code: IpcErrorCode::AgentError,
                message: "provider timeout".into(),
                retryable: Some(true),
            },
        })
        .unwrap();

        let port = spawn_fake_sse_server(vec![start_json, token_json, error_json]);
        let base_url = format!("http://127.0.0.1:{}", port);
        let (emitter, rx) = make_channel_emitter();

        let _ =
            stream_suggest_events(&base_url, build_sse_request(), fake_ok_resolver, emitter).await;

        let events: Vec<SuggestStreamEvent> = rx.try_iter().collect();
        assert!(
            events.len() >= 1,
            "must receive at least one event before closing"
        );

        let last = events.last().unwrap();
        assert!(
            matches!(last, SuggestStreamEvent::Error { .. }),
            "last event must be Error, got: {:?}",
            last
        );
        assert!(
            !events.iter().any(|e| matches!(e, SuggestStreamEvent::Done { .. })),
            "Done must not be emitted after Error event"
        );
        match last {
            SuggestStreamEvent::Error { error } => {
                assert!(matches!(error.code, IpcErrorCode::AgentError));
                assert_eq!(error.message, "provider timeout");
                assert_eq!(error.retryable, Some(true));
            }
            _ => unreachable!(),
        }
    }

    // (c) Done sem Start precedente (violação de contrato do emissor SSE).
    // general.md: no .unwrap()/.expect() em dados externos — deve ser tratado, não panic.
    #[tokio::test]
    async fn sse_done_without_start_does_not_panic() {
        let done_json = serde_json::to_string(&SuggestStreamEvent::Done {
            provider_kind: ProviderKind::Anthropic,
            model: None,
        })
        .unwrap();

        let port = spawn_fake_sse_server(vec![done_json]);
        let base_url = format!("http://127.0.0.1:{}", port);
        let (emitter, rx) = make_channel_emitter();

        // Must not panic — no .unwrap()/.expect() on external data (general.md)
        let result =
            stream_suggest_events(&base_url, build_sse_request(), fake_ok_resolver, emitter)
                .await;

        match result {
            Ok(()) => {
                // If Ok, the Done event must have been emitted (valid JSON, valid SSE)
                let events: Vec<_> = rx.try_iter().collect();
                assert!(
                    !events.is_empty(),
                    "if stream completed Ok, must have emitted at least the Done event"
                );
            }
            Err(_) => {
                // Returning Err for a contract-violating stream is also acceptable
            }
        }
    }

    // (d) Wire format deserialization via reqwest stream: tipos ipc.rs <-> wire SSE.
    // Valida serde round-trip: tag "type" (snake_case) + campos camelCase, ProviderKind
    // SCREAMING_SNAKE_CASE — exatamente o formato que o sidecar (T-102) emite.
    #[tokio::test]
    async fn sse_wire_format_deserialization_matches_ipc_types() {
        let wire_events = vec![
            r#"{"type":"start","suggestionId":"sid-xyz","contextLabel":"Reunião","theySaid":"Boa tarde"}"#.to_string(),
            r#"{"type":"token","text":"Texto do token"}"#.to_string(),
            r#"{"type":"done","providerKind":"ANTHROPIC","model":"claude-3-opus-20240229"}"#.to_string(),
        ];

        let port = spawn_fake_sse_server(wire_events);
        let base_url = format!("http://127.0.0.1:{}", port);
        let (emitter, rx) = make_channel_emitter();

        let result =
            stream_suggest_events(&base_url, build_sse_request(), fake_ok_resolver, emitter)
                .await;

        assert!(result.is_ok(), "wire format must deserialize cleanly: {:?}", result);

        let events: Vec<SuggestStreamEvent> = rx.try_iter().collect();
        assert_eq!(events.len(), 3, "must emit all 3 wire events");

        match &events[0] {
            SuggestStreamEvent::Start { suggestion_id, context_label, they_said } => {
                assert_eq!(suggestion_id, "sid-xyz");
                assert_eq!(context_label.as_deref(), Some("Reunião"));
                assert_eq!(they_said.as_deref(), Some("Boa tarde"));
            }
            other => panic!("event[0]: expected Start, got {:?}", other),
        }
        match &events[1] {
            SuggestStreamEvent::Token { text } => assert_eq!(text, "Texto do token"),
            other => panic!("event[1]: expected Token, got {:?}", other),
        }
        match &events[2] {
            SuggestStreamEvent::Done { provider_kind, model } => {
                assert!(
                    matches!(provider_kind, ProviderKind::Anthropic),
                    "must be Anthropic, got {:?}",
                    provider_kind
                );
                assert_eq!(model.as_deref(), Some("claude-3-opus-20240229"));
            }
            other => panic!("event[2]: expected Done, got {:?}", other),
        }
    }

    // (e) Propriedade de streaming incremental (RNF-102) — o cliente NÃO bufferiza.
    //
    // O servidor envia start+token imediatamente via chunked encoding (sem
    // Content-Length), depois aguarda 300ms antes de enviar done+close.
    //
    // Requisito: os eventos iniciais chegam ao canal em < 150ms, ANTES do
    // servidor completar o stream.
    //
    // Uma implementação que acumula `.text().await` ou equivalente falha neste
    // teste porque só entrega eventos depois do delay de 300ms expirar.
    // Uma implementação com `bytes_stream()` + parse incremental passa.
    #[tokio::test]
    async fn sse_incremental_token_arrives_before_stream_completes() {
        let start_json = serde_json::to_string(&SuggestStreamEvent::Start {
            suggestion_id: "sid-incr".into(),
            context_label: None,
            they_said: None,
        })
        .unwrap();
        let token_json =
            serde_json::to_string(&SuggestStreamEvent::Token { text: "incremental".into() })
                .unwrap();
        let done_json = serde_json::to_string(&SuggestStreamEvent::Done {
            provider_kind: ProviderKind::Openai,
            model: None,
        })
        .unwrap();

        // Server: sends start+token immediately; 300ms later sends done+close.
        // Buffering client: receives nothing until after 300ms → recv() times out at 150ms.
        // Streaming client: receives start+token within ~1ms → passes.
        let port = spawn_chunked_sse_server_with_delay(
            vec![start_json, token_json],
            300,
            vec![done_json],
        );
        let base_url = format!("http://127.0.0.1:{}", port);

        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<SuggestStreamEvent>();
        let emitter = TokioUnboundedEmitter { tx };

        let base_url_for_task = base_url.clone();
        let stream_task = tokio::spawn(async move {
            stream_suggest_events(
                &base_url_for_task,
                build_sse_request(),
                fake_ok_resolver,
                emitter,
            )
            .await
        });

        // start must arrive well before the 300ms server delay.
        let got_start = tokio::time::timeout(
            std::time::Duration::from_millis(150),
            rx.recv(),
        )
        .await
        .expect(
            "start event must arrive within 150ms — a buffering implementation fails here \
             because it waits for the full 300ms server delay before delivering any event",
        )
        .expect("channel must be open when start arrives");

        // early token must also arrive within 150ms of the test starting.
        let got_token = tokio::time::timeout(
            std::time::Duration::from_millis(150),
            rx.recv(),
        )
        .await
        .expect(
            "Token event must arrive within 150ms — a buffering implementation fails here \
             because it only delivers events after the full response is received",
        )
        .expect("channel must be open when token arrives");

        assert!(
            matches!(got_start, SuggestStreamEvent::Start { .. }),
            "first incremental event must be Start, got: {:?}",
            got_start
        );
        assert!(
            matches!(got_token, SuggestStreamEvent::Token { .. }),
            "second incremental event must be Token, got: {:?}",
            got_token
        );

        // Allow the full stream to finish (done arrives after the 300ms delay).
        let _ = stream_task.await;
    }
}
