// =====================================================================
// Ray — Fonte de verdade dos campos JSON de Settings (T-003)
// =====================================================================
//
// `Settings.features` e `Settings.shortcuts` (prisma/schema.prisma) são
// colunas `Json` de propósito geral, para não acoplar o schema a cada
// toggle/atalho individual (ver comentário no schema). A FORMA CANÔNICA
// desses dois blobs vive aqui — este é o único lugar do repositório que
// declara os nomes de toggle/atalho válidos e seus defaults.
//
// STATUS: mantido à mão (não gerado por ts-rs — ao contrário de ipc.ts,
// não existe struct Rust equivalente; estes JSONs nunca cruzam a
// fronteira IPC como um payload próprio, são lidos/escritos só pelo
// sidecar via Prisma). Ainda assim, os NOMES dos atalhos (RF-604) devem
// casar com os comandos que a UI invoca e que o núcleo registra
// (`core/src/lib.rs`, `#[tauri::command]`) — uma renomeação aqui é uma
// mudança de contrato de UI/núcleo, não só do sidecar.
//
// sidecar/src/settings.ts MANTÉM UM ESPELHO destes tipos e implementa a
// validação em runtime — mesmo motivo do espelho `contract.ts` vs.
// `contracts/ipc.ts`: o `tsconfig` do sidecar usa `rootDir: "src"` e não
// pode importar um arquivo fora da própria árvore (o pacote do sidecar é
// compilado/empacotado sozinho como `externalBin`, ADR-001). Divergência
// entre os dois é bug de contrato.
// =====================================================================

// ---------------------------------------------------------------------
// Toggles de recursos de sessão (RF-700)
// ---------------------------------------------------------------------

/** Nomes canônicos dos toggles de recursos (RF-701..706). */
export const FEATURE_TOGGLE_NAMES = [
  "autoScroll", // RF-701 — Rolagem Automática
  "selectToPrompt", // RF-702 — Selecionar para Prompt
  "sessionTimer", // RF-703 — Temporizador de Sessão
  "notchExperience", // RF-704 — Experiência do Notch
  "autoCompaction", // RF-705 — Compactação automática
  "quickScreenshotAnalysis", // RF-706 — Análise Rápida de Screenshots
] as const;

export type FeatureToggleName = (typeof FEATURE_TOGGLE_NAMES)[number];

/** Forma canônica de `Settings.features`: um toggle booleano por recurso. */
export type FeatureToggles = Record<FeatureToggleName, boolean>;

/**
 * Defaults de `Settings.features`. Nenhum RF-700 documenta um toggle
 * nascendo desligado, então o default é "tudo ligado" — decisão de
 * produto sinalizável se um recurso específico precisar nascer opt-in.
 */
export const DEFAULT_FEATURE_TOGGLES: FeatureToggles = {
  autoScroll: true,
  selectToPrompt: true,
  sessionTimer: true,
  notchExperience: true,
  autoCompaction: true,
  quickScreenshotAnalysis: true,
};

// ---------------------------------------------------------------------
// Atalhos de teclado (RF-600)
// ---------------------------------------------------------------------

/** Teclas modificadoras suportadas (RF-602). */
export const SHORTCUT_MODIFIERS = ["Cmd", "Ctrl", "Alt", "Shift"] as const;

export type ShortcutModifier = (typeof SHORTCUT_MODIFIERS)[number];

/**
 * Teclas únicas (sem modificador) permitidas por RF-602 ("... exceto
 * teclas únicas permitidas (ex.: Caps Lock)"). O SRS só cita um exemplo;
 * mantém a lista deliberadamente curta e explícita em vez de inferir
 * outras teclas.
 */
export const ALLOWED_MODIFIERLESS_KEYS = ["CapsLock"] as const;

/**
 * Identificadores canônicos dos comandos de atalho (RF-604). Estes nomes
 * são o "nome estável" da ação de atalho e devem casar com o comando que
 * a UI invoca / o núcleo registra para ela (ex.: `toggleWindowVisibility`
 * é a ação de "panic hide" exposta pelo comando Tauri `toggle_window` em
 * `core/src/lib.rs`).
 */
export const SHORTCUT_COMMANDS = [
  "askOrSend", // Perguntar/Enviar (padrão: Cmd+Enter)
  "captureScreen", // Capturar Tela (padrão: Cmd+E)
  "toggleVoiceRecording", // Gravação de Voz (padrão: Cmd+D)
  "toggleMicCapture", // Alternar Captura do Microfone (padrão: Cmd+Shift+D)
  "pushToListen", // Ouvir Segurando: captura só enquanto pressionado; soltar transcreve e dispara a análise (padrão: Alt+Space)
  "scrollUp", // Rolar Cima (padrão: Cmd+ArrowUp)
  "scrollDown", // Rolar Baixo (padrão: Cmd+ArrowDown)
  "notchPreviousInsight", // Insight Anterior do Notch (padrão: Cmd+ArrowLeft)
  "notchNextInsight", // Insight Próximo do Notch (padrão: Cmd+ArrowRight)
  "previousResponse", // Resposta Anterior (padrão: Cmd+Alt+ArrowUp)
  "nextResponse", // Resposta Próxima (padrão: Cmd+Alt+ArrowDown)
  "toggleActionBar", // Alternar Barra de Ações (padrão: Cmd+M)
  "toggleAlwaysOnTop", // Sempre no Topo (padrão: Cmd+Shift+A)
  "increaseOpacity", // Aumentar Opacidade (padrão: Cmd+Shift+=)
  "decreaseOpacity", // Reduzir Opacidade (padrão: Cmd+Shift+-)
  "moveModalUp", // Deslizar Modal Cima (padrão: Cmd+Shift+ArrowUp)
  "moveModalDown", // Deslizar Modal Baixo (padrão: Cmd+Shift+ArrowDown)
  "moveModalLeft", // Deslizar Modal Esquerda (não atribuído por padrão)
  "moveModalRight", // Deslizar Modal Direita (não atribuído por padrão)
  "toggleWindowVisibility", // Alternar Visibilidade da Janela
] as const;

export type ShortcutCommand = (typeof SHORTCUT_COMMANDS)[number];

/**
 * Um atalho vinculado: RF-601 exige um toggle de ativação por atalho e um
 * combo regravável. RF-602: `modifiers` só pode ser vazio se `key` estiver
 * em `ALLOWED_MODIFIERLESS_KEYS`.
 */
export type ShortcutBinding = {
  enabled: boolean;
  modifiers: ShortcutModifier[];
  key: string;
};

/**
 * Forma canônica de `Settings.shortcuts`: um binding por comando, ou
 * `null` para os comandos "não atribuídos por padrão" (RF-604).
 */
export type ShortcutMap = Record<ShortcutCommand, ShortcutBinding | null>;

/**
 * Conjunto padrão de atalhos (RF-604). `moveModalLeft`/`moveModalRight`
 * ficam `null` (explicitamente "não atribuídos por padrão" no SRS).
 * `toggleWindowVisibility` também fica `null`: RF-604 lista a ação no
 * conjunto padrão mas não especifica um combo de teclas para ela — uma
 * lacuna do SRS sinalizada aqui em vez de inventar um atalho não
 * especificado.
 */
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
