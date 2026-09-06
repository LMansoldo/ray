//! Captura de tela (RF-332 "Capturar Tela" / SCREEN_CAPTURE).
//!
//! Usa o binário do sistema `screencapture` (sem FFI). A permissão de
//! Screen Recording é do app bundle (TCC) — pré-checada com
//! CGPreflightScreenCaptureAccess via permissions::get_permission_status.
//! As janelas do Ray são capture-excluded (stealth, ADR-008): a captura pega
//! a tela do usuário sem o próprio Ray aparecer — comportamento desejado.

use base64::Engine as _;

/// Captura o display principal e retorna o PNG em base64 (data URL pronto
/// para <img src> e para o campo screenshots do SuggestRequest).
#[tauri::command]
pub fn capture_screen() -> Result<String, String> {
    let tmp = std::env::temp_dir().join(format!("ray-capture-{}.png", std::process::id()));
    let path = tmp.to_string_lossy().into_owned();

    let status = std::process::Command::new("/usr/sbin/screencapture")
        .args(["-x", "-D", "1", &path]) // -x silencioso; -D 1 display principal
        .status()
        .map_err(|e| format!("screencapture indisponivel: {e}"))?;
    if !status.success() {
        return Err(format!("screencapture falhou com status {status}"));
    }

    let bytes = std::fs::read(&path).map_err(|e| format!("falha ao ler captura: {e}"))?;
    let _ = std::fs::remove_file(&path);

    if bytes.is_empty() {
        return Err("captura vazia (permissao de Screen Recording negada?)".into());
    }

    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:image/png;base64,{b64}"))
}
