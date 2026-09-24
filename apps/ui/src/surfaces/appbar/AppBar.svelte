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

  <span class="appbar__grip" data-appbar-grip aria-hidden="true">
    <span></span>
    <span></span>
    <span></span>
  </span>

  <div class="appbar__grid">
    <button
      type="button"
      class="appbar__btn appbar__btn--home"
      aria-label="Home"
      title="Home"
      onclick={() => void navigateTo('home')}
    >
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
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
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
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
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="2.2" stroke="currentColor" stroke-width="1.5" />
        <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    </button>

    <!-- Bola do stealth (RF-010): O indicador de estado da barra — laranja
         acesa = ativo, apagada = inativo. Sem texto na barra (o aviso
         RF-508 de uso responsável viaja no tooltip). -->
    <button
      type="button"
      class="appbar__stealth"
      class:appbar__stealth--off={!stealthActive}
      data-appbar-stealth
      data-stealth-active={stealthActive}
      aria-label="Alternar stealth"
      title={stealthActive ? STEALTH_NOTICE : 'Stealth inativo — clique para ativar'}
      onclick={toggleStealth}
    ></button>

    <button
      type="button"
      class="appbar__btn"
      aria-label="Iniciar Configuracao"
      title="Iniciar Configuração (onboarding)"
      onclick={() => void navigateTo('onboarding')}
    >
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
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
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
        <circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.5" />
      </svg>
    </button>
  </div>
</nav>

<style>
  .appbar {
    /* Ocupa toda a janela Tauri (150x80 no tauri.conf.json).
       Evitamos position:fixed porque no WKWebView do macOS elementos fixed
       sao compostos em layer separada que nao entrega mousedown ao listener
       do documento — quebrando data-tauri-drag-region. */
    position: relative;
    width: 100%;
    height: 100dvh;
    isolation: isolate;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.6rem;
    color: var(--text-p);
    background: rgba(22, 24, 36, 0.9);
    border: 0.1rem solid rgba(255, 255, 255, 0.13);
    border-radius: 1.2rem;
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

  /* Faixa de arraste: 3 pontos horizontais no topo (o nav inteiro tambem e
     drag region; os pontos sao so o indicador visual). */
  .appbar__grip {
    display: flex;
    justify-content: center;
    gap: 3px;
    height: 0.4rem;
    flex-shrink: 0;
    opacity: 0.3;
  }

  .appbar__grip span {
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 50%;
    background: var(--text-p);
  }

  .appbar__grid {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(2, 1fr);
    gap: 0.5rem;
    align-items: center;
  }

  .appbar__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 2.6rem;
    padding: 0;
    color: var(--text-s);
    background: rgba(255, 255, 255, 0.06);
    border: 0.1rem solid rgba(255, 255, 255, 0.09);
    border-radius: 0.7rem;
    cursor: pointer;
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

  /* A bola do stealth: O indicador — laranja pulsante quando ativo. */
  .appbar__stealth {
    width: 100%;
    height: 2.6rem;
    padding: 0;
    background: var(--orange);
    border: 0.1rem solid rgba(255, 255, 255, 0.15);
    border-radius: 0.7rem;
    cursor: pointer;
    box-shadow: 0 0 8px rgba(255, 159, 10, 0.45);
    transition:
      background 0.15s,
      box-shadow 0.15s;
  }

  .appbar__stealth:hover {
    filter: brightness(1.12);
  }

  .appbar__stealth--off {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.09);
    box-shadow: none;
  }
</style>
