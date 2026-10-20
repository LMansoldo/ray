import { describe, it, expect, vi, beforeEach } from 'vitest'
import { onSettingsAction, dispatchSettingsAction, saveOverlayTemplate } from './settings-actions'
import type { SettingsAction } from './settings-actions'

// Contrato T-406: canal de ações declaradas da superfície Configurações —
// a fronteira de SAÍDA do estado da UI. Comandos que o núcleo já registra
// saem direto por invoke() (save_overlay_template — emite o evento global
// ray:overlay-template-changed para o overlay atualizar ao vivo); ações sem
// comando core ainda saem pelo canal pub/sub local (mesmo padrão de
// navigation.ts T-402, restart.ts T-405 e lib/glass/opacity.ts T-400). A UI
// NUNCA inventa um nome de comando por conta própria (general.md: o contrato
// é a fronteira).

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

beforeEach(() => {
  invokeMock.mockReset()
  invokeMock.mockResolvedValue(undefined)
})

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

describe('settings-actions — overlay customizado (save_overlay_template)', () => {
  it('overlayTemplateChange é entregue pelo canal declarado', () => {
    const received: SettingsAction[] = []
    const unsubscribe = onSettingsAction((action: SettingsAction) => received.push(action))

    dispatchSettingsAction({ type: 'overlayTemplateChange', enabled: true, template: '<p>x</p>' })

    expect(received).toEqual([{ type: 'overlayTemplateChange', enabled: true, template: '<p>x</p>' }])
    unsubscribe()
  })

  it('saveOverlayTemplate invoca o comando core com { enabled, template }', async () => {
    await saveOverlayTemplate(true, '<div data-ray-body>{{bodyHtml}}</div>')

    expect(invokeMock).toHaveBeenCalledWith('save_overlay_template', {
      enabled: true,
      template: '<div data-ray-body>{{bodyHtml}}</div>',
    })
  })

  it('saveOverlayTemplate propaga a falha do núcleo (a aba exibe o erro inline)', async () => {
    invokeMock.mockRejectedValue(new Error('sidecar not started'))

    await expect(saveOverlayTemplate(false, '')).rejects.toThrow('sidecar not started')
  })
})
