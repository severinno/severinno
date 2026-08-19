import { describe, it, expect } from "vitest"
import { render, screen } from "@/__tests__/test-utils"
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from "../table"

describe("Table", () => {
  it("renders full table structure with caption", () => {
    render(
      <Table>
        <TableCaption>Cidades atendidas</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Curitiba</TableCell>
          </TableRow>
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>Total</TableCell>
          </TableRow>
        </TableFooter>
      </Table>,
    )
    expect(screen.getByText("Nome")).toBeInTheDocument()
    expect(screen.getByText("Curitiba")).toBeInTheDocument()
    expect(screen.getByText("Cidades atendidas").tagName).toBe("CAPTION")
    expect(document.querySelector("[data-slot='table']")).toBeInTheDocument()
    expect(document.querySelector("[data-slot='table-header']")).toBeInTheDocument()
    expect(document.querySelector("[data-slot='table-body']")).toBeInTheDocument()
    expect(document.querySelector("[data-slot='table-footer']")).toBeInTheDocument()
    expect(document.querySelector("[data-slot='table-row']")).toBeInTheDocument()
    expect(document.querySelector("[data-slot='table-head']")).toBeInTheDocument()
    expect(document.querySelector("[data-slot='table-cell']")).toBeInTheDocument()
    expect(document.querySelector("[data-slot='table-caption']")).toBeInTheDocument()
  })

  it("applies className to table", () => {
    const { container } = render(<Table className="custom-table" />)
    expect(container.querySelector("table")?.className).toContain("custom-table")
  })

  it("forwards props to cell", () => {
    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell colSpan={2}>Span</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    expect(screen.getByText("Span")).toHaveAttribute("colspan", "2")
  })
})
