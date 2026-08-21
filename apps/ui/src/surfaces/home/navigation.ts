// Navegação entre superfícies a partir da Home (RF-011): Configurações
// (T-406) e Assistentes (T-407). Pub/sub local no padrão de
// lib/glass/opacity.ts (T-400): a superfície só emite o destino, e quem
// monta as janelas decide o roteamento quando aquelas superfícies existirem.

/** Superfícies alcançáveis a partir da Home. */
export type HomeDestination = 'settings' | 'assistants'

type HomeNavigationListener = (destination: HomeDestination) => void

const listeners = new Set<HomeNavigationListener>()

/** Observa navegações; o retorno cancela a inscrição. */
export function onHomeNavigate(listener: HomeNavigationListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Emite um destino de navegação para os inscritos. */
export function dispatchHomeNavigation(destination: HomeDestination): void {
  for (const listener of listeners) {
    listener(destination)
  }
}
