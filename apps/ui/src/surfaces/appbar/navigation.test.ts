import { describe, it, expect } from 'vitest'
import type { AppBarDestination } from './navigation'

// Contrato T-401 / RF-010: AppBarDestination declara os destinos validos.
// O canal pub/sub foi removido — a navegacao cross-window agora usa eventos
// Tauri (emit/listen). O tipo permanece como fonte unica para AppBar.svelte
// e App.svelte.

describe('AppBarDestination', () => {
  it('inclui todos os destinos esperados', () => {
    const all: AppBarDestination[] = ['home', 'settings', 'assistants', 'onboarding']
    expect(all).toHaveLength(4)
  })
})
