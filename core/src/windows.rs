//! Controles de janela e modo stealth (ADR-008). Exclusao de captura por
//! plataforma, always-on-top, opacidade e reposicionamento do overlay.
//! TASK: implementar cada controle com a API nativa correspondente.

use std::collections::HashMap;
#[cfg(test)]
use std::cell::RefCell;
use std::sync::{Mutex, OnceLock};

#[cfg(not(test))]
use tauri::{Emitter, Manager};

// ── Global AppHandle — used by dispatch_* to resolve labels to Windows ──

/// Global Tauri AppHandle, initialized once during app startup.
/// Required by dispatch_* functions to resolve window labels to real
/// `tauri::Window` objects in production builds.
static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

/// Initializes the global AppHandle. Must be called once from `run()`
/// before any dispatch_* function is invoked.
pub fn init_app_handle(handle: tauri::AppHandle) {
    let _ = APP_HANDLE.set(handle);
}

// ── Platform-specific FFI helpers ────────────────────────────────────────

/// Applies capture exclusion to a real window using platform-native APIs.
/// macOS: NSWindow.sharingType = NSWindowSharingNone (via objc2-app-kit).
/// Windows: SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE).
/// Linux: no native API — caller should signal the limitation.
fn apply_capture_exclusion_platform(window: &tauri::WebviewWindow, excluded: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSView, NSWindowSharingType};
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};

        let handle = window
            .window_handle()
            .map_err(|e| format!("window_handle: {e}"))?;
        let ns_view_ptr = match handle.as_raw() {
            RawWindowHandle::AppKit(appkit) => appkit.ns_view.as_ptr() as *const NSView,
            _ => return Err("not an AppKit window".into()),
        };
        // SAFETY: Tauri guarantees ns_view points to a valid NSView installed
        // in a window. The reference borrows the view for the scope of this call.
        let ns_view = unsafe { &*ns_view_ptr };
        let ns_window = ns_view
            .window()
            .ok_or("ns_view has no parent window")?;
        let sharing = if excluded {
            NSWindowSharingType::None
        } else {
            NSWindowSharingType::ReadOnly
        };
        ns_window.setSharingType(sharing);
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        use windows_sys::Win32::Graphics::Gdi::{
            SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
        };

        let handle = window
            .window_handle()
            .map_err(|e| format!("window_handle: {e}"))?;
        let hwnd = match handle.as_raw() {
            RawWindowHandle::Win32(h) => h.hwnd.as_ptr() as isize,
            _ => return Err("not a Win32 window".into()),
        };
        let affinity = if excluded {
            WDA_EXCLUDEFROMCAPTURE
        } else {
            WDA_NONE
        };
        // SAFETY: hwnd is from Tauri and points to a valid HWND.
        let result = unsafe { SetWindowDisplayAffinity(hwnd, affinity) };
        if result == 0 {
            return Err("SetWindowDisplayAffinity failed".into());
        }
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        // Linux: no native capture exclusion API per ADR-008.
        // Caller is responsible for signaling the limitation to the user.
        let _ = (window, excluded);
        return Err("capture exclusion not supported on Linux".into());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = (window, excluded);
        Err("capture exclusion not supported on this platform".into())
    }
}

/// Applies opacity to a real window using platform-native APIs.
/// macOS: NSWindow.setAlphaValue via objc2-app-kit.
/// Windows: SetLayeredWindowAttributes with LWA_ALPHA.
fn apply_opacity_platform(window: &tauri::WebviewWindow, opacity: f64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::NSView;
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};

        let handle = window
            .window_handle()
            .map_err(|e| format!("window_handle: {e}"))?;
        let ns_view_ptr = match handle.as_raw() {
            RawWindowHandle::AppKit(appkit) => appkit.ns_view.as_ptr() as *const NSView,
            _ => return Err("not an AppKit window".into()),
        };
        // SAFETY: Tauri guarantees ns_view points to a valid NSView installed
        // in a window. The reference borrows the view for the scope of this call.
        let ns_view = unsafe { &*ns_view_ptr };
        let ns_window = ns_view
            .window()
            .ok_or("ns_view has no parent window")?;
        ns_window.setAlphaValue(opacity);
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        use windows_sys::Win32::Graphics::Gdi::{SetLayeredWindowAttributes, LWA_ALPHA};
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetWindowLongW, SetWindowLongW, GWL_EXSTYLE, WS_EX_LAYERED,
        };

        let handle = window
            .window_handle()
            .map_err(|e| format!("window_handle: {e}"))?;
        let hwnd = match handle.as_raw() {
            RawWindowHandle::Win32(h) => h.hwnd.as_ptr() as isize,
            _ => return Err("not a Win32 window".into()),
        };
        let alpha = (opacity * 255.0).round() as u8;
        // SAFETY: hwnd is from Tauri and points to a valid HWND.
        unsafe {
            let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
            SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style | WS_EX_LAYERED as i32);
            let result = SetLayeredWindowAttributes(hwnd, 0, alpha, LWA_ALPHA);
            if result == 0 {
                return Err("SetLayeredWindowAttributes failed".into());
            }
        }
        return Ok(());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (window, opacity);
        Err("opacity not supported on this platform".into())
    }
}

// ── Native operations seam ──────────────────────────────────────────────
//
// GREEN will implement this trait with real platform FFI (macOS NSWindow,
// Windows user32.dll). Tests inject a mock to verify the correct native
// call is made (or skipped) without needing a real window.

/// Interface for native window operations. GREEN provides the real
/// platform implementation; tests inject `MockNativeOps`.
#[cfg(test)]
pub(crate) trait NativeOps: Send {
    fn apply_capture_exclusion(&self, window_label: &str, excluded: bool) -> Result<(), String>;
    fn apply_always_on_top(&self, window_label: &str, on: bool) -> Result<(), String>;
    fn apply_visibility(&self, window_label: &str, visible: bool) -> Result<(), String>;
    fn apply_opacity(&self, window_label: &str, opacity: f64) -> Result<(), String>;
}

/// Recorded call for test assertions.
#[cfg(test)]
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum NativeOpsCall {
    CaptureExclusion {
        window_label: String,
        excluded: bool,
    },
    AlwaysOnTop {
        window_label: String,
        on: bool,
    },
    Visibility {
        window_label: String,
        visible: bool,
    },
    Opacity {
        window_label: String,
        opacity: f64,
    },
}

/// Shared call log — mock holds one Arc, test holds another.
#[cfg(test)]
pub(crate) type CallLog = std::sync::Arc<Mutex<Vec<NativeOpsCall>>>;

/// Thread-safe mock that records every call into a shared CallLog.
#[cfg(test)]
pub(crate) struct MockNativeOps {
    calls: CallLog,
}

#[cfg(test)]
impl MockNativeOps {
    /// Returns (mock, call_log). Install mock in NATIVE_OPS_MOCK; read
    /// calls from the log after invoking the function under test.
    pub(crate) fn new() -> (Self, CallLog) {
        let log = std::sync::Arc::new(Mutex::new(Vec::new()));
        (Self { calls: log.clone() }, log)
    }

    fn record(&self, call: NativeOpsCall) {
        self.calls
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(call);
    }
}

// Per-thread mock slot. Tests install a MockNativeOps here; GREEN impl
// calls through it (or through a production NativeOps).
// In RED, this is None — stubs don't call through it.
// Thread-local prevents cross-test contamination when one test panics.
#[cfg(test)]
thread_local! {
    static NATIVE_OPS_MOCK: RefCell<Option<Box<dyn NativeOps>>> = RefCell::new(None);
}

#[cfg(test)]
impl NativeOps for MockNativeOps {
    fn apply_capture_exclusion(
        &self,
        window_label: &str,
        excluded: bool,
    ) -> Result<(), String> {
        self.record(NativeOpsCall::CaptureExclusion {
            window_label: window_label.to_string(),
            excluded,
        });
        Ok(())
    }

    fn apply_always_on_top(&self, window_label: &str, on: bool) -> Result<(), String> {
        self.record(NativeOpsCall::AlwaysOnTop {
            window_label: window_label.to_string(),
            on,
        });
        Ok(())
    }

    fn apply_visibility(&self, window_label: &str, visible: bool) -> Result<(), String> {
        self.record(NativeOpsCall::Visibility {
            window_label: window_label.to_string(),
            visible,
        });
        Ok(())
    }

    fn apply_opacity(&self, window_label: &str, opacity: f64) -> Result<(), String> {
        self.record(NativeOpsCall::Opacity {
            window_label: window_label.to_string(),
            opacity,
        });
        Ok(())
    }
}

// ── Window state registry (global, cross-thread) ────────────────────────

/// Estado observavel de uma janela. Atualizado pelas funcoes de controle;
/// consultado em testes para verificar conformidade com RF-501..RF-507.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct WindowState {
    pub(crate) visible: bool,
    pub(crate) always_on_top: bool,
    pub(crate) opacity: f64,
    pub(crate) capture_excluded: bool,
}

/// Global registry — visible from all threads. Mutex held briefly per op.
static WINDOW_REGISTRY: Mutex<Option<HashMap<String, WindowState>>> = Mutex::new(None);

// Override de suporte a captura para testes: -1 = auto, 0 = forcar nao-suportado,
// 1 = forcar suportado. Thread-local para evitar race conditions entre testes
// paralelos (cada teste tem seu proprio override).
#[cfg(test)]
thread_local! {
    static PLATFORM_CAPTURE_SUPPORT_OVERRIDE: std::cell::Cell<i8> = const { std::cell::Cell::new(-1) };
}

// Flag: a exclusao de captura nao e suportada nesta plataforma/compositor.
// ADR-008: "degradar graciosamente e sinalizar limitacao ao usuario quando
// indisponivel — nunca no-op silencioso." Thread-local para evitar race
// conditions entre testes paralelos.
#[cfg(test)]
thread_local! {
    static STEALTH_UNSUPPORTED_SIGNALED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Inicializa o registro global (idempotente).
/// Recupera de lock envenenado em vez de panic (general.md).
pub(crate) fn init_registry() {
    let mut guard = WINDOW_REGISTRY.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_none() {
        *guard = Some(HashMap::new());
    }
}

/// Consulta o estado de uma janela registrada.
/// Recupera de lock envenenado em vez de panic (general.md).
pub(crate) fn get_window_state(label: &str) -> Option<WindowState> {
    let guard = WINDOW_REGISTRY.lock().unwrap_or_else(|e| e.into_inner());
    guard
        .as_ref()
        .and_then(|map| map.get(label).cloned())
}

/// Atualiza o estado de uma janela (ou insere se nao existia).
/// Recupera de lock envenenado em vez de panic (general.md).
pub(crate) fn set_window_state(label: &str, state: WindowState) {
    let mut guard = WINDOW_REGISTRY.lock().unwrap_or_else(|e| e.into_inner());
    let map = guard.get_or_insert_with(HashMap::new);
    map.insert(label.to_string(), state);
}

/// Consulta se a plataforma suporta exclusao de captura nativamente.
/// Em testes, `force_platform_capture_support` sobrescreve o resultado.
/// GREEN: adicionar #[cfg(target_os)] branches para deteccao real.
pub(crate) fn platform_supports_capture_exclusion() -> bool {
    #[cfg(test)]
    {
        PLATFORM_CAPTURE_SUPPORT_OVERRIDE.with(|c| match c.get() {
            0 => false,
            1 => true,
            _ => cfg!(any(target_os = "macos", target_os = "windows")),
        })
    }
    #[cfg(not(test))]
    {
        cfg!(any(target_os = "macos", target_os = "windows"))
    }
}

// ── Opacity clamping (RF-506) ────────────────────────────────────────────

/// Clampa opacidade para o intervalo valido 0.0..=1.0.
/// RF-506: valores ajustaveis em tempo real, 0.0..=1.0.
pub(crate) fn clamp_opacity(opacity: f64) -> f64 {
    opacity.clamp(0.0, 1.0)
}

// ── Linux stealth limitation signaling (ADR-008) ──────────────────────────

/// Consulta se a limitacao de stealth foi sinalizada como nao suportada.
/// Usado em testes para verificar conformidade com ADR-008.
pub(crate) fn stealth_unsupported_signaled() -> bool {
    #[cfg(test)]
    {
        STEALTH_UNSUPPORTED_SIGNALED.with(|c| c.get())
    }
    #[cfg(not(test))]
    {
        false
    }
}

/// Sinaliza que a exclusao de captura nao e suportada.
/// Em producao, emite um evento Tauri para notificar a UI (ADR-008).
fn signal_stealth_unsupported() {
    #[cfg(test)]
    {
        STEALTH_UNSUPPORTED_SIGNALED.with(|c| c.set(true));
    }
    #[cfg(not(test))]
    {
        if let Some(handle) = APP_HANDLE.get() {
            // Emit to all windows; UI can listen for this event and show a
            // non-intrusive notification that stealth capture exclusion is
            // unavailable on this platform/compositor.
            let _ = handle.emit("stealth-unsupported", ());
        }
    }
}

// ── Displacement calculation (RF-507) ─────────────────────────────────────

/// Direcao do reposicionamento do overlay.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Direction {
    Left,
    Right,
    Up,
    Down,
}

/// Modo de deslocamento (RF-507).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DisplacementMode {
    /// Um toque — passo discreto pequeno.
    Discrete,
    /// Tecla segurada — movimento continuo com multiplicador.
    Continuous,
}

/// Calcula o deslocamento (dx, dy) para reposicionamento do overlay.
/// - `step`: pixels por toque discreto (ex.: 10)
/// - `hold_multiplier`: multiplicador quando segurado (ex.: 5.0 → 50px/tick)
///
/// RF-507: "deslocar overlay esquerda/direita/cima/baixo (toque = discreto;
/// segurar = continuo)."
pub(crate) fn calculate_overlay_displacement(
    direction: Direction,
    step: i32,
    mode: DisplacementMode,
    hold_multiplier: f64,
) -> (i32, i32) {
    let effective_step = match mode {
        DisplacementMode::Discrete => step,
        DisplacementMode::Continuous => (step as f64 * hold_multiplier).round() as i32,
    };
    match direction {
        Direction::Left => (-effective_step, 0),
        Direction::Right => (effective_step, 0),
        Direction::Up => (0, -effective_step),
        Direction::Down => (0, effective_step),
    }
}

// ── Registry helpers ───────────────────────────────────────────────────────

/// Estado padrao de uma janela recem-criada.
fn default_window_state() -> WindowState {
    WindowState {
        visible: true,
        always_on_top: false,
        opacity: 1.0,
        capture_excluded: false,
    }
}

/// Le, modifica e persiste o estado de uma janela numa unica aquisicao de lock.
/// Garante atomicidade mesmo com testes paralelos.
/// Recupera de lock envenenado em vez de panic (general.md).
fn update_window<F>(label: &str, f: F)
where
    F: FnOnce(&mut WindowState),
{
    let mut guard = WINDOW_REGISTRY.lock().unwrap_or_else(|e| e.into_inner());
    let map = guard.get_or_insert_with(HashMap::new);
    let state = map
        .entry(label.to_string())
        .or_insert_with(default_window_state);
    f(state);
}

// ── Native ops dispatch (test seam vs production) ─────────────────────────

/// Calls native capture exclusion through the test mock if installed,
/// otherwise resolves the label to a real Tauri Window and calls the
/// platform-native FFI (macOS NSWindow / Windows SetWindowDisplayAffinity).
fn dispatch_capture_exclusion(window_label: &str, excluded: bool) {
    #[cfg(test)]
    {
        NATIVE_OPS_MOCK.with(|cell| {
            if let Some(ref ops) = *cell.borrow() {
                let _ = ops.apply_capture_exclusion(window_label, excluded);
            }
        });
    }
    #[cfg(not(test))]
    {
        if let Some(handle) = APP_HANDLE.get() {
            if let Some(window) = handle.get_webview_window(window_label) {
                let _ = apply_capture_exclusion_platform(&window, excluded);
            }
        }
    }
}

/// Calls native always-on-top through the test mock if installed,
/// otherwise resolves the label and calls Tauri's set_always_on_top.
fn dispatch_always_on_top(window_label: &str, on: bool) {
    #[cfg(test)]
    {
        NATIVE_OPS_MOCK.with(|cell| {
            if let Some(ref ops) = *cell.borrow() {
                let _ = ops.apply_always_on_top(window_label, on);
            }
        });
    }
    #[cfg(not(test))]
    {
        if let Some(handle) = APP_HANDLE.get() {
            if let Some(window) = handle.get_webview_window(window_label) {
                let _ = window.set_always_on_top(on);
            }
        }
    }
}

/// Calls native visibility through the test mock if installed,
/// otherwise resolves the label and calls Tauri's show/hide.
fn dispatch_visibility(window_label: &str, visible: bool) {
    #[cfg(test)]
    {
        NATIVE_OPS_MOCK.with(|cell| {
            if let Some(ref ops) = *cell.borrow() {
                let _ = ops.apply_visibility(window_label, visible);
            }
        });
    }
    #[cfg(not(test))]
    {
        if let Some(handle) = APP_HANDLE.get() {
            if let Some(window) = handle.get_webview_window(window_label) {
                let result = if visible {
                    window.show()
                } else {
                    window.hide()
                };
                let _ = result;
            }
        }
    }
}

/// Calls native opacity through the test mock if installed,
/// otherwise resolves the label and calls the platform-native FFI.
fn dispatch_opacity(window_label: &str, opacity: f64) {
    #[cfg(test)]
    {
        NATIVE_OPS_MOCK.with(|cell| {
            if let Some(ref ops) = *cell.borrow() {
                let _ = ops.apply_opacity(window_label, opacity);
            }
        });
    }
    #[cfg(not(test))]
    {
        if let Some(handle) = APP_HANDLE.get() {
            if let Some(window) = handle.get_webview_window(window_label) {
                let _ = apply_opacity_platform(&window, opacity);
            }
        }
    }
}

// ── Window control functions ───────────────────────────────────────────────

/// Janelas que participam do modo stealth (ADR-008). Fonte única usada pelo
/// setup (todas nascem capture-excluded) e pelo comando `set_stealth` (o
/// toggle da AppBar aplica o modo em TODAS — modo é global; alternar só uma
/// janela deixava as demais invisíveis à captura mesmo com o stealth
/// "desligado", que era exatamente o bug reportado).
pub const STEALTH_WINDOWS: [&str; 4] = ["appbar", "main", "notch", "overlay"];

/// Ativa/desativa a exclusao de captura (stealth) numa janela.
/// Windows: SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE).
/// macOS: NSWindow sharingType = .none.
/// Linux: depende do compositor; degradar graciosamente.
pub fn set_capture_excluded(window_label: &str, excluded: bool) {
    if !platform_supports_capture_exclusion() {
        signal_stealth_unsupported();
    } else {
        dispatch_capture_exclusion(window_label, excluded);
    }
    update_window(window_label, |state| {
        state.capture_excluded = excluded;
    });
}

/// Alterna always-on-top.
pub fn set_always_on_top(window_label: &str, on: bool) {
    dispatch_always_on_top(window_label, on);
    update_window(window_label, |state| {
        state.always_on_top = on;
    });
}

/// Define opacidade (0.0..=1.0) das superficies de overlay.
pub fn set_opacity(window_label: &str, opacity: f64) {
    let clamped = clamp_opacity(opacity);
    dispatch_opacity(window_label, clamped);
    update_window(window_label, |state| {
        state.opacity = clamped;
    });
}

/// Oculta/mostra a janela inteira ("panic hide", RF-504).
pub fn toggle_visibility(window_label: &str) {
    let mut new_visible = true;
    update_window(window_label, |state| {
        state.visible = !state.visible;
        new_visible = state.visible;
    });
    dispatch_visibility(window_label, new_visible);
}

// ── Platform-specific FFI for native window operations ────────────────────
//
// TODO (GREEN): Add platform-specific FFI modules:
// - macOS: Objective-C runtime calls (set_sharing_type, set_alpha_value)
// - Windows: user32.dll calls (SetWindowDisplayAffinity, SetLayeredWindowAttributes)
// - Linux: no native capture exclusion; degrade gracefully

// ── Apply to real Tauri windows ────────────────────────────────────────────
//
// These functions operate on real Tauri Window objects via native platform
// APIs. They can be called directly from #[tauri::command] handlers that
// have access to a Window reference.

/// Aplica exclusao de captura a uma janela Tauri real via API nativa.
/// macOS: NSWindow.sharingType = NSWindowSharingNone.
/// Windows: SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE).
/// Linux: returns Err (no native API; signal via signal_stealth_unsupported).
pub fn apply_capture_exclusion(window: &tauri::WebviewWindow, excluded: bool) -> Result<(), String> {
    apply_capture_exclusion_platform(window, excluded)
}

/// Aplica always-on-top via Tauri WebviewWindow.
pub fn apply_always_on_top(window: &tauri::WebviewWindow, on: bool) -> Result<(), String> {
    window
        .set_always_on_top(on)
        .map_err(|e| format!("set_always_on_top: {e}"))
}

/// Aplica visibilidade via Tauri WebviewWindow.
pub fn apply_visibility(window: &tauri::WebviewWindow, visible: bool) -> Result<(), String> {
    if visible {
        window.show().map_err(|e| format!("show: {e}"))
    } else {
        window.hide().map_err(|e| format!("hide: {e}"))
    }
}

/// Aplica opacidade via API nativa da plataforma.
/// macOS: NSWindow.setAlphaValue.
/// Windows: SetLayeredWindowAttributes(LWA_ALPHA).
pub fn apply_opacity(window: &tauri::WebviewWindow, opacity: f64) -> Result<(), String> {
    apply_opacity_platform(window, opacity)
}

/// Habilita arrastar a janela clicando em qualquer area nao-interativa (macOS only).
///
/// Janelas sem decoracoes (decorations:false) nao sao moviveis por padrao no macOS
/// porque nao possuem barra de titulo. Definir isMovableByWindowBackground=true
/// delega o drag ao macOS de forma sincrona (sem IPC JS→Rust), tornando-o confiavel.
///
/// No-op em outras plataformas (nao compilado).
pub fn enable_movable_by_background(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::NSView;
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};

        let Ok(handle) = window.window_handle() else { return };
        let RawWindowHandle::AppKit(appkit) = handle.as_raw() else { return };
        let ns_view_ptr = appkit.ns_view.as_ptr() as *const NSView;
        // SAFETY: Tauri garante que ns_view aponta para um NSView valido instalado
        // em uma janela. A referencia dura apenas o escopo desta chamada.
        let ns_view = unsafe { &*ns_view_ptr };
        let Some(ns_window) = ns_view.window() else { return };
        ns_window.setMovableByWindowBackground(true);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    // ── Test helpers ─────────────────────────────────────────────────────

    /// Reseta todos os estados globais para isolamento entre testes.
    /// Usa unwrap_or_else para recuperar de locks envenenados (um teste
    /// que panica nao deve derrubar os testes seguintes).
    fn reset_all_state() {
        {
            let mut guard = WINDOW_REGISTRY.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(map) = guard.as_mut() {
                // Remove only the "overlay" entry (used by most tests) instead
                // of clearing the entire map. Cross-thread tests spawn threads
                // that mutate "overlay"; a full clear would race against them.
                map.remove("overlay");
            }
        }
        STEALTH_UNSUPPORTED_SIGNALED.with(|c| c.set(false));
        PLATFORM_CAPTURE_SUPPORT_OVERRIDE.with(|c| c.set(-1));
    }

    /// Forca `platform_supports_capture_exclusion()` a retornar `supported`.
    fn force_platform_capture_support(supported: bool) {
        PLATFORM_CAPTURE_SUPPORT_OVERRIDE.with(|c| c.set(if supported { 1 } else { 0 }));
    }

    /// Installs a MockNativeOps in the thread-local slot; returns the shared
    /// call log. After calling the function under test, assert on the log.
    fn install_mock_native_ops() -> CallLog {
        let (mock, log) = MockNativeOps::new();
        NATIVE_OPS_MOCK.with(|cell| {
            *cell.borrow_mut() = Some(Box::new(mock));
        });
        log
    }

    // ── (a) Opacity clamping — pure logic, no window needed (RF-506) ─────

    #[test]
    fn clamp_opacity_rejects_below_zero() {
        assert_eq!(
            clamp_opacity(-0.1),
            0.0,
            "opacity below 0.0 must be clamped to 0.0"
        );
    }

    #[test]
    fn clamp_opacity_clamps_deep_negative() {
        assert_eq!(
            clamp_opacity(-100.0),
            0.0,
            "deep negative must clamp to 0.0"
        );
    }

    #[test]
    fn clamp_opacity_rejects_above_one() {
        assert_eq!(
            clamp_opacity(1.5),
            1.0,
            "opacity above 1.0 must be clamped to 1.0"
        );
    }

    #[test]
    fn clamp_opacity_clamps_deep_positive() {
        assert_eq!(
            clamp_opacity(100.0),
            1.0,
            "deep positive must clamp to 1.0"
        );
    }

    // Boundary values — valid, should pass through unchanged.
    // These pass against both stub and correct implementation.
    // They discriminate: if GREEN accidentally clamps valid values, they fail.

    #[test]
    fn clamp_opacity_accepts_zero() {
        assert_eq!(clamp_opacity(0.0), 0.0, "0.0 is valid boundary");
    }

    #[test]
    fn clamp_opacity_accepts_one() {
        assert_eq!(clamp_opacity(1.0), 1.0, "1.0 is valid boundary");
    }

    #[test]
    fn clamp_opacity_accepts_mid_range() {
        assert_eq!(clamp_opacity(0.5), 0.5, "0.5 is valid mid-range");
    }

    // ── (b) toggle_visibility — RF-504 "panic hide" ─────────────────────

    /// First toggle on a new window: must hide it (initial visible=true → false).
    #[test]
    fn toggle_visibility_hides_on_first_toggle() {
        reset_all_state();
        toggle_visibility("overlay");
        let state = get_window_state("overlay");
        assert!(
            state.is_some(),
            "toggle_visibility must register the window (RF-504)"
        );
        assert!(
            !state.unwrap().visible,
            "first toggle must hide the window (visible true→false)"
        );
    }

    /// Two toggles: hide then show.
    #[test]
    fn toggle_visibility_shows_on_second_toggle() {
        reset_all_state();
        toggle_visibility("overlay");
        toggle_visibility("overlay");
        let state = get_window_state("overlay");
        assert!(
            state.is_some(),
            "toggle_visibility must register the window (RF-504)"
        );
        assert!(
            state.unwrap().visible,
            "second toggle must show the window (visible false→true)"
        );
    }

    // ── (c) set_always_on_top — RF-505 ──────────────────────────────────

    #[test]
    fn set_always_on_top_enables() {
        reset_all_state();
        set_always_on_top("overlay", true);
        let state = get_window_state("overlay");
        assert!(
            state.is_some(),
            "set_always_on_top must register the window (RF-505)"
        );
        assert!(
            state.unwrap().always_on_top,
            "set_always_on_top(_, true) must set always_on_top=true"
        );
    }

    #[test]
    fn set_always_on_top_disables() {
        reset_all_state();
        set_always_on_top("overlay", true);
        set_always_on_top("overlay", false);
        let state = get_window_state("overlay");
        assert!(
            state.is_some(),
            "set_always_on_top must register the window (RF-505)"
        );
        assert!(
            !state.unwrap().always_on_top,
            "set_always_on_top(_, false) must set always_on_top=false"
        );
    }

    // ── (d) set_opacity — RF-506 — must call clamp_opacity ──────────────

    #[test]
    fn set_opacity_clamps_out_of_range() {
        reset_all_state();
        set_opacity("overlay", 1.5);
        let state = get_window_state("overlay");
        assert!(
            state.is_some(),
            "set_opacity must register the window (RF-506)"
        );
        assert_eq!(
            state.unwrap().opacity,
            1.0,
            "set_opacity(1.5) must clamp to 1.0 via clamp_opacity (RF-506)"
        );
    }

    #[test]
    fn set_opacity_stores_valid_value() {
        reset_all_state();
        set_opacity("overlay", 0.7);
        let state = get_window_state("overlay");
        assert!(
            state.is_some(),
            "set_opacity must register the window (RF-506)"
        );
        assert_eq!(
            state.unwrap().opacity,
            0.7,
            "set_opacity(0.7) must store 0.7 unchanged (valid range)"
        );
    }

    /// Negative opacity must be clamped to 0.0 (RF-506: 0.0..=1.0).
    #[test]
    fn set_opacity_clamps_negative_to_zero() {
        reset_all_state();
        set_opacity("overlay", -0.5);
        let state = get_window_state("overlay");
        assert!(
            state.is_some(),
            "set_opacity must register the window (RF-506)"
        );
        assert_eq!(
            state.unwrap().opacity,
            0.0,
            "set_opacity(-0.5) must clamp to 0.0 via clamp_opacity (RF-506)"
        );
    }

    // ── (e) set_capture_excluded — RF-501 / ADR-008 — platform signaling ─

    /// On an unsupported platform, set_capture_excluded must signal the
    /// limitation (ADR-008: "nunca no-op silencioso").
    #[test]
    fn set_capture_excluded_signals_on_unsupported_platform() {
        reset_all_state();
        force_platform_capture_support(false);
        set_capture_excluded("overlay", true);
        assert!(
            stealth_unsupported_signaled(),
            "unsupported platform MUST signal stealth limitation (ADR-008)"
        );
        let state = get_window_state("overlay");
        assert!(
            state.is_some(),
            "set_capture_excluded must register the window (RF-501)"
        );
        assert!(
            state.unwrap().capture_excluded,
            "set_capture_excluded(_, true) must set capture_excluded=true"
        );
    }

    /// On a supported platform (macOS/Windows), set_capture_excluded must
    /// NOT signal limitation — stealth works natively.
    #[test]
    fn set_capture_excluded_no_signal_on_supported_platform() {
        reset_all_state();
        force_platform_capture_support(true);
        set_capture_excluded("overlay", true);
        assert!(
            !stealth_unsupported_signaled(),
            "supported platform must NOT signal limitation"
        );
        let state = get_window_state("overlay");
        assert!(
            state.is_some(),
            "set_capture_excluded must register the window (RF-501)"
        );
        assert!(
            state.unwrap().capture_excluded,
            "set_capture_excluded(_, true) must set capture_excluded=true"
        );
    }

    /// Disabling capture exclusion on an unsupported platform must still
    /// signal (the platform limitation exists regardless of the flag).
    #[test]
    fn set_capture_excluded_signals_even_when_disabling_on_unsupported() {
        reset_all_state();
        force_platform_capture_support(false);
        set_capture_excluded("overlay", false);
        assert!(
            stealth_unsupported_signaled(),
            "unsupported platform must signal even when disabling (ADR-008)"
        );
        let state = get_window_state("overlay");
        assert!(
            state.is_some(),
            "set_capture_excluded must register the window (RF-501)"
        );
        assert!(
            !state.unwrap().capture_excluded,
            "set_capture_excluded(_, false) must set capture_excluded=false"
        );
    }

    /// Disabling capture exclusion on a supported platform: no signal,
    /// state updated.
    #[test]
    fn set_capture_excluded_disable_on_supported() {
        reset_all_state();
        force_platform_capture_support(true);
        set_capture_excluded("overlay", false);
        assert!(
            !stealth_unsupported_signaled(),
            "supported platform: no signal when disabling"
        );
        let state = get_window_state("overlay");
        assert!(
            state.is_some(),
            "set_capture_excluded must register the window (RF-501)"
        );
        assert!(
            !state.unwrap().capture_excluded,
            "set_capture_excluded(_, false) must set capture_excluded=false"
        );
    }

    // ── (f) Displacement calculation — pure logic (RF-507) ──────────────

    #[test]
    fn discrete_right_moves_positive_x() {
        let (dx, dy) = calculate_overlay_displacement(
            Direction::Right,
            10,
            DisplacementMode::Discrete,
            1.0,
        );
        assert_eq!(dx, 10, "right: x must increase by step");
        assert_eq!(dy, 0, "right: y must not change");
    }

    #[test]
    fn discrete_left_moves_negative_x() {
        let (dx, dy) = calculate_overlay_displacement(
            Direction::Left,
            10,
            DisplacementMode::Discrete,
            1.0,
        );
        assert_eq!(dx, -10, "left: x must decrease by step");
        assert_eq!(dy, 0, "left: y must not change");
    }

    #[test]
    fn discrete_up_moves_negative_y() {
        let (dx, dy) = calculate_overlay_displacement(
            Direction::Up,
            10,
            DisplacementMode::Discrete,
            1.0,
        );
        assert_eq!(dx, 0, "up: x must not change");
        assert_eq!(dy, -10, "up: y must decrease by step");
    }

    #[test]
    fn discrete_down_moves_positive_y() {
        let (dx, dy) = calculate_overlay_displacement(
            Direction::Down,
            10,
            DisplacementMode::Discrete,
            1.0,
        );
        assert_eq!(dx, 0, "down: x must not change");
        assert_eq!(dy, 10, "down: y must increase by step");
    }

    #[test]
    fn continuous_hold_multiplies_step() {
        let (dx, dy) = calculate_overlay_displacement(
            Direction::Right,
            10,
            DisplacementMode::Continuous,
            5.0,
        );
        assert_eq!(dx, 50, "continuous: step * hold_multiplier = 10 * 5.0");
        assert_eq!(dy, 0, "continuous right: y must not change");
    }

    #[test]
    fn continuous_hold_left() {
        let (dx, dy) = calculate_overlay_displacement(
            Direction::Left,
            10,
            DisplacementMode::Continuous,
            3.0,
        );
        assert_eq!(dx, -30, "continuous left: -(step * multiplier) = -30");
        assert_eq!(dy, 0, "continuous left: y must not change");
    }

    #[test]
    fn continuous_hold_up() {
        let (dx, dy) = calculate_overlay_displacement(
            Direction::Up,
            8,
            DisplacementMode::Continuous,
            4.0,
        );
        assert_eq!(dx, 0, "continuous up: x must not change");
        assert_eq!(dy, -32, "continuous up: -(step * multiplier) = -32");
    }

    #[test]
    fn continuous_hold_down() {
        let (dx, dy) = calculate_overlay_displacement(
            Direction::Down,
            8,
            DisplacementMode::Continuous,
            4.0,
        );
        assert_eq!(dx, 0, "continuous down: x must not change");
        assert_eq!(dy, 32, "continuous down: step * multiplier = 32");
    }

    /// Edge case: zero step produces no movement in any direction.
    #[test]
    fn zero_step_produces_no_movement() {
        for dir in [
            Direction::Left,
            Direction::Right,
            Direction::Up,
            Direction::Down,
        ] {
            let (dx, dy) =
                calculate_overlay_displacement(dir, 0, DisplacementMode::Discrete, 1.0);
            assert_eq!(
                (dx, dy),
                (0, 0),
                "zero step must produce no movement for {dir:?}"
            );
        }
    }

    /// Continuous with hold_multiplier=1.0 should equal discrete step.
    #[test]
    fn continuous_with_multiplier_one_equals_discrete() {
        let (dx_d, dy_d) = calculate_overlay_displacement(
            Direction::Right,
            10,
            DisplacementMode::Discrete,
            1.0,
        );
        let (dx_c, dy_c) = calculate_overlay_displacement(
            Direction::Right,
            10,
            DisplacementMode::Continuous,
            1.0,
        );
        assert_eq!(dx_d, dx_c, "multiplier 1.0: continuous == discrete x");
        assert_eq!(dy_d, dy_c, "multiplier 1.0: continuous == discrete y");
    }

    // ── (g) Baseline invariants ─────────────────────────────────────────

    /// Flag starts as false before any call — baseline invariant.
    #[test]
    fn stealth_flag_initially_false() {
        reset_all_state();
        assert!(
            !stealth_unsupported_signaled(),
            "flag must be false before any call"
        );
    }

    /// Registry starts empty — baseline invariant.
    #[test]
    fn registry_starts_empty() {
        reset_all_state();
        assert!(
            get_window_state("overlay").is_none(),
            "no window state before any call"
        );
    }

    // ── (h) Native-ops seam — verify apply_* is invoked ────────────────
    //
    // These tests address the feedback: "No test drives the native capture
    // exclusion on supported platforms — the core of T-304/ADR-008. The
    // four apply_* functions have zero tests."

    /// On a supported platform, set_capture_excluded must invoke the native
    /// capture exclusion with the correct window label and flag.
    /// A GREEN that only updates the registry without calling native ops fails.
    #[test]
    fn native_ops_capture_exclusion_called_on_supported() {
        reset_all_state();
        force_platform_capture_support(true);
        let calls = install_mock_native_ops();
        set_capture_excluded("overlay", true);
        let recorded = calls.lock().unwrap();
        assert!(
            recorded.contains(&NativeOpsCall::CaptureExclusion {
                window_label: "overlay".to_string(),
                excluded: true,
            }),
            "supported platform: native capture exclusion MUST be called \
             via NativeOps seam. Recorded: {recorded:?}"
        );
    }

    /// On a supported platform, disabling must also call native ops.
    #[test]
    fn native_ops_capture_exclusion_called_when_disabling_on_supported() {
        reset_all_state();
        force_platform_capture_support(true);
        let calls = install_mock_native_ops();
        set_capture_excluded("overlay", false);
        let recorded = calls.lock().unwrap();
        assert!(
            recorded.contains(&NativeOpsCall::CaptureExclusion {
                window_label: "overlay".to_string(),
                excluded: false,
            }),
            "supported platform: native exclusion must be called even when \
             disabling. Recorded: {recorded:?}"
        );
    }

    /// On an unsupported platform, native ops must NOT be called (skip
    /// instead of crash). Assert zero calls via the seam.
    #[test]
    fn native_ops_capture_exclusion_not_called_on_unsupported() {
        reset_all_state();
        force_platform_capture_support(false);
        let calls = install_mock_native_ops();
        set_capture_excluded("overlay", true);
        let recorded = calls.lock().unwrap();
        assert!(
            recorded.is_empty(),
            "unsupported platform: native ops must NOT be called (graceful \
             degradation). Recorded: {recorded:?}"
        );
    }

    /// On unsupported, assert native ops skipped AND state still updated.
    /// A GREEN that no-ops entirely (no state update) fails.
    #[test]
    fn native_ops_capture_excluded_skipped_on_unsupported_platform() {
        reset_all_state();
        force_platform_capture_support(false);
        let calls = install_mock_native_ops();
        set_capture_excluded("overlay", true);
        let recorded = calls.lock().unwrap();
        assert!(
            recorded.is_empty(),
            "unsupported: native capture exclusion must be skipped. \
             Recorded: {recorded:?}"
        );
        drop(recorded); // release lock before next assertion
        let state = get_window_state("overlay");
        assert!(
            state.is_some() && state.unwrap().capture_excluded,
            "unsupported: state must still be updated (flag=true) even \
             when native ops are skipped"
        );
    }

    /// set_always_on_top must dispatch the AlwaysOnTop variant through the
    /// NativeOps seam. A GREEN that only updates the registry without calling
    /// native ops passes existing tests but fails this one (RF-505).
    #[test]
    fn native_ops_always_on_top_called() {
        reset_all_state();
        let calls = install_mock_native_ops();
        set_always_on_top("overlay", true);
        let recorded = calls.lock().unwrap();
        assert!(
            recorded.contains(&NativeOpsCall::AlwaysOnTop {
                window_label: "overlay".to_string(),
                on: true,
            }),
            "set_always_on_top must dispatch AlwaysOnTop via NativeOps seam. \
             Recorded: {recorded:?}"
        );
    }

    /// set_always_on_top(false) must also dispatch through the seam.
    #[test]
    fn native_ops_always_on_top_called_when_disabling() {
        reset_all_state();
        let calls = install_mock_native_ops();
        set_always_on_top("overlay", false);
        let recorded = calls.lock().unwrap();
        assert!(
            recorded.contains(&NativeOpsCall::AlwaysOnTop {
                window_label: "overlay".to_string(),
                on: false,
            }),
            "set_always_on_top(false) must dispatch AlwaysOnTop via NativeOps. \
             Recorded: {recorded:?}"
        );
    }

    /// toggle_visibility must dispatch the Visibility variant through the
    /// NativeOps seam. A GREEN that only updates the registry without calling
    /// native ops passes existing tests but fails this one (RF-504).
    #[test]
    fn native_ops_visibility_called_on_first_toggle() {
        reset_all_state();
        let calls = install_mock_native_ops();
        toggle_visibility("overlay");
        let recorded = calls.lock().unwrap();
        assert!(
            recorded.contains(&NativeOpsCall::Visibility {
                window_label: "overlay".to_string(),
                visible: false, // initial true → toggled to false
            }),
            "toggle_visibility must dispatch Visibility(visible=false) via \
             NativeOps seam. Recorded: {recorded:?}"
        );
    }

    /// Two toggles: second toggle must dispatch visible=true.
    #[test]
    fn native_ops_visibility_called_on_second_toggle() {
        reset_all_state();
        let calls = install_mock_native_ops();
        toggle_visibility("overlay");
        toggle_visibility("overlay");
        let recorded = calls.lock().unwrap();
        assert!(
            recorded.contains(&NativeOpsCall::Visibility {
                window_label: "overlay".to_string(),
                visible: true, // toggled back to true
            }),
            "second toggle must dispatch Visibility(visible=true) via \
             NativeOps seam. Recorded: {recorded:?}"
        );
    }

    /// set_opacity must dispatch the Opacity variant through the NativeOps seam
    /// with the clamped value. A GREEN that only updates the registry without
    /// calling native ops passes existing tests but fails this one (RF-506).
    #[test]
    fn native_ops_opacity_called_with_clamped_value() {
        reset_all_state();
        let calls = install_mock_native_ops();
        set_opacity("overlay", 1.5); // clamped to 1.0
        let recorded = calls.lock().unwrap();
        assert!(
            recorded.contains(&NativeOpsCall::Opacity {
                window_label: "overlay".to_string(),
                opacity: 1.0, // clamped, not raw 1.5
            }),
            "set_opacity(1.5) must dispatch Opacity(opacity=1.0) — the clamped \
             value — via NativeOps seam. Recorded: {recorded:?}"
        );
    }

    /// set_opacity with valid value must dispatch the exact value through the seam.
    #[test]
    fn native_ops_opacity_called_with_valid_value() {
        reset_all_state();
        let calls = install_mock_native_ops();
        set_opacity("overlay", 0.7);
        let recorded = calls.lock().unwrap();
        assert!(
            recorded.contains(&NativeOpsCall::Opacity {
                window_label: "overlay".to_string(),
                opacity: 0.7,
            }),
            "set_opacity(0.7) must dispatch Opacity(opacity=0.7) via NativeOps. \
             Recorded: {recorded:?}"
        );
    }

    // ── (i) Cross-thread registry — proves global, not thread_local ─────
    //
    // These tests address the feedback: "Tauri commands run on arbitrary
    // threads, so a GREEN that fills the stubs via update_window passes
    // every test but ships per-thread window state (visibility/opacity
    // toggles lost between invocations)."

    /// Toggle on spawned thread must be visible from main thread.
    /// A thread_local registry isolates threads — this test catches that.
    #[test]
    fn cross_thread_toggle_visibility_visible_from_other_thread() {
        // Use a unique label to avoid races with other parallel tests that
        // all share the "overlay" key in the global registry.
        let label = "ct_vis_visible";

        // Main thread: initial state — no window yet.
        assert!(
            get_window_state(label).is_none(),
            "precondition: no state before toggle"
        );

        // Spawn thread: toggle visibility (visible=true → false).
        let label_clone = label;
        let handle = thread::spawn(move || {
            toggle_visibility(label_clone);
        });
        handle.join().expect("thread must not panic");

        // Main thread: must see the toggled state.
        let state = get_window_state(label);
        assert!(
            state.is_some(),
            "cross-thread: toggle on spawned thread must register window \
             on main thread (global registry, not thread_local)"
        );
        assert!(
            !state.unwrap().visible,
            "cross-thread: visibility toggle (true→false) on spawned thread \
             must be visible from main thread"
        );
    }

    /// State set on main thread must survive a spawn+toggle on another thread.
    /// With thread_local: spawned toggle is isolated; main thread state is
    /// preserved. With global Mutex (GREEN): spawned toggle modifies shared
    /// state. This test forces the GREEN implementation to use a global
    /// Mutex by asserting cross-thread visibility.
    #[test]
    fn cross_thread_toggle_visibility_preserves_main_thread_state() {
        // Use a unique label to avoid races with other parallel tests that
        // all share the "overlay" key in the global registry.
        let label = "ct_vis_preserves";

        // Main thread: set always_on_top.
        set_always_on_top(label, true);
        let before = get_window_state(label).unwrap();
        assert!(before.always_on_top, "precondition");

        // Spawn thread: toggle visibility.
        let label_clone = label;
        let handle = thread::spawn(move || {
            toggle_visibility(label_clone);
        });
        handle.join().expect("thread must not panic");

        // Main thread: must see the toggle AND preserve always_on_top.
        // With thread_local, spawned toggle is invisible → after.visible
        // stays true → test FAILS (forcing global Mutex in GREEN).
        // With global Mutex, spawned toggle is visible → after.visible
        // is false → test PASSES.
        let after = get_window_state(label).unwrap();
        assert!(
            after.always_on_top,
            "cross-thread: always_on_top set on main thread must survive \
             toggle on spawned thread"
        );
        assert!(
            !after.visible,
            "cross-thread: spawned thread's toggle must be visible from \
             main thread (forces global Mutex, not thread_local)"
        );
    }
}
