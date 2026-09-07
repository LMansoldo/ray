//! Captura de tela (RF-332 "Capturar Tela" / SCREEN_CAPTURE).
//!
//! Usa o binário do sistema `screencapture` (sem FFI). A permissão de
//! Screen Recording é do app bundle (TCC) — pré-checada com
//! CGPreflightScreenCaptureAccess via permissions::get_permission_status.
//! As janelas do Ray são capture-excluded (stealth, ADR-008): a captura pega
//! a tela do usuário sem o próprio Ray aparecer — comportamento desejado.

use base64::Engine as _;

/// Captura o display principal e retorna a imagem em base64 (data URL pronto
/// para <img src> e para o campo screenshots do SuggestRequest).
///
/// A captura crua do `screencapture` num display retina/5K é um PNG de
/// vários MB — inflado ~33% pelo base64 no corpo do request (latência, custo
/// de tokens e falhas 4xx do provedor). Reduzimos ao mínimo que um modelo
/// multimodal lê bem: JPEG com borda maior em 1280px (dezenas de KB) via
/// `sips` (binário nativo do macOS, sem dependência nova). Se o sips falhar,
/// segue o PNG original — melhor pesado do que sem imagem.
#[tauri::command]
pub fn capture_screen() -> Result<String, String> {
    let id = std::process::id();
    let tmp = std::env::temp_dir();
    let raw = tmp.join(format!("ray-capture-{id}.png"));
    let raw_path = raw.to_string_lossy().into_owned();
    let small = tmp.join(format!("ray-capture-{id}.jpg"));
    let small_path = small.to_string_lossy().into_owned();

    let status = std::process::Command::new("/usr/sbin/screencapture")
        .args(["-x", "-D", "1", &raw_path]) // -x silencioso; -D 1 display principal
        .status()
        .map_err(|e| format!("screencapture indisponivel: {e}"))?;
    if !status.success() {
        return Err(format!("screencapture falhou com status {status}"));
    }

    let resized = std::process::Command::new("/usr/bin/sips")
        .args([
            "-Z",
            "1280",
            "-s",
            "format",
            "jpeg",
            "-s",
            "formatOptions",
            "60",
            &raw_path,
            "--out",
            &small_path,
        ])
        .status();
    let (final_path, mime) = match resized {
        Ok(s) if s.success() => {
            let _ = std::fs::remove_file(&raw);
            (small_path, "image/jpeg")
        }
        _ => (raw_path, "image/png"), // sips falhou: PNG original
    };

    let bytes = std::fs::read(&final_path).map_err(|e| format!("falha ao ler captura: {e}"))?;
    let _ = std::fs::remove_file(&final_path);

    if bytes.is_empty() {
        return Err("captura vazia (permissao de Screen Recording negada?)".into());
    }

    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}
