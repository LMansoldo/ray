<script lang="ts">
  // Exemplo de consumo do design system Liquid Glass (T-400). As superfícies
  // reais (app bar, home, overlay, notch) chegam nas tasks seguintes da
  // Fase 4 — ver apps/ui/src/surfaces/.
  import GlassPanel from './lib/glass/GlassPanel.svelte'

  let ready: boolean = $state(true)
</script>

<main>
  <GlassPanel surface="home">
    <h1>Ray</h1>
    <p class="status">{ready ? 'core conectado' : 'aguardando core'}</p>
  </GlassPanel>
</main>

<style>
  main {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 2.4rem;
  }

  h1 {
    font-size: 2.4rem;
    margin: 0;
  }

  .status {
    margin: 0.4rem 0 0;
    opacity: 0.72;
  }
</style>
