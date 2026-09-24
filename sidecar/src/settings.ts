// Espelho dos tipos de contrato de Settings.features / Settings.shortcuts
// (T-003) + validação em runtime desses JSONs.
// Fonte de verdade em runtime: contracts/settings.ts. Mantido em espelho
// pela mesma razão de contract.ts vs. contracts/ipc.ts: o tsconfig do
// sidecar usa rootDir: "src" e não importa arquivos fora da própria
// árvore. Divergência entre os dois é bug de contrato.

// ---------------------------------------------------------------------
// Toggles de recursos de sessão (RF-700)
// ---------------------------------------------------------------------

export const FEATURE_TOGGLE_NAMES = [
  "autoScroll",
  "selectToPrompt",
  "sessionTimer",
  "notchExperience",
  "autoCompaction",
  "quickScreenshotAnalysis",
  // Espelho de contracts/settings.ts: Ouvir Segurando — o agente só recebe
  // contexto enquanto o atalho pushToListen está pressionado (opt-in).
  "pushToListen",
] as const;

export type FeatureToggleName = (typeof FEATURE_TOGGLE_NAMES)[number];

export type FeatureToggles = Record<FeatureToggleName, boolean>;

export const DEFAULT_FEATURE_TOGGLES: FeatureToggles = {
  autoScroll: true,
  selectToPrompt: true,
  sessionTimer: true,
  notchExperience: true,
  autoCompaction: true,
  quickScreenshotAnalysis: true,
  pushToListen: false,
};

// ---------------------------------------------------------------------
// Atalhos de teclado (RF-600)
// ---------------------------------------------------------------------

export const SHORTCUT_MODIFIERS = ["Cmd", "Ctrl", "Alt", "Shift"] as const;

export type ShortcutModifier = (typeof SHORTCUT_MODIFIERS)[number];

export const ALLOWED_MODIFIERLESS_KEYS = ["CapsLock"] as const;

export const SHORTCUT_COMMANDS = [
  "askOrSend",
  "captureScreen",
  "toggleVoiceRecording",
  "toggleMicCapture",
  "pushToListen",
  "scrollUp",
  "scrollDown",
  "notchPreviousInsight",
  "notchNextInsight",
  "previousResponse",
  "nextResponse",
  "overlayScrollUp",
  "overlayScrollDown",
  "toggleActionBar",
  "toggleAlwaysOnTop",
  "increaseOpacity",
  "decreaseOpacity",
  "moveModalUp",
  "moveModalDown",
  "moveModalLeft",
  "moveModalRight",
  "toggleWindowVisibility",
] as const;

export type ShortcutCommand = (typeof SHORTCUT_COMMANDS)[number];

export type ShortcutBinding = {
  enabled: boolean;
  modifiers: ShortcutModifier[];
  key: string;
};

export type ShortcutMap = Record<ShortcutCommand, ShortcutBinding | null>;

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  askOrSend: { enabled: true, modifiers: ["Cmd"], key: "Enter" },
  captureScreen: { enabled: true, modifiers: ["Cmd"], key: "E" },
  toggleVoiceRecording: { enabled: true, modifiers: ["Cmd"], key: "D" },
  toggleMicCapture: { enabled: true, modifiers: ["Cmd", "Shift"], key: "D" },
  pushToListen: { enabled: true, modifiers: ["Alt"], key: "Space" },
  scrollUp: { enabled: true, modifiers: ["Cmd"], key: "ArrowUp" },
  scrollDown: { enabled: true, modifiers: ["Cmd"], key: "ArrowDown" },
  notchPreviousInsight: { enabled: true, modifiers: ["Cmd"], key: "ArrowLeft" },
  notchNextInsight: { enabled: true, modifiers: ["Cmd"], key: "ArrowRight" },
  previousResponse: { enabled: true, modifiers: ["Cmd", "Alt"], key: "ArrowUp" },
  nextResponse: { enabled: true, modifiers: ["Cmd", "Alt"], key: "ArrowDown" },
  overlayScrollUp: { enabled: true, modifiers: ["Cmd", "Alt", "Shift"], key: "ArrowUp" },
  overlayScrollDown: { enabled: true, modifiers: ["Cmd", "Alt", "Shift"], key: "ArrowDown" },
  toggleActionBar: { enabled: true, modifiers: ["Cmd"], key: "M" },
  toggleAlwaysOnTop: { enabled: true, modifiers: ["Cmd", "Shift"], key: "A" },
  increaseOpacity: { enabled: true, modifiers: ["Cmd", "Shift"], key: "=" },
  decreaseOpacity: { enabled: true, modifiers: ["Cmd", "Shift"], key: "-" },
  moveModalUp: { enabled: true, modifiers: ["Cmd", "Shift"], key: "ArrowUp" },
  moveModalDown: { enabled: true, modifiers: ["Cmd", "Shift"], key: "ArrowDown" },
  moveModalLeft: null,
  moveModalRight: null,
  toggleWindowVisibility: null,
};

// ---------------------------------------------------------------------
// Validação em runtime
// ---------------------------------------------------------------------

export type SettingsValidationError = { path: string; message: string };

export type SettingsParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: SettingsValidationError[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFeatureToggleName(key: string): key is FeatureToggleName {
  return (FEATURE_TOGGLE_NAMES as readonly string[]).includes(key);
}

function isShortcutCommand(key: string): key is ShortcutCommand {
  return (SHORTCUT_COMMANDS as readonly string[]).includes(key);
}

function isShortcutModifier(value: unknown): value is ShortcutModifier {
  return (
    typeof value === "string" &&
    (SHORTCUT_MODIFIERS as readonly string[]).includes(value)
  );
}

function findUnknownKeys(value: Record<string, unknown>, known: (key: string) => boolean): string[] {
  return Object.keys(value).filter((key) => !known(key));
}

/**
 * Valida `Settings.features` (RF-700): objeto com os toggles conhecidos,
 * todos booleanos. Chave AUSENTE herda o default — blobs persistidos antes
 * de um toggle novo (ex.: pushToListen) continuam válidos na leitura, sem
 * descartar as preferências do usuário; valor PRESENTE não-booleano e
 * chave DESCONHECIDA seguem sendo erro.
 */
export function parseFeatureToggles(value: unknown): SettingsParseResult<FeatureToggles> {
  if (!isRecord(value)) {
    return { ok: false, errors: [{ path: "$", message: "features deve ser um objeto" }] };
  }

  const errors: SettingsValidationError[] = [];
  const result: Partial<FeatureToggles> = {};

  for (const name of FEATURE_TOGGLE_NAMES) {
    const raw = value[name];
    if (raw === undefined) {
      result[name] = DEFAULT_FEATURE_TOGGLES[name];
      continue;
    }
    if (typeof raw !== "boolean") {
      errors.push({ path: name, message: `"${name}" deve ser boolean` });
      continue;
    }
    result[name] = raw;
  }

  for (const unknownKey of findUnknownKeys(value, isFeatureToggleName)) {
    errors.push({ path: unknownKey, message: `toggle de recurso desconhecido: "${unknownKey}"` });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: result as FeatureToggles };
}

function validateShortcutModifiers(
  path: string,
  raw: unknown,
  errors: SettingsValidationError[],
): ShortcutModifier[] | undefined {
  if (!Array.isArray(raw) || !raw.every(isShortcutModifier)) {
    errors.push({ path: `${path}.modifiers`, message: "modifiers deve ser um array de ShortcutModifier" });
    return undefined;
  }
  return raw;
}

function validateShortcutKey(path: string, raw: unknown, errors: SettingsValidationError[]): string | undefined {
  if (typeof raw !== "string" || raw.length === 0) {
    errors.push({ path: `${path}.key`, message: "key deve ser uma string não vazia" });
    return undefined;
  }
  return raw;
}

function validateShortcutEnabled(path: string, raw: unknown, errors: SettingsValidationError[]): boolean | undefined {
  if (typeof raw !== "boolean") {
    errors.push({ path: `${path}.enabled`, message: "enabled deve ser boolean" });
    return undefined;
  }
  return raw;
}

function requiresModifier(modifiers: ShortcutModifier[], key: string): boolean {
  if (modifiers.length > 0) {
    return false;
  }
  return !(ALLOWED_MODIFIERLESS_KEYS as readonly string[]).includes(key);
}

function bindingSignature(binding: ShortcutBinding): string {
  const sortedModifiers = [...binding.modifiers].sort().join("+");
  return `${sortedModifiers}+${binding.key}`;
}

function validateShortcutBinding(
  command: ShortcutCommand,
  raw: unknown,
  errors: SettingsValidationError[],
): ShortcutBinding | null | undefined {
  if (raw === null) {
    return null;
  }
  if (!isRecord(raw)) {
    errors.push({ path: command, message: "atalho deve ser um objeto ou null" });
    return undefined;
  }

  const enabled = validateShortcutEnabled(command, raw.enabled, errors);
  const modifiers = validateShortcutModifiers(command, raw.modifiers, errors);
  const key = validateShortcutKey(command, raw.key, errors);

  if (enabled === undefined || modifiers === undefined || key === undefined) {
    return undefined;
  }

  if (requiresModifier(modifiers, key)) {
    errors.push({
      path: command,
      message: `"${command}" precisa de ao menos um modificador (RF-602), exceto teclas permitidas sem modificador`,
    });
    return undefined;
  }

  return { enabled, modifiers, key };
}

function checkDuplicateBindings(bindings: Map<ShortcutCommand, ShortcutBinding>): SettingsValidationError[] {
  const seen = new Map<string, ShortcutCommand>();
  const errors: SettingsValidationError[] = [];

  for (const [command, binding] of bindings) {
    if (!binding.enabled) {
      continue;
    }
    const signature = bindingSignature(binding);
    const previousCommand = seen.get(signature);
    if (previousCommand !== undefined) {
      errors.push({
        path: command,
        message: `combinação de teclas duplicada com "${previousCommand}" (RF-602)`,
      });
      continue;
    }
    seen.set(signature, command);
  }

  return errors;
}

/** Valida `Settings.shortcuts` (RF-600): um binding válido (ou null) por comando conhecido, sem duplicatas. */
export function parseShortcutMap(value: unknown): SettingsParseResult<ShortcutMap> {
  if (!isRecord(value)) {
    return { ok: false, errors: [{ path: "$", message: "shortcuts deve ser um objeto" }] };
  }

  const errors: SettingsValidationError[] = [];
  const result: Partial<ShortcutMap> = {};
  const enabledBindings = new Map<ShortcutCommand, ShortcutBinding>();

  for (const command of SHORTCUT_COMMANDS) {
    const binding = validateShortcutBinding(command, value[command], errors);
    if (binding === undefined) {
      continue;
    }
    result[command] = binding;
    if (binding !== null) {
      enabledBindings.set(command, binding);
    }
  }

  for (const unknownKey of findUnknownKeys(value, isShortcutCommand)) {
    errors.push({ path: unknownKey, message: `comando de atalho desconhecido: "${unknownKey}"` });
  }

  errors.push(...checkDuplicateBindings(enabledBindings));

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: result as ShortcutMap };
}
