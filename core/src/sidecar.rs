//! Supervisão do sidecar Node (ADR-001) e cliente IPC loopback (ADR-005).
//! O Rust inicia o sidecar, lê a porta efêmera do stdout, monitora o ciclo de
//! vida e o reinicia em falha. TASK: implementar spawn + parsing + healthcheck.

use thiserror::Error;

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

impl Sidecar {
    /// Inicia o sidecar via Tauri sidecar (externalBin) e resolve a porta.
    /// TASK: usar tauri_plugin_shell::process::Command::sidecar("ray-sidecar"),
    /// capturar stdout, ler a linha `RAY_SIDECAR_PORT=<n>` e preencher `port`.
    pub async fn start() -> Result<Self, SidecarError> {
        Err(SidecarError::Spawn("not_implemented".into()))
    }

    /// Base URL do sidecar em loopback.
    pub fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    /// Healthcheck (GET /health). TASK: reqwest GET e checar status ok.
    pub async fn health(&self) -> Result<(), SidecarError> {
        Err(SidecarError::NotReady)
    }
}
