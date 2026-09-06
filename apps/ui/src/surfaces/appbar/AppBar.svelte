<script lang="ts">
  import { invoke } from '@tauri-apps/api/core'
  import { emit } from '@tauri-apps/api/event'
  import { glassTokens } from '../../lib/glass/tokens'
  import type { AppBarDestination } from './navigation'
  import type { AppBarProps } from './types'

  let {
    windowLabel = 'main',
    stealthExcluded = true,
  }: AppBarProps = $props()

  let stealthOverride = $state<boolean | null>(null)
  const stealthActive = $derived(stealthOverride ?? stealthExcluded)

  const STEALTH_NOTICE =
    'Stealth ativo: garanta o consentimento das pessoas capturadas. ' +
    'O uso é de inteira responsabilidade do usuário, inclusive a ' +
    'conformidade legal da gravação. Use de forma responsável.'

  function toggleStealth(): void {
    const nextExcluded = !stealthActive
    stealthOverride = nextExcluded
    void invoke('set_stealth', { windowLabel, excluded: nextExcluded })
  }

  async function navigateTo(dest: AppBarDestination): Promise<void> {
    await invoke('show_window', { windowLabel: 'main' })
    await emit('ray:navigate', { surface: dest })
  }

  async function hideMainWindow(): Promise<void> {
    await invoke('hide_window', { windowLabel: 'main' })
  }
</script>

<nav
  class="appbar"
  data-appbar
  data-tauri-drag-region
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
    <div class="appbar__grip" data-appbar-grip>
      <span class="appbar__grip-dot"></span>
      <span class="appbar__grip-dot"></span>
      <span class="appbar__grip-dot"></span>
    </div>

    <button
      type="button"
      class="appbar__btn appbar__btn--home"
      aria-label="Home"
      title="Home"
      onclick={() => void navigateTo('home')}
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2.5 7L8 2.5 13.5 7v6a1 1 0 01-1 1h-9a1 1 0 01-1-1V7z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
      </svg>
    </button>

    <button
      type="button"
      class="appbar__btn"
      aria-label="Assistentes"
      title="Assistentes"
      onclick={() => void navigateTo('assistants')}
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="2" y="2.5" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.5" />
        <rect x="9" y="2.5" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.5" />
        <rect x="2" y="9" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.5" />
        <rect x="9" y="9" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.5" />
      </svg>
    </button>

    <button
      type="button"
      class="appbar__btn"
      aria-label="Configuracoes"
      title="Configurações"
      onclick={() => void navigateTo('settings')}
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="2.2" stroke="currentColor" stroke-width="1.5" />
        <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    </button>

    <span class="appbar__status" data-appbar-status role="status">
      <span class="appbar__status-dot" class:appbar__status-dot--on={stealthActive}></span>
      {stealthActive ? 'Stealth ativo' : 'Stealth inativo'}
    </span>

    <!-- Bola laranja do stealth (RF-010): sem texto visível; o nome
         acessível fica no rótulo. O aviso RF-508 viaja no tooltip. -->
    <button
      type="button"
      class="appbar__stealth"
      aria-label="Alternar stealth"
      title={STEALTH_NOTICE}
      onclick={toggleStealth}
    ></button>

    <button
      type="button"
      class="appbar__btn"
      aria-label="Iniciar Configuracao"
      title="Iniciar Configuração (onboarding)"
      onclick={() => void navigateTo('onboarding')}
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M9.5 1.5L3 9h4l-1 5.5L12.5 7h-4l1-5.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
      </svg>
    </button>

    <button
      type="button"
      class="appbar__btn"
      aria-label="Ocultar"
      title="Ocultar janela principal"
      onclick={() => void hideMainWindow()}
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
        <circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.5" />
      </svg>
    </button>
  </div>

  {#if stealthActive}
    <p class="appbar__notice" data-stealth-notice>{STEALTH_NOTICE}</p>
  {/if}
</nav>

<style>
  .appbar {
    /* Ocupa toda a janela Tauri (height no tauri.conf.json).
       Evitamos position:fixed porque no WKWebView do macOS elementos fixed
       sao compostos em layer separada que nao entrega mousedown ao listener
       do documento — quebrando data-tauri-drag-region. */
    position: relative;
    width: 100%;
    height: 100dvh;
    isolation: isolate;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.8rem 1.2rem;
    color: var(--text-p);
    background: rgba(22, 24, 36, 0.9);
    border: 0.1rem solid rgba(255, 255, 255, 0.13);
    border-radius: 1.4rem;
    box-shadow:
      0 0.8rem 3.2rem rgba(0, 0, 0, 0.5),
      inset 0 1px 0 rgba(255, 255, 255, 0.07);
    overflow: hidden;
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
    gap: 0.6rem;
    flex-wrap: nowrap;
  }

  .appbar__grip {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 0.6rem 0.4rem 0.6rem 0.6rem;
    cursor: grab;
    flex-shrink: 0;
    opacity: 0.3;
  }

  .appbar__grip-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--text-p);
  }

  .appbar__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 3.2rem;
    height: 3.2rem;
    padding: 0;
    color: var(--text-s);
    background: rgba(255, 255, 255, 0.06);
    border: 0.1rem solid rgba(255, 255, 255, 0.09);
    border-radius: 0.9rem;
    cursor: pointer;
    flex-shrink: 0;
    transition:
      background 0.12s,
      color 0.12s;
  }

  .appbar__btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: var(--text-p);
  }

  .appbar__btn--home {
    color: var(--text-p);
    background: var(--iris-dim);
    border-color: var(--iris-border);
  }

  .appbar__btn--home:hover {
    background: rgba(90, 87, 232, 0.34);
    color: var(--text-p);
  }

  .appbar__status {
    flex: 1;
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
    font-size: 1.15rem;
    color: var(--text-t);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .appbar__status-dot {
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 50%;
    background: var(--text-t);
    flex-shrink: 0;
    transition: background 0.15s;
  }

  .appbar__status-dot--on {
    background: var(--orange);
    box-shadow: 0 0 6px rgba(255, 159, 10, 0.5);
  }

  .appbar__stealth {
    width: 2rem;
    height: 2rem;
    padding: 0;
    background: var(--orange);
    border: 0.1rem solid rgba(255, 255, 255, 0.15);
    border-radius: 50%;
    cursor: pointer;
    flex-shrink: 0;
    box-shadow: 0 0 8px rgba(255, 159, 10, 0.45);
    transition: transform 0.12s;
  }

  .appbar__stealth:hover {
    transform: scale(1.12);
  }

  .appbar__notice {
    margin: 0;
    font-size: 1.05rem;
    line-height: 1.35;
    color: var(--text-t);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
