<script lang="ts">
  import { onMount } from 'svelte'
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import { listen } from '@tauri-apps/api/event'
  import AppBar from './surfaces/appbar/AppBar.svelte'
  import Home from './surfaces/home/Home.svelte'
  import Onboarding from './surfaces/onboarding/Onboarding.svelte'
  import Settings from './surfaces/settings/Settings.svelte'
  import Assistants from './surfaces/assistants/Assistants.svelte'
  import Overlay from './surfaces/overlay/Overlay.svelte'
  import { onHomeNavigate } from './surfaces/home/navigation'
  import { onOnboardingRestart } from './surfaces/onboarding/restart'
  import type { HomeProps } from './surfaces/home/types'

  type Surface = 'onboarding' | 'home' | 'settings' | 'assistants'

  const ONBOARDING_DONE_KEY = 'ray_onboarding_done'

  const currentWindow = getCurrentWindow()
  const isAppBarWindow = currentWindow.label === 'appbar'

  const initialSurface: Surface = localStorage.getItem(ONBOARDING_DONE_KEY)
    ? 'home'
    : 'onboarding'

  let surface = $state<Surface>(initialSurface)
  let overlayVisible = $state(false)

  const homeProps: HomeProps = {
    sessions: [],
    planName: 'Free',
    freeSessionsUsed: 0,
    freeSessionsTotal: 7,
    assistant: { name: 'Assistente Padrao', category: 'GENERAL' },
    memoryItems: [],
    sessionId: '',
    assistantId: '',
    context: [],
    credential: { kind: 'OPENAI', connectionMode: 'API_KEY', secret: '' },
  }

  function goTo(next: Surface): void {
    surface = next
  }

  onMount(() => {
    if (isAppBarWindow) return

    // Primeira execucao: exibir automaticamente para o onboarding.
    if (!localStorage.getItem(ONBOARDING_DONE_KEY)) {
      void currentWindow.show()
    }

    let unlistenNavigate: (() => void) | undefined

    void listen<{ surface: Surface }>('ray:navigate', (event) => {
      goTo(event.payload.surface)
    }).then((fn) => {
      unlistenNavigate = fn
    })

    const unsubHome = onHomeNavigate((dest) => goTo(dest))

    const unsubRestart = onOnboardingRestart(() => {
      localStorage.removeItem(ONBOARDING_DONE_KEY)
      goTo('onboarding')
    })

    return () => {
      unlistenNavigate?.()
      unsubHome()
      unsubRestart()
    }
  })

  function handleOnboardingComplete(): void {
    localStorage.setItem(ONBOARDING_DONE_KEY, '1')
    goTo('home')
  }
</script>

{#if isAppBarWindow}
  <AppBar />
{:else}
  <div class="app">
    {#if surface === 'onboarding'}
      <Onboarding oncomplete={handleOnboardingComplete} />
    {:else if surface === 'home'}
      <Home {...homeProps} />
    {:else if surface === 'settings'}
      <Settings />
    {:else if surface === 'assistants'}
      <Assistants />
    {/if}

    {#if overlayVisible}
      <Overlay />
    {/if}
  </div>
{/if}

<style>
  .app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
</style>
