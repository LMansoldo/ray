import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/svelte'
import InsightCard from './InsightCard.svelte'
import type { SuggestionStreamState } from './stream'
import type { InsightCardProps } from './types'
import { onOverlayAction, type OverlayAction } from './overlay-actions'

// Contrato T-403 / RF-331: o card de insight é o layout canônico do overlay
// (e do Notch, T-404): contexto da situação com ícone no topo, bloco
// "ELES DISSERAM" com a fala do outro falante, bloco "DIGA ISSO" com a
// resposta sugerida.
//
// O DIGA ISSO renderiza markdown via o renderizador read-only de streaming do
// T-408 (MarkdownView, lib/markdown) — NUNCA o editor Milkdown (ADR-011:
// "o renderer de streaming é read-only e leve; NÃO usar o editor completo
// para exibir tokens ao vivo"). O teste pina isso em DOM: [data-markdown-view]
// presente, .ProseMirror e [data-markdown-editor] ausentes.
//
// A rolagem automática (RF-701) vive no corpo rolável do DIGA ISSO
// ([data-insight-say-this-body]): acompanha o conteúdo mais novo até o fim;
// pausa quando o usuário rola para cima e retoma ao voltar ao fim. jsdom não
// faz layout: os testes definem scrollHeight/clientHeight via defineProperty
// (probe-verificado) e o componente reage ao evento de scroll real.
//
// Props tipadas contra a fonte única de tipos da superfície (types.ts), não
// via ComponentProps<InsightCard>: sob o svelte-check, a importação de um
// .svelte por um .ts resolve para o shape legado { $on?; $set? } e
// ComponentProps degrada para never (ver decisions.md T-402).

type Props = InsightCardProps

// Estado de exibição do card: o mesmo SuggestionStreamState que o Overlay
// deriva dos eventos do stream (stream.ts). 'idle' nunca chega ao card — o
// Overlay só o renderiza com stream ativo.
function makeState(partial: Partial<SuggestionStreamState> = {}): SuggestionStreamState {
  return {
    status: 'streaming',
    suggestionId: 's-1',
    text: '',
    ...partial,
  }
}

function baseProps(state: SuggestionStreamState = makeState()): Props {
  return { state }
}

// Regra do repo: sem emojis na UI.
const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u

function card(container: HTMLElement): Element {
  const root = container.querySelector('[data-insight-card]')
  expect(root, 'o card de insight deve existir').not.toBeNull()
  return root as Element
}

function sayThisBody(container: HTMLElement): HTMLElement {
  const body = container.querySelector('[data-insight-say-this-body]')
  expect(body, 'o corpo rolável do DIGA ISSO deve existir').not.toBeNull()
  return body as HTMLElement
}

// Segue o documento na ordem do RF-331: contexto → ELES DISSERAM → DIGA ISSO.
function expectBefore(first: Element | null, second: Element | null, message: string): void {
  expect(first, message).not.toBeNull()
  expect(second, message).not.toBeNull()
  expect(
    (first as Element).compareDocumentPosition(second as Element) &
      Node.DOCUMENT_POSITION_FOLLOWING,
    message,
  ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
}

let unsubscribeAction: (() => void) | undefined

afterEach(() => {
  unsubscribeAction?.()
  unsubscribeAction = undefined
  cleanup()
})

describe('InsightCard — layout canônico (RF-331)', () => {
  it('renderiza contexto com ícone no topo, ELES DISSERAM e DIGA ISSO', () => {
    const { container, getByRole } = render(InsightCard, {
      props: baseProps(
        makeState({
          contextLabel: 'Reunião de vendas',
          theySaid: 'Qual o preço?',
          text: 'Sugiro responder',
        }),
      ),
    })

    const root = card(container)
    const context = container.querySelector('[data-insight-context]')
    const theySaid = container.querySelector('[data-insight-they-said]')
    const sayThis = container.querySelector('[data-insight-say-this]')

    expect(root.getAttribute('data-insight-status')).toBe('streaming')
    expect(context?.textContent).toContain('Reunião de vendas')
    expect(container.querySelector('[data-insight-context-icon]'), 'RF-331: contexto com ícone').not.toBeNull()
    expect(theySaid?.textContent).toContain('ELES DISSERAM')
    expect(theySaid?.textContent).toContain('Qual o preço?')
    expect(sayThis?.textContent).toContain('DIGA ISSO')
    expect(sayThis?.textContent).toContain('Sugiro responder')

    expectBefore(context, theySaid, 'contexto deve vir antes de ELES DISSERAM (RF-331)')
    expectBefore(theySaid, sayThis, 'ELES DISSERAM deve vir antes de DIGA ISSO (RF-331)')
  })

  it('sem contexto nem fala do outro, o card não quebra e o ícone continua presente', () => {
    const { container } = render(InsightCard, {
      props: baseProps(makeState({ text: 'Resposta' })),
    })

    expect(container.querySelector('[data-insight-context-icon]'), 'ícone do contexto sempre presente').not.toBeNull()
    expect(container.querySelector('[data-insight-they-said]')?.textContent).toContain('ELES DISSERAM')
    expect(container.querySelector('[data-insight-say-this]')?.textContent).toContain('Resposta')
  })

  it('exibe o status done e o status error como atributo do card', () => {
    const { container: doneContainer } = render(InsightCard, {
      props: baseProps(
        makeState({ status: 'done', text: 'Olá', providerKind: 'DEEPSEEK', model: 'deepseek-chat' }),
      ),
    })
    expect(card(doneContainer).getAttribute('data-insight-status')).toBe('done')
    cleanup()

    const { container: errorContainer } = render(InsightCard, {
      props: baseProps(
        makeState({
          status: 'error',
          text: 'Olá',
          error: { code: 'AGENT_ERROR', message: 'provedor falhou' },
        }),
      ),
    })
    expect(card(errorContainer).getAttribute('data-insight-status')).toBe('error')
  })
})

describe('InsightCard — DIGA ISSO usa o renderizador de streaming do T-408 (ADR-011)', () => {
  it('renderiza o markdown acumulado via MarkdownView, nunca o editor Milkdown', () => {
    const { container } = render(InsightCard, {
      props: baseProps(makeState({ text: 'Olá **mundo**' })),
    })

    const body = sayThisBody(container)
    expect(
      body.querySelector('[data-markdown-view]'),
      'o DIGA ISSO deve delegar ao renderizador read-only do T-408',
    ).not.toBeNull()
    expect(
      body.querySelector('strong')?.textContent,
      'o markdown deve ser processado (strong), não exibido cru',
    ).toBe('mundo')
    expect(body.textContent).toContain('Olá mundo')

    // ADR-011: nunca o editor completo para exibir tokens ao vivo.
    expect(body.querySelector('.ProseMirror'), 'nunca o editor ProseMirror no card').toBeNull()
    expect(body.querySelector('[data-markdown-editor]'), 'nunca o componente editor no card').toBeNull()
  })

  it('com texto vazio (início do stream) a view continua montada e sem conteúdo', () => {
    const { container } = render(InsightCard, { props: baseProps(makeState({ text: '' })) })

    const body = sayThisBody(container)
    expect(body.querySelector('[data-markdown-view]')).not.toBeNull()
    expect(body.querySelector('[data-markdown-view]')?.textContent).toBe('')
  })
})

describe('InsightCard — erro no meio do stream (RF-332, T-303)', () => {
  it('exibe o erro sem perder o texto acumulado no DIGA ISSO', () => {
    const { container } = render(InsightCard, {
      props: baseProps(
        makeState({
          status: 'error',
          text: 'Olá',
          error: { code: 'AGENT_ERROR', message: 'provedor falhou' },
        }),
      ),
    })

    const error = container.querySelector('[data-insight-error]')
    expect(error, 'o erro deve ser exibido no card').not.toBeNull()
    expect(error?.textContent).toContain('provedor falhou')
    expect(container.querySelector('[data-insight-say-this]')?.textContent).toContain('Olá')
  })
})

describe('InsightCard — rolagem automática (RF-701)', () => {
  function withScrollMetrics(container: HTMLElement): {
    body: HTMLElement
    setScrollHeight: (height: number) => void
  } {
    const body = sayThisBody(container)
    let scrollHeight = 1000
    Object.defineProperty(body, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    })
    Object.defineProperty(body, 'clientHeight', { configurable: true, get: () => 200 })
    return { body, setScrollHeight: (height: number) => (scrollHeight = height) }
  }

  it('acompanha a resposta mais recente: rola até o fim quando o conteúdo cresce', async () => {
    const { container, rerender } = render(InsightCard, {
      props: baseProps(makeState({ text: 'A' })),
    })
    const { body, setScrollHeight } = withScrollMetrics(container)

    // Conteúdo cresce: o fim passa de 800 para 900 e a rolagem segue.
    setScrollHeight(1100)
    await rerender({ state: makeState({ text: 'AB' }) })
    expect(body.scrollTop, 'deve rolar até o fim (scrollHeight - clientHeight)').toBe(900)

    setScrollHeight(1200)
    await rerender({ state: makeState({ text: 'ABC' }) })
    expect(body.scrollTop).toBe(1000)
  })

  it('pausa quando o usuário rola para cima e retoma ao voltar ao fim', async () => {
    const { container, rerender } = render(InsightCard, {
      props: baseProps(makeState({ text: 'A' })),
    })
    const { body, setScrollHeight } = withScrollMetrics(container)

    // Usuário rola para cima (fim = 800): a rolagem automática pausa.
    await fireEvent.scroll(body, { target: { scrollTop: 300 } })
    setScrollHeight(1200)
    await rerender({ state: makeState({ text: 'AB' }) })
    expect(body.scrollTop, 'pausada: conteúdo novo não move a rolagem').toBe(300)

    // Usuário volta ao fim (fim = 1000): retoma.
    await fireEvent.scroll(body, { target: { scrollTop: 1000 } })
    setScrollHeight(1300)
    await rerender({ state: makeState({ text: 'ABC' }) })
    expect(body.scrollTop, 'retomada: segue o fim de novo').toBe(1100)
  })
})


describe('InsightCard — regras gerais do repo', () => {
  it('a saída renderizada não contém emojis, inclusive no estado de erro', () => {
    const { container } = render(InsightCard, {
      props: baseProps(
        makeState({
          status: 'error',
          contextLabel: 'Reunião',
          theySaid: 'Qual o preço?',
          text: 'Sugiro **responder**',
          error: { code: 'AGENT_ERROR', message: 'provedor falhou' },
        }),
      ),
    })
    expect(EMOJI_PATTERN.test(container.textContent ?? '')).toBe(false)
  })
})
