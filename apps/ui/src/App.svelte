<script lang="ts">
  // Placeholder inicial da UI (T-001). As superfícies reais (app bar, home,
  // overlay, notch) chegam nas tasks da Fase 4 — ver apps/ui/src/surfaces/.
  let ready: boolean = $state(true)
</script>

<main>
  <h1>Ray</h1>
  <p class="status">{ready ? 'core conectado' : 'aguardando core'}</p>
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    gap: 0.5rem;
    font-family: system-ui, 'Segoe UI', Roboto, sans-serif;
    color: #08060d;
    background: #fff;
  }

  h1 {
    font-size: 2rem;
    margin: 0;
  }

  .status {
    margin: 0;
    color: #6b6375;
  }
</style>
