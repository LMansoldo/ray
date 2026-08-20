import { describe, it, expect } from 'vitest'
import { dispatchOnboardingRestart, onOnboardingRestart } from './restart'

// Contrato T-405 / RF-102: o onboarding deve poder ser reiniciado a qualquer
// momento via Ajuda → Reiniciar Integração (RF-1003). O menu Ajuda pertence a
// T-406; aqui vive o canal pub/sub local que a superfície de onboarding
// escuta — o mesmo padrão de navigation.ts (T-402) e lib/glass/opacity.ts
// (T-400). O T-406 só precisará chamar dispatchOnboardingRestart().

describe('restart — canal de reinício do onboarding (RF-102 / RF-1003)', () => {
  it('notifica os inscritos quando Reiniciar Integração é disparado', () => {
    const received: number[] = []
    const unsubscribe = onOnboardingRestart(() => received.push(1))

    dispatchOnboardingRestart()
    expect(received).toEqual([1])

    unsubscribe()
    dispatchOnboardingRestart()
    expect(received).toEqual([1])
  })
})
