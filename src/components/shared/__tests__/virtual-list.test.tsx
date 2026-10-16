// @vitest-environment jsdom
import React from "react"
import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@/__tests__/test-utils"
import { VirtualList } from "../virtual-list"

describe("<VirtualList />", () => {
  it("exibe mensagem vazia quando items está vazio", () => {
    render(
      <VirtualList
        items={[]}
        height={300}
        itemHeight={50}
        emptyText="Sem registros"
        renderItem={(item) => <div>{item}</div>}
      />,
    )

    expect(screen.getByText("Sem registros")).toBeDefined()
  })

  it("renderiza apenas a janela visível para listas com milhares de itens", () => {
    // Cria lista grande com 1.000 itens
    const mockItems = Array.from({ length: 1000 }, (_, i) => `Item #${i + 1}`)

    const { container } = render(
      <VirtualList
        items={mockItems}
        height={200}
        itemHeight={40}
        overscan={2}
        renderItem={(item) => <div className="test-item">{item}</div>}
      />,
    )

    // Altura 200 / itemHeight 40 = 5 visíveis + 2*2 overscan = 9 itens no DOM máximo
    const renderedElements = container.querySelectorAll(".test-item")
    expect(renderedElements.length).toBeLessThan(20)
    expect(renderedElements.length).toBeGreaterThan(0)

    // Primeiro item deve ser renderizado
    expect(screen.getByText("Item #1")).toBeDefined()
    // Itens no fim da lista (ex: item 900) não devem estar montados no DOM
    expect(screen.queryByText("Item #900")).toBeNull()
  })

  it("calcula a altura total proporcional ao número de itens", () => {
    const mockItems = ["Item A", "Item B", "Item C", "Item D", "Item E"]
    const { container } = render(
      <VirtualList
        items={mockItems}
        height={150}
        itemHeight={50}
        renderItem={(item) => <div>{item}</div>}
      />,
    )

    // 5 itens * 50px = 250px de altura total interna
    const totalDiv = container.querySelector('div[style*="height: 250px"]')
    expect(totalDiv).not.toBeNull()
  })
})
