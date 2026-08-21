<script lang="ts">
  // Superfície Configurações (T-406, RF-206/301..404/601..706/1001..1004):
  // 7 abas — Fontes de IA (BYOK, quatro modos de conexão), Modelos (seleção
  // por função), Áudio e Tela (medidores), Permissões (RF-103), Recursos
  // (toggles do contrato), Atalhos (espelho das regras do núcleo) e Ajuda.
  //
  // Sem props (padrão T-405 — evita o problema de tipagem de props do T-402).
  // O estado ENTRA pelo adaptador local settings-feed.ts, lido uma vez no
  // mount; as saídas SÃO as ações declaradas do canal settings-actions.ts —
  // nenhum comando core de settings existe ainda, e a UI nunca inventa um
  // nome de invoke() (general.md: o contrato é a fronteira). ADR-003: o
  // segredo digitado vive apenas no próprio campo e no payload credentialSave.
  import { glassTokens } from '../../lib/glass/tokens'
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
  import { readSettingsState } from './settings-feed'
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

  const settingsState: SettingsState = readSettingsState()

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

  // Opções de provedor por função = slots com status != notConfigured (RF-404).
  const configuredSlots = PROVIDER_CARDS.filter(
    (card) => settingsState.providerStatus[card.slot] !== 'notConfigured',
  )

  const localSpeechEngine = settingsState.platform === 'macos' ? 'Apple Speech' : 'Whisper embutido'

  let modelSelections = $state<Record<AiFunction, string>>({
    TRANSCRIPTION: settingsState.functionConfig.TRANSCRIPTION?.kind ?? '',
    ANALYSIS: settingsState.functionConfig.ANALYSIS?.kind ?? '',
    TRANSLATION: settingsState.functionConfig.TRANSLATION?.kind ?? '',
  })
  let modelInputs = $state<Record<AiFunction, string>>({
    TRANSCRIPTION: settingsState.functionConfig.TRANSCRIPTION?.model ?? '',
    ANALYSIS: settingsState.functionConfig.ANALYSIS?.model ?? '',
    TRANSLATION: settingsState.functionConfig.TRANSLATION?.model ?? '',
  })

  function changeFunctionProvider(event: Event, fn: AiFunction): void {
    const select = event.currentTarget as HTMLSelectElement
    if (!isProviderKind(select.value)) {
      return
    }
    dispatchSettingsAction({
      type: 'functionProviderChange',
      function: fn,
      kind: select.value,
      model: modelInputs[fn],
    })
  }

  // ── Áudio e Tela (RF-206) ─────────────────────────────────────────────

  function toggleMeters(event: MouseEvent): void {
    const checkbox = event.currentTarget as HTMLInputElement
    dispatchSettingsAction({ type: 'metersVisibilityChange', visible: checkbox.checked })
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

  const permissionRows = buildPermissionRows(settingsState.platform)
  const missingPermissions = permissionRows.some(
    (row) => settingsState.permissions[row.id] === 'notGranted',
  )

  // ── Recursos (RF-700) — dirigidos pelo contrato, sem feed ─────────────

  const FEATURE_LABELS: Record<FeatureToggleName, string> = {
    autoScroll: 'Rolagem Automática',
    selectToPrompt: 'Selecionar para Prompt',
    sessionTimer: 'Temporizador de Sessão',
    notchExperience: 'Experiência do Notch',
    autoCompaction: 'Compactação automática',
    quickScreenshotAnalysis: 'Análise Rápida de Screenshots',
  }

  let featureToggles = $state<FeatureToggles>({ ...DEFAULT_FEATURE_TOGGLES })

  function toggleFeature(event: MouseEvent, name: FeatureToggleName): void {
    const checkbox = event.currentTarget as HTMLInputElement
    featureToggles[name] = checkbox.checked
    dispatchSettingsAction({ type: 'featureToggleChange', name, enabled: checkbox.checked })
  }

  // ── Atalhos (RF-601/602/604) — estado do feed, espelho das regras core ──

  const SHORTCUT_LABELS: Record<ShortcutCommand, string> = {
    askOrSend: 'Perguntar/Enviar',
    captureScreen: 'Capturar Tela',
    toggleVoiceRecording: 'Gravação de Voz',
    toggleMicCapture: 'Alternar Captura do Microfone',
    scrollUp: 'Rolar Cima',
    scrollDown: 'Rolar Baixo',
    notchPreviousInsight: 'Insight Anterior do Notch',
    notchNextInsight: 'Insight Próximo do Notch',
    previousResponse: 'Resposta Anterior',
    nextResponse: 'Resposta Próxima',
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

  // Mapa LOCAL corrente (seedado do feed): a validação de duplicatas e o
  // efeito imediato (combo exibido, toggle) operam sobre ele.
  let shortcuts = $state<ShortcutMap>({ ...settingsState.shortcuts })
  let recordingCommand = $state<ShortcutCommand | null>(null)
  let shortcutError = $state<{ command: ShortcutCommand; message: string } | null>(null)

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
  }

  function resetShortcuts(): void {
    shortcuts = { ...DEFAULT_SHORTCUTS }
    shortcutError = null
    recordingCommand = null
    dispatchSettingsAction({ type: 'shortcutReset' })
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

<main
  class="settings"
  style:--surface-fill={glassTokens.color.surface}
  style:--surface-border={glassTokens.color.border}
  style:--surface-content={glassTokens.color.content}
  style:--surface-shadow={glassTokens.shadow.background}
>
  <nav class="settings__tabs">
    {#each TABS as tab (tab.id)}
      <button
        type="button"
        class="settings__tab"
        data-settings-tab={tab.id}
        onclick={() => openTab(tab.id)}
      >
        {tab.title}
      </button>
    {/each}
  </nav>

  {#if activeTab === 'aiSources'}
    <section class="settings__panel" data-settings-panel="aiSources">
      <div class="settings__filter">
        <button
          type="button"
          data-provider-filter="all"
          onclick={() => {
            providerFilter = 'all'
          }}
        >
          Todos
        </button>
        <button
          type="button"
          data-provider-filter="local"
          onclick={() => {
            providerFilter = 'local'
          }}
        >
          Local
        </button>
        <button
          type="button"
          data-provider-filter="cloud"
          onclick={() => {
            providerFilter = 'cloud'
          }}
        >
          Nuvem
        </button>
      </div>

      {#each visibleCards as card (card.slot)}
        <div class="settings__provider" data-provider-card={card.slot}>
          <h3 class="settings__provider-title">{card.title}</h3>
          <p class="settings__provider-status" data-provider-status={card.slot}>
            {PROVIDER_STATUS_LABELS[settingsState.providerStatus[card.slot]]}
          </p>
          {#if card.hasKeyInput}
            <input
              class="settings__provider-key"
              data-provider-key-input={card.slot}
              type="password"
              bind:value={keyValues[card.slot]}
            />
          {/if}
          {#if card.hasBaseUrlInput}
            <input
              class="settings__provider-baseurl"
              data-provider-baseurl-input
              type="text"
              placeholder="Endpoint base"
              bind:value={genericBaseUrl}
            />
          {/if}
          {#if card.hasSave}
            <button
              type="button"
              class="settings__provider-save"
              data-provider-save={card.slot}
              onclick={() => saveCredential(card.slot)}
            >
              Salvar
            </button>
          {/if}
        </div>
      {/each}
    </section>
  {/if}

  {#if activeTab === 'models'}
    <section class="settings__panel" data-settings-panel="models">
      {#each FUNCTIONS as fn (fn)}
        {@const config = settingsState.functionConfig[fn]}
        <div class="settings__function" data-function-selector={fn}>
          <h3 class="settings__function-title">{FUNCTION_TITLES[fn]}</h3>
          {#if !config}
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
          </select>
          <input
            class="settings__function-model"
            data-function-model-input
            bind:value={modelInputs[fn]}
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
        <!-- O comando core que abriria as preferências de sistema ainda não
             existe; quando existir, este CTA passa a invocá-lo. -->
        <button type="button" class="settings__grant">Conceder permissões ausentes</button>
        <p class="settings__guidance" data-settings-restart-guidance>
          Conclua a configuração e reinicie o app para aplicar as permissões.
        </p>
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
</main>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: 1.6rem;
    max-width: 72rem;
    margin: 0 auto;
    padding: 1.6rem;
  }

  .settings__tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
  }

  .settings__tab {
    font: inherit;
    font-size: 1.2rem;
    padding: 0.6rem 1rem;
    color: var(--surface-content);
    background: var(--surface-fill);
    border: 0.1rem solid var(--surface-border);
    border-radius: 2rem;
    cursor: pointer;
  }

  .settings__panel {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
    padding: 1.6rem;
    color: var(--surface-content);
    background: var(--surface-fill);
    border: 0.1rem solid var(--surface-border);
    border-radius: 1.2rem;
    box-shadow: var(--surface-shadow);
  }

  .settings__filter {
    display: flex;
    gap: 0.8rem;
  }

  .settings__filter button,
  .settings__provider-save,
  .settings__shortcut-change,
  .settings__shortcut-reset,
  .settings__grant,
  .settings__help-action {
    font: inherit;
    padding: 0.8rem 1.4rem;
    color: var(--surface-content);
    background: var(--surface-fill);
    border: 0.1rem solid var(--surface-border);
    border-radius: 1.2rem;
    cursor: pointer;
  }

  .settings__provider,
  .settings__function,
  .settings__shortcut,
  .settings__permission,
  .settings__feature,
  .settings__meter {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    padding: 1.2rem;
    border: 0.1rem solid var(--surface-border);
    border-radius: 1.2rem;
  }

  .settings__provider-title,
  .settings__function-title,
  .settings__help-title {
    font-size: 1.6rem;
    margin: 0;
  }

  .settings__provider-status,
  .settings__function-empty,
  .settings__function-local,
  .settings__guidance,
  .settings__shortcut-error,
  .settings__about {
    margin: 0;
    font-size: 1.3rem;
  }

  .settings__shortcut-error {
    color: #8a1f1f;
  }

  .settings__shortcut {
    flex-direction: row;
    align-items: center;
    flex-wrap: wrap;
  }

  .settings__shortcut-label {
    flex: 1 1 20rem;
  }

  .settings__shortcut-combo {
    font-size: 1.2rem;
    padding: 0.4rem 0.8rem;
    border: 0.1rem solid var(--surface-border);
    border-radius: 0.6rem;
  }

  .settings__permission {
    flex-direction: row;
    justify-content: space-between;
    gap: 1.6rem;
  }

  .settings__permission-name {
    font-weight: 600;
  }

  .settings__permission-function {
    text-align: right;
  }

  .settings__feature,
  .settings__meter {
    flex-direction: row;
    align-items: center;
    gap: 1rem;
  }

  .settings__help-link {
    color: var(--surface-content);
  }

  .settings__help-action,
  .settings__shortcut-reset {
    align-self: flex-start;
  }
</style>
