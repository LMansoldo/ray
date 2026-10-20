// Tipos da superfície AppBar (T-401 / RF-010). Fonte única das props da
// barra — precedente T-402 attempt 3: ComponentProps<.svelte> degrada para
// never sob o svelte-check, então as props vivem aqui em types.ts.

export type AppBarProps = {
  /**
   * Estado inicial da exclusão de captura (stealth). Não existe comando de
   * LEITURA de estado em core/src/lib.rs: quem monta a barra (App shell)
   * informa o estado real ao montar. Padrão true — o uso completo é o
   * default e o app nasce fora da captura de tela.
   *
   * O toggle é GLOBAL: `set_stealth` aplica em todas as janelas
   * participantes (windows::STEALTH_WINDOWS no core) — não há mais alvo por
   * janela, então não existe prop de label.
   */
  stealthExcluded?: boolean
}
