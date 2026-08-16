//! Controles de janela e modo stealth (ADR-008). Exclusão de captura por
//! plataforma, always-on-top, opacidade e reposicionamento do overlay.
//! TASK: implementar cada controle com a API nativa correspondente.

/// Ativa/desativa a exclusão de captura (stealth) numa janela.
/// Windows: SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE).
/// macOS: NSWindow sharingType = .none.
/// Linux: depende do compositor; degradar graciosamente.
pub fn set_capture_excluded(_window_label: &str, _excluded: bool) {
    // TASK: ramificar por #[cfg(target_os = ...)] e chamar a API nativa.
}

/// Alterna always-on-top.
pub fn set_always_on_top(_window_label: &str, _on: bool) {
    // TASK: window.set_always_on_top(on)
}

/// Define opacidade (0.0..=1.0) das superfícies de overlay.
pub fn set_opacity(_window_label: &str, _opacity: f64) {
    // TASK: por plataforma; no macOS via NSWindow alphaValue, etc.
}

/// Oculta/mostra a janela inteira ("panic hide", RF-504).
pub fn toggle_visibility(_window_label: &str) {
    // TASK: window.is_visible() ? hide() : show()
}
