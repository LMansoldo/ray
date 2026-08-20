import { describe, it, expect } from 'vitest'
import { onSettingsAction, dispatchSettingsAction } from './settings-actions'
import type { SettingsAction } from './settings-actions'

// Contrato T-406: canal de ações declaradas da superfície Configurações —
// a fronteira de SAÍDA do estado da UI. Como nenhum comando core existe
// ainda para credenciais/atalhos/features/logs (core/src/lib.rs registra
// apenas set_stealth/toggle_window/suggest/transcribe_pending_pcm), as ações
// saem por este canal pub/sub local (mesmo padrão de navigation.ts T-402,
// restart.ts T-405 e lib/glass/opacity.ts T-400). Quando os comandos core
// existirem, este canal passa a chamá-los via invoke() — a UI NUNCA inventa
// um nome de comando por conta própria (general.md: contrato é fronteira).

describe('settings-actions — canal de ações declaradas', () => {
  it('entrega a ação despachada ao listener inscrito', () => {
    const received: SettingsAction[] = []
    const unsubscribe = onSettingsAction((action: SettingsAction) => received.push(action))

    const action: SettingsAction = { type: 'logFolderOpen' }
    dispatchSettingsAction(action)

    expect(received).toEqual([action])
    unsubscribe()
  })

  it('o retorno da inscrição cancela a entrega', () => {
    const received: SettingsAction[] = []
    const unsubscribe = onSettingsAction((action: SettingsAction) => received.push(action))

    unsubscribe()
    dispatchSettingsAction({ type: 'logCopy' })

    expect(received).toEqual([])
  })

  it('entrega a todos os listeners inscritos (fan-out)', () => {
    const first: SettingsAction[] = []
    const second: SettingsAction[] = []
    const unsubscribeFirst = onSettingsAction((action: SettingsAction) => first.push(action))
    const unsubscribeSecond = onSettingsAction((action: SettingsAction) => second.push(action))

    dispatchSettingsAction({ type: 'shortcutReset' })

    expect(first).toEqual([{ type: 'shortcutReset' }])
    expect(second).toEqual([{ type: 'shortcutReset' }])
    unsubscribeFirst()
    unsubscribeSecond()
  })
})
