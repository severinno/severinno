import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import React from "react"
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react"
import { AddressForm, type AddressFormValue } from "../address-form"

// ---------------------------------------------------------------------------
// Mock stores
// ---------------------------------------------------------------------------

const mockGeoStore = {
  lat: null as number | null,
  lng: null as number | null,
  loading: false,
  error: null,
  setFromGPS: vi.fn().mockResolvedValue(undefined),
  getState: vi.fn(),
}

vi.mock("@/store/geo", () => ({
  useGeoStore: Object.assign(
    (selector: (s: any) => unknown) => selector(mockGeoStore),
    // Delegate to mockGeoStore.getState() so tests can control return values via mock chaining
    { getState: () => mockGeoStore.getState() },
  ),
}))

// ---------------------------------------------------------------------------
// Mock API
// ---------------------------------------------------------------------------

const mockApiGet = vi.fn()

vi.mock("@/lib/api", () => ({
  apiGet: (...args: any[]) => mockApiGet(...args),
}))

// ---------------------------------------------------------------------------
// Mock UI components
// ---------------------------------------------------------------------------

vi.mock("@/components/ui/input", () => ({
  Input: (p: any) => <input {...p} />,
}))

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...p }: any) => <label {...p}>{children}</label>,
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...p }: any) => <button {...p}>{children}</button>,
}))

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: any) => (
    <div data-testid="select" data-value={value}>
      {children}
      <select
        data-testid="select-native"
        value={value ?? ""}
        onChange={(e) => onValueChange?.(e.target.value)}
        aria-hidden="true"
        style={{ display: "none" }}
      >
        <option value="">Selecione</option>
        <option value="SP">SP</option>
        <option value="RJ">RJ</option>
      </select>
    </div>
  ),
  SelectTrigger: ({ children, ...p }: any) => <span {...p}>{children}</span>,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
}))

vi.mock("@/lib/utils", () => ({
  cn: (...c: any[]) => c.filter(Boolean).join(" "),
}))

// ---------------------------------------------------------------------------
// Mock lucide icons
// ---------------------------------------------------------------------------

vi.mock("lucide-react", () => {
  const Icon = () => <span data-testid="icon" />
  Icon.displayName = "Icon"
  return {
    Loader2: () => <span data-testid="icon-loading" />,
    LocateFixed: () => <span data-testid="icon-locate" />,
    MapPin: () => <span data-testid="icon-mappin" />,
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultAddress: AddressFormValue = {
  cep: "",
  street: "",
  number: "",
  complement: "",
  district: "",
  city: "",
  state: "",
  lat: null,
  lng: null,
}

/**
 * Controlled test harness — re-renders the AddressForm with the updated value
 * whenever onChange fires, simulating a real parent component.
 */
function StatefulHarness(props: {
  initialValue?: AddressFormValue
  onChange?: (v: AddressFormValue) => void
  [key: string]: any
}) {
  const { initialValue, onChange, ...rest } = props
  const [value, setValue] = React.useState<AddressFormValue>(
    initialValue ?? defaultAddress,
  )
  return (
    <AddressForm
      value={value}
      onChange={(v) => {
        setValue(v)
        onChange?.(v)
      }}
      {...rest}
    />
  )
}

function renderForm(props: Partial<Parameters<typeof AddressForm>[0]> & { initialValue?: AddressFormValue } = {}) {
  const onChange = vi.fn()
  const result = render(
    <StatefulHarness initialValue={props.initialValue} onChange={onChange} {...props} />,
  )
  return { onChange, result }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGeoStore.lat = null
  mockGeoStore.lng = null
  mockGeoStore.getState.mockReturnValue(mockGeoStore)
  mockApiGet.mockReset()
})

afterEach(() => {
  cleanup()
})

// =========================================================================
// Tests
// =========================================================================

describe("AddressForm — rendering", () => {
  it("renders all address fields", { timeout: 10000 }, () => {
    renderForm()
    expect(screen.getByLabelText("CEP")).toBeInTheDocument()
    expect(screen.getByLabelText("Rua / Avenida")).toBeInTheDocument()
    expect(screen.getByLabelText("Número")).toBeInTheDocument()
    expect(screen.getByLabelText("Complemento")).toBeInTheDocument()
    expect(screen.getByLabelText("Bairro")).toBeInTheDocument()
    expect(screen.getByLabelText("Cidade")).toBeInTheDocument()
    expect(screen.getByText("UF")).toBeInTheDocument()
  })

  it("renders GPS button by default", () => {
    renderForm()
    const btns = screen.getAllByText("Minha localização")
    expect(btns.length).toBeGreaterThan(0)
  })

  it("hides GPS button when hideGps is true", () => {
    renderForm({ hideGps: true })
    expect(screen.queryAllByText("Minha localização").length).toBe(0)
  })

  it("renders with prefilled value", () => {
    const value: AddressFormValue = {
      ...defaultAddress,
      street: "Rua Augusta",
      number: "500",
      city: "São Paulo",
      state: "SP",
    }
    render(
      <StatefulHarness initialValue={value} />,
    )
    const streetInput = screen.getByLabelText("Rua / Avenida") as HTMLInputElement
    const numberInput = screen.getByLabelText("Número") as HTMLInputElement
    const cityInput = screen.getByLabelText("Cidade") as HTMLInputElement
    expect(streetInput.value).toBe("Rua Augusta")
    expect(numberInput.value).toBe("500")
    expect(cityInput.value).toBe("São Paulo")
  })

  it("uses idPrefix for label associations", () => {
    renderForm({ idPrefix: "addr" })
    const cep = screen.getByLabelText("CEP") as HTMLInputElement
    const street = screen.getByLabelText("Rua / Avenida") as HTMLInputElement
    const number = screen.getByLabelText("Número") as HTMLInputElement
    expect(cep.id).toBe("addr-cep")
    expect(street.id).toBe("addr-street")
    expect(number.id).toBe("addr-number")
  })

  it("shows location confirmed indicator when lat/lng present", () => {
    const value = { ...defaultAddress, lat: -23.55, lng: -46.63 }
    render(<StatefulHarness initialValue={value} />)
    expect(screen.getByText("Localização confirmada")).toBeInTheDocument()
    expect(screen.getByTestId("icon-mappin")).toBeInTheDocument()
  })

  it("shows confirmation hint when lat/lng are null", () => {
    renderForm()
    const hints = screen.getAllByText("Confirme o endereço para prosseguir.")
    expect(hints.length).toBeGreaterThan(0)
  })

  it("applies className to the container", () => {
    const { result } = renderForm({ className: "my-custom-class" })
    const rootDiv = result.container.querySelector(".my-custom-class")
    expect(rootDiv).toBeTruthy()
  })
})

describe("AddressForm — field interactions", () => {
  it("calls onChange with updated CEP on input", () => {
    const { onChange } = renderForm()
    const cepInput = screen.getByLabelText("CEP") as HTMLInputElement
    fireEvent.change(cepInput, { target: { value: "01234" } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ cep: "01234" }))
  })

  it("masks CEP on input (12345678 → 12345-678)", () => {
    const { onChange } = renderForm()
    const cepInput = screen.getByLabelText("CEP") as HTMLInputElement
    fireEvent.change(cepInput, { target: { value: "12345678" } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ cep: "12345-678" }))
  })

  it("calls onChange with updated street on input", () => {
    const { onChange } = renderForm()
    const input = screen.getByLabelText("Rua / Avenida") as HTMLInputElement
    fireEvent.change(input, { target: { value: "Av. Paulista" } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ street: "Av. Paulista" }))
  })

  it("calls onChange with updated number on input", () => {
    const { onChange } = renderForm()
    const input = screen.getByLabelText("Número") as HTMLInputElement
    fireEvent.change(input, { target: { value: "1000" } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ number: "1000" }))
  })

  it("calls onChange with updated city on input", () => {
    const { onChange } = renderForm()
    const input = screen.getByLabelText("Cidade") as HTMLInputElement
    fireEvent.change(input, { target: { value: "Rio de Janeiro" } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ city: "Rio de Janeiro" }))
  })

  it("calls onChange with UF state on select change", () => {
    const { onChange } = renderForm()
    const select = screen.getByTestId("select-native") as HTMLSelectElement
    fireEvent.change(select, { target: { value: "SP" } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ state: "SP" }))
  })
})

describe("AddressForm — CEP lookup", () => {
  it("triggers CEP lookup on blur when CEP has 8 digits", async () => {
    mockApiGet.mockResolvedValue({
      cep: "01310-100",
      street: "Av. Paulista",
      district: "Bela Vista",
      city: "São Paulo",
      state: "SP",
    })
    renderForm()
    const input = screen.getByLabelText("CEP") as HTMLInputElement

    // Type the full CEP (8+ digits) → triggers mask
    await act(async () => {
      fireEvent.change(input, { target: { value: "01310100" } })
    })

    // Wait for React re-render with masked value
    await act(async () => {
      fireEvent.blur(input)
    })

    // Wait for async lookup
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    // After blur, the component reads e.target.value which is the masked value "01310-100"
    // onlyDigits("01310-100") → "01310100" (8 digits) → CEP lookup triggered
    expect(mockApiGet).toHaveBeenCalledWith("/api/geo/cep", { cep: "01310100" })
  })

  it("does not call apiGet when CEP has fewer than 8 digits on blur", async () => {
    renderForm()
    const input = screen.getByLabelText("CEP") as HTMLInputElement

    await act(async () => {
      fireEvent.change(input, { target: { value: "123" } })
    })
    await act(async () => {
      fireEvent.blur(input)
    })

    expect(mockApiGet).not.toHaveBeenCalled()
  })

  it("shows error message when CEP lookup fails", async () => {
    mockApiGet.mockRejectedValue(new Error("Not found"))

    renderForm()
    const input = screen.getByLabelText("CEP") as HTMLInputElement

    await act(async () => {
      fireEvent.change(input, { target: { value: "99999999" } })
    })

    // The controlled component now has the masked value
    await act(async () => {
      fireEvent.blur(input)
    })

    // Wait for async rejection
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(screen.getByText("CEP não encontrado. Preencha o endereço manualmente.")).toBeInTheDocument()
  })
})

describe("AddressForm — GPS location", () => {
  it("calls setFromGPS when GPS button is clicked", async () => {
    mockGeoStore.getState.mockReturnValue({ lat: null, lng: null })

    renderForm()
    const btns = screen.getAllByText("Minha localização")
    await act(async () => {
      fireEvent.click(btns[0])
    })

    expect(mockGeoStore.setFromGPS).toHaveBeenCalled()
  })

  it("calls reverse geocode after GPS resolves with coordinates", async () => {
    mockGeoStore.setFromGPS.mockResolvedValue(undefined)
    mockGeoStore.getState.mockReturnValue({ lat: -23.55, lng: -46.63 })

    mockApiGet.mockResolvedValue({
      street: "Av. Paulista",
      district: "Bela Vista",
      city: "São Paulo",
      state: "SP",
      cep: "01310100",
    })

    const { onChange } = renderForm()
    const btns = screen.getAllByText("Minha localização")

    await act(async () => {
      fireEvent.click(btns[0])
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(mockApiGet).toHaveBeenCalledWith("/api/geo/reverse", {
      lat: -23.55,
      lng: -46.63,
    })
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        lat: -23.55,
        lng: -46.63,
        street: "Av. Paulista",
        city: "São Paulo",
        state: "SP",
      }),
    )
  })

  it("falls back to coords-only when reverse geocode fails", async () => {
    mockGeoStore.setFromGPS.mockResolvedValue(undefined)
    mockGeoStore.getState.mockReturnValue({ lat: -23.55, lng: -46.63 })

    mockApiGet.mockRejectedValue(new Error("Reverse geocode failed"))

    const { onChange } = renderForm()
    const btns = screen.getAllByText("Minha localização")

    await act(async () => {
      fireEvent.click(btns[0])
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        lat: -23.55,
        lng: -46.63,
      }),
    )
  })

  it("does not call reverse geocode when GPS returns null coordinates", async () => {
    mockGeoStore.setFromGPS.mockResolvedValue(undefined)
    mockGeoStore.getState.mockReturnValue({ lat: null, lng: null })

    renderForm()
    const btns = screen.getAllByText("Minha localização")

    await act(async () => {
      fireEvent.click(btns[0])
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(mockApiGet).not.toHaveBeenCalledWith("/api/geo/reverse", expect.anything())
  })
})

describe("AddressForm — validation errors", () => {
  it("shows field-level validation errors", () => {
    const errors = {
      cep: "CEP inválido",
      street: "Rua é obrigatória",
      city: "Cidade é obrigatória",
      state: "Selecione um estado",
    }
    render(
      <AddressForm value={defaultAddress} onChange={vi.fn()} errors={errors} />,
    )

    expect(screen.getByText("CEP inválido")).toBeInTheDocument()
    expect(screen.getByText("Rua é obrigatória")).toBeInTheDocument()
    expect(screen.getByText("Cidade é obrigatória")).toBeInTheDocument()
    expect(screen.getByText("Selecione um estado")).toBeInTheDocument()
  })

  it("marks invalid fields with aria-invalid", () => {
    const errors = { cep: "Erro", street: "Erro" }
    render(
      <AddressForm value={defaultAddress} onChange={vi.fn()} errors={errors} />,
    )

    const cepInput = screen.getByLabelText("CEP") as HTMLInputElement
    expect(cepInput.getAttribute("aria-invalid")).toBe("true")

    const streetInput = screen.getByLabelText("Rua / Avenida") as HTMLInputElement
    expect(streetInput.getAttribute("aria-invalid")).toBe("true")
  })

  it("does not set aria-invalid on fields without errors", () => {
    render(
      <AddressForm value={defaultAddress} onChange={vi.fn()} errors={{}} />,
    )

    const complementInput = screen.getByLabelText("Complemento") as HTMLInputElement
    expect(complementInput.getAttribute("aria-invalid")).not.toBe("true")
  })
})

describe("AddressForm — initial state selection", () => {
  it("renders UF select with correct initial value", () => {
    const value = { ...defaultAddress, state: "SP" }
    render(<StatefulHarness initialValue={value} />)
    const select = screen.getByTestId("select-native") as HTMLSelectElement
    expect(select.value).toBe("SP")
  })

  it("renders UF select with empty initial value", () => {
    renderForm()
    const select = screen.getByTestId("select-native") as HTMLSelectElement
    expect(select.value).toBe("")
  })
})
