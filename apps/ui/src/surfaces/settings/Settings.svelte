<script lang="ts">
  // Superfície Configurações (T-406, RF-206/301..404/601..706/1001..1004):
  // 7 abas — Fontes de IA (BYOK, quatro modos de conexão), Modelos (seleção
  // por função), Áudio e Tela (medidores), Permissões (RF-103), Recursos
  // (toggles do contrato), Atalhos (espelho das regras do núcleo) e Ajuda.
  //
  // Sem props (padrão T-405 — evita o problema de tipagem de props do T-402).
  // O estado ENTRA pelo adaptador local settings-feed.ts (que hidrata dos
  // comandos core registrados em core/src/lib.rs), lido uma vez no mount;
  // as saídas declaradas continuam no canal settings-actions.ts E, onde o
  // comando core existe, a superfície o invoca diretamente (apply_shortcuts,
  // save_feature_toggles, delete_credential — a UI nunca inventa um nome de
  // invoke() fora do registro do núcleo). Preferências locais não-secretas
  // (medidores, modelos por função) persistem em Web Storage com chaves
  // allowlistadas ('ray_audio_meters', 'ray_models'); ADR-003: o segredo
  // digitado vive apenas no próprio campo e no payload credentialSave.
  import { glassTokens } from '../../lib/glass/tokens'
  import { invoke } from '@tauri-apps/api/core'
  import { emit, listen } from '@tauri-apps/api/event'
  import { onMount } from 'svelte'
  import { dispatchOnboardingRestart } from '../onboarding/restart'
  import type { OnboardingPermissionId, OnboardingPlatform } from '../onboarding/types'
  import {
    DEFAULT_FEATURE_TOGGLES,
    DEFAULT_SHORTCUTS,
    FEATURE_TOGGLE_NAMES,
    SHORTCUT_COMMANDS,
  } from '../../../../../contracts/settings'
  import type {
    FeatureToggleName,
    FeatureToggles,
    ShortcutBinding,
    ShortcutCommand,
    ShortcutMap,
    ShortcutModifier,
  } from '../../../../../contracts/settings'
  import type {
    AiFunction,
    ProviderConnectionMode,
    ProviderKind,
  } from '../../../../../contracts/ipc'
  import { loadSettingsState, readSettingsState } from './settings-feed'
  import { dispatchSettingsAction } from './settings-actions'
  import type { SettingsAction } from './settings-actions'
  import { formatCombo, validateShortcutChange } from './shortcut-validation'
  import type { ShortcutValidationError } from './shortcut-validation'
  import type {
    ProviderConnectionStatus,
    ProviderSlotId,
    SettingsState,
    SettingsTabId,
  } from './types'

  // ── Abas (SRS seções 3–4, ordem do backlog T-406) ──────────────────────

  const TABS: ReadonlyArray<{ id: SettingsTabId; title: string }> = [
    { id: 'aiSources', title: 'Fontes de IA' },
    { id: 'models', title: 'Modelos' },
    { id: 'audioScreen', title: 'Áudio e Tela' },
    { id: 'permissions', title: 'Permissões' },
    { id: 'features', title: 'Recursos' },
    { id: 'shortcuts', title: 'Atalhos' },
    { id: 'help', title: 'Ajuda' },
  ]

  let activeTab = $state<SettingsTabId>('aiSources')

  // Estado inicial: leitura SÍNCRONA do feed (semeia atalhos/modelos e
  // permite injeção em testes); os status de provedor e o resto do estado
  // real são refinados em seguida pelo carregamento assíncrono do core
  // (loadSettingsState). Quando ele resolve, o estado LOCAL editável
  // (atalhos, recursos) é re-sincronizado do estado hidratado.
  let settingsState = $state<SettingsState>(readSettingsState())
  void loadSettingsState().then((s) => {
    settingsState = s
    // Atalhos e recursos seguem o estado carregado (RF-601/700): a UI
    // espelha o mapa ativo no SO e os toggles persistidos.
    shortcuts = { ...s.shortcuts }
    featureToggles = { ...DEFAULT_FEATURE_TOGGLES, ...s.features }
  })

  // Recarrega o status dos provedores quando uma credencial é salva/validada
  // (App.svelte emite após save_credential + validate_credential).
  let unlistenCredentials: (() => void) | undefined

  onMount(() => {
    void listen<{ slot: string; valid?: boolean; reason?: string }>(
      'ray:credentials-changed',
      (event) => {
        const { slot, valid, reason } = event.payload
        if (valid === false && reason) {
          validationReasons = { ...validationReasons, [slot]: reason }
        } else if (valid === true) {
          const { [slot]: _removed, ...rest } = validationReasons
          validationReasons = rest
        }
        void loadSettingsState().then((s) => {
          settingsState = s
        })
      },
    ).then((fn) => {
      unlistenCredentials = fn
    })
    return () => {
      unlistenCredentials?.()
    }
  })

  function openTab(tab: SettingsTabId): void {
    activeTab = tab
  }

  // ── Fontes de IA (RF-401/402/403/406) ─────────────────────────────────

  interface ProviderCard {
    slot: ProviderSlotId
    title: string
    kind: ProviderKind
    connectionMode: ProviderConnectionMode
    hasKeyInput: boolean
    hasBaseUrlInput: boolean
    hasSave: boolean
    cloud: boolean
  }

  const PROVIDER_CARDS: readonly ProviderCard[] = [
    { slot: 'deepseek', title: 'DeepSeek', kind: 'DEEPSEEK', connectionMode: 'API_KEY', hasKeyInput: true, hasBaseUrlInput: false, hasSave: true, cloud: true },
    { slot: 'anthropic', title: 'Anthropic', kind: 'ANTHROPIC', connectionMode: 'API_KEY', hasKeyInput: true, hasBaseUrlInput: false, hasSave: true, cloud: true },
    { slot: 'gemini', title: 'Google Gemini', kind: 'GEMINI', connectionMode: 'API_KEY', hasKeyInput: true, hasBaseUrlInput: false, hasSave: true, cloud: true },
    { slot: 'openai', title: 'OpenAI', kind: 'OPENAI', connectionMode: 'API_KEY', hasKeyInput: true, hasBaseUrlInput: false, hasSave: true, cloud: true },
    { slot: 'chatgpt', title: 'ChatGPT', kind: 'OPENAI', connectionMode: 'SUBSCRIPTION', hasKeyInput: false, hasBaseUrlInput: false, hasSave: false, cloud: true },
    { slot: 'openrouter', title: 'OpenRouter', kind: 'OPENROUTER', connectionMode: 'AGGREGATOR', hasKeyInput: true, hasBaseUrlInput: false, hasSave: true, cloud: true },
    { slot: 'generic', title: 'Endpoint compatível com OpenAI', kind: 'GENERIC', connectionMode: 'COMPATIBLE_ENDPOINT', hasKeyInput: true, hasBaseUrlInput: true, hasSave: true, cloud: false },
  ]

  const PROVIDER_STATUS_LABELS: Record<ProviderConnectionStatus, string> = {
    connected: 'Conectado',
    saved: 'Salvo',
    disconnected: 'Não Conectado',
    notConfigured: 'Não configurado',
  }

  type ProviderFilter = 'all' | 'local' | 'cloud'

  let providerFilter = $state<ProviderFilter>('all')

  const visibleCards = $derived.by(() => {
    if (providerFilter === 'cloud') {
      return PROVIDER_CARDS.filter((card) => card.cloud)
    }
    if (providerFilter === 'local') {
      return PROVIDER_CARDS.filter((card) => !card.cloud)
    }
    return PROVIDER_CARDS
  })

  // Campos de credencial: estado em memória apenas — o valor só sai da UI
  // dentro do payload credentialSave, uma única vez (ADR-003).
  let keyValues = $state<Record<ProviderSlotId, string>>({
    deepseek: '',
    anthropic: '',
    gemini: '',
    openai: '',
    chatgpt: '',
    openrouter: '',
    generic: '',
  })
  let genericBaseUrl = $state('')

  function providerCardOf(slot: ProviderSlotId): ProviderCard | undefined {
    return PROVIDER_CARDS.find((card) => card.slot === slot)
  }

  /** Sigla do card (ex.: "Google Gemini" → "G") para o logo do pcard. */
  function plogoInitials(title: string): string {
    const words = title.split(/\s+/).filter((word) => word.length > 0)
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase()
    }
    return title.slice(0, 2)
  }

  function saveCredential(slot: ProviderSlotId): void {
    const card = providerCardOf(slot)
    if (!card || !card.hasSave) {
      return
    }
    if (keyValues[slot] === '') {
      return
    }
    const payload: Extract<SettingsAction, { type: 'credentialSave' }> = {
      type: 'credentialSave',
      slot,
      kind: card.kind,
      connectionMode: card.connectionMode,
      secret: keyValues[slot],
    }
    if (card.hasBaseUrlInput && genericBaseUrl !== '') {
      payload.baseUrl = genericBaseUrl
    }
    dispatchSettingsAction(payload)
  }

  /** Slot com exclusão em andamento — desabilita o botão Excluir dele. */
  let deletingSlot = $state<ProviderSlotId | null>(null)

  /** Exclui a credencial do slot (cofre nativo + banco via core) e emite
   *  'ray:credentials-changed' para os status recarregarem (App.svelte
   *  escuta o mesmo evento). Limpa o campo de chave; segredo nunca circula. */
  async function deleteProviderCredential(slot: ProviderSlotId): Promise<void> {
    deletingSlot = slot
    try {
      await invoke('delete_credential', { slot })
      keyValues[slot] = ''
      void emit('ray:credentials-changed', { slot, valid: undefined }).catch(console.error)
    } catch {
      // core/sidecar indisponível — mantém o estado atual
    } finally {
      deletingSlot = null
    }
  }

  // ── Modelos personalizados (URL + modelo + key, RF-401) ──────────────

  // Endpoint próprio compatível com OpenAI (/v1/chat/completions) ou
  // Anthropic (/v1/messages). A key NUNCA toca o Web Storage (ADR-003):
  // cruza uma única vez no payload credentialSave — o cofre nativo guarda o
  // segredo e o slot 'custom-<id>' amarra os metadados à credencial.
  type CustomModelKind = Extract<ProviderKind, 'GENERIC' | 'ANTHROPIC'>

  interface CustomModelEntry {
    id: string
    slot: `custom-${string}`
    label: string
    baseUrl: string
    model: string
    kind: CustomModelKind
  }

  // A chave 'ray_custom_models' é allowlistada no teste de integridade
  // (no-direct-sidecar.test.ts) — e citada literalmente nas chamadas de
  // storage, que são varridas linha a linha.

  function readCustomModels(): CustomModelEntry[] {
    try {
      const raw = window.localStorage.getItem?.('ray_custom_models')
      if (!raw) {
        return []
      }
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) {
        return []
      }
      return parsed.filter((entry): entry is CustomModelEntry => {
        const candidate = entry as Partial<CustomModelEntry> | null
        return (
          !!candidate &&
          typeof candidate.id === 'string' &&
          typeof candidate.slot === 'string' &&
          typeof candidate.label === 'string' &&
          typeof candidate.baseUrl === 'string' &&
          typeof candidate.model === 'string' &&
          (candidate.kind === 'GENERIC' || candidate.kind === 'ANTHROPIC')
        )
      })
    } catch {
      return []
    }
  }

  let customModels = $state<CustomModelEntry[]>(readCustomModels())

  let customLabel = $state('')
  let customBaseUrl = $state('')
  let customModelName = $state('')
  let customKey = $state('')
  let customFormat = $state<CustomModelKind>('GENERIC')

  const canAddCustomModel = $derived(
    customLabel.trim() !== '' &&
      /^https?:\/\/.+/.test(customBaseUrl.trim()) &&
      customModelName.trim() !== '' &&
      customKey !== '',
  )

  function persistCustomModels(): void {
    window.localStorage.setItem?.('ray_custom_models', JSON.stringify(customModels))
  }

  function addCustomModel(): void {
    if (!canAddCustomModel) {
      return
    }
    const id = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).slice(0, 8)
    const entry: CustomModelEntry = {
      id,
      slot: `custom-${id}`,
      label: customLabel.trim(),
      baseUrl: customBaseUrl.trim(),
      model: customModelName.trim(),
      kind: customFormat,
    }
    dispatchSettingsAction({
      type: 'credentialSave',
      slot: entry.slot,
      kind: entry.kind,
      connectionMode: entry.kind === 'GENERIC' ? 'COMPATIBLE_ENDPOINT' : 'API_KEY',
      secret: customKey,
      baseUrl: entry.baseUrl,
    })
    customModels = [...customModels, entry]
    persistCustomModels()
    // O segredo não circula depois do payload — formulário limpo.
    customLabel = ''
    customBaseUrl = ''
    customModelName = ''
    customKey = ''
    customFormat = 'GENERIC'
  }

  async function deleteCustomModel(entry: CustomModelEntry): Promise<void> {
    try {
      await invoke('delete_credential', { slot: entry.slot })
      customModels = customModels.filter((model) => model.id !== entry.id)
      persistCustomModels()
      // Funções atribuídas a este modelo voltam a ficar sem provedor.
      for (const fn of FUNCTIONS) {
        if (modelSelections[fn] === `custom:${entry.id}`) {
          modelSelections[fn] = ''
          modelInputs[fn] = ''
        }
      }
      persistModels()
      void emit('ray:credentials-changed', { slot: entry.slot, valid: undefined }).catch(
        console.error,
      )
    } catch {
      // core/sidecar indisponível — mantém o estado atual
    }
  }

  // ── Modelos (RF-301/302/303/404) ──────────────────────────────────────

  const FUNCTIONS: readonly AiFunction[] = ['TRANSCRIPTION', 'ANALYSIS', 'TRANSLATION']

  const FUNCTION_TITLES: Record<AiFunction, string> = {
    TRANSCRIPTION: 'Transcrição',
    ANALYSIS: 'Análise',
    TRANSLATION: 'Tradução',
  }

  const PROVIDER_KINDS: readonly ProviderKind[] = [
    'OPENAI',
    'ANTHROPIC',
    'GEMINI',
    'DEEPSEEK',
    'OPENROUTER',
    'GENERIC',
  ]

  function isProviderKind(value: string): value is ProviderKind {
    return (PROVIDER_KINDS as readonly string[]).includes(value)
  }

  // Preferência local de modelos por função (localStorage 'ray_models'):
  // sobrevive a reinícios e SEMEIA os seletores sobre o functionConfig do
  // feed; toda mudança persiste de volta e emite 'ray:models-changed' para
  // o consumidor global (o app ajusta os pipelines — a UI não escuta).
  // (A chave 'ray_models' é allowlistada no teste de integridade.)

  interface StoredModelEntry {
    kind: ProviderKind
    model: string
    /** Presente quando a entrada é um modelo personalizado (ray_custom_models). */
    customId?: string
  }
  type StoredModels = Record<AiFunction, StoredModelEntry | null>

  function readStoredModels(): Partial<StoredModels> {
    try {
      const raw = window.localStorage.getItem?.('ray_models')
      if (!raw) {
        return {}
      }
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {}
      }
      return parsed as Partial<StoredModels>
    } catch {
      return {}
    }
  }

  const storedModels = readStoredModels()

  function seedKind(fn: AiFunction): string {
    const entry = storedModels[fn]
    if (entry?.customId && customModels.some((model) => model.id === entry.customId)) {
      return `custom:${entry.customId}`
    }
    if (entry && isProviderKind(entry.kind)) {
      return entry.kind
    }
    return settingsState.functionConfig[fn]?.kind ?? ''
  }

  function seedModel(fn: AiFunction): string {
    const entry = storedModels[fn]
    if (entry && typeof entry.model === 'string') {
      return entry.model
    }
    return settingsState.functionConfig[fn]?.model ?? ''
  }

  // Opções de provedor por função = slots com status != notConfigured (RF-404).
  const configuredSlots = $derived(
    PROVIDER_CARDS.filter(
      (card) => settingsState.providerStatus[card.slot] !== 'notConfigured',
    ),
  )

  const localSpeechEngine = $derived(
    settingsState.platform === 'macos' ? 'Apple Speech' : 'Whisper embutido',
  )

  let modelSelections = $state<Record<AiFunction, string>>({
    TRANSCRIPTION: seedKind('TRANSCRIPTION'),
    ANALYSIS: seedKind('ANALYSIS'),
    TRANSLATION: seedKind('TRANSLATION'),
  })
  let modelInputs = $state<Record<AiFunction, string>>({
    TRANSCRIPTION: seedModel('TRANSCRIPTION'),
    ANALYSIS: seedModel('ANALYSIS'),
    TRANSLATION: seedModel('TRANSLATION'),
  })

  /** Mapa corrente por função — null quando a função está sem provedor. */
  function currentModels(): StoredModels {
    const build = (fn: AiFunction): StoredModelEntry | null => {
      const selection = modelSelections[fn]
      if (selection.startsWith('custom:')) {
        const entry = customModels.find((model) => model.id === selection.slice('custom:'.length))
        if (!entry) {
          return null
        }
        return { kind: entry.kind, model: modelInputs[fn] || entry.model, customId: entry.id }
      }
      return isProviderKind(selection) ? { kind: selection, model: modelInputs[fn] } : null
    }
    return {
      TRANSCRIPTION: build('TRANSCRIPTION'),
      ANALYSIS: build('ANALYSIS'),
      TRANSLATION: build('TRANSLATION'),
    }
  }

  /** Persiste a preferência local e notifica o app (ray:models-changed). */
  function persistModels(): void {
    const models = currentModels()
    window.localStorage.setItem?.('ray_models', JSON.stringify(models))
    void emit('ray:models-changed', models).catch(console.error)
  }

  function changeFunctionProvider(event: Event, fn: AiFunction): void {
    const select = event.currentTarget as HTMLSelectElement
    const value = select.value
    modelSelections[fn] = value
    if (value.startsWith('custom:')) {
      const entry = customModels.find((model) => model.id === value.slice('custom:'.length))
      if (!entry) {
        // Modelo removido: função volta a ficar sem provedor.
        persistModels()
        return
      }
      modelInputs[fn] = entry.model
      dispatchSettingsAction({
        type: 'functionProviderChange',
        function: fn,
        kind: entry.kind,
        model: entry.model,
      })
      persistModels()
      return
    }
    if (!isProviderKind(value)) {
      // Seleção vazia: função volta a ficar sem provedor (persiste null).
      persistModels()
      return
    }
    dispatchSettingsAction({
      type: 'functionProviderChange',
      function: fn,
      kind: value,
      model: modelInputs[fn],
    })
    persistModels()
  }

  function changeFunctionModel(event: Event, fn: AiFunction): void {
    const input = event.currentTarget as HTMLInputElement
    modelInputs[fn] = input.value
    persistModels()
  }

  // ── Áudio e Tela (RF-206) ─────────────────────────────────────────────

  function toggleMeters(event: MouseEvent): void {
    const checkbox = event.currentTarget as HTMLInputElement
    const visible = checkbox.checked
    settingsState = { ...settingsState, metersVisible: visible }
    // A chave 'ray_audio_meters' é allowlistada no teste de integridade; a
    // chamada opcional tolera ambientes sem Storage utilitável.
    window.localStorage.setItem?.('ray_audio_meters', visible ? '1' : '0')
    dispatchSettingsAction({ type: 'metersVisibilityChange', visible })
    // Notifica o consumidor global (a superfície de áudio liga/desliga os
    // medidores) — a UI daqui não escuta o próprio evento.
    void emit('ray:meters-changed', { visible }).catch(console.error)
  }

  // ── Permissões (RF-103/104/335) — mesmo mapeamento do onboarding ──────

  interface PermissionRow {
    id: OnboardingPermissionId
    name: string
    function: string
  }

  function buildPermissionRows(platform: OnboardingPlatform): PermissionRow[] {
    const speechFunction = platform === 'macos' ? 'STT on-device' : 'Whisper embutido'
    return [
      { id: 'microphone', name: 'Microfone', function: 'canal VOCÊ' },
      {
        id: 'screenRecording',
        name: 'Captura de Tela',
        function: 'Capturar Tela · contexto visual',
      },
      { id: 'accessibility', name: 'Acessibilidade', function: 'Analisar Seleção' },
      { id: 'speechRecognition', name: 'Reconhecimento de Fala', function: speechFunction },
    ]
  }

  const permissionRows = $derived(buildPermissionRows(settingsState.platform))
  const missingPermissions = $derived(
    permissionRows.some((row) => settingsState.permissions[row.id] === 'notGranted'),
  )

  let grantingPermissions = $state(false)

  /** Motivo da última validação por slot (ex.: "HTTP 400") — exibido no card. */
  let validationReasons = $state<Record<string, string>>({})

  /** "Habilitar tudo": dispara as dialogs TCC e reflete o status final. */
  async function grantMissingPermissions(): Promise<void> {
    grantingPermissions = true
    try {
      const map = await invoke<Record<string, string>>('request_all_permissions')
      const asState = (v: string | undefined) => (v === 'granted' ? 'granted' : 'notGranted')
      settingsState = {
        ...settingsState,
        permissions: {
          microphone: asState(map.microphone),
          screenRecording: asState(map.screenRecording),
          accessibility: asState(map.accessibility),
          speechRecognition: asState(map.speechRecognition),
        },
      }
    } catch {
      // core indisponível — mantém o estado atual
    } finally {
      grantingPermissions = false
    }
  }

  // ── Recursos (RF-700) — dirigidos pelo contrato, hidratados do core ────

  const FEATURE_LABELS: Record<FeatureToggleName, string> = {
    autoScroll: 'Rolagem Automática',
    selectToPrompt: 'Selecionar para Prompt',
    sessionTimer: 'Temporizador de Sessão',
    notchExperience: 'Experiência do Notch',
    autoCompaction: 'Compactação automática',
    quickScreenshotAnalysis: 'Análise Rápida de Screenshots',
    pushToListen: 'Ouvir Segurando (o agente só escuta segurando o atalho)',
  }

  // Semeados do feed e re-sincronizados quando loadSettingsState resolve
  // (features persistidas via get_app_settings). Ignoramos o aviso de
  // "captura o valor inicial" — semear UMA vez é a intenção: o mapa local
  // é editável e a re-sincronização explícita acontece no load.
  // svelte-ignore state_referenced_locally
  let featureToggles = $state<FeatureToggles>({ ...DEFAULT_FEATURE_TOGGLES, ...settingsState.features })

  function toggleFeature(event: MouseEvent, name: FeatureToggleName): void {
    const checkbox = event.currentTarget as HTMLInputElement
    featureToggles[name] = checkbox.checked
    dispatchSettingsAction({ type: 'featureToggleChange', name, enabled: checkbox.checked })
    // Persiste no core (sidecar/Prisma) e notifica a UI (ray:features-changed).
    const features: FeatureToggles = { ...featureToggles }
    void invoke('save_feature_toggles', { features }).catch(console.error)
    void emit('ray:features-changed', features).catch(console.error)
  }

  // ── Atalhos (RF-601/602/604) — estado do feed, espelho das regras core ──

  const SHORTCUT_LABELS: Record<ShortcutCommand, string> = {
    askOrSend: 'Perguntar/Enviar',
    captureScreen: 'Capturar Tela',
    toggleVoiceRecording: 'Gravação de Voz',
    toggleMicCapture: 'Alternar Captura do Microfone',
    pushToListen: 'Ouvir Segurando (solte para analisar)',
    scrollUp: 'Rolar Cima',
    scrollDown: 'Rolar Baixo',
    notchPreviousInsight: 'Insight Anterior do Notch',
    notchNextInsight: 'Insight Próximo do Notch',
    previousResponse: 'Resposta Anterior',
    nextResponse: 'Resposta Próxima',
    overlayScrollUp: 'Rolar Cima do Overlay',
    overlayScrollDown: 'Rolar Baixo do Overlay',
    toggleActionBar: 'Alternar Barra de Ações',
    toggleAlwaysOnTop: 'Sempre no Topo',
    increaseOpacity: 'Aumentar Opacidade',
    decreaseOpacity: 'Reduzir Opacidade',
    moveModalUp: 'Deslizar Modal Cima',
    moveModalDown: 'Deslizar Modal Baixo',
    moveModalLeft: 'Deslizar Modal Esquerda',
    moveModalRight: 'Deslizar Modal Direita',
    toggleWindowVisibility: 'Alternar Visibilidade da Janela',
  }

  // Mapa LOCAL corrente (seedado do feed e re-sincronizado quando a
  // hidratação do core resolve): a validação de duplicatas e o efeito
  // imediato (combo exibido, toggle) operam sobre ele. Semear uma vez é a
  // intenção (ver comentário em featureToggles acima).
  // svelte-ignore state_referenced_locally
  let shortcuts = $state<ShortcutMap>({ ...settingsState.shortcuts })
  let recordingCommand = $state<ShortcutCommand | null>(null)
  let shortcutError = $state<{ command: ShortcutCommand; message: string } | null>(null)

  /** Aplica o mapa corrente no SO via core (apply_shortcuts — RF-601):
   *  registro imediato + persistência. Erros individuais do núcleo (combo já
   *  registrado pelo SO etc.) viram feedback no comando alterado; `changed`
   *  null (redefinição) não tem linha para anexar o erro. */
  function applyShortcutsToCore(changed: ShortcutCommand | null): void {
    void invoke<{ errors: string[] } | undefined>('apply_shortcuts', {
      bindings: { ...shortcuts },
    })
      .then((res) => {
        if (changed !== null && res?.errors?.length) {
          shortcutError = { command: changed, message: res.errors[0] }
        }
      })
      .catch(() => {
        // core indisponível — o mapa local permanece; a próxima mudança
        // reaplica o mapa completo
      })
  }

  // Teclas só-modificador não encerram a gravação; ESC cancela; teclas
  // comuns são commitadas e validadas (espelho de core::validate_binding).
  const MODIFIER_ONLY_KEYS: readonly string[] = ['Meta', 'Control', 'Alt', 'Shift']

  // A captura de teclas durante a gravação é global (o próximo keydown vale
  // onde quer que o foco esteja), então o ouvinte vive na janela apenas
  // enquanto há uma gravação ativa.
  $effect(() => {
    if (recordingCommand === null) {
      return
    }
    const command = recordingCommand
    const listener = (event: KeyboardEvent) => handleShortcutKeyDown(event, command)
    window.addEventListener('keydown', listener)
    return () => {
      window.removeEventListener('keydown', listener)
    }
  })

  function startShortcutRecording(command: ShortcutCommand): void {
    shortcutError = null
    recordingCommand = command
  }

  function buildBindingFromKeyEvent(
    event: KeyboardEvent,
    command: ShortcutCommand,
  ): ShortcutBinding {
    const modifiers: ShortcutModifier[] = []
    if (event.metaKey) {
      modifiers.push('Cmd')
    }
    if (event.ctrlKey) {
      modifiers.push('Ctrl')
    }
    if (event.altKey) {
      modifiers.push('Alt')
    }
    if (event.shiftKey) {
      modifiers.push('Shift')
    }
    const current = shortcuts[command]
    return { enabled: current?.enabled ?? true, modifiers, key: event.key }
  }

  function shortcutErrorMessage(error: ShortcutValidationError): string {
    if (error.kind === 'missingModifier') {
      return 'Atalho exige um modificador (Cmd, Ctrl ou Alt).'
    }
    return 'Combo duplicado — já atribuído a outro atalho.'
  }

  function handleShortcutKeyDown(event: KeyboardEvent, command: ShortcutCommand): void {
    if (recordingCommand !== command) {
      return
    }
    if (MODIFIER_ONLY_KEYS.includes(event.key)) {
      return
    }
    if (event.key === 'Escape') {
      recordingCommand = null
      return
    }
    const binding = buildBindingFromKeyEvent(event, command)
    const validationError = validateShortcutChange(command, binding, shortcuts)
    recordingCommand = null
    if (validationError) {
      shortcutError = { command, message: shortcutErrorMessage(validationError) }
      return
    }
    shortcutError = null
    shortcuts[command] = binding
    dispatchSettingsAction({ type: 'shortcutChange', command, binding })
    applyShortcutsToCore(command)
  }

  function toggleShortcut(event: MouseEvent, command: ShortcutCommand): void {
    const checkbox = event.currentTarget as HTMLInputElement
    const binding = shortcuts[command]
    if (!binding) {
      return
    }
    const updated: ShortcutBinding = { ...binding, enabled: checkbox.checked }
    shortcuts[command] = updated
    dispatchSettingsAction({ type: 'shortcutChange', command, binding: updated })
    applyShortcutsToCore(command)
  }

  function resetShortcuts(): void {
    shortcuts = { ...DEFAULT_SHORTCUTS }
    shortcutError = null
    recordingCommand = null
    dispatchSettingsAction({ type: 'shortcutReset' })
    // Redefinir reaplica o conjunto PADRÃO no SO (não o mapa corrente).
    applyShortcutsToCore(null)
  }

  // ── Ajuda (RF-1001..1004) ─────────────────────────────────────────────

  function restartIntegration(): void {
    dispatchOnboardingRestart()
  }

  function openLogFolder(): void {
    dispatchSettingsAction({ type: 'logFolderOpen' })
  }

  function copyLogs(): void {
    dispatchSettingsAction({ type: 'logCopy' })
  }
</script>

<main class="settings" style:--surface-blur={glassTokens.blur.surface}>
  <nav class="settings__side">
    <div class="settings__side-label">Configurações</div>
    {#each TABS as tab (tab.id)}
      <button
        type="button"
        class="stab"
        class:on={activeTab === tab.id}
        data-settings-tab={tab.id}
        onclick={() => openTab(tab.id)}
      >
        {tab.title}
      </button>
    {/each}
  </nav>

  <div class="settings__body">

  {#if activeTab === 'aiSources'}
    <section class="settings__panel" data-settings-panel="aiSources">
      <h2 class="settings__title">Fontes de IA</h2>
      <div class="settings__filter">
        <button
          type="button"
          class="cpill"
          class:on={providerFilter === 'all'}
          data-provider-filter="all"
          onclick={() => {
            providerFilter = 'all'
          }}
        >
          Todos
        </button>
        <button
          type="button"
          class="cpill"
          class:on={providerFilter === 'local'}
          data-provider-filter="local"
          onclick={() => {
            providerFilter = 'local'
          }}
        >
          Local
        </button>
        <button
          type="button"
          class="cpill"
          class:on={providerFilter === 'cloud'}
          data-provider-filter="cloud"
          onclick={() => {
            providerFilter = 'cloud'
          }}
        >
          Nuvem
        </button>
      </div>

      {#each visibleCards as card (card.slot)}
        <div class="pcard" data-provider-card={card.slot}>
          <div class="phdr">
            <span class="plogo" aria-hidden="true">{plogoInitials(card.title)}</span>
            <span class="pmeta">
              <span class="pname">{card.title}</span>
              <span class="pmode">{card.cloud ? 'BYOK · Nuvem' : 'Self-hosted'}</span>
            </span>
            <span
              class="pbadge"
              class:pbadge--ok={settingsState.providerStatus[card.slot] === 'connected'}
              class:pbadge--saved={settingsState.providerStatus[card.slot] === 'saved'}
              data-provider-status={card.slot}
            >
              {PROVIDER_STATUS_LABELS[settingsState.providerStatus[card.slot]]}
            </span>
          </div>
          {#if validationReasons[card.slot] && settingsState.providerStatus[card.slot] !== 'connected'}
            <p class="pvalreason" data-provider-validation-reason={card.slot}>
              Validação: {validationReasons[card.slot]}
            </p>
          {/if}
          {#if card.hasKeyInput}
            <input
              class="key-input"
              data-provider-key-input={card.slot}
              type="password"
              placeholder="{card.title} API key"
              bind:value={keyValues[card.slot]}
            />
          {/if}
          {#if card.hasBaseUrlInput}
            <input
              class="key-input"
              data-provider-baseurl-input
              type="text"
              placeholder="Endpoint base"
              bind:value={genericBaseUrl}
            />
          {/if}
          {#if card.hasSave || settingsState.providerStatus[card.slot] !== 'notConfigured'}
            <div class="key-row">
              {#if card.hasSave}
                <button
                  type="button"
                  class="btn btn--primary"
                  data-provider-save={card.slot}
                  onclick={() => saveCredential(card.slot)}
                >
                  Salvar
                </button>
              {/if}
              {#if settingsState.providerStatus[card.slot] !== 'notConfigured'}
                <button
                  type="button"
                  class="btn btn--danger"
                  data-provider-delete={card.slot}
                  disabled={deletingSlot === card.slot}
                  onclick={() => void deleteProviderCredential(card.slot)}
                >
                  {deletingSlot === card.slot ? 'Excluindo…' : 'Excluir'}
                </button>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </section>
  {/if}

  {#if activeTab === 'models'}
    <section class="settings__panel" data-settings-panel="models">
      <div class="settings__custom" data-custom-models>
        <h3 class="settings__function-title">Modelos personalizados</h3>
        <p class="settings__function-empty" data-custom-models-hint>
          Endpoint próprio compatível com OpenAI ou Anthropic — informe a URL, o nome do modelo e a
          chave.
        </p>
        {#each customModels as entry (entry.id)}
          <div class="pcard" data-custom-model={entry.id}>
            <div class="phdr">
              <span class="plogo" aria-hidden="true">{plogoInitials(entry.label)}</span>
              <span class="pmeta">
                <span class="pname">{entry.label}</span>
                <span class="pmode">
                  {entry.model} · {entry.kind === 'GENERIC'
                    ? 'compatível OpenAI'
                    : 'compatível Anthropic'}
                </span>
              </span>
            </div>
            <p class="pmode" data-custom-model-url>{entry.baseUrl}</p>
            <div class="key-row">
              <button
                type="button"
                class="btn btn--danger"
                data-custom-model-delete={entry.id}
                onclick={() => void deleteCustomModel(entry)}
              >
                Excluir
              </button>
            </div>
          </div>
        {/each}
        <div class="settings__custom-form" data-custom-model-form>
          <input
            class="key-input"
            data-custom-label-input
            type="text"
            placeholder="Nome (ex.: Meu servidor local)"
            bind:value={customLabel}
          />
          <input
            class="key-input"
            data-custom-baseurl-input
            type="text"
            placeholder="URL base (ex.: https://api.exemplo.com)"
            bind:value={customBaseUrl}
          />
          <input
            class="key-input"
            data-custom-model-name-input
            type="text"
            placeholder="Nome do modelo (ex.: llama-3)"
            bind:value={customModelName}
          />
          <input
            class="key-input"
            data-custom-key-input
            type="password"
            placeholder="API key"
            bind:value={customKey}
          />
          <select
            class="settings__function-provider"
            data-custom-format-select
            bind:value={customFormat}
          >
            <option value="GENERIC">Compatível com OpenAI</option>
            <option value="ANTHROPIC">Compatível com Anthropic</option>
          </select>
          <div class="key-row">
            <button
              type="button"
              class="btn btn--primary"
              data-custom-model-add
              disabled={!canAddCustomModel}
              onclick={addCustomModel}
            >
              Adicionar modelo
            </button>
          </div>
        </div>
      </div>

      {#each FUNCTIONS as fn (fn)}
        {@const config = settingsState.functionConfig[fn]}
        <div class="settings__function" data-function-selector={fn}>
          <h3 class="settings__function-title">{FUNCTION_TITLES[fn]}</h3>
          {#if !config && modelSelections[fn] === ''}
            <p class="settings__function-empty" data-function-empty>
              Nenhum provedor configurado
            </p>
          {/if}
          <select
            class="settings__function-provider"
            data-function-provider-select
            bind:value={modelSelections[fn]}
            onchange={(event) => changeFunctionProvider(event, fn)}
          >
            {#if !config}
              <option value="">Selecionar provedor</option>
            {/if}
            {#each configuredSlots as card (card.slot)}
              <option value={card.kind}>{card.title}</option>
            {/each}
            {#each customModels as entry (entry.id)}
              <option value={'custom:' + entry.id}>{entry.label}</option>
            {/each}
          </select>
          <input
            class="settings__function-model"
            data-function-model-input
            value={modelInputs[fn]}
            oninput={(event) => changeFunctionModel(event, fn)}
          />
          {#if fn === 'TRANSCRIPTION'}
            <p class="settings__function-local">Local on-device: {localSpeechEngine}</p>
          {/if}
        </div>
      {/each}
    </section>
  {/if}

  {#if activeTab === 'audioScreen'}
    <section class="settings__panel" data-settings-panel="audioScreen">
      <label class="settings__meter">
        <input
          class="settings__meter-toggle"
          data-meters-toggle
          type="checkbox"
          checked={settingsState.metersVisible}
          onclick={toggleMeters}
        />
        Mostrar medidores de áudio
      </label>
    </section>
  {/if}

  {#if activeTab === 'permissions'}
    <section class="settings__panel" data-settings-panel="permissions">
      {#each permissionRows as row (row.id)}
        <div
          class="settings__permission"
          data-permission-row={row.id}
          data-permission-state={settingsState.permissions[row.id]}
        >
          <span class="settings__permission-name">{row.name}</span>
          <span class="settings__permission-function">{row.function}</span>
        </div>
      {/each}
      {#if missingPermissions}
        <button
          type="button"
          class="settings__grant"
          data-settings-grant-missing
          disabled={grantingPermissions}
          onclick={() => void grantMissingPermissions()}
        >
          {grantingPermissions ? 'Solicitando…' : 'Conceder permissões ausentes'}
        </button>
      {/if}
    </section>
  {/if}

  {#if activeTab === 'features'}
    <section class="settings__panel" data-settings-panel="features">
      {#each FEATURE_TOGGLE_NAMES as name (name)}
        <label class="settings__feature" data-feature-toggle={name}>
          <input
            type="checkbox"
            checked={featureToggles[name]}
            onclick={(event) => toggleFeature(event, name)}
          />
          {FEATURE_LABELS[name]}
        </label>
      {/each}
    </section>
  {/if}

  {#if activeTab === 'shortcuts'}
    <section class="settings__panel" data-settings-panel="shortcuts">
      {#each SHORTCUT_COMMANDS as command (command)}
        {@const binding = shortcuts[command]}
        <div
          class="settings__shortcut"
          data-shortcut-row={command}
          data-shortcut-recording={recordingCommand === command ? 'true' : undefined}
        >
          <span class="settings__shortcut-label">{SHORTCUT_LABELS[command]}</span>
          {#if binding}
            <kbd class="settings__shortcut-combo" data-shortcut-combo={command}>
              {formatCombo(binding)}
            </kbd>
            <input
              class="settings__shortcut-toggle"
              data-shortcut-toggle={command}
              type="checkbox"
              checked={binding.enabled}
              onclick={(event) => toggleShortcut(event, command)}
            />
          {:else}
            <span class="settings__shortcut-combo" data-shortcut-combo={command}>
              Não atribuído
            </span>
          {/if}
          <button
            type="button"
            class="settings__shortcut-change"
            data-shortcut-change={command}
            onclick={() => startShortcutRecording(command)}
          >
            Change
          </button>
          {#if shortcutError !== null && shortcutError.command === command}
            <p class="settings__shortcut-error" data-shortcut-error={command}>
              {shortcutError.message}
            </p>
          {/if}
        </div>
      {/each}
      <button
        type="button"
        class="settings__shortcut-reset"
        data-shortcut-reset
        onclick={resetShortcuts}
      >
        Redefinir Todos para Padrões
      </button>
    </section>
  {/if}

  {#if activeTab === 'help'}
    <section class="settings__panel" data-settings-panel="help">
      <h2 class="settings__help-title">Sobre</h2>
      <p class="settings__about" data-about-version>Versão {settingsState.appVersion}</p>
      <a
        class="settings__help-link"
        data-help-link="community"
        href="https://discord.gg/ray-app"
        target="_blank"
        rel="noreferrer"
      >
        Comunidade no Discord
      </a>
      <a
        class="settings__help-link"
        data-help-link="support"
        href="https://docs.ray.app"
        target="_blank"
        rel="noreferrer"
      >
        Documentação e suporte
      </a>
      <button type="button" class="settings__help-action" onclick={restartIntegration}>
        Reiniciar Integração
      </button>
      <button type="button" class="settings__help-action" onclick={openLogFolder}>
        Abrir pasta de logs
      </button>
      <button type="button" class="settings__help-action" onclick={copyLogs}>
        Copiar logs
      </button>
    </section>
  {/if}
  </div>
</main>

<style>
  .pbadge--saved {
    background: rgba(48, 209, 88, 0.14);
    color: var(--green);
    border-color: rgba(48, 209, 88, 0.3);
  }

  .pvalreason {
    margin: -0.6rem 0 0.4rem;
    font-size: 1.15rem;
    color: var(--text-t);
  }

  .settings {
    display: flex;
    align-items: stretch;
    width: 100%;
    max-width: 88rem;
    margin: 0 auto;
    min-height: 100%;
  }

  /* ── Sidebar de abas ── */
  .settings__side {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 18rem;
    flex-shrink: 0;
    padding: 1.2rem 0.8rem;
    border-right: 0.1rem solid var(--rim);
  }

  .settings__side-label {
    padding: 0.8rem 1rem 0.4rem;
    font-size: 1.1rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-t);
  }

  .stab {
    font: inherit;
    font-size: 1.3rem;
    display: flex;
    align-items: center;
    gap: 0.8rem;
    width: 100%;
    padding: 0.7rem 1rem;
    text-align: left;
    color: var(--text-s);
    background: transparent;
    border: none;
    border-radius: 0.7rem;
    cursor: pointer;
    transition:
      background 0.1s,
      color 0.1s;
  }

  .stab:hover {
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-p);
  }

  .stab.on {
    background: var(--iris-dim);
    color: var(--text-p);
    font-weight: 500;
  }

  .stab:focus-visible {
    outline: 2px solid var(--iris);
  }

  /* ── Corpo ── */
  .settings__body {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: 2rem;
  }

  .settings__panel {
    display: flex;
    flex-direction: column;
    gap: 1.6rem;
  }

  .settings__title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--text-p);
  }

  /* ── Filtros (cpills) ── */
  .settings__filter {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .cpill {
    font: inherit;
    font-size: 1.2rem;
    font-weight: 500;
    padding: 4px 1.2rem;
    border-radius: 2rem;
    color: var(--text-s);
    background: rgba(255, 255, 255, 0.05);
    border: 0.1rem solid var(--rim);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.12s;
  }

  .cpill:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .cpill.on {
    background: var(--iris-dim);
    border-color: rgba(90, 87, 232, 0.35);
    color: var(--text-p);
  }

  /* ── Cards de provedor ── */
  .pcard {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
    padding: 1.6rem;
    background: var(--elevated);
    border: 0.1rem solid var(--rim);
    border-radius: 1rem;
  }

  .phdr {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .plogo {
    width: 3.2rem;
    height: 3.2rem;
    border-radius: 0.8rem;
    background: rgba(255, 255, 255, 0.06);
    border: 0.1rem solid var(--rim);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text-s);
    flex-shrink: 0;
  }

  .pmeta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .pname {
    font-size: 1.3rem;
    font-weight: 600;
    color: var(--text-p);
  }

  .pmode {
    font-size: 1.1rem;
    color: var(--text-t);
  }

  .pbadge {
    margin-left: auto;
    font-size: 1.1rem;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 5px;
    color: var(--text-t);
    background: rgba(255, 255, 255, 0.05);
  }

  .pbadge--ok {
    color: var(--green);
    background: rgba(48, 209, 88, 0.12);
  }

  .key-input {
    font-family: 'SF Mono', Menlo, Consolas, monospace;
    font-size: 1.2rem;
    letter-spacing: 0.04em;
    padding: 0.7rem 1.2rem;
    color: var(--text-s);
    background: rgba(255, 255, 255, 0.04);
    border: 0.1rem solid var(--rim);
    border-radius: 0.7rem;
    outline: none;
  }

  .key-input::placeholder {
    font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
    letter-spacing: normal;
    color: var(--text-t);
  }

  .key-input:focus {
    border-color: var(--iris);
  }

  .key-row {
    display: flex;
    gap: 0.8rem;
    align-items: center;
  }

  /* ── Botões compartilhados do painel ── */
  .btn {
    font: inherit;
    font-size: 1.1rem;
    font-weight: 500;
    padding: 5px 1.2rem;
    border-radius: 6px;
    cursor: pointer;
    white-space: nowrap;
    transition:
      opacity 0.12s,
      background 0.12s;
  }

  .btn--primary {
    color: #fff;
    background: var(--iris);
    border: 0.1rem solid rgba(255, 255, 255, 0.1);
  }

  .btn--primary:hover {
    opacity: 0.88;
  }

  .btn:disabled {
    cursor: default;
    opacity: 0.55;
  }

  .btn--danger {
    color: var(--error);
    background: transparent;
    border: 0.1rem solid var(--rim);
  }

  .btn--danger:hover:not(:disabled) {
    background: rgba(255, 82, 82, 0.12);
    border-color: rgba(255, 82, 82, 0.3);
  }

  /* ── Painéis genéricos (Modelos, Permissões, Recursos, Atalhos, Ajuda) ── */
  .settings__function,
  .settings__shortcut,
  .settings__permission,
  .settings__feature,
  .settings__meter {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    padding: 1.2rem;
    background: var(--elevated);
    border: 0.1rem solid var(--rim);
    border-radius: 1rem;
  }

  .settings__function-title,
  .settings__help-title {
    font-size: 1.3rem;
    font-weight: 600;
    margin: 0;
    color: var(--text-p);
  }

  .settings__function-empty,
  .settings__function-local,
  .settings__guidance,
  .settings__shortcut-error,
  .settings__about {
    margin: 0;
    font-size: 1.2rem;
    color: var(--text-s);
  }

  .settings__function-provider,
  .settings__function-model {
    font: inherit;
    font-size: 1.2rem;
    padding: 0.6rem 1rem;
    color: var(--text-p);
    background: rgba(255, 255, 255, 0.04);
    border: 0.1rem solid var(--rim);
    border-radius: 0.7rem;
  }

  /* ── Modelos personalizados (URL + modelo + key) ─────────────────────── */
  .settings__custom {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    padding: 1.2rem;
    background: var(--elevated);
    border: 0.1rem solid var(--rim);
    border-radius: 1rem;
  }

  .settings__custom-form {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .settings__shortcut {
    flex-direction: row;
    align-items: center;
    flex-wrap: wrap;
  }

  .settings__shortcut-label {
    flex: 1 1 20rem;
    font-size: 1.3rem;
    color: var(--text-p);
  }

  .settings__shortcut-combo {
    font-size: 1.2rem;
    padding: 0.4rem 0.8rem;
    color: var(--text-s);
    border: 0.1rem solid var(--rim);
    border-radius: 0.6rem;
    background: rgba(255, 255, 255, 0.04);
  }

  .settings__shortcut-change,
  .settings__shortcut-reset,
  .settings__grant,
  .settings__help-action {
    font: inherit;
    font-size: 1.1rem;
    font-weight: 500;
    padding: 5px 1.2rem;
    border-radius: 6px;
    cursor: pointer;
    color: var(--text-s);
    background: rgba(255, 255, 255, 0.06);
    border: 0.1rem solid var(--rim);
    transition:
      background 0.12s,
      color 0.12s;
  }

  .settings__shortcut-change:hover,
  .settings__shortcut-reset:hover,
  .settings__grant:hover,
  .settings__help-action:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text-p);
  }

  .settings__shortcut-error {
    color: var(--error);
  }

  .settings__shortcut[data-shortcut-recording='true'] {
    border-color: rgba(90, 87, 232, 0.35);
  }

  .settings__permission {
    flex-direction: row;
    justify-content: space-between;
    gap: 1.6rem;
  }

  .settings__permission-name {
    font-size: 1.3rem;
    font-weight: 600;
    color: var(--text-p);
  }

  .settings__permission-function {
    text-align: right;
    font-size: 1.2rem;
    color: var(--text-t);
  }

  .settings__feature,
  .settings__meter {
    flex-direction: row;
    align-items: center;
    gap: 1rem;
    font-size: 1.3rem;
    color: var(--text-p);
  }

  .settings__help-link {
    font-size: 1.3rem;
    color: var(--iris);
    text-decoration: none;
  }

  .settings__help-link:hover {
    text-decoration: underline;
  }

  .settings__help-action,
  .settings__shortcut-reset {
    align-self: flex-start;
  }
</style>
