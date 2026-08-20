import { describe, it, expect } from 'vitest'
import {
  dispatchOverlayAction,
  onOverlayAction,
  type OverlayAction,
} from './overlay-actions'

// Contrato T-403 / RF-331: a ação contextual "Ver caso de uso" do card de
// insight. Não existe comando core para "abrir caso de uso" (core/src/lib.rs
// registra apenas set_stealth/toggle_window/suggest/transcribe_pending_pcm) e
// frontend.md proíbe a UI de inventar um — a superfície emite a ação num canal
// pub/sub local (padrão home/navigation.ts T-402, onboarding/restart.ts T-405,
// lib/glass/opacity.ts T-400) e quem monta as janelas decide o destino.
//
// Callbacks anotados com OverlayAction explicitamente: no RED o módulo ausente
// tira a inferência contextual e gera implicit-any (precedente T-406); no
// GREEN a anotação permanece válida.

describe('overlay-actions — canal da ação contextual (RF-331)', () => {
  it('notifica os inscritos com a ação emitida; o retorno cancela a inscrição', () => {
    const received: OverlayAction[] = []
    const unsubscribe = onOverlayAction((action: OverlayAction) => received.push(action))

    dispatchOverlayAction({ type: 'viewUseCase', suggestionId: 's-1' })
    dispatchOverlayAction({ type: 'viewUseCase', suggestionId: 's-2' })
    expect(received).toEqual([
      { type: 'viewUseCase', suggestionId: 's-1' },
      { type: 'viewUseCase', suggestionId: 's-2' },
    ])

    unsubscribe()
    dispatchOverlayAction({ type: 'viewUseCase', suggestionId: 's-3' })
    expect(received).toEqual([
      { type: 'viewUseCase', suggestionId: 's-1' },
      { type: 'viewUseCase', suggestionId: 's-2' },
    ])
  })

  it('notifica todos os inscritos', () => {
    const primeiro: OverlayAction[] = []
    const segundo: OverlayAction[] = []
    const unsubscribePrimeiro = onOverlayAction((action: OverlayAction) =>
      primeiro.push(action),
    )
    onOverlayAction((action: OverlayAction) => segundo.push(action))

    dispatchOverlayAction({ type: 'viewUseCase', suggestionId: 's-1' })
    expect(primeiro).toEqual([{ type: 'viewUseCase', suggestionId: 's-1' }])
    expect(segundo).toEqual([{ type: 'viewUseCase', suggestionId: 's-1' }])

    unsubscribePrimeiro()
    dispatchOverlayAction({ type: 'viewUseCase', suggestionId: 's-2' })
    expect(primeiro).toEqual([{ type: 'viewUseCase', suggestionId: 's-1' }])
    expect(segundo).toEqual([
      { type: 'viewUseCase', suggestionId: 's-1' },
      { type: 'viewUseCase', suggestionId: 's-2' },
    ])
  })
})
