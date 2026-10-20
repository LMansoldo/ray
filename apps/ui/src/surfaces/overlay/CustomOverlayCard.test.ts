import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, act, waitFor } from '@testing-library/svelte'
import CustomOverlayCard from './CustomOverlayCard.svelte'
import type { SuggestionStreamState } from './stream'
import type { CustomOverlayCardProps } from './types'

// Contrato do card de overlay com template customizado: o template HTML+CSS
// do usuário renderiza num iframe sandbox="allow-same-origin" (SEM
// allow-scripts — o template não executa JS). O srcdoc é o template com os
// placeholders substituídos: status/contexto/erro escapados, bodyHtml
// verbatim do pipeline MarkdownView.
//
// jsdom não carrega o conteúdo do srcdoc em contentDocument (sem layout e
// sem carga de recursos), então o acesso protegido a contentDocument degrada
// para null — exatamente o caminho de tolerância do componente. Os testes
// observam o comportamento pelo ATRIBUTO srcdoc (padrão permitido pelo
// contrato do recurso) e pela ausência de crash nos caminhos de scroll.

function makeState(partial: Partial<SuggestionStreamState> = {}): SuggestionStreamState {
  return {
    status: 'streaming',
    suggestionId: 's-1',
    text: '',
    ...partial,
  }
}

const TEMPLATE = [
  '<div data-ray-overlay-status="{{status}}">',
  '<p class="ctx">{{contextLabel}}</p>',
  '<p class="they">{{theySaid}}</p>',
  '<div data-ray-body>{{bodyHtml}}</div>',
  '<p class="err">{{error}}</p>',
  '</div>',
].join('\n')

function frame(container: HTMLElement): HTMLIFrameElement {
  const el = container.querySelector('[data-custom-overlay-card]')
  expect(el, 'o iframe do card customizado deve existir').not.toBeNull()
  return el as HTMLIFrameElement
}

function srcdocOf(container: HTMLElement): string {
  return frame(container).getAttribute('srcdoc') ?? ''
}

afterEach(() => {
  cleanup()
})

describe('CustomOverlayCard — iframe sandbox (sem JavaScript no template)', () => {
  it('renderiza o iframe com sandbox allow-same-origin e SEM allow-scripts', () => {
    const { container } = render(CustomOverlayCard, {
      props: { state: makeState(), template: TEMPLATE } satisfies CustomOverlayCardProps,
    })

    expect(frame(container).getAttribute('sandbox')).toBe('allow-same-origin')
  })

  it('o srcdoc substitui os dados: status na raiz, contexto escapado e corpo verbatim', async () => {
    const { container } = render(CustomOverlayCard, {
      props: {
        state: makeState({
          contextLabel: 'A & B <importante>',
          theySaid: '"Qual o preço?"',
          text: 'Responda **assim**',
        }),
        template: TEMPLATE,
      } satisfies CustomOverlayCardProps,
    })
    await waitFor(() => expect(srcdocOf(container)).not.toBe(''))

    const srcdoc = srcdocOf(container)
    expect(srcdoc).toContain('data-ray-overlay-status="streaming"')
    expect(srcdoc).toContain('A &amp; B &lt;importante&gt;')
    expect(srcdoc).toContain('&quot;Qual o preço?&quot;')
    expect(srcdoc, 'markdown renderizado entra verbatim').toContain('<strong>assim</strong>')
    expect(srcdoc).toContain('data-ray-body')
  })

  it('estado de erro: mensagem escapa no placeholder {{error}}', async () => {
    const { container } = render(CustomOverlayCard, {
      props: {
        state: makeState({
          status: 'error',
          error: { code: 'AGENT_ERROR', message: '<b>falhou</b>' },
        }),
        template: TEMPLATE,
      } satisfies CustomOverlayCardProps,
    })
    await waitFor(() => expect(srcdocOf(container)).not.toBe(''))

    expect(srcdocOf(container)).toContain('data-ray-overlay-status="error"')
    expect(srcdocOf(container)).toContain('&lt;b&gt;falhou&lt;/b&gt;')
    expect(srcdocOf(container)).not.toContain('<b>falhou</b>')
  })
})

describe('CustomOverlayCard — reconstrução do srcdoc (debounce do streaming)', () => {
  it('mudança de suggestionId/status reconstrói o srcdoc IMEDIATAMENTE', async () => {
    const { container, rerender } = render(CustomOverlayCard, {
      props: { state: makeState({ suggestionId: 's-1', text: 'primeira' }), template: TEMPLATE },
    })
    await waitFor(() => expect(srcdocOf(container)).toContain('primeira'))

    await act(() =>
      rerender({
        state: makeState({ suggestionId: 's-2', status: 'done', text: 'segunda' }),
        template: TEMPLATE,
      }),
    )

    expect(srcdocOf(container), 'evento discreto não espera debounce').toContain('segunda')
    expect(srcdocOf(container)).toContain('data-ray-overlay-status="done"')
  })

  it('tokens em streaming reconstruem com trailing debounce (comportamento observável)', async () => {
    const { container, rerender } = render(CustomOverlayCard, {
      props: { state: makeState({ text: 'Olá' }), template: TEMPLATE },
    })
    await waitFor(() => expect(srcdocOf(container)).toContain('Olá'))

    await act(() =>
      rerender({ state: makeState({ text: 'Olá mundo' }), template: TEMPLATE }),
    )
    expect(
      srcdocOf(container),
      'token em streaming NÃO reconstrói na hora (debounce 200ms)',
    ).not.toContain('mundo')

    await waitFor(
      () => expect(srcdocOf(container), 'após o debounce o token chega ao srcdoc').toContain('mundo'),
      { timeout: 1_500 },
    )
  })
})

describe('CustomOverlayCard — rolagem (RF-701 / overlayScroll*)', () => {
  it('evento ray:overlay-scroll não quebra sem same-origin (jsdom)', async () => {
    render(CustomOverlayCard, {
      props: { state: makeState(), template: TEMPLATE } satisfies CustomOverlayCardProps,
    })

    await act(() =>
      window.dispatchEvent(new CustomEvent('ray:overlay-scroll', { detail: { dir: 'down' } })),
    )
    await act(() =>
      window.dispatchEvent(new CustomEvent('ray:overlay-scroll', { detail: { dir: 'up' } })),
    )
    // Sem crash: o iframe continua montado.
    expect(document.querySelector('[data-custom-overlay-card]')).not.toBeNull()
  })
})
