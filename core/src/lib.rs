//! Ray core — biblioteca do núcleo Tauri (ADR-001).
//! Reúne os módulos e expõe os comandos Tauri consumidos pela UI Svelte.
//! Os comandos são stubs: assinatura correta, corpo placeholder.

pub mod audio;
pub mod ipc;
pub mod sidecar;
pub mod vault;
pub mod windows;

use ipc::{SuggestRequest, SuggestStreamEvent};

// --- Comandos Tauri (fronteira UI <-> núcleo) -------------------------
// A UI Svelte invoca estes comandos. O núcleo resolve credencial no cofre,
// injeta na chamada ao sidecar e devolve à UI. TASK: preencher cada corpo.

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

/// Aciona o copiloto. O núcleo busca a credencial no cofre, injeta e faz o
/// streaming a partir do sidecar, reemitindo eventos para a UI.
/// TASK: implementar a ponte SSE(sidecar) -> evento Tauri(UI).
#[tauri::command]
fn suggest(_req: SuggestRequest) -> Result<(), String> {
    // Placeholder: a implementação emitirá SuggestStreamEvent à UI.
    let _ = SuggestStreamEvent::Token { text: String::new() };
    Err("not_implemented".into())
}

/// Ponto de entrada da aplicação Tauri.
/// TASK: registrar handlers, inicializar o sidecar (sidecar::Sidecar::start),
/// criar as janelas (app bar, home, overlay, notch) e aplicar stealth.
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            set_stealth,
            toggle_window,
            suggest
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ray");
}
