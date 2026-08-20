import { describe, it, expect } from 'vitest'
import {
  dispatchAppBarNavigation,
  onAppBarNavigate,
  type AppBarDestination,
} from './navigation'

// Contrato T-401 / RF-010: o botão Home abre a superfície Home (T-402) e
// "Iniciar Configuração" abre o onboarding (T-405). As superfícies-alvo são
// itens independentes do run — a app bar emite o destino num canal pub/sub
// local, o mesmo padrão de home/navigation.ts (T-402), onboarding/restart.ts
// (T-405) e lib/glass/opacity.ts (T-400) — e quem monta as janelas decide o
// roteamento quando a camada App existir.
//
// Callbacks anotados com AppBarDestination explicitamente: no RED o módulo
// ausente tira a inferência contextual e gera implicit-any (precedente
// T-406); no GREEN a anotação permanece válida.

describe('navigation — canal de abertura de superfícies da app bar (RF-010)', () => {
  it('notifica os inscritos com o destino emitido; o retorno cancela a inscrição', () => {
    const received: AppBarDestination[] = []
    const unsubscribe = onAppBarNavigate((destination: AppBarDestination) =>
      received.push(destination),
    )

    dispatchAppBarNavigation('home')
    dispatchAppBarNavigation('onboarding')
    expect(received).toEqual(['home', 'onboarding'])

    unsubscribe()
    dispatchAppBarNavigation('home')
    expect(received).toEqual(['home', 'onboarding'])
  })

  it('notifica todos os inscritos', () => {
    const primeiro: AppBarDestination[] = []
    const segundo: AppBarDestination[] = []
    const unsubscribePrimeiro = onAppBarNavigate((destination: AppBarDestination) =>
      primeiro.push(destination),
    )
    onAppBarNavigate((destination: AppBarDestination) => segundo.push(destination))

    dispatchAppBarNavigation('onboarding')
    expect(primeiro).toEqual(['onboarding'])
    expect(segundo).toEqual(['onboarding'])

    unsubscribePrimeiro()
    dispatchAppBarNavigation('home')
    expect(primeiro).toEqual(['onboarding'])
    expect(segundo).toEqual(['onboarding', 'home'])
  })
})
