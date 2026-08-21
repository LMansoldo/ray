// Canal de navegação da app bar (T-401 / RF-010): o botão Home abre a
// superfície Home (T-402) e "Iniciar Configuração" abre o onboarding
// (T-405). As superfícies-alvo são itens independentes do run — a barra só
// emite o destino num canal pub/sub local, mesmo padrão de
// home/navigation.ts (T-402), onboarding/restart.ts (T-405) e
// lib/glass/opacity.ts (T-400); quem monta as janelas decide o roteamento
// quando a camada App existir.

/** Superfícies que a app bar pode abrir. */
export type AppBarDestination = 'home' | 'onboarding'

type AppBarNavigationListener = (destination: AppBarDestination) => void

const listeners = new Set<AppBarNavigationListener>()

/** Observa pedidos de abertura de superfície; o retorno cancela a inscrição. */
export function onAppBarNavigate(listener: AppBarNavigationListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Emite o destino para todos os inscritos. */
export function dispatchAppBarNavigation(destination: AppBarDestination): void {
  for (const listener of listeners) {
    listener(destination)
  }
}
