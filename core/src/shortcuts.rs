//! Atalhos globais (RF-600, T-305). Registro, validacao e regravacao de
//! atalhos globais do sistema. Cada atalho mapeia um nome de comando
//! (SHORTCUT_COMMANDS de contracts/settings.ts) para uma acao do nucleo.
//!
//! RF-603: atalhos operam com o app sem foco (stealth) — registrados como
//! atalhos globais do SO (no macOS, requer permissao de Acessibilidade).

use std::collections::HashMap;

// ── Tipos (espelho Rust de contracts/settings.ts) ──────────────────────

/// Modificadores de tecla suportados (contracts/settings.ts:65).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ShortcutModifier {
    Cmd,
    Ctrl,
    Alt,
    Shift,
}

/// Um atalho vinculado (contracts/settings.ts:113).
/// RF-601: toggle de ativacao + combo regravavel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShortcutBinding {
    pub enabled: bool,
    pub modifiers: Vec<ShortcutModifier>,
    pub key: String,
}

/// Comandos de atalho canonicos (contracts/settings.ts:84-104).
/// Nomes casam com SHORTCUT_COMMANDS do contrato UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ShortcutCommand {
    AskOrSend,
    CaptureScreen,
    ToggleVoiceRecording,
    ToggleMicCapture,
    /// Push-to-listen (RF-604): sem reunião, captura só enquanto pressionado;
    /// ao soltar, transcreve o trecho e dispara a análise do agente. Com
    /// reunião ativa e features.pushToListen ligado, segurar apenas libera o
    /// contexto ao agente e soltar analisa o trecho do intervalo (a escuta
    /// contínua não para). É o único comando com comportamento no keypress E
    /// no release.
    PushToListen,
    ScrollUp,
    ScrollDown,
    NotchPreviousInsight,
    NotchNextInsight,
    PreviousResponse,
    NextResponse,
    /// Rolagem do corpo do Overlay (DIGA ISSO) — a janela flutuante é quem
    /// consome o ray:shortcut correspondente.
    OverlayScrollUp,
    OverlayScrollDown,
    ToggleActionBar,
    ToggleAlwaysOnTop,
    IncreaseOpacity,
    DecreaseOpacity,
    MoveModalUp,
    MoveModalDown,
    MoveModalLeft,
    MoveModalRight,
    ToggleWindowVisibility,
}

/// Mapa completo de atalhos: um binding por comando, ou null.
pub type ShortcutMap = HashMap<ShortcutCommand, Option<ShortcutBinding>>;

// ── Constantes (contracts/settings.ts) ─────────────────────────────────

/// Teclas unicas permitidas sem modificador (contracts/settings.ts:75).
pub const ALLOWED_MODIFIERLESS_KEYS: &[&str] = &["CapsLock"];

/// Todos os 22 comandos de atalho (contracts/settings.ts).
pub const ALL_SHORTCUT_COMMANDS: &[ShortcutCommand] = &[
    ShortcutCommand::AskOrSend,
    ShortcutCommand::CaptureScreen,
    ShortcutCommand::ToggleVoiceRecording,
    ShortcutCommand::ToggleMicCapture,
    ShortcutCommand::PushToListen,
    ShortcutCommand::ScrollUp,
    ShortcutCommand::ScrollDown,
    ShortcutCommand::NotchPreviousInsight,
    ShortcutCommand::NotchNextInsight,
    ShortcutCommand::PreviousResponse,
    ShortcutCommand::NextResponse,
    ShortcutCommand::OverlayScrollUp,
    ShortcutCommand::OverlayScrollDown,
    ShortcutCommand::ToggleActionBar,
    ShortcutCommand::ToggleAlwaysOnTop,
    ShortcutCommand::IncreaseOpacity,
    ShortcutCommand::DecreaseOpacity,
    ShortcutCommand::MoveModalUp,
    ShortcutCommand::MoveModalDown,
    ShortcutCommand::MoveModalLeft,
    ShortcutCommand::MoveModalRight,
    ShortcutCommand::ToggleWindowVisibility,
];

// ── Trait de registro (fronteira FFI mockavel) ─────────────────────────

/// Trait para registro de atalhos globais no SO. A implementacao real
/// usa a API de atalhos globais do Tauri/OS; testes usam mock.
pub trait GlobalShortcutRegistrar: Send + Sync {
    /// Registra um atalho global. Retorna Ok(()) ou erro.
    fn register(&self, combo: &str, command: ShortcutCommand) -> Result<(), String>;

    /// Desregistra um atalho especifico pelo combo.
    fn unregister(&self, combo: &str) -> Result<(), String>;

    /// Desregistra todos os atalhos registrados.
    fn unregister_all(&self) -> Result<(), String>;
}

// ── Mock para testes ──────────────────────────────────────────────────

#[cfg(test)]
pub(crate) struct MockRegistrar {
    pub registered: std::sync::Mutex<Vec<(String, ShortcutCommand)>>,
    pub unregistered: std::sync::Mutex<Vec<String>>,
}

#[cfg(test)]
impl MockRegistrar {
    pub(crate) fn new() -> Self {
        Self {
            registered: std::sync::Mutex::new(Vec::new()),
            unregistered: std::sync::Mutex::new(Vec::new()),
        }
    }

    pub(crate) fn registered_combos(&self) -> Vec<(String, ShortcutCommand)> {
        self.registered.lock().unwrap().clone()
    }

    pub(crate) fn unregistered_combos(&self) -> Vec<String> {
        self.unregistered.lock().unwrap().clone()
    }
}

#[cfg(test)]
impl GlobalShortcutRegistrar for MockRegistrar {
    fn register(&self, combo: &str, command: ShortcutCommand) -> Result<(), String> {
        self.registered
            .lock()
            .unwrap()
            .push((combo.to_string(), command));
        Ok(())
    }

    fn unregister(&self, combo: &str) -> Result<(), String> {
        self.unregistered
            .lock()
            .unwrap()
            .push(combo.to_string());
        Ok(())
    }

    fn unregister_all(&self) -> Result<(), String> {
        self.registered.lock().unwrap().clear();
        Ok(())
    }
}

// ── Validacao ─────────────────────────────────────────────────────────

/// Valida um binding conforme RF-602 e CA-8.
///
/// Regras:
/// - Deve ter pelo menos um modificador (Cmd/Ctrl ou Alt), EXCETO se
///   `key` estiver em ALLOWED_MODIFIERLESS_KEYS (ex.: CapsLock).
/// - Nao deve duplicar um combo ja registrado no mapa.
pub fn validate_binding(
    binding: &ShortcutBinding,
    command: ShortcutCommand,
    current_map: &ShortcutMap,
) -> Result<(), ShortcutError> {
    // RF-602: must include Cmd/Ctrl or Alt, unless key is in ALLOWED_MODIFIERLESS_KEYS
    let has_valid_modifier = binding.modifiers.iter().any(|m| {
        matches!(
            m,
            ShortcutModifier::Cmd | ShortcutModifier::Ctrl | ShortcutModifier::Alt
        )
    });
    let is_modifierless_allowed = ALLOWED_MODIFIERLESS_KEYS.contains(&binding.key.as_str());

    if !has_valid_modifier && !is_modifierless_allowed {
        return Err(ShortcutError::MissingModifier);
    }

    // CA-8: duplicate check — same combo bound to a DIFFERENT command
    let new_combo = combo_string(binding);
    for (&other_cmd, other_binding_opt) in current_map {
        if other_cmd == command {
            continue;
        }
        if let Some(other_binding) = other_binding_opt {
            if !other_binding.enabled {
                continue;
            }
            if combo_string(other_binding) == new_combo {
                return Err(ShortcutError::DuplicateCombo);
            }
        }
    }

    Ok(())
}

/// Monta a string de combo para comparacao (ex.: "Cmd+Shift+A").
pub fn combo_string(binding: &ShortcutBinding) -> String {
    // Canonical modifier order: Cmd, Ctrl, Alt, Shift
    let order = [
        ShortcutModifier::Cmd,
        ShortcutModifier::Ctrl,
        ShortcutModifier::Alt,
        ShortcutModifier::Shift,
    ];
    let mut parts: Vec<String> = Vec::new();
    for modifier in &order {
        if binding.modifiers.contains(modifier) {
            parts.push(
                match modifier {
                    ShortcutModifier::Cmd => "Cmd",
                    ShortcutModifier::Ctrl => "Ctrl",
                    ShortcutModifier::Alt => "Alt",
                    ShortcutModifier::Shift => "Shift",
                }
                .to_string(),
            );
        }
    }
    parts.push(binding.key.clone());
    parts.join("+")
}

/// Mapeia um ShortcutCommand para a acao correspondente.
/// Cada comando dispara uma acao existente no nucleo.
pub fn command_to_action_name(command: ShortcutCommand) -> &'static str {
    match command {
        ShortcutCommand::AskOrSend => "askOrSend",
        ShortcutCommand::CaptureScreen => "captureScreen",
        ShortcutCommand::ToggleVoiceRecording => "toggleVoiceRecording",
        ShortcutCommand::ToggleMicCapture => "toggleMicCapture",
        ShortcutCommand::PushToListen => "pushToListen",
        ShortcutCommand::ScrollUp => "scrollUp",
        ShortcutCommand::ScrollDown => "scrollDown",
        ShortcutCommand::NotchPreviousInsight => "notchPreviousInsight",
        ShortcutCommand::NotchNextInsight => "notchNextInsight",
        ShortcutCommand::PreviousResponse => "previousResponse",
        ShortcutCommand::NextResponse => "nextResponse",
        ShortcutCommand::OverlayScrollUp => "overlayScrollUp",
        ShortcutCommand::OverlayScrollDown => "overlayScrollDown",
        ShortcutCommand::ToggleActionBar => "toggleActionBar",
        ShortcutCommand::ToggleAlwaysOnTop => "toggleAlwaysOnTop",
        ShortcutCommand::IncreaseOpacity => "increaseOpacity",
        ShortcutCommand::DecreaseOpacity => "decreaseOpacity",
        ShortcutCommand::MoveModalUp => "moveModalUp",
        ShortcutCommand::MoveModalDown => "moveModalDown",
        ShortcutCommand::MoveModalLeft => "moveModalLeft",
        ShortcutCommand::MoveModalRight => "moveModalRight",
        ShortcutCommand::ToggleWindowVisibility => "toggleWindowVisibility",
    }
}

/// Registra todos os bindings nao-nulos no registrar.
/// RF-602: valida cada binding antes de registrar; efeito imediato.
pub fn register_all(
    map: &ShortcutMap,
    registrar: &dyn GlobalShortcutRegistrar,
) -> Result<(), ShortcutError> {
    for (&cmd, binding_opt) in map {
        if let Some(binding) = binding_opt {
            // RF-601: skip disabled bindings
            if !binding.enabled {
                continue;
            }
            validate_binding(binding, cmd, map)?;
            let combo = combo_string(binding);
            registrar
                .register(&combo, cmd)
                .map_err(ShortcutError::RegistrationFailed)?;
        }
    }
    Ok(())
}

/// Reatribui um atalho: valida o novo binding, desregistra o antigo,
/// registra o novo e atualiza o mapa. RF-602 efeito imediato.
/// CA-8: ESC cancela (erro de validacao mantem binding anterior).
pub fn rebind(
    command: ShortcutCommand,
    new_binding: ShortcutBinding,
    map: &mut ShortcutMap,
    registrar: &dyn GlobalShortcutRegistrar,
) -> Result<(), ShortcutError> {
    // RF-602: validate new binding first (ESC cancellation — if invalid, preserve old)
    validate_binding(&new_binding, command, map)?;

    // Unregister old combo if one exists
    if let Some(old_binding) = map.get(&command) {
        if let Some(old) = old_binding {
            let old_combo = combo_string(old);
            let _ = registrar.unregister(&old_combo);
        }
    }

    // Register new combo
    let new_combo = combo_string(&new_binding);
    registrar
        .register(&new_combo, command)
        .map_err(ShortcutError::RegistrationFailed)?;

    // Update map
    map.insert(command, Some(new_binding));

    Ok(())
}

/// RF-601: Redefinir Todos para Padroes.
/// Desregistra todos, substitui o mapa pelo DEFAULT_SHORTCUTS e
/// registra os bindings padroes.
pub fn reset_to_defaults(
    map: &mut ShortcutMap,
    registrar: &dyn GlobalShortcutRegistrar,
) -> Result<(), ShortcutError> {
    // 1. Unregister all existing shortcuts
    registrar
        .unregister_all()
        .map_err(ShortcutError::RegistrationFailed)?;

    // 2. Replace map with defaults
    let defaults = build_default_shortcuts();
    map.clear();
    for (cmd, binding) in defaults {
        map.insert(cmd, binding);
    }

    // 3. Register all default bindings
    register_all(map, registrar)?;

    Ok(())
}

/// Constrói o conjunto padrao de atalhos equivalente a DEFAULT_SHORTCUTS
/// de contracts/settings.ts:133-153.
pub fn build_default_shortcuts() -> ShortcutMap {
    // All 16 enabled defaults from contracts/settings.ts:133-153
    let defaults: Vec<(ShortcutCommand, Vec<ShortcutModifier>, &str)> = vec![
        (ShortcutCommand::AskOrSend, vec![ShortcutModifier::Cmd], "Enter"),
        (ShortcutCommand::CaptureScreen, vec![ShortcutModifier::Cmd], "E"),
        (
            ShortcutCommand::ToggleVoiceRecording,
            vec![ShortcutModifier::Cmd],
            "D",
        ),
        (
            ShortcutCommand::ToggleMicCapture,
            vec![ShortcutModifier::Cmd, ShortcutModifier::Shift],
            "D",
        ),
        // Push-to-listen (RF-604): Alt+Espaço, sem conflito com os demais.
        (
            ShortcutCommand::PushToListen,
            vec![ShortcutModifier::Alt],
            "Space",
        ),
        (ShortcutCommand::ScrollUp, vec![ShortcutModifier::Cmd], "ArrowUp"),
        (
            ShortcutCommand::ScrollDown,
            vec![ShortcutModifier::Cmd],
            "ArrowDown",
        ),
        (
            ShortcutCommand::NotchPreviousInsight,
            vec![ShortcutModifier::Cmd],
            "ArrowLeft",
        ),
        (
            ShortcutCommand::NotchNextInsight,
            vec![ShortcutModifier::Cmd],
            "ArrowRight",
        ),
        (
            ShortcutCommand::PreviousResponse,
            vec![ShortcutModifier::Cmd, ShortcutModifier::Alt],
            "ArrowUp",
        ),
        (
            ShortcutCommand::NextResponse,
            vec![ShortcutModifier::Cmd, ShortcutModifier::Alt],
            "ArrowDown",
        ),
        // Rolagem do Overlay: Cmd+Alt+Shift+Setas — sem conflito com as
        // setas do notch (Cmd), das respostas (Cmd+Alt) e do modal (Cmd+Shift).
        (
            ShortcutCommand::OverlayScrollUp,
            vec![
                ShortcutModifier::Cmd,
                ShortcutModifier::Alt,
                ShortcutModifier::Shift,
            ],
            "ArrowUp",
        ),
        (
            ShortcutCommand::OverlayScrollDown,
            vec![
                ShortcutModifier::Cmd,
                ShortcutModifier::Alt,
                ShortcutModifier::Shift,
            ],
            "ArrowDown",
        ),
        (
            ShortcutCommand::ToggleActionBar,
            vec![ShortcutModifier::Cmd],
            "M",
        ),
        (
            ShortcutCommand::ToggleAlwaysOnTop,
            vec![ShortcutModifier::Cmd, ShortcutModifier::Shift],
            "A",
        ),
        (
            ShortcutCommand::IncreaseOpacity,
            vec![ShortcutModifier::Cmd, ShortcutModifier::Shift],
            "=",
        ),
        (
            ShortcutCommand::DecreaseOpacity,
            vec![ShortcutModifier::Cmd, ShortcutModifier::Shift],
            "-",
        ),
        (
            ShortcutCommand::MoveModalUp,
            vec![ShortcutModifier::Cmd, ShortcutModifier::Shift],
            "ArrowUp",
        ),
        (
            ShortcutCommand::MoveModalDown,
            vec![ShortcutModifier::Cmd, ShortcutModifier::Shift],
            "ArrowDown",
        ),
    ];

    let mut map = HashMap::new();

    // Insert enabled bindings
    for (cmd, modifiers, key) in defaults {
        map.insert(
            cmd,
            Some(ShortcutBinding {
                enabled: true,
                modifiers,
                key: key.to_string(),
            }),
        );
    }

    // Insert null bindings (no shortcut assigned)
    map.insert(ShortcutCommand::MoveModalLeft, None);
    map.insert(ShortcutCommand::MoveModalRight, None);
    map.insert(ShortcutCommand::ToggleWindowVisibility, None);

    map
}

// ── Erros ─────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum ShortcutError {
    #[error("shortcut must include a modifier (Cmd/Ctrl or Alt), except for allowed modifierless keys")]
    MissingModifier,

    #[error("duplicate shortcut combo — already bound to another command")]
    DuplicateCombo,

    #[error("shortcut registration failed: {0}")]
    RegistrationFailed(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Helpers ────────────────────────────────────────────────────────

    fn empty_map() -> ShortcutMap {
        HashMap::new()
    }

    fn binding(modifiers: Vec<ShortcutModifier>, key: &str) -> ShortcutBinding {
        ShortcutBinding {
            enabled: true,
            modifiers,
            key: key.to_string(),
        }
    }

    fn binding_disabled(modifiers: Vec<ShortcutModifier>, key: &str) -> ShortcutBinding {
        ShortcutBinding {
            enabled: false,
            modifiers,
            key: key.to_string(),
        }
    }

    /// Constroi um mapa com um binding existente para teste de duplicata.
    fn map_with(cmd: ShortcutCommand, b: ShortcutBinding) -> ShortcutMap {
        let mut map = HashMap::new();
        map.insert(cmd, Some(b));
        map
    }

    // ── (a) RF-602 / CA-8 — validacao de modificador ──────────────────

    #[test]
    fn binding_without_modifier_is_rejected() {
        let b = binding(vec![], "A");
        let result = validate_binding(&b, ShortcutCommand::AskOrSend, &empty_map());
        assert!(
            matches!(result, Err(ShortcutError::MissingModifier)),
            "binding without modifier must be rejected: {:?}",
            result
        );
    }

    #[test]
    fn binding_with_cmd_modifier_is_accepted() {
        let b = binding(vec![ShortcutModifier::Cmd], "Enter");
        let result = validate_binding(&b, ShortcutCommand::AskOrSend, &empty_map());
        assert!(result.is_ok(), "Cmd+Enter must be accepted: {:?}", result);
    }

    #[test]
    fn binding_with_ctrl_modifier_is_accepted() {
        let b = binding(vec![ShortcutModifier::Ctrl], "E");
        let result = validate_binding(&b, ShortcutCommand::CaptureScreen, &empty_map());
        assert!(result.is_ok(), "Ctrl+E must be accepted: {:?}", result);
    }

    #[test]
    fn binding_with_alt_modifier_is_accepted() {
        let b = binding(vec![ShortcutModifier::Alt], "D");
        let result = validate_binding(&b, ShortcutCommand::ToggleVoiceRecording, &empty_map());
        assert!(result.is_ok(), "Alt+D must be accepted: {:?}", result);
    }

    #[test]
    fn capslock_without_modifier_is_accepted() {
        let b = binding(vec![], "CapsLock");
        let result = validate_binding(&b, ShortcutCommand::ToggleVoiceRecording, &empty_map());
        assert!(
            result.is_ok(),
            "CapsLock without modifier must be accepted (RF-602): {:?}",
            result
        );
    }

    #[test]
    fn space_without_modifier_is_rejected() {
        let b = binding(vec![], "Space");
        let result = validate_binding(&b, ShortcutCommand::AskOrSend, &empty_map());
        assert!(
            matches!(result, Err(ShortcutError::MissingModifier)),
            "Space without modifier must be rejected: {:?}",
            result
        );
    }

    #[test]
    fn binding_with_shift_only_modifier_is_rejected() {
        // RF-602: must include a modifier (Cmd/Ctrl or Alt). Shift alone
        // is not sufficient — it doesn't meet the requirement.
        let b = binding(vec![ShortcutModifier::Shift], "A");
        let result = validate_binding(&b, ShortcutCommand::AskOrSend, &empty_map());
        assert!(
            matches!(result, Err(ShortcutError::MissingModifier)),
            "Shift-only combo must be rejected (RF-602 requires Cmd/Ctrl or Alt): {:?}",
            result
        );
    }

    // ── (a) RF-602 / CA-8 — duplicatas ────────────────────────────────

    #[test]
    fn duplicate_combo_is_rejected() {
        let existing = binding(vec![ShortcutModifier::Cmd], "Enter");
        let map = map_with(ShortcutCommand::AskOrSend, existing);
        let new_binding = binding(vec![ShortcutModifier::Cmd], "Enter");
        let result = validate_binding(&new_binding, ShortcutCommand::CaptureScreen, &map);
        assert!(
            matches!(result, Err(ShortcutError::DuplicateCombo)),
            "duplicate combo must be rejected: {:?}",
            result
        );
    }

    #[test]
    fn same_command_rebinding_is_not_duplicate() {
        let existing = binding(vec![ShortcutModifier::Cmd], "Enter");
        let map = map_with(ShortcutCommand::AskOrSend, existing);
        let new_binding = binding(vec![ShortcutModifier::Cmd], "Enter");
        let result = validate_binding(&new_binding, ShortcutCommand::AskOrSend, &map);
        assert!(
            result.is_ok(),
            "rebinding same command to same combo must not be duplicate: {:?}",
            result
        );
    }

    #[test]
    fn different_combo_is_not_duplicate() {
        let existing = binding(vec![ShortcutModifier::Cmd], "Enter");
        let map = map_with(ShortcutCommand::AskOrSend, existing);
        let new_binding = binding(vec![ShortcutModifier::Cmd], "E");
        let result = validate_binding(&new_binding, ShortcutCommand::CaptureScreen, &map);
        assert!(
            result.is_ok(),
            "different combo must not be duplicate: {:?}",
            result
        );
    }

    // ── (b) ESC cancela regravacao — rebind com binding invalido ──────
    // RF-602 / CA-8: ESC cancela regravacao. Em Rust, "ESC" e modelado
    // como uma tentativa de rebind que falha na validacao — o binding
    // anterior deve permanecer no mapa e nada deve ser registrado.

    #[test]
    fn esc_cancellation_preserves_previous_binding() {
        let mock = MockRegistrar::new();
        let previous = binding(vec![ShortcutModifier::Cmd], "D");
        let mut map = map_with(ShortcutCommand::ToggleVoiceRecording, previous.clone());

        // Tentar rebindar com binding invalido (sem modificador) — simula ESC
        let invalid = binding(vec![], "X");
        let result = rebind(ShortcutCommand::ToggleVoiceRecording, invalid, &mut map, &mock);
        assert!(
            result.is_err(),
            "rebind with invalid binding must fail (ESC simulation)"
        );

        // Binding anterior preservado
        let stored = map.get(&ShortcutCommand::ToggleVoiceRecording).unwrap();
        assert_eq!(
            stored.as_ref().unwrap(),
            &previous,
            "ESC cancellation must preserve previous binding"
        );
    }

    #[test]
    fn esc_cancellation_does_not_register_new_combo() {
        let mock = MockRegistrar::new();
        let previous = binding(vec![ShortcutModifier::Cmd], "D");
        let mut map = map_with(ShortcutCommand::ToggleVoiceRecording, previous.clone());

        // Tentar rebindar com binding invalido — simula ESC
        let invalid = binding(vec![], "X");
        let _ = rebind(ShortcutCommand::ToggleVoiceRecording, invalid, &mut map, &mock);

        let registered = mock.registered_combos();
        assert!(
            registered.is_empty(),
            "ESC cancellation must not register any new shortcut"
        );
    }

    // ── (c) Efeito imediato — rebind registra novo combo ──────────────
    // RF-602: efeito imediato. O commit (rebind) deve registrar o novo
    // combo no SO e desregistrar o antigo.

    #[test]
    fn rebind_unregisters_old_and_registers_new() {
        let mock = MockRegistrar::new();
        let old_binding = binding(vec![ShortcutModifier::Cmd], "D");
        let mut map = map_with(ShortcutCommand::ToggleVoiceRecording, old_binding);

        let new_binding = binding(vec![ShortcutModifier::Cmd, ShortcutModifier::Shift], "R");
        let result = rebind(
            ShortcutCommand::ToggleVoiceRecording,
            new_binding,
            &mut map,
            &mock,
        );
        assert!(result.is_ok(), "valid rebind must succeed: {:?}", result);

        // Must unregister old combo
        let unregistered = mock.unregistered_combos();
        assert_eq!(unregistered.len(), 1, "must unregister exactly one old combo");
        assert!(
            unregistered[0].contains("Cmd") && unregistered[0].contains("D"),
            "must unregister old combo Cmd+D, got: {}",
            unregistered[0]
        );

        // Must register new combo
        let registered = mock.registered_combos();
        assert_eq!(registered.len(), 1, "must register exactly one new combo");
        assert_eq!(
            registered[0].1,
            ShortcutCommand::ToggleVoiceRecording,
            "must register for the correct command"
        );
    }

    #[test]
    fn rebind_updates_map_with_new_binding() {
        let mock = MockRegistrar::new();
        let old_binding = binding(vec![ShortcutModifier::Cmd], "D");
        let mut map = map_with(ShortcutCommand::ToggleVoiceRecording, old_binding);

        let new_binding = binding(vec![ShortcutModifier::Cmd, ShortcutModifier::Shift], "R");
        let _ = rebind(
            ShortcutCommand::ToggleVoiceRecording,
            new_binding.clone(),
            &mut map,
            &mock,
        );

        let stored = map.get(&ShortcutCommand::ToggleVoiceRecording).unwrap();
        assert_eq!(
            stored.as_ref().unwrap(),
            &new_binding,
            "map must be updated with new binding after rebind"
        );
    }

    // ── (c) register_all registra todos os bindings nao-nulos ─────────

    #[test]
    fn register_all_registers_non_null_bindings() {
        let mock = MockRegistrar::new();
        let mut map = HashMap::new();
        map.insert(
            ShortcutCommand::AskOrSend,
            Some(binding(vec![ShortcutModifier::Cmd], "Enter")),
        );
        map.insert(
            ShortcutCommand::CaptureScreen,
            Some(binding(vec![ShortcutModifier::Cmd], "E")),
        );
        map.insert(ShortcutCommand::MoveModalLeft, None);

        let result = register_all(&map, &mock);
        assert!(result.is_ok(), "register_all must succeed: {:?}", result);

        let registered = mock.registered_combos();
        assert_eq!(
            registered.len(),
            2,
            "must register exactly 2 non-null bindings"
        );
    }

    #[test]
    fn register_all_skips_null_bindings() {
        let mock = MockRegistrar::new();
        let mut map = HashMap::new();
        map.insert(ShortcutCommand::MoveModalLeft, None);
        map.insert(ShortcutCommand::MoveModalRight, None);
        map.insert(ShortcutCommand::ToggleWindowVisibility, None);

        let result = register_all(&map, &mock);
        assert!(result.is_ok(), "register_all must succeed: {:?}", result);

        let registered = mock.registered_combos();
        assert!(
            registered.is_empty(),
            "register_all must skip null bindings"
        );
    }

    #[test]
    fn register_all_rejects_invalid_binding() {
        let mock = MockRegistrar::new();
        let mut map = HashMap::new();
        // Invalid: no modifier and not CapsLock
        map.insert(
            ShortcutCommand::AskOrSend,
            Some(binding(vec![], "A")),
        );

        let result = register_all(&map, &mock);
        assert!(
            result.is_err(),
            "register_all must reject invalid bindings"
        );

        let registered = mock.registered_combos();
        assert!(
            registered.is_empty(),
            "register_all must not register anything when validation fails"
        );
    }

    #[test]
    fn register_all_skips_disabled_bindings() {
        // RF-601: toggle de ativacao — a disabled binding (enabled:false)
        // must NOT be registered even if Some(binding). register_all must
        // skip it.
        let mock = MockRegistrar::new();
        let mut map = HashMap::new();
        map.insert(
            ShortcutCommand::AskOrSend,
            Some(binding_disabled(vec![ShortcutModifier::Cmd], "Enter")),
        );
        map.insert(
            ShortcutCommand::CaptureScreen,
            Some(binding(vec![ShortcutModifier::Cmd], "E")),
        );

        let result = register_all(&map, &mock);
        assert!(result.is_ok(), "register_all must succeed: {:?}", result);

        let registered = mock.registered_combos();
        assert_eq!(
            registered.len(),
            1,
            "register_all must skip disabled binding, only register enabled one"
        );
        assert_eq!(
            registered[0].1,
            ShortcutCommand::CaptureScreen,
            "only the enabled binding (CaptureScreen) must be registered"
        );
    }

    // ── (d) Mapeamento exaustivo comando → nome de acao ────────────────
    // Teste que falha se command_to_action_name nao cobrir todos os
    // comandos (match nao-exaustivo).

    #[test]
    fn all_shortcut_commands_have_action_name() {
        // Pin exact action-name strings per contracts/settings.ts:84-104.
        // command_to_action_name must return the camelCase name that the UI
        // invokes and the core registers.
        for &cmd in ALL_SHORTCUT_COMMANDS {
            let name = command_to_action_name(cmd);
            let expected = match cmd {
                ShortcutCommand::AskOrSend => "askOrSend",
                ShortcutCommand::CaptureScreen => "captureScreen",
                ShortcutCommand::ToggleVoiceRecording => "toggleVoiceRecording",
                ShortcutCommand::ToggleMicCapture => "toggleMicCapture",
                ShortcutCommand::PushToListen => "pushToListen",
                ShortcutCommand::ScrollUp => "scrollUp",
                ShortcutCommand::ScrollDown => "scrollDown",
                ShortcutCommand::NotchPreviousInsight => "notchPreviousInsight",
                ShortcutCommand::NotchNextInsight => "notchNextInsight",
                ShortcutCommand::PreviousResponse => "previousResponse",
                ShortcutCommand::NextResponse => "nextResponse",
                ShortcutCommand::OverlayScrollUp => "overlayScrollUp",
                ShortcutCommand::OverlayScrollDown => "overlayScrollDown",
                ShortcutCommand::ToggleActionBar => "toggleActionBar",
                ShortcutCommand::ToggleAlwaysOnTop => "toggleAlwaysOnTop",
                ShortcutCommand::IncreaseOpacity => "increaseOpacity",
                ShortcutCommand::DecreaseOpacity => "decreaseOpacity",
                ShortcutCommand::MoveModalUp => "moveModalUp",
                ShortcutCommand::MoveModalDown => "moveModalDown",
                ShortcutCommand::MoveModalLeft => "moveModalLeft",
                ShortcutCommand::MoveModalRight => "moveModalRight",
                ShortcutCommand::ToggleWindowVisibility => "toggleWindowVisibility",
            };
            assert_eq!(
                name, expected,
                "command_to_action_name({:?}) must return '{}', got '{}'",
                cmd, expected, name
            );
        }
    }

    #[test]
    fn all_commands_count_is_22() {
        assert_eq!(
            ALL_SHORTCUT_COMMANDS.len(),
            22,
            "must have exactly 22 shortcut commands per contracts/settings.ts"
        );
    }

    // ── (d) combo_string formata corretamente ─────────────────────────

    #[test]
    fn combo_string_sorts_modifiers() {
        let b = binding(vec![ShortcutModifier::Shift, ShortcutModifier::Cmd], "A");
        assert_eq!(combo_string(&b), "Cmd+Shift+A");
    }

    #[test]
    fn combo_string_single_modifier() {
        let b = binding(vec![ShortcutModifier::Cmd], "Enter");
        assert_eq!(combo_string(&b), "Cmd+Enter");
    }

    #[test]
    fn combo_string_no_modifier() {
        let b = binding(vec![], "CapsLock");
        assert_eq!(combo_string(&b), "CapsLock");
    }

    // ── (d) Bindings null (moveModalLeft, moveModalRight, toggleWindowVisibility)
    //         não registram atalho — testado via register_all ───────────

    // ── (e) Mock seam — registro global real atras de trait ────────────

    #[test]
    fn mock_registrar_records_all_calls() {
        let mock = MockRegistrar::new();
        mock.register("Cmd+Enter", ShortcutCommand::AskOrSend)
            .unwrap();
        mock.register("Cmd+E", ShortcutCommand::CaptureScreen)
            .unwrap();
        mock.register("Cmd+Shift+A", ShortcutCommand::ToggleAlwaysOnTop)
            .unwrap();

        let registered = mock.registered_combos();
        assert_eq!(registered.len(), 3);
        assert_eq!(
            registered[0],
            ("Cmd+Enter".to_string(), ShortcutCommand::AskOrSend)
        );
        assert_eq!(
            registered[1],
            ("Cmd+E".to_string(), ShortcutCommand::CaptureScreen)
        );
        assert_eq!(
            registered[2],
            ("Cmd+Shift+A".to_string(), ShortcutCommand::ToggleAlwaysOnTop)
        );
    }

    #[test]
    fn mock_registrar_unregister_all_clears() {
        let mock = MockRegistrar::new();
        mock.register("Cmd+Enter", ShortcutCommand::AskOrSend)
            .unwrap();
        mock.unregister_all().unwrap();
        let registered = mock.registered_combos();
        assert!(registered.is_empty(), "unregister_all must clear all");
    }

    // ── (e) Validacao com binding disabled nao bloqueia ───────────────

    #[test]
    fn disabled_binding_not_checked_for_duplicate() {
        let disabled = binding_disabled(vec![ShortcutModifier::Cmd], "Enter");
        let map = map_with(ShortcutCommand::AskOrSend, disabled);
        let new_binding = binding(vec![ShortcutModifier::Cmd], "Enter");
        let result = validate_binding(&new_binding, ShortcutCommand::CaptureScreen, &map);
        assert!(
            result.is_ok(),
            "disabled binding must not block new binding with same combo: {:?}",
            result
        );
    }

    // ── (f) RF-601 — Redefinir Todos para Padroes ─────────────────────
    // reset_to_defaults deve: unregister all, substituir mapa por defaults,
    // register all defaults.

    #[test]
    fn reset_to_defaults_clears_registrar_and_repopulates() {
        let mock = MockRegistrar::new();
        // Pre-registrar um combo "sujo"
        mock.register("Ctrl+X", ShortcutCommand::AskOrSend)
            .unwrap();

        let mut map = HashMap::new();
        map.insert(
            ShortcutCommand::AskOrSend,
            Some(binding(vec![ShortcutModifier::Ctrl], "X")),
        );

        let result = reset_to_defaults(&mut map, &mock);
        assert!(
            result.is_ok(),
            "reset_to_defaults must succeed: {:?}",
            result
        );

        // Registrar antigo limpo, novos defaults registrados
        let registered = mock.registered_combos();
        // 19 bindings padrao devem ter sido registrados
        assert_eq!(
            registered.len(),
            19,
            "must register 19 default bindings after reset"
        );
    }

    #[test]
    fn reset_to_defaults_sets_correct_map_size() {
        let mock = MockRegistrar::new();
        let mut map = HashMap::new();

        let result = reset_to_defaults(&mut map, &mock);
        assert!(result.is_ok());

        assert_eq!(
            map.len(),
            22,
            "reset_to_defaults must produce a 22-entry map"
        );

        // 3 null bindings
        assert_eq!(
            map.get(&ShortcutCommand::MoveModalLeft).unwrap(),
            &None,
            "moveModalLeft must be null after reset"
        );
        assert_eq!(
            map.get(&ShortcutCommand::MoveModalRight).unwrap(),
            &None,
            "moveModalRight must be null after reset"
        );
        assert_eq!(
            map.get(&ShortcutCommand::ToggleWindowVisibility).unwrap(),
            &None,
            "toggleWindowVisibility must be null after reset"
        );
    }

    #[test]
    fn reset_to_defaults_produces_valid_bindings() {
        let mock = MockRegistrar::new();
        let mut map = HashMap::new();
        let _ = reset_to_defaults(&mut map, &mock);

        // Cada binding nao-nulo deve passar na validacao
        for (&cmd, binding_opt) in &map {
            if let Some(b) = binding_opt {
                let result = validate_binding(b, cmd, &map);
                assert!(
                    result.is_ok(),
                    "default binding for {:?} must be valid: {:?}",
                    cmd,
                    result
                );
            }
        }
    }

    #[test]
    fn reset_to_defaults_from_dirty_state() {
        let mock = MockRegistrar::new();
        // Estado "sujo": binding customizado
        mock.register("Alt+Z", ShortcutCommand::CaptureScreen)
            .unwrap();
        let mut map = HashMap::new();
        map.insert(
            ShortcutCommand::CaptureScreen,
            Some(binding(vec![ShortcutModifier::Alt], "Z")),
        );
        map.insert(
            ShortcutCommand::AskOrSend,
            Some(binding(vec![ShortcutModifier::Ctrl], "Q")),
        );

        let result = reset_to_defaults(&mut map, &mock);
        assert!(result.is_ok());

        // Apos reset, CaptureScreen deve ter o default (Cmd+E), nao Alt+Z
        let capture = map.get(&ShortcutCommand::CaptureScreen).unwrap().as_ref().unwrap();
        assert_eq!(capture.modifiers, vec![ShortcutModifier::Cmd]);
        assert_eq!(capture.key, "E");
    }

    #[test]
    fn default_shortcuts_pin_all_18_combos() {
        // RF-604: pin the default combos from contracts/settings.ts.
        // This prevents a GREEN implementation from mis-copying combos.
        let mock = MockRegistrar::new();
        let mut map = HashMap::new();
        let _ = reset_to_defaults(&mut map, &mock);

        // All enabled defaults — exact (command, modifiers, key) per contract
        let expected: Vec<(ShortcutCommand, Vec<ShortcutModifier>, &str)> = vec![
            (ShortcutCommand::AskOrSend, vec![ShortcutModifier::Cmd], "Enter"),
            (ShortcutCommand::CaptureScreen, vec![ShortcutModifier::Cmd], "E"),
            (ShortcutCommand::ToggleVoiceRecording, vec![ShortcutModifier::Cmd], "D"),
            (ShortcutCommand::ToggleMicCapture, vec![ShortcutModifier::Cmd, ShortcutModifier::Shift], "D"),
            (ShortcutCommand::ScrollUp, vec![ShortcutModifier::Cmd], "ArrowUp"),
            (ShortcutCommand::ScrollDown, vec![ShortcutModifier::Cmd], "ArrowDown"),
            (ShortcutCommand::NotchPreviousInsight, vec![ShortcutModifier::Cmd], "ArrowLeft"),
            (ShortcutCommand::NotchNextInsight, vec![ShortcutModifier::Cmd], "ArrowRight"),
            (ShortcutCommand::PreviousResponse, vec![ShortcutModifier::Cmd, ShortcutModifier::Alt], "ArrowUp"),
            (ShortcutCommand::NextResponse, vec![ShortcutModifier::Cmd, ShortcutModifier::Alt], "ArrowDown"),
            (ShortcutCommand::OverlayScrollUp, vec![ShortcutModifier::Cmd, ShortcutModifier::Alt, ShortcutModifier::Shift], "ArrowUp"),
            (ShortcutCommand::OverlayScrollDown, vec![ShortcutModifier::Cmd, ShortcutModifier::Alt, ShortcutModifier::Shift], "ArrowDown"),
            (ShortcutCommand::ToggleActionBar, vec![ShortcutModifier::Cmd], "M"),
            (ShortcutCommand::ToggleAlwaysOnTop, vec![ShortcutModifier::Cmd, ShortcutModifier::Shift], "A"),
            (ShortcutCommand::IncreaseOpacity, vec![ShortcutModifier::Cmd, ShortcutModifier::Shift], "="),
            (ShortcutCommand::DecreaseOpacity, vec![ShortcutModifier::Cmd, ShortcutModifier::Shift], "-"),
            (ShortcutCommand::MoveModalUp, vec![ShortcutModifier::Cmd, ShortcutModifier::Shift], "ArrowUp"),
            (ShortcutCommand::MoveModalDown, vec![ShortcutModifier::Cmd, ShortcutModifier::Shift], "ArrowDown"),
        ];

        for (cmd, expected_mods, expected_key) in &expected {
            let binding_opt = map.get(cmd).unwrap_or_else(|| {
                panic!("missing default entry for {:?}", cmd)
            });
            let b = binding_opt.as_ref().unwrap_or_else(|| {
                panic!("{:?} must have a non-null default binding", cmd)
            });
            assert_eq!(
                &b.modifiers, expected_mods,
                "{:?} modifiers mismatch: expected {:?}, got {:?}",
                cmd, expected_mods, b.modifiers
            );
            assert_eq!(
                b.key, *expected_key,
                "{:?} key mismatch: expected '{}', got '{}'",
                cmd, expected_key, b.key
            );
            assert!(b.enabled, "{:?} must be enabled by default", cmd);
        }
    }
}
