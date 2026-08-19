import { describe, it, expect } from "vitest"
import { render, screen } from "@/__tests__/test-utils"
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectValue,
  SelectSeparator,
  SelectGroup,
} from "../select"

describe("Select", () => {
  it("renders trigger with value when closed", () => {
    render(
      <Select open={false}>
        <SelectTrigger>
          <SelectValue placeholder="Escolha uma cidade" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="curitiba">Curitiba</SelectItem>
        </SelectContent>
      </Select>,
    )
    expect(screen.getByText("Escolha uma cidade")).toBeInTheDocument()
    expect(screen.queryByText("Curitiba")).not.toBeInTheDocument()
  })

  it("renders items when open", async () => {
    render(
      <Select open>
        <SelectTrigger>
          <SelectValue placeholder="Cidade" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Capitais</SelectLabel>
            <SelectItem value="curitiba">Curitiba</SelectItem>
            <SelectItem value="sp">São Paulo</SelectItem>
          </SelectGroup>
          <SelectSeparator />
        </SelectContent>
      </Select>,
    )
    expect(await screen.findByText("Capitais")).toBeInTheDocument()
    expect(await screen.findByText("Curitiba")).toBeInTheDocument()
    expect(await screen.findByText("São Paulo")).toBeInTheDocument()
  })
})
