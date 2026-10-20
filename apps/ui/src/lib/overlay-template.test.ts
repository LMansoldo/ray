import { describe, it, expect } from 'vitest'
import {
  DEFAULT_OVERLAY_TEMPLATE,
  OVERLAY_TEMPLATE_VARS,
  SAMPLE_OVERLAY_DATA,
  renderOverlayBodyHtml,
  renderOverlayTemplate,
} from './overlay-template'

// Contrato do template de overlay customizado: substituição de string em
// {{var}} com escape para campos de texto puro (contextLabel/theySaid/status/
// error) e bodyHtml VERBATIM (já vem do pipeline MarkdownView — transform-
// VerdictBlocks + renderMarkdown). Placeholder desconhecido fica intacto.
// O template default precisa declarar data-ray-body (alvo do auto-scroll
// RF-701 e do atalho overlayScroll*) e os 5 placeholders.

describe('renderOverlayTemplate — substituição', () => {
  const template = [
    '<div data-ray-overlay-status="{{status}}">',
    '<p class="ctx">{{contextLabel}}</p>',
    '<p class="they">{{theySaid}}</p>',
    '<div data-ray-body>{{bodyHtml}}</div>',
    '<p class="err">{{error}}</p>',
    '</div>',
  ].join('\n')

  it('substitui os 5 placeholders contratados', () => {
    const html = renderOverlayTemplate(template, {
      contextLabel: 'Reunião de vendas',
      theySaid: 'Qual o preço?',
      bodyHtml: '<p>Responda <strong>assim</strong></p>',
      status: 'streaming',
      error: '',
    })

    expect(html).toContain('data-ray-overlay-status="streaming"')
    expect(html).toContain('<p class="ctx">Reunião de vendas</p>')
    expect(html).toContain('<p class="they">Qual o preço?</p>')
    expect(html).toContain('<div data-ray-body><p>Responda <strong>assim</strong></p></div>')
    expect(html).toContain('<p class="err"></p>')
    // Nenhum placeholder contratado sobrevive à substituição.
    expect(html).not.toContain('{{contextLabel}}')
    expect(html).not.toContain('{{theySaid}}')
    expect(html).not.toContain('{{bodyHtml}}')
    expect(html).not.toContain('{{status}}')
    expect(html).not.toContain('{{error}}')
  })

  it('escapa contextLabel, theySaid, status e error (texto puro nunca vira markup)', () => {
    const html = renderOverlayTemplate(template, {
      contextLabel: '<img src=x onerror="alert(1)">Contexto',
      theySaid: '"Eles" & <outros>',
      bodyHtml: '<p>corpo confiável</p>',
      status: 'done',
      error: '<script>alert(2)</script>',
    })

    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;Contexto')
    expect(html).toContain('&quot;Eles&quot; &amp; &lt;outros&gt;')
    expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;')
    expect(html, 'nenhuma tag injectada via campo de texto puro').not.toContain('<img src=x')
    expect(html).not.toContain('<script>alert(2)</script>')
  })

  it('repassa bodyHtml VERBATIM (HTML já renderizado — não escapar)', () => {
    const bodyHtml = '<p>Responda <strong>assim</strong></p><div class="ray-verdict" data-verdict="true">x</div>'
    const html = renderOverlayTemplate(template, {
      contextLabel: 'c',
      theySaid: 't',
      bodyHtml,
      status: 'done',
      error: '',
    })

    expect(html).toContain(bodyHtml)
  })

  it('deixa placeholder desconhecido intacto (conteúdo literal do autor)', () => {
    const html = renderOverlayTemplate(
      '<p>{{naoExiste}}</p><p>{{contextLabel}}</p>',
      { contextLabel: 'ok', theySaid: '', bodyHtml: '', status: 'done', error: '' },
    )

    expect(html).toContain('{{naoExiste}}')
    expect(html).toContain('>ok</p>')
  })
})

describe('renderOverlayBodyHtml — mesmo pipeline do MarkdownView (T-408/T-602)', () => {
  it('renderiza markdown e repassa bloco de veredito como HTML cru', () => {
    const bodyHtml = renderOverlayBodyHtml(
      [
        'Responda com **clareza**.',
        '',
        '## Verificação de fatos',
        '',
        '### Claim: "A Terra é plana"',
        '**Veredito: FALSE** · confiança: alta',
        'Geodésia mede um elipsoide de revolução.',
        'Fontes: [NASA](https://www.nasa.gov)',
      ].join('\n'),
    )

    expect(bodyHtml).toContain('<strong>clareza</strong>')
    expect(bodyHtml).toContain('class="ray-verdict"')
    expect(bodyHtml).toContain('ray-verdict__chip--false')
  })
})

describe('DEFAULT_OVERLAY_TEMPLATE — contrato estrutural', () => {
  it('declara data-ray-body (alvo do auto-scroll RF-701 / overlayScroll*)', () => {
    expect(DEFAULT_OVERLAY_TEMPLATE).toContain('data-ray-body')
  })

  it('declara os 5 placeholders contratados', () => {
    for (const name of ['contextLabel', 'theySaid', 'bodyHtml', 'status', 'error']) {
      expect(DEFAULT_OVERLAY_TEMPLATE).toContain(`{{${name}}}`)
    }
  })

  it('carrega o status em data-ray-overlay-status na raiz (convenção do contrato)', () => {
    expect(DEFAULT_OVERLAY_TEMPLATE).toContain('data-ray-overlay-status="{{status}}"')
  })

  it('liga cursor de streaming e caixa de erro via seletores de status', () => {
    expect(DEFAULT_OVERLAY_TEMPLATE).toContain('[data-ray-overlay-status="streaming"]')
    expect(DEFAULT_OVERLAY_TEMPLATE).toContain('[data-ray-overlay-status="error"]')
  })

  it('estiliza o card de veredito com chips TRUE/FALSE/UNCERTAIN', () => {
    expect(DEFAULT_OVERLAY_TEMPLATE).toContain('.ray-verdict__chip--true')
    expect(DEFAULT_OVERLAY_TEMPLATE).toContain('.ray-verdict__chip--false')
    expect(DEFAULT_OVERLAY_TEMPLATE).toContain('.ray-verdict__chip--uncertain')
  })

  it('renderizado com os dados de exemplo, não sobra placeholder e o corpo existe', () => {
    const html = renderOverlayTemplate(DEFAULT_OVERLAY_TEMPLATE, SAMPLE_OVERLAY_DATA)
    expect(html).not.toContain('{{contextLabel}}')
    expect(html).not.toContain('{{theySaid}}')
    expect(html).not.toContain('{{bodyHtml}}')
    expect(html).not.toContain('{{status}}')
    expect(html).not.toContain('{{error}}')
    expect(html).toContain('data-ray-overlay-status="done"')
    expect(html).toContain('data-ray-body')
  })

  it('termina com quebra de linha (arquivo de template canônico)', () => {
    expect(DEFAULT_OVERLAY_TEMPLATE.endsWith('\n')).toBe(true)
  })
})

describe('OVERLAY_TEMPLATE_VARS — documentação em constante para o editor', () => {
  it('documenta exatamente os 5 placeholders contratados', () => {
    expect(OVERLAY_TEMPLATE_VARS.map((v) => v.name)).toEqual([
      'contextLabel',
      'theySaid',
      'bodyHtml',
      'status',
      'error',
    ])
  })
})
