//! Supervisão do sidecar Node (ADR-001) e cliente IPC loopback (ADR-005).
//! O Rust inicia o sidecar, lê a porta efêmera do stdout, monitora o ciclo de
//! vida e o reinicia em falha. TASK: implementar spawn + parsing + healthcheck.

use std::process::Stdio;
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::time::{sleep, Duration};

#[derive(Debug, Error)]
pub enum SidecarError {
    #[error("failed to spawn sidecar: {0}")]
    Spawn(String),
    #[error("sidecar not ready")]
    NotReady,
    #[error("ipc error: {0}")]
    Ipc(String),
}

/// Handle para o processo sidecar e sua porta loopback.
pub struct Sidecar {
    pub port: u16,
}

/// Parses a `RAY_SIDECAR_PORT=<n>` line emitted by the sidecar at boot.
/// Returns the port number, or `None` if the line is absent or malformed.
pub(crate) fn parse_port_line(line: &str) -> Option<u16> {
    line.strip_prefix("RAY_SIDECAR_PORT=")?
        .trim()
        .parse::<u16>()
        .ok()
}

/// Sidecar binary name. Overridable via `RAY_SIDECAR_BIN` for tests.
fn sidecar_binary() -> String {
    std::env::var("RAY_SIDECAR_BIN").unwrap_or_else(|_| "ray-sidecar".into())
}

/// Reads stdout lines until `RAY_SIDECAR_PORT=<n>` is found (ADR-005).
async fn read_sidecar_port<R: tokio::io::AsyncRead + Unpin>(
    reader: R,
) -> Result<u16, SidecarError> {
    let mut lines = BufReader::new(reader).lines();
    loop {
        let line = lines
            .next_line()
            .await
            .map_err(|e| SidecarError::Spawn(e.to_string()))?
            .ok_or_else(|| {
                SidecarError::Spawn("stdout closed before RAY_SIDECAR_PORT".into())
            })?;
        if let Some(port) = parse_port_line(&line) {
            return Ok(port);
        }
    }
}

/// Spawns the sidecar binary and resolves its ephemeral port.
async fn spawn_child() -> Result<(u16, Child), SidecarError> {
    let mut child = Command::new(sidecar_binary())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| SidecarError::Spawn(e.to_string()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| SidecarError::Spawn("stdout unavailable".into()))?;
    let port = read_sidecar_port(stdout).await?;
    Ok((port, child))
}

/// Supervision loop (ADR-001 / RNF-302): owns the child, waits for exit,
/// and respawns with a 1-second backoff — never blocks the UI windows.
async fn supervise(mut child: Child) {
    const BACKOFF: Duration = Duration::from_secs(1);
    loop {
        let _ = child.wait().await;
        sleep(BACKOFF).await;
        match spawn_child().await {
            Ok((_port, new_child)) => child = new_child,
            Err(_) => sleep(BACKOFF).await,
        }
    }
}

impl Sidecar {
    /// Inicia o sidecar via externalBin, lê a porta efêmera do stdout e
    /// lança a tarefa de supervisão em background (ADR-001/005).
    pub async fn start() -> Result<Self, SidecarError> {
        let (port, child) = spawn_child().await?;
        tokio::spawn(supervise(child));
        Ok(Sidecar { port })
    }

    /// Base URL do sidecar em loopback (ADR-005).
    pub fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    /// Healthcheck: GET /health, verifica status 2xx.
    pub async fn health(&self) -> Result<(), SidecarError> {
        let url = format!("{}/health", self.base_url());
        let resp = reqwest::get(&url)
            .await
            .map_err(|e| SidecarError::Ipc(e.to_string()))?;
        if resp.status().is_success() {
            Ok(())
        } else {
            Err(SidecarError::Ipc(format!(
                "health check failed with status {}",
                resp.status()
            )))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── (a) Parsing ───────────────────────────────────────────────────────

    #[test]
    fn parse_valid_port() {
        assert_eq!(parse_port_line("RAY_SIDECAR_PORT=8080"), Some(8080));
    }

    #[test]
    fn parse_port_with_trailing_whitespace() {
        assert_eq!(parse_port_line("RAY_SIDECAR_PORT=3000  "), Some(3000));
    }

    #[test]
    fn parse_port_boundary_zero() {
        assert_eq!(parse_port_line("RAY_SIDECAR_PORT=0"), Some(0));
    }

    #[test]
    fn parse_port_boundary_max() {
        assert_eq!(parse_port_line("RAY_SIDECAR_PORT=65535"), Some(65535));
    }

    #[test]
    fn parse_not_a_number() {
        assert_eq!(parse_port_line("RAY_SIDECAR_PORT=abc"), None);
    }

    #[test]
    fn parse_empty_value() {
        assert_eq!(parse_port_line("RAY_SIDECAR_PORT="), None);
    }

    #[test]
    fn parse_wrong_prefix() {
        assert_eq!(parse_port_line("PORT=8080"), None);
    }

    #[test]
    fn parse_empty_string() {
        assert_eq!(parse_port_line(""), None);
    }

    #[test]
    fn parse_overflow_u16() {
        assert_eq!(parse_port_line("RAY_SIDECAR_PORT=70000"), None);
    }

    #[test]
    fn parse_negative_number() {
        assert_eq!(parse_port_line("RAY_SIDECAR_PORT=-1"), None);
    }

    #[test]
    fn parse_extra_text_after_port() {
        assert_eq!(parse_port_line("RAY_SIDECAR_PORT=8080 extra"), None);
    }

    #[test]
    fn parse_prefix_only() {
        assert_eq!(parse_port_line("RAY_SIDECAR_PORT="), None);
    }

    // ── (b) base_url ──────────────────────────────────────────────────────

    #[test]
    fn base_url_contains_loopback_and_port() {
        let s = Sidecar { port: 9999 };
        assert_eq!(s.base_url(), "http://127.0.0.1:9999");
    }

    // ── (c) Health ────────────────────────────────────────────────────────

    #[tokio::test]
    async fn health_ok_when_server_returns_200() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            use std::io::{Read, Write};
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0u8; 1024];
            let _ = stream.read(&mut buf);
            let body = r#"{"status":"ok"}"#;
            let _ = stream.write_all(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                )
                .as_bytes(),
            );
        });
        assert!(Sidecar { port }.health().await.is_ok());
    }

    #[tokio::test]
    async fn health_err_when_server_returns_500() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            use std::io::{Read, Write};
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0u8; 1024];
            let _ = stream.read(&mut buf);
            let _ = stream.write_all(
                b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            );
        });
        assert!(Sidecar { port }.health().await.is_err());
    }

    #[tokio::test]
    async fn health_err_when_no_server() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        assert!(Sidecar { port }.health().await.is_err());
    }

    // ── (d) read_sidecar_port ─────────────────────────────────────────────

    #[tokio::test]
    async fn read_port_from_stdout_with_preamble() {
        let data = b"starting...\nRAY_SIDECAR_PORT=4242\nready\n";
        let port = read_sidecar_port(&data[..]).await.unwrap();
        assert_eq!(port, 4242);
    }

    #[tokio::test]
    async fn read_port_err_on_eof_without_port_line() {
        let data = b"no port here\n";
        let result = read_sidecar_port(&data[..]).await;
        assert!(result.is_err());
    }
}
