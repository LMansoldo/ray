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

/** Nomes canônicos dos toggles de recursos (RF-701..706 + pushToListen). */
export const FEATURE_TOGGLE_NAMES = [
  "autoScroll", // RF-701 — Rolagem Automática
  "selectToPrompt", // RF-702 — Selecionar para Prompt
  "sessionTimer", // RF-703 — Temporizador de Sessão
  "notchExperience", // RF-704 — Experiência do Notch
  "autoCompaction", // RF-705 — Compactação automática
  "quickScreenshotAnalysis", // RF-706 — Análise Rápida de Screenshots
  // Ouvir Segurando: a escuta/transcrição continua contínua, mas o agente
  // só recebe o contexto (e responde) enquanto o atalho pushToListen está
  // pressionado — ao soltar, analisa só o trecho do intervalo.
  "pushToListen",
] as const;

export type FeatureToggleName = (typeof FEATURE_TOGGLE_NAMES)[number];

/** Forma canônica de `Settings.features`: um toggle booleano por recurso. */
export type FeatureToggles = Record<FeatureToggleName, boolean>;

/**
 * Defaults de `Settings.features`. Nenhum RF-700 documenta um toggle
 * nascendo desligado, então o default é "tudo ligado" — decisão de
 * produto sinalizável se um recurso específico precisar nascer opt-in.
 * EXCEÇÃO: `pushToListen` nasce DESLIGADO por decisão de produto — ele
 * muda o comportamento da análise automática (o agente só recebe contexto
 * segurando o atalho), então é opt-in; sem o toggle o app mantém o
 * comportamento contínuo de sempre.
 */
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
// Idioma da captação de fala (STT)
// ---------------------------------------------------------------------

/**
 * Locales de reconhecimento de fala suportados pelo switch de "Áudio e
 * Tela". O valor é o locale EXPLÍCITO passado ao motor de STT
 * (SFSpeechRecognizer no macOS via NSLocale) — sem isso o recognizer herda
 * o locale do dispositivo e, num macOS em inglês, fala em pt-BR não é
 * transcrita. IDs são BCP 47 válidos para o Apple Speech.
 */
export const STT_LANGUAGE_IDS = ["pt-BR", "en-US"] as const;

export type SttLanguage = (typeof STT_LANGUAGE_IDS)[number];

/**
 * Default: pt-BR. Antes deste campo o recognizer usava o locale do
 * dispositivo; o produto é voltado a reuniões em português, então nasce
 * fixado em pt-BR (o switch em Áudio e Tela devolve o inglês).
 */
export const DEFAULT_STT_LANGUAGE: SttLanguage = "pt-BR";

/** Type guard canônico — leitura tolerante, escrita estrita (mesma regra dos blobs). */
export function isSttLanguage(value: unknown): value is SttLanguage {
  return (
    typeof value === "string" &&
    (STT_LANGUAGE_IDS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------
// Overlay customizado (template HTML+CSS)
// ---------------------------------------------------------------------

/**
 * Limite de tamanho do template de overlay. Um HTML+CSS de card tem ordens
 * de grandeza abaixo disso; o teto existe para o PUT /settings recusar
 * payloads desproporcionais (escrita estrita) sem criar DoS de banco.
 */
export const OVERLAY_TEMPLATE_MAX_LENGTH = 200_000;

/**
 * Type guard canônico do template de overlay: string (possivelmente vazia —
 * vazio = "usar o InsightCard embutido") com no máximo
 * OVERLAY_TEMPLATE_MAX_LENGTH caracteres.
 */
export function isOverlayTemplate(value: unknown): value is string {
  return (
    typeof value === "string" && value.length <= OVERLAY_TEMPLATE_MAX_LENGTH
  );
}

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
  "pushToListen", // Ouvir Segurando (padrão: Alt+Space). Sem reunião: captura só enquanto pressionado; soltar transcreve e analisa. Com reunião ativa E o toggle features.pushToListen ligado: a transcrição segue contínua e soltar entrega ao agente SÓ o trecho do intervalo
  "scrollUp", // Rolar Cima (padrão: Cmd+ArrowUp)
  "scrollDown", // Rolar Baixo (padrão: Cmd+ArrowDown)
  "notchPreviousInsight", // Insight Anterior do Notch (padrão: Cmd+ArrowLeft)
  "notchNextInsight", // Insight Próximo do Notch (padrão: Cmd+ArrowRight)
  "previousResponse", // Resposta Anterior (padrão: Cmd+Alt+ArrowUp)
  "nextResponse", // Resposta Próxima (padrão: Cmd+Alt+ArrowDown)
  "overlayScrollUp", // Rolar Cima do Overlay (padrão: Cmd+Alt+Shift+ArrowUp)
  "overlayScrollDown", // Rolar Baixo do Overlay (padrão: Cmd+Alt+Shift+ArrowDown)
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
