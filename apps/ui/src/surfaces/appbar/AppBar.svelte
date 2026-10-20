<script lang="ts">
  // Barra flutuante estilo toolbar macOS (RF-010): traffic lights à esquerda
  // (vermelho = Ocultar janela main, RF-504), segmented control de navegação
  // (Home/Assistentes/Configurações), chip de stealth com LED laranja
  // (RF-010/502; o aviso RF-508 de uso responsável viaja no tooltip) e botão
  // de onboarding. A barra inteira é drag region nativa (data-tauri-drag-
  // region + movableByWindowBackground no setup do core) — o grip de pontos
  // da barra antiga não existe mais.
  import { invoke } from '@tauri-apps/api/core'
  import { emit } from '@tauri-apps/api/event'
  import { glassTokens } from '../../lib/glass/tokens'
  import type { AppBarDestination } from './navigation'
  import type { AppBarProps } from './types'

  let {
    stealthExcluded = true,
  }: AppBarProps = $props()

  let stealthOverride = $state<boolean | null>(null)
  const stealthActive = $derived(stealthOverride ?? stealthExcluded)

  // Segmento ativo do segmented control: default Home, atualiza no clique.
  // A barra não recebe o estado real de navegação da janela main — o destaque
  // é otimista, reflexo do último destino pedido por aqui.
  let activeDest = $state<AppBarDestination>('home')

  const STEALTH_NOTICE =
    'Stealth ativo: garanta o consentimento das pessoas capturadas. ' +
    'O uso é de inteira responsabilidade do usuário, inclusive a ' +
    'conformidade legal da gravação. Use de forma responsável.'

  function toggleStealth(): void {
    const nextExcluded = !stealthActive
    stealthOverride = nextExcluded
    // Sem windowLabel: o modo stealth é GLOBAL — o core aplica em todas as
    // janelas participantes (windows::STEALTH_WINDOWS). Enviar só a janela
    // da AppBar deixava main/notch/overlay capture-excluded mesmo com o
    // stealth "desligado".
    void invoke('set_stealth', { excluded: nextExcluded })
  }

  async function navigateTo(dest: AppBarDestination): Promise<void> {
    activeDest = dest
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

  <div class="appbar__lights" data-appbar-lights aria-label="Controles de janela">
    <button
      type="button"
      class="appbar__light appbar__light--close"
      aria-label="Ocultar"
      title="Ocultar janela principal"
      onclick={() => void hideMainWindow()}
    ></button>
    <span class="appbar__light appbar__light--min" aria-hidden="true"></span>
    <span class="appbar__light appbar__light--zoom" aria-hidden="true"></span>
  </div>

  <span class="appbar__divider" aria-hidden="true"></span>

  <div class="appbar__segments" role="group" aria-label="Navegação">
    <button
      type="button"
      class="appbar__segment"
      class:appbar__segment--on={activeDest === 'home'}
      aria-label="Home"
      title="Home"
      onclick={() => void navigateTo('home')}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2.5 7L8 2.5 13.5 7v6a1 1 0 01-1 1h-9a1 1 0 01-1-1V7z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
      </svg>
      Home
    </button>

    <button
      type="button"
      class="appbar__segment"
      class:appbar__segment--on={activeDest === 'assistants'}
      aria-label="Assistentes"
      title="Assistentes"
      onclick={() => void navigateTo('assistants')}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="2" y="2.5" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.5" />
        <rect x="9" y="2.5" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.5" />
        <rect x="2" y="9" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.5" />
        <rect x="9" y="9" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.5" />
      </svg>
      Assistentes
    </button>

    <button
      type="button"
      class="appbar__segment"
      class:appbar__segment--on={activeDest === 'settings'}
      aria-label="Configuracoes"
      title="Configurações"
      onclick={() => void navigateTo('settings')}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="2.2" stroke="currentColor" stroke-width="1.5" />
        <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
      Configurações
    </button>
  </div>

  <span class="appbar__divider" aria-hidden="true"></span>

  <!-- Chip do stealth: LED laranja acesa = ativo (mesma semântica da bola
       antiga). Sem texto de estado visível — o aviso RF-508 viaja no tooltip. -->
  <button
    type="button"
    class="appbar__stealth"
    class:appbar__stealth--off={!stealthActive}
    data-appbar-stealth
    data-stealth-active={stealthActive}
    aria-label="Alternar stealth"
    aria-pressed={stealthActive}
    title={stealthActive ? STEALTH_NOTICE : 'Stealth inativo — clique para ativar'}
    onclick={toggleStealth}
  >
    <span class="appbar__stealth-led" aria-hidden="true"></span>
    <span class="appbar__stealth-label">Stealth</span>
  </button>

  <button
    type="button"
    class="appbar__tool"
    aria-label="Iniciar Configuracao"
    title="Iniciar Configuração (onboarding)"
    onclick={() => void navigateTo('onboarding')}
  >
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M9.5 1.5L3 9h4l-1 5.5L12.5 7h-4l1-5.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
    </svg>
  </button>
</nav>

<style>
  /* Ocupa toda a janela Tauri (580x56 no tauri.conf.json). Evitamos
     position:fixed porque no WKWebView do macOS elementos fixed são
     compostos em layer separada que não entrega mousedown ao listener do
     documento — quebrando data-tauri-drag-region. */
  .appbar {
    position: relative;
    width: 100%;
    height: 100dvh;
    isolation: isolate;
    display: flex;
    align-items: center;
    gap: 1.2rem;
    padding: 0 1.2rem 0 1.6rem;
    color: var(--text-p);
    background: rgba(22, 24, 36, 0.9);
    border: 0.1rem solid rgba(255, 255, 255, 0.13);
    border-radius: 1.2rem;
    box-shadow:
      0 0 0 0.5px rgba(0, 0, 0, 0.7),
      0 1.6rem 4rem rgba(0, 0, 0, 0.5),
      inset 0 1px 0 rgba(255, 255, 255, 0.07);
    overflow: hidden;
    backdrop-filter: blur(var(--surface-blur));
    -webkit-backdrop-filter: blur(var(--surface-blur));
    cursor: default;
    user-select: none;
    -webkit-user-select: none;
  }

  .appbar__refraction {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
  }

  /* ── Traffic lights (vermelho funcional = Ocultar; demais decorativos) ── */
  .appbar__lights {
    display: flex;
    gap: 0.8rem;
    flex-shrink: 0;
  }

  .appbar__light {
    width: 1.2rem;
    height: 1.2rem;
    border-radius: 50%;
    border: 0.5px solid rgba(0, 0, 0, 0.22);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    position: relative;
    transition: filter 0.12s;
  }

  .appbar__light::before {
    font: 700 0.9rem/1 -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
    color: rgba(0, 0, 0, 0.55);
    opacity: 0;
    transition: opacity 0.1s;
  }

  /* Glifos aparecem no hover do grupo, como no macOS. */
  .appbar__lights:hover .appbar__light::before {
    opacity: 1;
  }

  .appbar__light--close {
    background: #ff5f57;
    cursor: pointer;
  }

  .appbar__light--close::before {
    content: 'x';
  }

  .appbar__light--close:active {
    filter: brightness(0.8);
  }

  .appbar__light--min,
  .appbar__light--zoom {
    background: rgba(255, 255, 255, 0.1);
  }

  .appbar__light--min::before {
    content: '-';
  }

  .appbar__light--zoom::before {
    content: '+';
  }

  .appbar__divider {
    width: 1px;
    height: 2.4rem;
    background: rgba(255, 255, 255, 0.09);
    flex-shrink: 0;
  }

  /* ── Segmented control de navegação ── */
  .appbar__segments {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: rgba(255, 255, 255, 0.05);
    border: 0.1rem solid rgba(255, 255, 255, 0.07);
    border-radius: 0.8rem;
    flex-shrink: 0;
  }

  .appbar__segment {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    height: 2.8rem;
    padding: 0 1.1rem;
    font: 500 1.15rem -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
    color: var(--text-s);
    background: transparent;
    border: none;
    border-radius: 0.6rem;
    cursor: pointer;
    white-space: nowrap;
    transition:
      background 0.12s,
      color 0.12s;
  }

  .appbar__segment:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-p);
  }

  .appbar__segment--on {
    background: var(--iris-dim);
    color: var(--text-p);
    box-shadow: inset 0 0 0 1px var(--iris-border);
  }

  .appbar__segment--on svg {
    color: var(--iris);
  }

  /* ── Chip do stealth: LED laranja + rótulo ── */
  .appbar__stealth {
    display: inline-flex;
    align-items: center;
    gap: 0.7rem;
    height: 3.2rem;
    padding: 0 1.2rem;
    background: rgba(255, 255, 255, 0.05);
    border: 0.1rem solid rgba(255, 255, 255, 0.09);
    border-radius: 1.6rem;
    cursor: pointer;
    flex-shrink: 0;
    transition:
      background 0.15s,
      border-color 0.15s;
  }

  .appbar__stealth:hover {
    background: rgba(255, 255, 255, 0.09);
  }

  .appbar__stealth-led {
    width: 0.8rem;
    height: 0.8rem;
    border-radius: 50%;
    background: var(--orange);
    box-shadow: 0 0 0.6rem rgba(255, 159, 10, 0.65);
    transition:
      background 0.15s,
      box-shadow 0.15s;
  }

  .appbar__stealth-label {
    font: 500 1.15rem -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
    color: var(--text-s);
    transition: color 0.15s;
  }

  .appbar__stealth--off .appbar__stealth-led {
    background: rgba(255, 255, 255, 0.16);
    box-shadow: none;
  }

  .appbar__stealth--off .appbar__stealth-label {
    color: var(--text-t);
  }

  /* ── Botão de ícone solto (onboarding) ── */
  .appbar__tool {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 3.2rem;
    height: 3.2rem;
    color: var(--text-s);
    background: rgba(255, 255, 255, 0.05);
    border: 0.1rem solid rgba(255, 255, 255, 0.09);
    border-radius: 0.8rem;
    cursor: pointer;
    flex-shrink: 0;
    transition:
      background 0.12s,
      color 0.12s;
  }

  .appbar__tool:hover {
    background: rgba(255, 255, 255, 0.11);
    color: var(--text-p);
  }

  .appbar__tool:active {
    background: rgba(255, 255, 255, 0.16);
  }
</style>
