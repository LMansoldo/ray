//! Local error-only logging for Ray (T-503 / RF-1004).
//!
//! Invariant: meeting content (transcripts, suggestions) NEVER appears in log
//! output. Only structural errors and diagnostics are logged. This is enforced
//! by only calling `log::error!` for internal failures — never for content
//! that came from user audio or AI responses.

use log::LevelFilter;
use simplelog::{Config, WriteLogger};
use std::{
    fs::OpenOptions,
    path::PathBuf,
    sync::OnceLock,
};
use tauri::Manager;

static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Initialises the file logger. Must be called once before any `log::error!`
/// calls. Subsequent calls are silently ignored (OnceLock).
///
/// Creates `log_dir` if it does not exist.
/// Log level is fixed at ERROR — debug/info/warn lines are discarded.
pub fn init(log_dir: PathBuf) -> Result<(), String> {
    std::fs::create_dir_all(&log_dir).map_err(|e| format!("create log dir: {e}"))?;

    LOG_DIR.set(log_dir.clone()).ok();

    let log_file = log_dir.join("ray.log");
    let file = OpenOptions::new()
        .append(true)
        .create(true)
        .open(&log_file)
        .map_err(|e| format!("open log file: {e}"))?;

    WriteLogger::init(LevelFilter::Error, Config::default(), file)
        .map_err(|e| format!("logger init: {e}"))
}

/// Returns the directory where `ray.log` lives, if logging was initialised.
pub fn log_dir() -> Option<PathBuf> {
    LOG_DIR.get().cloned()
}

/// Resolves the log directory: uses the initialised path if available,
/// otherwise falls back to `app_log_dir` reported by Tauri.
pub fn resolve_log_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(dir) = log_dir() {
        return Ok(dir);
    }
    app.path()
        .app_log_dir()
        .map_err(|e| format!("resolve app log dir: {e}"))
}

/// Opens the log folder in the platform's file manager.
/// Uses native shell commands — no plugin dependency.
pub fn open_folder(path: &PathBuf) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("open log folder: {e}"))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("open log folder: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| format!("open log folder: {e}"))?;
    }
    Ok(())
}

/// Reads the current log file and writes its content to the system clipboard.
pub fn copy_to_clipboard(log_dir: &PathBuf) -> Result<(), String> {
    let log_file = log_dir.join("ray.log");
    let content = std::fs::read_to_string(&log_file)
        .map_err(|e| format!("read log file: {e}"))?;

    let mut clipboard = arboard::Clipboard::new()
        .map_err(|e| format!("clipboard init: {e}"))?;

    clipboard
        .set_text(content)
        .map_err(|e| format!("clipboard write: {e}"))
}
