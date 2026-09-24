//! Permissões de SO (TCC) no macOS — status e solicitação (RF-103).
//!
//! - Microfone:    AVCaptureDevice.authorizationStatus/requestAccess (AVFoundation)
//! - Fala:         SFSpeechRecognizer.requestAuthorization (Speech)
//! - Tela:         CGPreflightScreenCaptureAccess / CGRequestScreenCaptureAccess
//! - Acessibilidade: AXIsProcessTrusted (ApplicationServices)
//!
//! As chaves NS*UsageDescription vivem em core/Info.plist (mescladas pelo
//! bundler) — sem elas o macOS aborta o processo na chamada das APIs.

use std::sync::mpsc;
use std::time::Duration;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct PermissionMap {
    pub microphone: String,
    pub speechRecognition: String,
    pub screenRecording: String,
    pub accessibility: String,
}

/// Status canônicos: "granted" | "notGranted" | "denied" (vocabulário do
/// contrato da UI — OnboardingPermissionState). "restricted" colapsa em
/// "denied" (a recuperação é a mesma: Ajustes do Sistema).
const GRANTED: &str = "granted";
const NOT_GRANTED: &str = "notGranted";
const DENIED: &str = "denied";

// Força o load dos frameworks para que as classes Objective-C resolvam.
#[link(name = "AVFoundation", kind = "framework")]
extern "C" {}
#[link(name = "CoreMedia", kind = "framework")]
extern "C" {}
#[link(name = "Speech", kind = "framework")]
extern "C" {}
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {}
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {}

extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
    fn AXIsProcessTrusted() -> bool;
}

#[cfg(target_os = "macos")]
mod mac {
    use super::{Duration, mpsc};
    use block2::RcBlock;
    use objc2::runtime::AnyClass;

    pub(crate) fn class_or_none(name: &str) -> Option<&'static AnyClass> {
        let c = std::ffi::CString::new(name).ok()?;
        AnyClass::get(c.as_c_str())
    }

    /// Status de autorização AVFoundation: 0 notDetermined / 1 restricted /
    /// 2 denied / 3 authorized.
    pub(crate) unsafe fn av_authorization_status(media_type: &str) -> Option<i64> {
        let cls = class_or_none("AVCaptureDevice")?;
        let ns_str = objc2_foundation::NSString::from_str(media_type);
        let status: i64 = objc2::msg_send![cls, authorizationStatusForMediaType: &*ns_str];
        Some(status)
    }

    /// requestAccessForMediaType:completionHandler: — bloqueia via channel
    /// até o usuário responder a dialog do TCC (timeout no chamador).
    pub(crate) unsafe fn av_request_access(media_type: &str) -> Option<bool> {
        let cls = class_or_none("AVCaptureDevice")?;
        let ns_str = objc2_foundation::NSString::from_str(media_type);
        let (tx, rx) = mpsc::channel::<bool>();
        let block = RcBlock::new(move |granted: objc2::runtime::Bool| {
            let _ = tx.send(granted.as_bool());
        });
        let _: () = objc2::msg_send![cls, requestAccessForMediaType: &*ns_str, completionHandler: &*block];
        rx.recv_timeout(Duration::from_secs(30)).ok()
    }

    /// SFSpeechRecognizer.requestAuthorization — 0 notDetermined / 1 denied /
    /// 2 restricted / 3 authorized.
    pub(crate) unsafe fn speech_authorization_status() -> Option<i64> {
        let cls = class_or_none("SFSpeechRecognizer")?;
        let status: i64 = objc2::msg_send![cls, authorizationStatus];
        Some(status)
    }

    /// macOS 15+/26: prompts do TCC para apps em BACKGROUND são suprimidos —
    /// o diálogo não aparece, o pedido não cria entrada em Privacidade e o
    /// app nunca fica "habilitável". O Ray é app Accessory (LSUIElement),
    /// então ativamos o app (trazê-lo à frente) antes de pedir. `open` no
    /// bundle ativa a instância em execução sem relançar.
    pub(crate) fn activate_for_prompt() {
        let Ok(exe) = std::env::current_exe() else {
            return;
        };
        // .../Ray.app/Contents/MacOS/ray-core → nth(3) = Ray.app (só se for
        // mesmo um bundle .app; em binário desempacotado, não faz nada).
        let Some(bundle) = exe.ancestors().nth(3) else {
            return;
        };
        if bundle.extension().is_none_or(|e| e != "app") {
            return;
        }
        let _ = std::process::Command::new("open").arg(bundle).spawn();
        // Tempo para o AppKit ativar a janela antes do request anexar.
        std::thread::sleep(std::time::Duration::from_millis(600));
    }

    pub(crate) unsafe fn speech_request_authorization() -> Option<bool> {
        // O Speech lê a usage description do BUNDLE principal — a seção
        // __TEXT,__info_plist embutida pelo build.rs NÃO basta (macOS 26:
        // TCC aborta o processo mesmo com ela, ver crash reports TCC/
        // NSSpeechRecognitionUsageDescription). Em binário desempacotado
        // (cargo tauri dev), recusar com log em vez de derrubar o app:
        // para testar permissões em dev, use core/scripts/dev-app.sh.
        let bundled = std::env::current_exe()
            .map(|exe| exe.to_string_lossy().contains(".app/Contents/MacOS/"))
            .unwrap_or(false);
        if !bundled {
            eprintln!(
                "[ray] permissão de fala: binário desempacotado — o macOS aborta \
                 o processo neste request (a usage description só é lida de um \
                 bundle). Rode via core/scripts/dev-app.sh ou use o app empacotado."
            );
            return None;
        }
        let cls = class_or_none("SFSpeechRecognizer")?;
        let (tx, rx) = mpsc::channel::<i64>();
        let block = RcBlock::new(move |status: i64| {
            let _ = tx.send(status);
        });
        let _: () = objc2::msg_send![cls, requestAuthorization: &*block];
        rx.recv_timeout(Duration::from_secs(30)).ok().map(|s| s == 3)
    }
}

fn av_status_to_str(status: Option<i64>) -> String {
    match status {
        Some(3) => GRANTED.into(),
        Some(2) => DENIED.into(),
        Some(1) => DENIED.into(),
        Some(0) => NOT_GRANTED.into(),
        _ => NOT_GRANTED.into(),
    }
}

/// Fluxo completo de request de permissões: vira app REGULAR (com Dock)
/// durante os pedidos — o macOS 15+/26 AUTO-NEGA o prompt de microfone de
/// apps Accessory/background (mic vira "denied" sem diálogo e sem entrada
/// em Privacidade) — ativa a janela, pede e volta a Accessory no fim.
#[cfg(target_os = "macos")]
fn request_with_prompts(app: &tauri::AppHandle, kinds: &[String]) {
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    mac::activate_for_prompt();
    for kind in kinds {
        match kind.as_str() {
            "microphone" => {
                let r = unsafe { mac::av_request_access("soun") };
                eprintln!("[ray] permissão microfone: request → {r:?}");
            }
            "speechRecognition" => {
                let r = unsafe { mac::speech_request_authorization() };
                eprintln!("[ray] permissão fala: request → {r:?}");
            }
            "screenRecording" => {
                let r = unsafe { CGRequestScreenCaptureAccess() };
                eprintln!("[ray] permissão tela: request → {r}");
            }
            other => eprintln!("[ray] permissão desconhecida: {other}"),
        }
    }
    // Deixa o usuário ver o resultado do último diálogo antes de sumir com
    // o ícone do Dock.
    std::thread::sleep(std::time::Duration::from_millis(800));
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
}

/// Lê o status atual de todas as permissões (sem dialog).
#[tauri::command]
pub fn get_permission_status() -> PermissionMap {
    #[cfg(target_os = "macos")]
    {
        let mic = unsafe { mac::av_authorization_status("soun") };
        let speech = unsafe { mac::speech_authorization_status() };
        let screen = unsafe { CGPreflightScreenCaptureAccess() };
        let ax = unsafe { AXIsProcessTrusted() };
        PermissionMap {
            microphone: av_status_to_str(mic),
            speechRecognition: av_status_to_str(speech),
            screenRecording: if screen { GRANTED.into() } else { NOT_GRANTED.into() },
            accessibility: if ax { GRANTED.into() } else { NOT_GRANTED.into() },
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        PermissionMap {
            microphone: GRANTED.into(),
            speechRecognition: GRANTED.into(),
            screenRecording: GRANTED.into(),
            accessibility: GRANTED.into(),
        }
    }
}

/// Solicita UMA permissão (dispara a dialog do TCC quando aplicável).
/// `kind`: "microphone" | "speechRecognition" | "screenRecording" |
/// "accessibility". Acessibilidade e tela-negada não têm dialog de API —
/// abrem os Ajustes do Sistema; o status final depende da ação do usuário.
#[tauri::command]
pub fn request_permission(app: tauri::AppHandle, kind: String) -> PermissionMap {
    #[cfg(target_os = "macos")]
    request_with_prompts(&app, std::slice::from_ref(&kind));
    #[cfg(not(target_os = "macos"))]
    let _ = (app, kind);
    get_permission_status()
}

/// Pede várias permissões em sequência (uso interno e botão "Habilitar tudo").
#[cfg(target_os = "macos")]
pub fn request_permissions(
    app: tauri::AppHandle,
    kinds: Vec<&str>,
) -> PermissionMap {
    let kinds: Vec<String> = kinds.into_iter().map(String::from).collect();
    request_with_prompts(&app, &kinds);
    get_permission_status()
}

/// Solicita todas as permissões em sequência (botão "Habilitar tudo").
#[tauri::command]
pub fn request_all_permissions(app: tauri::AppHandle) -> PermissionMap {
    #[cfg(target_os = "macos")]
    request_with_prompts(
        &app,
        &[
            "microphone".to_string(),
            "speechRecognition".to_string(),
            "screenRecording".to_string(),
        ],
    );
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    get_permission_status()
}

/// Abre o painel de Privacidade correspondente nos Ajustes do Sistema.
/// Usado quando a permissão foi negada (a dialog não reaparece).
#[tauri::command]
pub fn open_permission_settings(kind: String) -> Result<(), String> {
    let pane = match kind.as_str() {
        "microphone" => "com.apple.preference.security?Privacy_Microphone",
        "speechRecognition" => "com.apple.preference.security?Privacy_SpeechRecognition",
        "screenRecording" => "com.apple.preference.security?Privacy_ScreenCapture",
        "accessibility" => "com.apple.preference.security?Privacy_Accessibility",
        other => return Err(format!("permissao desconhecida: {other}")),
    };
    std::process::Command::new("open")
        .arg(format!("x-apple.systempreferences:{pane}"))
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
