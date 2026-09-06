<script lang="ts">
  // Superfície Onboarding (T-405): fluxo ordenado de 5 passos —
  // permissões, áudio, transcrição, análise e comunidade/ajuda (opcional,
  // terminal). O uso completo é o default — não existe passo de trial.
  // A progressão é travada pelo estado real de cada passo
  // (RF-103 / RF-104), relido do adaptador local state-feed.ts a cada clique
  // (o comando core que forneceria o estado ainda não existe). O reinício
  // (Ajuda → Reiniciar Integração, RF-102 / RF-1003) chega pelo canal local
  // restart.ts; o menu Ajuda em si pertence a T-406.
  import { glassTokens } from '../../lib/glass/tokens'
  import { onMount } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import { onOnboardingRestart } from './restart'
  import {
    loadOnboardingState,
    readOnboardingState,
    requestAllPermissions,
    setOnboardingStateFeed,
  } from './state-feed'
  import type {
    OnboardingPermissionId,
    OnboardingPlatform,
    OnboardingState,
  } from './types'

  let { oncomplete }: { oncomplete?: () => void } = $props()

  /** Títulos dos 5 passos, na ordem do fluxo (comunidade opcional/terminal). */
  const STEP_TITLES = [
    'Verificação de permissões',
    'Configuração de áudio',
    'Transcrição',
    'Análise de texto e imagem',
    'Comunidade e ajuda',
  ] as const

  /**
   * Permissões exigidas por plataforma (RF-103): o Reconhecimento de Fala só
   * é exigido no macOS (STT on-device); Windows/Linux usam Whisper embutido.
   */
  const REQUIRED_PERMISSIONS: Record<OnboardingPlatform, OnboardingPermissionId[]> = {
    macos: ['microphone', 'screenRecording', 'accessibility', 'speechRecognition'],
    windows: ['microphone', 'screenRecording', 'accessibility'],
    linux: ['microphone', 'screenRecording', 'accessibility'],
  }

  /** Linha do passo 1: permissão de sistema → função que ela habilita (RF-103). */
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

  let currentStep = $state(1)
  let onboardingState = $state<OnboardingState>(readOnboardingState())
  let requesting = $state(false)

  // Status real de permissões do core (TCC) na entrada da superfície. O
  // estado carregado também vira o feed ativo — advance() consulta o feed
  // (injetável nos testes; core-carregado no app). Se o core não responder
  // (testes jsdom), o feed injetado permanece intocado.
  async function refreshFromCore(): Promise<void> {
    const s = await loadOnboardingState()
    if (s === null) return
    setOnboardingStateFeed(() => s)
    onboardingState = s
  }

  onMount(() => {
    void refreshFromCore()
  })

  async function handleGrantMissing(): Promise<void> {
    requesting = true
    try {
      const state = await requestAllPermissions()
      if (state === null) return
      onboardingState = state
      setOnboardingStateFeed(() => state)
      // Permissão negada não reapresenta dialog: abre os Ajustes do Sistema
      // para a pendência restante (a recuperação é manual por natureza).
      const pending = (['microphone', 'speechRecognition', 'screenRecording', 'accessibility'] as OnboardingPermissionId[]).find(
        (id) => onboardingState.permissions[id] !== 'granted',
      )
      if (pending) {
        await invoke('open_permission_settings', { kind: pending })
      }
    } finally {
      requesting = false
    }
  }

  async function handleRefresh(): Promise<void> {
    await refreshFromCore()
  }

  const rows = $derived.by(() => buildPermissionRows(onboardingState.platform))

  const step1Complete = $derived.by(() => step1CompleteFor(onboardingState))

  // Reinício via Ajuda → Reiniciar Integração (RF-102): volta ao passo 1 de
  // qualquer ponto, relendo o estado no processo.
  $effect(() => {
    return onOnboardingRestart(() => {
      currentStep = 1
      onboardingState = readOnboardingState()
    })
  })

  /** Passo 1 completo ⇔ toda permissão exigida na plataforma satisfeita. */
  function step1CompleteFor(state: OnboardingState): boolean {
    return REQUIRED_PERMISSIONS[state.platform].every(
      (id) => state.permissions[id] !== 'notGranted',
    )
  }

  /** Passos 2-4: booleano de configuração exibido como status. */
  function stepConfigured(step: number): boolean {
    if (step === 2) {
      return onboardingState.audioDevicesConfigured
    }
    if (step === 3) {
      return onboardingState.transcriptionConfigured
    }
    return onboardingState.analysisConfigured
  }

  /** O avanço trava no primeiro passo incompleto; o passo 5 é opcional. */
  function canAdvanceFrom(step: number, state: OnboardingState): boolean {
    if (step === 1) {
      return step1CompleteFor(state)
    }
    if (step === 2) {
      return state.audioDevicesConfigured
    }
    if (step === 3) {
      return state.transcriptionConfigured
    }
    if (step === 4) {
      return state.analysisConfigured
    }
    return true
  }

  function advance(): void {
    // Consulta o feed ativo (injetável nos testes; core-carregado no app).
    const state = readOnboardingState()
    onboardingState = state
    if (!canAdvanceFrom(currentStep, state)) {
      return
    }
    currentStep += 1
  }
</script>

<main
  class="onboarding"
  style:--surface-blur={glassTokens.blur.surface}
>
  <ol class="onboarding__steps">
    {#each STEP_TITLES as title, index (title)}
      <li
        class="onboarding__step-item"
        class:on={currentStep === index + 1}
        class:done={currentStep > index + 1}
        data-onboarding-step-item
      >
        {title}
      </li>
    {/each}
  </ol>

  <!-- O resumo de permissões persiste no DOM além do passo 1: o contrato
       pina as linhas [data-permission-row] consultáveis também depois de
       avançar (ver decisions.md — teste do RF-103 no Windows). -->
  <section class="onboarding__permissions">
    {#each rows as row (row.id)}
      <div
        class="prow"
        class:prow--pending={onboardingState.permissions[row.id] === 'notGranted'}
        data-permission-row={row.id}
        data-permission-state={onboardingState.permissions[row.id]}
      >
        <span class="pinfo">
          <span class="pname">{row.name}</span>
          <span class="pfunc">{row.function}</span>
        </span>
        <span
          class="pstatus"
          class:pstatus--ok={onboardingState.permissions[row.id] !== 'notGranted'}
        >
          {onboardingState.permissions[row.id] === 'notGranted' ? 'Pendente' : 'Concedido'}
        </span>
      </div>
    {/each}

    {#if !step1Complete}
      <!-- "Habilitar tudo": dispara as dialogs TCC (mic, fala, tela) via core
           e abre os Ajustes do Sistema para o que continuar pendente. -->
      <button
        type="button"
        class="ob-btn ob-btn--primary"
        data-onboarding-grant-missing
        disabled={requesting}
        onclick={() => void handleGrantMissing()}
      >
        {requesting ? 'Solicitando…' : 'Habilitar tudo'}
      </button>
      <button
        type="button"
        class="ob-btn"
        data-onboarding-refresh-permissions
        onclick={() => void handleRefresh()}
      >
        Atualizar status
      </button>
    {/if}
  </section>

  <section class="onboarding__panel" data-onboarding-step={currentStep}>
    <span class="ob-eyebrow">Passo {currentStep} de {STEP_TITLES.length}</span>
    <h2 class="onboarding__title">{STEP_TITLES[currentStep - 1]}</h2>

    {#if currentStep >= 2 && currentStep <= 4}
      <p class="onboarding__status" data-onboarding-step-status>
        {stepConfigured(currentStep) ? 'Configurado' : 'Não configurado'}
      </p>
    {:else if currentStep === 5}
      <div class="onboarding__finish" data-finish-card>
        <button type="button" class="ob-btn ob-btn--primary" onclick={() => oncomplete?.()}>
          Concluir configuracao
        </button>
      </div>
    {/if}
  </section>

  {#if currentStep < 5}
    <button type="button" class="ob-btn ob-btn--primary onboarding__next" data-onboarding-next onclick={advance}>
      Avançar
    </button>
  {/if}
</main>

<style>
  .onboarding {
    display: flex;
    flex-direction: column;
    gap: 1.6rem;
    max-width: 50rem;
    margin: 0 auto;
    padding: 2.8rem 1.6rem;
  }

  /* ── Progresso de passos (pills) ── */
  .onboarding__steps {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .onboarding__step-item {
    font-size: 1.1rem;
    font-weight: 500;
    padding: 4px 1rem;
    color: var(--text-t);
    background: rgba(255, 255, 255, 0.05);
    border: 0.1rem solid var(--rim);
    border-radius: 2rem;
    transition:
      background 0.2s,
      color 0.2s,
      border-color 0.2s;
  }

  .onboarding__step-item.done {
    color: var(--text-s);
    border-color: rgba(90, 87, 232, 0.45);
  }

  .onboarding__step-item.on {
    color: var(--text-p);
    background: var(--iris-dim);
    border-color: rgba(90, 87, 232, 0.35);
  }

  /* ── Card do passo (mock: .ob-card) ── */
  .onboarding__panel {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
    padding: 2.8rem;
    background: var(--elevated);
    border: 0.1rem solid var(--rim);
    border-radius: 1rem;
    position: relative;
    overflow: hidden;
    backdrop-filter: blur(var(--surface-blur));
    -webkit-backdrop-filter: blur(var(--surface-blur));
  }

  .onboarding__panel::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 45%;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.04) 0%, transparent 100%);
    pointer-events: none;
  }

  .ob-eyebrow {
    font-size: 1.1rem;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--iris);
  }

  .onboarding__title {
    font-size: 2rem;
    font-weight: 700;
    letter-spacing: -0.025em;
    line-height: 1.2;
    text-wrap: balance;
    margin: 0;
    color: var(--text-p);
  }

  /* ── Tabela de permissões (mock: .perm-table / .prow) ── */
  .onboarding__permissions {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .prow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.9rem 1.2rem;
    background: rgba(255, 255, 255, 0.03);
    border: 0.1rem solid var(--rim);
    border-radius: 0.8rem;
  }

  .prow--pending {
    border-color: rgba(255, 214, 10, 0.3);
    background: rgba(255, 214, 10, 0.04);
  }

  .pinfo {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .pname {
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--text-p);
  }

  .pfunc {
    font-size: 1.1rem;
    color: var(--text-t);
  }

  .pstatus {
    font-size: 1.1rem;
    font-weight: 600;
    flex-shrink: 0;
    color: var(--yellow);
  }

  .pstatus--ok {
    color: var(--green);
  }

  .onboarding__guidance,
  .onboarding__status {
    margin: 0;
    font-size: 1.3rem;
    line-height: 1.65;
    color: var(--text-s);
  }

  /* ── Ações (mock: .ob-actions) ── */
  .ob-btn {
    font: inherit;
    font-size: 1.2rem;
    font-weight: 500;
    padding: 0.6rem 1.4rem;
    align-self: flex-end;
    color: var(--text-s);
    background: rgba(255, 255, 255, 0.06);
    border: 0.1rem solid var(--rim);
    border-radius: 0.7rem;
    cursor: pointer;
    transition:
      background 0.12s,
      color 0.12s;
  }

  .ob-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text-p);
  }

  .ob-btn--primary {
    color: #fff;
    background: var(--iris);
    border-color: rgba(255, 255, 255, 0.1);
  }

  .ob-btn--primary:hover {
    opacity: 0.88;
    background: var(--iris);
    color: #fff;
  }

  .onboarding__next {
    align-self: flex-end;
  }

  .onboarding__finish {
    display: flex;
    justify-content: flex-end;
  }
</style>
