// Canal de reinício do onboarding (RF-102 / RF-1003): o menu Ajuda →
// Reiniciar Integração pertence a T-406 (Configurações); aqui vive o canal
// pub/sub local que a superfície escuta — mesmo padrão de navigation.ts
// (T-402) e lib/glass/opacity.ts (T-400). O T-406 só precisa chamar
// dispatchOnboardingRestart().

type OnboardingRestartListener = () => void

const listeners = new Set<OnboardingRestartListener>()

/** Observa pedidos de reinício da integração; o retorno cancela a inscrição. */
export function onOnboardingRestart(listener: OnboardingRestartListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Emite o pedido de reinício para os inscritos. */
export function dispatchOnboardingRestart(): void {
  for (const listener of listeners) {
    listener()
  }
}
