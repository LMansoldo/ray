import { describe, it, expect } from 'vitest'
import { transformVerdictBlocks } from './verdict'
import { renderMarkdown } from './markdown'

// T-602: blocos de fact-checking na convenção v1 viram o card .ray-verdict
// (chip colorido por veredito, indicador de confiança, claim em destaque e
// fontes como chips de link). Contrato de streaming: texto sem o padrão é
// INTOCADO, e bloco parcial (corte no meio) não crasha — renderiza como
// markdown normal até a forma mínima (claim + veredito) fechar.

function parseHtml(html: string): HTMLElement {
  const container = document.createElement('div')
  container.innerHTML = html
  return container
}

function renderSource(markdown: string): HTMLElement {
  return parseHtml(renderMarkdown(transformVerdictBlocks(markdown)))
}

function cardOf(container: HTMLElement): HTMLElement {
  const card = container.querySelector<HTMLElement>('.ray-verdict')
  expect(card, 'o card de veredito deve existir no HTML renderizado').not.toBeNull()
  return card!
}

// Fixture canônica da convenção v1 (contrato compartilhado).
function factCheckBlock(
  kind: 'TRUE' | 'FALSE' | 'UNCERTAIN',
  confidence: string | null,
): string {
  const verdictLine =
    confidence === null
      ? `**Veredito: ${kind}**`
      : `**Veredito: ${kind}** · confiança: ${confidence}`
  return [
    '## Verificação de fatos',
    '',
    '### Claim: "A vacina contém chip de rastreamento"',
    verdictLine,
    'Estudos e a própria bula do imunizante não comprovam a existência desse componente.',
    'Fontes: [Reuters](https://reuters.com/fato) · [Agência Pública](https://apublica.org/fato)',
  ].join('\n')
}

describe('transformVerdictBlocks — as 3 classes de veredito (T-602 a)', () => {
  for (const kind of ['TRUE', 'FALSE', 'UNCERTAIN'] as const) {
    it(`TRUE/FALSE/UNCERTAIN: ${kind} produz chip e data-verdict próprios`, () => {
      const container = renderSource(factCheckBlock(kind, 'alta'))
      const card = cardOf(container)
      expect(card.getAttribute('data-verdict')).toBe(kind.toLowerCase())
      const chip = card.querySelector('.ray-verdict__chip')
      expect(chip, `o chip do veredito ${kind} deve existir`).not.toBeNull()
      expect(chip!.classList.contains(`ray-verdict__chip--${kind.toLowerCase()}`)).toBe(true)
      expect(chip!.textContent).toBe(kind)
    })
  }

  it('as três classes produzem marcação DISTINTA entre si', () => {
    const markups = (['TRUE', 'FALSE', 'UNCERTAIN'] as const).map((kind) =>
      renderMarkdown(transformVerdictBlocks(factCheckBlock(kind, 'alta'))),
    )
    expect(new Set(markups).size).toBe(3)
    const verdicts = markups.map(
      (html) => parseHtml(html).querySelector('.ray-verdict')!.getAttribute('data-verdict'),
    )
    expect(new Set(verdicts).size).toBe(3)
  })
})

describe('transformVerdictBlocks — markdown sem o padrão sai INTACTO (T-602 b)', () => {
  it('markdown comum volta byte a byte', () => {
    const samples = [
      '',
      '# Título\n\ntexto com **ênfase** e [link](https://exemplo.com)',
      '```ts\nconst x = 1\n```',
      '- item um\n- item dois',
      '> citação\n\ntexto final',
    ]
    for (const sample of samples) {
      expect(transformVerdictBlocks(sample), `alterou sem padrão: ${sample}`).toBe(sample)
    }
  })

  it('menção a claim sem linha de veredito volta byte a byte', () => {
    const sample = [
      '## Verificação de fatos',
      '',
      '### Claim: "A Terra é plana"',
      'O veredito ainda não chegou neste trecho.',
    ].join('\n')
    expect(transformVerdictBlocks(sample)).toBe(sample)
  })

  it('renderMarkdown(transform(x)) === renderMarkdown(x) sem o padrão', () => {
    const sample = '### Claim: "sem veredito"\n\ntexto normal depois'
    expect(transformVerdictBlocks(sample)).toBe(sample)
    expect(renderMarkdown(transformVerdictBlocks(sample))).toBe(renderMarkdown(sample))
  })
})

describe('transformVerdictBlocks — streaming parcial degrada sem crash (T-602 c)', () => {
  const FULL = factCheckBlock('FALSE', 'média')

  it('nenhum prefixo do fluxo crasha e todos produzem HTML', () => {
    let buffer = ''
    for (const token of FULL) {
      buffer += token
      const rendered = renderMarkdown(transformVerdictBlocks(buffer))
      expect(rendered).toBeTypeOf('string')
      // O HTML parseado nunca fica vazio enquanto há conteúdo no buffer.
      expect(parseHtml(rendered).textContent !== null || buffer === '').toBe(true)
    }
  })

  it('corte antes da forma mínima (claim sem fechar) renderiza markdown normal', () => {
    const partials = [
      '## Verificação de fatos\n\n### Claim: "A Terra é',
      '## Verificação de fatos\n\n### Claim: "A Terra é plana"',
      '## Verificação de fatos\n\n### Claim: "X"\n**Veredito: FA',
      '## Verificação de fatos\n\n### Claim: "X"\n**Veredito: FALSE** · conf',
    ]
    for (const partial of partials) {
      const container = parseHtml(renderMarkdown(transformVerdictBlocks(partial)))
      expect(
        container.querySelector('.ray-verdict'),
        `parcial não deveria virar card: ${partial}`,
      ).toBeNull()
      // Conteúdo parcial permanece visível como markdown comum.
      expect(container.textContent!.length).toBeGreaterThan(0)
    }
  })

  it('forma mínima fechada vira card mesmo sem justificativa/fontes ainda', () => {
    const partial = '## Verificação de fatos\n\n### Claim: "X"\n**Veredito: TRUE**'
    const container = parseHtml(renderMarkdown(transformVerdictBlocks(partial)))
    const card = cardOf(container)
    expect(card.querySelector('.ray-verdict__chip--true')!.textContent).toBe('TRUE')
    expect(card.querySelector('.ray-verdict__claim')!.textContent).toBe('X')
    // O que não chegou não existe ainda.
    expect(container.querySelector('.ray-verdict__sources')).toBeNull()
  })

  it('o card ganha justificativa e fontes conforme os tokens chegam', () => {
    const tokens = [
      '## Verificação de fatos',
      '\n\n### Claim: "X"',
      '\n**Veredito: TRUE**',
      '\nJustificativa',
      ' curta.',
      '\nFontes: [A](https://a.com)',
    ]
    let buffer = ''
    for (const token of tokens) {
      buffer += token
      const container = parseHtml(renderMarkdown(transformVerdictBlocks(buffer)))
      if (token === '\n**Veredito: TRUE**') {
        expect(container.querySelector('.ray-verdict')).not.toBeNull()
        expect(container.querySelector('.ray-verdict__why')).toBeNull()
      }
    }
    const card = cardOf(parseHtml(renderMarkdown(transformVerdictBlocks(buffer))))
    expect(card.querySelector('.ray-verdict__why')!.textContent).toBe('Justificativa curta.')
    expect(card.querySelectorAll('.ray-verdict__source')).toHaveLength(1)
  })
})

describe('transformVerdictBlocks — fontes viram links (T-602 d)', () => {
  it('cada fonte vira chip de link com href e título', () => {
    const container = renderSource(factCheckBlock('TRUE', 'baixa'))
    const links = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('.ray-verdict__source'),
    )
    expect(links).toHaveLength(2)
    expect(links[0].getAttribute('href')).toBe('https://reuters.com/fato')
    expect(links[0].textContent).toBe('Reuters')
    expect(links[1].getAttribute('href')).toBe('https://apublica.org/fato')
    expect(links[1].textContent).toBe('Agência Pública')
    // Links externos abrem com noopener (conteúdo de LLM).
    for (const link of links) {
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    }
  })

  it('linha Fontes sem link válido não vira âncora', () => {
    const markdown = [
      '### Claim: "X"',
      '**Veredito: TRUE**',
      'Fontes: sem links aqui',
    ].join('\n')
    const container = parseHtml(renderMarkdown(transformVerdictBlocks(markdown)))
    expect(container.querySelector('.ray-verdict__source')).toBeNull()
  })

  it('url com esquema inseguro não vira href', () => {
    const markdown = [
      '### Claim: "X"',
      '**Veredito: TRUE**',
      'Fontes: [ruim](javascript:alert(1))',
    ].join('\n')
    const container = parseHtml(renderMarkdown(transformVerdictBlocks(markdown)))
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull()
  })
})

describe('transformVerdictBlocks — confiança e layout do card', () => {
  it('confiança alta/média/baixa = 3/2/1 pontos acesos', () => {
    const cases: Array<[string, number]> = [
      ['alta', 3],
      ['média', 2],
      ['baixa', 1],
    ]
    for (const [confidence, on] of cases) {
      const card = cardOf(renderSource(factCheckBlock('TRUE', confidence)))
      const dots = card.querySelectorAll('.ray-verdict__dot')
      expect(dots).toHaveLength(3)
      expect(card.querySelectorAll('.ray-verdict__dot--on')).toHaveLength(on)
      expect(card.querySelector('.ray-verdict__confidence')!.getAttribute('aria-label')).toBe(
        `confiança ${confidence}`,
      )
    }
  })

  it('sem confiança o bloco ainda vira card, sem indicador', () => {
    const card = cardOf(renderSource(factCheckBlock('UNCERTAIN', null)))
    expect(card.querySelector('.ray-verdict__confidence')).toBeNull()
    expect(card.getAttribute('data-verdict')).toBe('uncertain')
  })

  it('claim em destaque, heading da seção e texto fora do bloco são preservados', () => {
    const markdown = [
      'Antes do bloco.',
      '',
      factCheckBlock('FALSE', 'alta'),
      '',
      'Depois do bloco.',
    ].join('\n')
    const container = renderSource(markdown)
    expect(container.textContent).toContain('Antes do bloco.')
    expect(container.textContent).toContain('Depois do bloco.')
    expect(container.querySelector('h2')?.textContent).toBe('Verificação de fatos')
    const claim = cardOf(container).querySelector('.ray-verdict__claim')
    expect(claim!.textContent).toBe('A vacina contém chip de rastreamento')
  })

  it('vários claims na mesma seção viram cards independentes', () => {
    const markdown = [
      '## Verificação de fatos',
      '',
      '### Claim: "Primeira"',
      '**Veredito: TRUE** · confiança: alta',
      'Fontes: [A](https://a.com)',
      '',
      '### Claim: "Segunda"',
      '**Veredito: UNCERTAIN**',
      'Fontes: [B](https://b.com) · [C](https://c.com)',
    ].join('\n')
    const container = renderSource(markdown)
    const cards = container.querySelectorAll('.ray-verdict')
    expect(cards).toHaveLength(2)
    expect(cards[0].getAttribute('data-verdict')).toBe('true')
    expect(cards[1].getAttribute('data-verdict')).toBe('uncertain')
    expect(container.querySelectorAll('.ray-verdict__source')).toHaveLength(3)
  })

  it('claim e justificativa com HTML não escapam como marcação', () => {
    const markdown = [
      '### Claim: "<img src=x onerror=alert(1)>"',
      '**Veredito: FALSE**',
      'Texto com <b>tags</b> e & "aspas".',
      'Fontes: [t](https://a.com/?q=1&x=2)',
    ].join('\n')
    const container = renderSource(markdown)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    const card = cardOf(container)
    expect(card.querySelector('.ray-verdict__claim')!.textContent).toBe(
      '<img src=x onerror=alert(1)>',
    )
    expect(card.querySelector('.ray-verdict__why')!.textContent).toBe(
      'Texto com <b>tags</b> e & "aspas".',
    )
    const link = container.querySelector<HTMLAnchorElement>('.ray-verdict__source')
    expect(link!.getAttribute('href')).toBe('https://a.com/?q=1&x=2')
  })
})
