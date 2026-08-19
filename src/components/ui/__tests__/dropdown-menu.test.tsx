import { describe, it, expect } from "vitest"
import { render, screen, fireEvent, findByText } from "@/__tests__/test-utils"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "../dropdown-menu"

describe("DropdownMenu", () => {
  it("renders items when open", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuContent>
          <DropdownMenuLabel>Ações</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem>
              Editar <DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem>Excluir</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
        </DropdownMenuContent>
      </DropdownMenu>,
    )
    expect(screen.getByText("Ações")).toBeInTheDocument()
    expect(screen.getByText("Editar")).toBeInTheDocument()
    expect(screen.getByText("⌘E")).toBeInTheDocument()
    expect(screen.getByText("Excluir")).toBeInTheDocument()
    expect(document.querySelector("[role='separator']")).toBeInTheDocument()
  })

  it("renders trigger when closed", () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button">menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Oculto</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )
    expect(screen.getByText("menu")).toBeInTheDocument()
    expect(screen.queryByText("Oculto")).not.toBeInTheDocument()
  })

  it("renders checkbox and radio items", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem checked>Destacar</DropdownMenuCheckboxItem>
          <DropdownMenuRadioGroup value="brl">
            <DropdownMenuRadioItem value="brl">Real</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="usd">Dólar</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    )
    expect(screen.getByText("Destacar")).toBeInTheDocument()
    expect(screen.getByText("Real")).toBeInTheDocument()
    expect(screen.getByText("Dólar")).toBeInTheDocument()
    expect(document.querySelector("[data-slot='dropdown-menu-checkbox-item']")).toBeInTheDocument()
    expect(document.querySelector("[data-slot='dropdown-menu-radio-group']")).toBeInTheDocument()
    expect(document.querySelector("[data-slot='dropdown-menu-radio-item']")).toBeInTheDocument()
  })

  it("renders submenu, portal, inset label and shortcut", async () => {
    render(
      <DropdownMenu open>
        <DropdownMenuContent>
          <DropdownMenuLabel inset>Conta</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuPortal>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Mais opções</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem>Configurações</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuPortal>
            <DropdownMenuItem>
              Sair <DropdownMenuShortcut>⌘Q</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
        </DropdownMenuContent>
      </DropdownMenu>,
    )
    expect(screen.getByText("Conta")).toBeInTheDocument()
    expect(screen.getByText("Mais opções")).toBeInTheDocument()
    expect(screen.getByText("⌘Q")).toBeInTheDocument()
    fireEvent.click(screen.getByText("Mais opções"))
    expect(await findByText("Configurações")).toBeInTheDocument()
    expect(document.querySelector("[data-slot='dropdown-menu-sub-content']")).toBeInTheDocument()
  })
})
