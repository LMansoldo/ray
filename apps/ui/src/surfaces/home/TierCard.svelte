<script lang="ts">
  // Free tier (RF-901 / RF-902): contador de sessões grátis usadas e chamada
  // para iniciar o teste de 7 dias. O fluxo real do trial é item posterior —
  // aqui o botão apenas declara a ação na Home.
  import GlassPanel from '../../lib/glass/GlassPanel.svelte'
  import { glassTokens } from '../../lib/glass/tokens'

  let {
    freeSessionsUsed,
    freeSessionsTotal,
  }: {
    freeSessionsUsed: number
    freeSessionsTotal: number
  } = $props()
</script>

<div class="tier-card" data-tier-card>
  <GlassPanel>
    <div
      class="tier-card__body"
      style:--surface-fill={glassTokens.color.surface}
      style:--surface-border={glassTokens.color.border}
      style:--surface-content={glassTokens.color.content}
    >
      <p class="tier-card__counter">
        {freeSessionsUsed} de {freeSessionsTotal} usadas
      </p>
      <button type="button" class="tier-card__cta">Iniciar teste de 7 dias</button>
    </div>
  </GlassPanel>
</div>

<style>
  .tier-card__body {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.8rem;
  }

  .tier-card__counter {
    margin: 0;
  }

  .tier-card__cta {
    font: inherit;
    padding: 0.8rem 1.4rem;
    color: var(--surface-content);
    background: var(--surface-fill);
    border: 0.1rem solid var(--surface-border);
    border-radius: 1.2rem;
    cursor: pointer;
  }
</style>
