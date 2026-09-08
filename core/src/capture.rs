//! Captura de tela (RF-332 "Capturar Tela" / SCREEN_CAPTURE).
//!
//! Usa o binário do sistema `screencapture` (sem FFI). A permissão de
//! Screen Recording é do app bundle (TCC) — pré-checada com
//! CGPreflightScreenCaptureAccess via permissions::get_permission_status.
//! As janelas do Ray são capture-excluded (stealth, ADR-008): a captura pega
//! a tela do usuário sem o próprio Ray aparecer — comportamento desejado.
//!
//! Armazenamento (memória x disco): a imagem vive EM DISCO em
//! `<app_data>/captures/capture-<ts>.jpg` (mantidas as 5 mais recentes). O
//! data URL base64 existe só TRANSITORIAMENTE — construído no ato do uso
//! (request ao provedor) e descartado depois. A UI nunca acumula base64:
//! recebe o caminho no evento `ray:screen-captured` e lê a imagem sob
//! demanda via `latest_capture`.

use base64::Engine as _;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Quantas capturas manter em disco (as mais recentes; as antigas são podadas).
const MAX_STORED_CAPTURES: usize = 5;

/// Pasta de capturas persistidas: `<app_data>/captures` (criada se faltar).
pub fn captures_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("captures");
    std::fs::create_dir_all(&dir).map_err(|e| format!("criar captures/: {e}"))?;
    Ok(dir)
}

/// Captura o display principal, reduz a JPEG 1280 e persiste em
/// `dir/capture-<ts>.jpg`. Retorna (caminho no disco, data URL para uso
/// imediato). O redimensionamento é o mesmo de antes: captura crua num
/// display retina/5K é um PNG de vários MB — inviável no corpo do request.
/// Se o `sips` falhar, o PNG original é movido para a pasta (melhor pesado
/// do que sem captura).
pub fn capture_to(dir: &Path) -> Result<(PathBuf, String), String> {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);

    let raw = std::env::temp_dir().join(format!("ray-capture-{ts}.png"));
    let raw_path = raw.to_string_lossy().into_owned();

    let status = std::process::Command::new("/usr/sbin/screencapture")
        .args(["-x", "-D", "1", &raw_path]) // -x silencioso; -D 1 display principal
        .status()
        .map_err(|e| format!("screencapture indisponivel: {e}"))?;
    if !status.success() {
        return Err(format!("screencapture falhou com status {status}"));
    }

    // Destino persistente: JPEG reduzido; fallback PNG original movido.
    let target = dir.join(format!("capture-{ts}.jpg"));
    let target_path = target.to_string_lossy().into_owned();
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
            &target_path,
        ])
        .status();
    let (final_path, mime) = match resized {
        Ok(s) if s.success() => {
            let _ = std::fs::remove_file(&raw);
            (target, "image/jpeg")
        }
        _ => {
            let _ = std::fs::rename(&raw, &target);
            (target, "image/png")
        }
    };

    prune_old_captures(dir);

    let bytes = std::fs::read(&final_path).map_err(|e| format!("falha ler captura: {e}"))?;
    if bytes.is_empty() {
        return Err("captura vazia (permissao de Screen Recording negada?)".into());
    }
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok((final_path, format!("data:{mime};base64,{b64}")))
}

/// Mantém só as MAX_STORED_CAPTURES mais recentes na pasta.
fn prune_old_captures(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("capture-"))
        })
        .collect();
    files.sort();
    while files.len() > MAX_STORED_CAPTURES {
        let oldest = files.remove(0);
        let _ = std::fs::remove_file(oldest);
    }
}

/// A captura mais recente em disco como data URL — o arquivo só é lido
/// (e o base64 só existe em memória) quando alguém pede.
#[tauri::command]
pub fn latest_capture(app: tauri::AppHandle) -> Result<String, String> {
    let dir = captures_dir(&app)?;
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Err("nenhuma captura armazenada".into());
    };
    let newest = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("capture-"))
        })
        .max()
        .ok_or_else(|| "nenhuma captura armazenada".to_string())?;
    let bytes = std::fs::read(&newest).map_err(|e| format!("falha ler captura: {e}"))?;
    if bytes.is_empty() {
        return Err("captura vazia".into());
    }
    let mime = if newest.extension().is_some_and(|e| e == "png") {
        "image/png"
    } else {
        "image/jpeg"
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

/// Captura e devolve o data URL para uso imediato (request ao provedor).
/// O arquivo persistido é efeito colateral — a fonte de verdade em disco.
#[tauri::command]
pub fn capture_screen(app: tauri::AppHandle) -> Result<String, String> {
    let dir = captures_dir(&app)?;
    Ok(capture_to(&dir)?.1)
}
