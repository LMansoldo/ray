<script lang="ts">
  // Superfície Onboarding (T-405): fluxo ordenado de 6 passos (RF-101) —
  // permissões, áudio, transcrição, análise, comunidade (opcional) e o trial
  // de 7 dias (RF-902). A progressão é travada pelo estado real de cada passo
  // (RF-103 / RF-104), relido do adaptador local state-feed.ts a cada clique
  // (o comando core que forneceria o estado ainda não existe). O reinício
  // (Ajuda → Reiniciar Integração, RF-102 / RF-1003) chega pelo canal local
  // restart.ts; o menu Ajuda em si pertence a T-406.
  import { glassTokens } from '../../lib/glass/tokens'
  import { onOnboardingRestart } from './restart'
  import { readOnboardingState } from './state-feed'
  import type {
    OnboardingPermissionId,
    OnboardingPlatform,
    OnboardingState,
  } from './types'

  /** Títulos dos 6 passos, na ordem exata do RF-101. */
  const STEP_TITLES = [
    'Verificação de permissões',
    'Configuração de áudio',
    'Transcrição',
    'Análise de texto e imagem',
    'Comunidade e ajuda',
    'Trial de 7 dias',
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

  /** O avanço trava no primeiro passo incompleto; 5 é opcional, 6 é terminal. */
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
    const state = readOnboardingState()
    onboardingState = state
    if (!canAdvanceFrom(currentStep, state)) {
      return
    }
    currentStep += 1
  }

  function skipCommunity(): void {
    onboardingState = readOnboardingState()
    currentStep = 6
  }
</script>

<main
  class="onboarding"
  style:--surface-fill={glassTokens.color.surface}
  style:--surface-border={glassTokens.color.border}
  style:--surface-content={glassTokens.color.content}
  style:--surface-shadow={glassTokens.shadow.background}
>
  <ol class="onboarding__steps">
    {#each STEP_TITLES as title (title)}
      <li class="onboarding__step-item" data-onboarding-step-item>{title}</li>
    {/each}
  </ol>

  <!-- O resumo de permissões persiste no DOM além do passo 1: o contrato
       pina as linhas [data-permission-row] consultáveis também depois de
       avançar (ver decisions.md — teste do RF-103 no Windows). -->
  <section class="onboarding__permissions">
    {#each rows as row (row.id)}
      <div
        class="onboarding__permission"
        data-permission-row={row.id}
        data-permission-state={onboardingState.permissions[row.id]}
      >
        <span class="onboarding__permission-name">{row.name}</span>
        <span class="onboarding__permission-function">{row.function}</span>
      </div>
    {/each}

    {#if !step1Complete}
      <!-- O comando core que abriria as preferências de sistema ainda não
           existe; quando existir, este CTA passa a invocá-lo. -->
      <button type="button" class="onboarding__grant" data-onboarding-grant-missing>
        Conceder permissões ausentes
      </button>
      <p class="onboarding__guidance" data-onboarding-restart-guidance>
        Conclua a configuração e reinicie o app para aplicar as permissões.
      </p>
    {/if}
  </section>

  <section class="onboarding__panel" data-onboarding-step={currentStep}>
    <h2 class="onboarding__title">{STEP_TITLES[currentStep - 1]}</h2>

    {#if currentStep >= 2 && currentStep <= 4}
      <p class="onboarding__status" data-onboarding-step-status>
        {stepConfigured(currentStep) ? 'Configurado' : 'Não configurado'}
      </p>
    {:else if currentStep === 5}
      <button
        type="button"
        class="onboarding__skip"
        data-onboarding-skip
        onclick={skipCommunity}
      >
        Pular
      </button>
    {:else if currentStep === 6}
      <div class="onboarding__trial" data-trial-card>
        <button type="button" class="onboarding__trial-start">
          Iniciar teste de 7 dias
        </button>
      </div>
    {/if}
  </section>

  {#if currentStep < 6}
    <button type="button" class="onboarding__next" data-onboarding-next onclick={advance}>
      Avançar
    </button>
  {/if}
</main>

<style>
  .onboarding {
    display: flex;
    flex-direction: column;
    gap: 1.6rem;
    max-width: 72rem;
    margin: 0 auto;
    padding: 1.6rem;
  }

  .onboarding__steps {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .onboarding__step-item {
    font-size: 1.2rem;
    padding: 0.6rem 1rem;
    color: var(--surface-content);
    background: var(--surface-fill);
    border: 0.1rem solid var(--surface-border);
    border-radius: 2rem;
  }

  .onboarding__panel {
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

  .onboarding__title {
    font-size: 1.6rem;
    margin: 0;
  }

  .onboarding__permissions {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }

  .onboarding__permission {
    display: flex;
    justify-content: space-between;
    gap: 1.6rem;
    padding: 0.8rem 1.2rem;
    border: 0.1rem solid var(--surface-border);
    border-radius: 1.2rem;
  }

  .onboarding__permission-name {
    font-weight: 600;
  }

  .onboarding__permission-function {
    text-align: right;
  }

  .onboarding__guidance,
  .onboarding__status {
    margin: 0;
    font-size: 1.3rem;
  }

  .onboarding__next,
  .onboarding__skip,
  .onboarding__grant,
  .onboarding__trial-start {
    font: inherit;
    padding: 0.8rem 1.4rem;
    color: var(--surface-content);
    background: var(--surface-fill);
    border: 0.1rem solid var(--surface-border);
    border-radius: 1.2rem;
    cursor: pointer;
  }

  .onboarding__next {
    align-self: flex-end;
  }

  .onboarding__trial {
    padding: 1.6rem;
    border: 0.1rem solid var(--surface-border);
    border-radius: 1.2rem;
    box-shadow: var(--surface-shadow);
  }
</style>
