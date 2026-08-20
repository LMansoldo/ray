<script lang="ts">
  // Badge do plano atual (RF-903). Exibe o nome do plano vindo da Home.
  import { glassTokens } from '../../lib/glass/tokens'

  let { planName }: { planName: string } = $props()
</script>

<div
  class="plan-badge"
  data-plan-badge
  style:--surface-fill={glassTokens.color.surface}
  style:--surface-border={glassTokens.color.border}
  style:--surface-content={glassTokens.color.content}
>
  <span class="plan-badge__label">{planName}</span>
</div>

<style>
  .plan-badge {
    display: inline-flex;
    padding: 0.4rem 1rem;
    background: var(--surface-fill);
    border: 0.1rem solid var(--surface-border);
    border-radius: 99rem;
    color: var(--surface-content);
  }

  .plan-badge__label {
    font-size: 1.2rem;
  }
</style>
