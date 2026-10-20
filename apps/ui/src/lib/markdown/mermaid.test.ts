import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderMermaid } from './mermaid'

// Diagramas Mermaid (lazy loader): import dinâmico + initialize uma única
// vez + fallback null em erro. O pacote real nunca carrega nos testes — o
// módulo 'mermaid' é mockado; aqui testamos só o contrato do wrapper.

const { initialize, render } = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}))

vi.mock('mermaid', () => ({ default: { initialize, render } }))

beforeEach(() => {
  initialize.mockReset()
  render.mockReset()
})

describe('renderMermaid', () => {
  it('renderiza DSL válido e inicializa o mermaid uma vez (lazy, dark, strict)', async () => {
    render.mockResolvedValue({ svg: '<svg viewBox="0 0 10 10"></svg>' })

    const svg = await renderMermaid('graph TD\n  A --> B')
    expect(svg).toBe('<svg viewBox="0 0 10 10"></svg>')
    expect(render).toHaveBeenCalledTimes(1)
    expect(String(render.mock.calls[0][0])).toMatch(/^ray-mermaid-\d+$/)

    // Segunda chamada NÃO reinicializa (instância única) e usa id novo.
    await renderMermaid('graph TD\n  B --> C')
    expect(initialize).toHaveBeenCalledTimes(1)
    expect(initialize).toHaveBeenCalledWith({
      startOnLoad: false,
      theme: 'dark',
      securityLevel: 'strict',
    })
    expect(render.mock.calls[1][0]).not.toBe(render.mock.calls[0][0])
  })

  it('retorna null em DSL inválido (fallback para código, nunca lança)', async () => {
    render.mockRejectedValue(new Error('Parse error on line 2'))

    const svg = await renderMermaid('graph TD\n  isso nao e valido >>>')
    expect(svg).toBeNull()
  })

  it('retorna null se o carregamento do pacote falhar', async () => {
    render.mockRejectedValue(new TypeError('mermaid crashed on load'))

    const svg = await renderMermaid('graph TD\n  A --> B')
    expect(svg).toBeNull()
  })
})
