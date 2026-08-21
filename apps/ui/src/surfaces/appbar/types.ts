// Tipos da superfície AppBar (T-401 / RF-010). Fonte única das props da
// barra — precedente T-402 attempt 3: ComponentProps<.svelte> degrada para
// never sob o svelte-check, então as props vivem aqui em types.ts.

export type AppBarProps = {
  /**
   * Label da janela Tauri alvo dos comandos set_stealth e toggle_window.
   * Padrão 'main' — label da única janela declarada em core/tauri.conf.json.
   */
  windowLabel?: string
  /**
   * Estado inicial da exclusão de captura (stealth). Não existe comando de
   * LEITURA de estado em core/src/lib.rs: quem monta a barra (App shell)
   * informa o estado real ao montar. Padrão false (inativo).
   */
  stealthExcluded?: boolean
}
