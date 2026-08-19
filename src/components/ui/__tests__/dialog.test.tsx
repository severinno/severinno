import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@/__tests__/test-utils"
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "../dialog"

describe("Dialog", () => {
  it("renders trigger and shows content when open", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar perfil</DialogTitle>
            <DialogDescription>Altere seus dados.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose>Fechar</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    )
    expect(screen.getByText("Editar perfil")).toBeInTheDocument()
    expect(screen.getByText("Altere seus dados.")).toBeInTheDocument()
    expect(screen.getByText("Fechar")).toBeInTheDocument()
  })

  it("opens content on trigger click", () => {
    render(
      <Dialog>
        <DialogTrigger asChild>
          <button type="button">abrir modal</button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Conteúdo</DialogTitle>
        </DialogContent>
      </Dialog>,
    )
    expect(screen.queryByText("Conteúdo")).not.toBeInTheDocument()
    fireEvent.click(screen.getByText("abrir modal"))
    expect(screen.getByText("Conteúdo")).toBeInTheDocument()
  })

  it("applies className to content", () => {
    render(
      <Dialog open>
        <DialogContent className="custom-dialog">
          <DialogTitle>X</DialogTitle>
        </DialogContent>
      </Dialog>,
    )
    const content = document.querySelector("[data-slot='dialog-content']")
    expect(content?.className).toContain("custom-dialog")
  })
})
