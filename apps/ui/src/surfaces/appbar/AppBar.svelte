<script lang="ts">
  // Superfície AppBar (T-401 / RF-010): barra flutuante compacta com grip de
  // arrastar nativo, botão Home (abre a superfície Home via canal local),
  // indicador de status, botão stealth (bola laranja — RF-502: alterna o
  // estado visivelmente via set_stealth) e "Iniciar Configuração" (abre o
  // onboarding via canal local). Ocultar é o panic hide (RF-504) — o mesmo
  // comando toggle_window do menu da bandeja (RF-010). Ativar o stealth
  // exibe o aviso de uso responsável e conformidade legal (RF-508, SRS §7).
  import { invoke } from '@tauri-apps/api/core'
  import { glassTokens } from '../../lib/glass/tokens'
  import { dispatchAppBarNavigation } from './navigation'
  import type { AppBarProps } from './types'

  let {
    windowLabel = 'main',
    stealthExcluded = false,
  }: AppBarProps = $props()

  // Alternância otimista (o comando core retorna void): o override local
  // parte de null — sem desvio do prop — e só muda no clique, então montar
  // com stealthExcluded=true nunca re-dispara set_stealth sozinho.
  let stealthOverride = $state<boolean | null>(null)
  const stealthActive = $derived(stealthOverride ?? stealthExcluded)

  // Aviso RF-508 (SRS 7.1-7.3): consentimento, uso responsável e
  // conformidade legal — responsabilidade do usuário.
  const STEALTH_NOTICE =
    'Stealth ativo: garanta o consentimento das pessoas capturadas. ' +
    'O uso é de inteira responsabilidade do usuário, inclusive a ' +
    'conformidade legal da gravação. Use de forma responsável.'

  function toggleStealth(): void {
    const nextExcluded = !stealthActive
    stealthOverride = nextExcluded
    void invoke('set_stealth', { windowLabel, excluded: nextExcluded })
  }

  function hideWindow(): void {
    void invoke('toggle_window', { windowLabel })
  }
</script>

<nav
  class="appbar"
  data-appbar
  style:--surface-fill={glassTokens.color.surface}
  style:--surface-border={glassTokens.color.border}
  style:--surface-content={glassTokens.color.content}
  style:--surface-shadow={glassTokens.shadow.background}
  style:--surface-blur={glassTokens.blur.surface}
>
  <span
    class="appbar__refraction"
    aria-hidden="true"
    style="background-image: {glassTokens.refraction.sheen};"
  ></span>
  <div class="appbar__bar">
    <!-- Alça de arraste declarativa (Tauri 2): o core não registra comando de
         drag e frontend.md proíbe a UI de inventar um. -->
    <div class="appbar__grip" data-appbar-grip data-tauri-drag-region>
      <span class="appbar__grip-dot"></span>
      <span class="appbar__grip-dot"></span>
      <span class="appbar__grip-dot"></span>
    </div>

    <button
      type="button"
      class="appbar__home"
      onclick={() => dispatchAppBarNavigation('home')}
    >
      Home
    </button>

    <span class="appbar__status" data-appbar-status role="status">
      {stealthActive ? 'Stealth ativo' : 'Stealth inativo'}
    </span>

    <!-- Bola laranja do stealth (RF-010): sem texto visível; o nome
         acessível fica no rótulo. -->
    <button
      type="button"
      class="appbar__stealth"
      aria-label="Alternar stealth"
      onclick={toggleStealth}
    ></button>

    <button
      type="button"
      class="appbar__nav"
      onclick={() => dispatchAppBarNavigation('assistants')}
    >
      Assistentes
    </button>

    <button
      type="button"
      class="appbar__nav"
      onclick={() => dispatchAppBarNavigation('settings')}
    >
      Configuracoes
    </button>

    <button
      type="button"
      class="appbar__setup"
      onclick={() => dispatchAppBarNavigation('onboarding')}
    >
      Onboarding
    </button>

    <button type="button" class="appbar__hide" onclick={hideWindow}>
      Ocultar
    </button>
  </div>

  {#if stealthActive}
    <p class="appbar__notice" data-stealth-notice>{STEALTH_NOTICE}</p>
  {/if}
</nav>

<style>
  .appbar {
    position: relative;
    isolation: isolate;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    max-width: 44rem;
    padding: 0.8rem;
    color: var(--surface-content);
    background: var(--surface-fill);
    border: 0.1rem solid var(--surface-border);
    border-radius: 1.2rem;
    box-shadow: var(--surface-shadow);
    backdrop-filter: blur(var(--surface-blur));
    -webkit-backdrop-filter: blur(var(--surface-blur));
  }

  .appbar__refraction {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
  }

  .appbar__bar {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    flex-wrap: wrap;
  }

  .appbar__grip {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.4rem 0.6rem;
    cursor: grab;
  }

  .appbar__grip-dot {
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 50%;
    background: var(--surface-content);
    opacity: 0.5;
  }

  .appbar__home,
  .appbar__nav,
  .appbar__setup,
  .appbar__hide {
    font: inherit;
    font-size: 1.2rem;
    padding: 0.5rem 1rem;
    color: var(--surface-content);
    background: transparent;
    border: 0.1rem solid var(--surface-border);
    border-radius: 1.2rem;
    cursor: pointer;
  }

  .appbar__status {
    flex: 1;
    min-width: 12rem;
    font-size: 1.2rem;
  }

  .appbar__stealth {
    width: 2rem;
    height: 2rem;
    padding: 0;
    background: #ff9500;
    border: 0.1rem solid var(--surface-border);
    border-radius: 50%;
    cursor: pointer;
  }

  .appbar__notice {
    margin: 0;
    padding: 0.8rem 1rem;
    font-size: 1.2rem;
    border: 0.1rem solid var(--surface-border);
    border-radius: 0.8rem;
  }
</style>
