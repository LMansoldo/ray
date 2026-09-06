import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte'
import Settings from './Settings.svelte'
import { onSettingsAction } from './settings-actions'
import type { SettingsAction } from './settings-actions'

// Contrato T-406 / RF-206 — aba Áudio e Tela: medidores de áudio por canal
// com opção de ocultar. A preferência persiste localmente em
// 'ray_audio_meters' ('1'/'0'; ausente = visível) e cada mudança sai pela
// fronteira declarada (settings-actions) E emite 'ray:meters-changed'
// {visible} para o consumidor global.

const { emitMock } = vi.hoisted(() => ({
  emitMock: vi.fn<(event: string, payload?: unknown) => Promise<void>>().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/event', () => ({
  emit: emitMock,
  listen: vi.fn().mockResolvedValue(() => {}),
}))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn().mockResolvedValue('1.2.3') }))

// Node 25 expõe um localStorage global experimental SEM métodos, que sombreia
// o do jsdom (window === globalThis no vitest). Instalamos um Storage em
// memória para exercitar a persistência real da preferência de medidores.
function installMemoryStorage(): void {
  const store = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (key) => (store.has(key) ? (store.get(key) as string) : null),
    key: (index) => Array.from(store.keys())[index] ?? null,
    removeItem: (key) => void store.delete(key),
    setItem: (key, value) => void store.set(key, value),
  }
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true })
}
installMemoryStorage()

async function openTab(container: HTMLElement, tab: string): Promise<void> {
  const button = container.querySelector(`[data-settings-tab="${tab}"]`)
  if (!button) {
    throw new Error(`aba ${tab} não encontrada`)
  }
  await fireEvent.click(button)
}

function metersToggle(container: HTMLElement): HTMLInputElement {
  const toggle = container.querySelector('[data-meters-toggle]') as HTMLInputElement | null
  if (!toggle) {
    throw new Error('opção de medidores não encontrada')
  }
  return toggle
}

afterEach(() => {
  cleanup()
  emitMock.mockClear()
  window.localStorage.removeItem('ray_audio_meters')
  window.localStorage.removeItem('ray_models')
})

describe('Áudio e Tela — opção de ocultar medidores (RF-206)', () => {
  it('renderiza a opção "Mostrar medidores de áudio" visível por padrão', async () => {
    const { container } = render(Settings)
    await openTab(container, 'audioScreen')

    const toggle = metersToggle(container)
    expect(toggle.type).toBe('checkbox')
    expect(toggle.checked, 'sem preferência salva, medidores visíveis').toBe(true)
    expect(container.querySelector('[data-settings-panel="audioScreen"]')?.textContent).toContain(
      'Mostrar medidores de áudio',
    )
  })

  it('fica desmarcada quando a preferência local declara medidores ocultos', async () => {
    window.localStorage.setItem('ray_audio_meters', '0')
    const { container } = render(Settings)
    await openTab(container, 'audioScreen')

    // A preferência local entra quando a hidratação do core resolve.
    await waitFor(() => {
      expect(metersToggle(container).checked).toBe(false)
    })
  })

  it('alternar persiste em ray_audio_meters, despacha e emite ray:meters-changed', async () => {
    const actions: SettingsAction[] = []
    const unsubscribe = onSettingsAction((action: SettingsAction) => actions.push(action))
    const { container } = render(Settings)
    await openTab(container, 'audioScreen')

    await fireEvent.click(metersToggle(container))

    expect(actions).toEqual([{ type: 'metersVisibilityChange', visible: false }])
    expect(window.localStorage.getItem('ray_audio_meters')).toBe('0')
    expect(emitMock).toHaveBeenCalledWith('ray:meters-changed', { visible: false })
    unsubscribe()
  })

  it('reexibir grava "1" e emite visible true', async () => {
    window.localStorage.setItem('ray_audio_meters', '0')
    const { container } = render(Settings)
    await openTab(container, 'audioScreen')

    await waitFor(() => {
      expect(metersToggle(container).checked).toBe(false)
    })
    await fireEvent.click(metersToggle(container))

    expect(window.localStorage.getItem('ray_audio_meters')).toBe('1')
    expect(emitMock).toHaveBeenCalledWith('ray:meters-changed', { visible: true })
  })
})
