import { describe, it, expect } from "vitest"
import { render, screen } from "@/__tests__/test-utils"
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "../alert-dialog"

describe("AlertDialog", () => {
  it("shows content when open", () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tem certeza?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    )
    expect(screen.getByText("Tem certeza?")).toBeInTheDocument()
    expect(screen.getByText("Esta ação não pode ser desfeita.")).toBeInTheDocument()
    expect(screen.getByText("Cancelar")).toBeInTheDocument()
    expect(screen.getByText("Confirmar")).toBeInTheDocument()
  })

  it("hides content when closed", () => {
    render(
      <AlertDialog>
        <AlertDialogTrigger>abrir</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Oculto</AlertDialogTitle>
        </AlertDialogContent>
      </AlertDialog>,
    )
    expect(screen.getByText("abrir")).toBeInTheDocument()
    expect(screen.queryByText("Oculto")).not.toBeInTheDocument()
  })

  it("applies className to content", () => {
    render(
      <AlertDialog open>
        <AlertDialogContent className="custom-content">
          <AlertDialogTitle>Título</AlertDialogTitle>
        </AlertDialogContent>
      </AlertDialog>,
    )
    const content = document.querySelector("[data-slot='alert-dialog-content']")
    expect(content).toBeInTheDocument()
    expect(content?.className).toContain("custom-content")
  })
})
