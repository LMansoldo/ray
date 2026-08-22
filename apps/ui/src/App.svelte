<script lang="ts">
  import { onMount } from 'svelte'
  import AppBar from './surfaces/appbar/AppBar.svelte'
  import Home from './surfaces/home/Home.svelte'
  import Onboarding from './surfaces/onboarding/Onboarding.svelte'
  import Settings from './surfaces/settings/Settings.svelte'
  import Assistants from './surfaces/assistants/Assistants.svelte'
  import Overlay from './surfaces/overlay/Overlay.svelte'
  import { onAppBarNavigate } from './surfaces/appbar/navigation'
  import { onHomeNavigate } from './surfaces/home/navigation'
  import { onOnboardingRestart } from './surfaces/onboarding/restart'
  import type { HomeProps } from './surfaces/home/types'

  type Surface = 'onboarding' | 'home' | 'settings' | 'assistants'

  const ONBOARDING_DONE_KEY = 'ray_onboarding_done'
  const initialSurface: Surface = localStorage.getItem(ONBOARDING_DONE_KEY)
    ? 'home'
    : 'onboarding'

  let surface = $state<Surface>(initialSurface)
  let overlayVisible = $state(false)

  // Props placeholder para a Home — sem dados reais do core ainda.
  const homeProps: HomeProps = {
    sessions: [],
    planName: 'Free',
    freeSessionsUsed: 0,
    freeSessionsTotal: 7,
    assistant: { name: 'Assistente Padrão', category: 'GENERAL' },
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
    const unsubAppBar = onAppBarNavigate((dest) => {
      if (dest === 'onboarding') {
        localStorage.removeItem(ONBOARDING_DONE_KEY)
        goTo('onboarding')
      } else {
        goTo(dest)
      }
    })

    const unsubHome = onHomeNavigate((dest) => goTo(dest))

    const unsubRestart = onOnboardingRestart(() => {
      localStorage.removeItem(ONBOARDING_DONE_KEY)
      goTo('onboarding')
    })

    return () => {
      unsubAppBar()
      unsubHome()
      unsubRestart()
    }
  })

  function handleOnboardingComplete(): void {
    localStorage.setItem(ONBOARDING_DONE_KEY, '1')
    goTo('home')
  }
</script>

<div class="app">
  {#if surface === 'onboarding'}
    <Onboarding oncomplete={handleOnboardingComplete} />
  {:else}
    <AppBar />

    {#if surface === 'home'}
      <Home {...homeProps} />
    {:else if surface === 'settings'}
      <Settings />
    {:else if surface === 'assistants'}
      <Assistants />
    {/if}

    {#if overlayVisible}
      <Overlay />
    {/if}
  {/if}
</div>

<style>
  .app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
</style>
