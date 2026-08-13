/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @next/next/no-img-element, jsx-a11y/alt-text  */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@/__tests__/test-utils"
import { QuoteModal } from "../quote-modal"
import { createMockAuthStore, createMockUIStore, createMockViewStore } from "./test-utils"
import * as React from "react"

// -----------------------------------------------------------------------
// Shared mock stores
// -----------------------------------------------------------------------

const mockUIStore = createMockUIStore()
const mockAuthStore = createMockAuthStore()
const mockViewStore = createMockViewStore()

// -----------------------------------------------------------------------
// Hoisted mocks
// -----------------------------------------------------------------------

vi.mock("@/store/ui", () => ({
  useUIStore: Object.assign((selector: (s: any) => unknown) => selector(mockUIStore), {
    getState: () => mockUIStore,
  }),
}))

vi.mock("@/store/auth", () => ({
  useAuthStore: Object.assign((selector: (s: any) => unknown) => selector(mockAuthStore), {
    getState: () => mockAuthStore,
  }),
}))

vi.mock("@/store/view", () => ({
  useViewStore: Object.assign((selector: (s: any) => unknown) => selector(mockViewStore), {
    getState: () => mockViewStore,
  }),
}))

vi.mock("@/store/geo", () => ({
  useGeoStore: Object.assign(
    (selector: (s: any) => unknown) => selector({ setFromGPS: vi.fn(), lat: null, lng: null }),
    { getState: () => ({ lat: null, lng: null }) },
  ),
}))

const mockUseQuery = vi.hoisted(() => vi.fn())

vi.mock("@tanstack/react-query", () => ({
  useQuery: mockUseQuery,
  QueryClient: class {
    getQueryCache = () => ({ findAll: () => [], clear: vi.fn() })
    getMutationCache = () => ({ findAll: () => [], clear: vi.fn() })
    getDefaultOptions = () => ({})
    mount = vi.fn()
    unmount = vi.fn()
  },
  QueryClientProvider: ({ children }: any) => <>{children}</>,
}))

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...p }: any) => <div {...p}>{children}</div>,
    p: ({ children, ...p }: any) => <p {...p}>{children}</p>,
    span: ({ children, ...p }: any) => <span {...p}>{children}</span>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}))

// Dialog
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: any) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({ children, className }: any) => (
    <div data-testid="dialog-content" className={className}>
      {children}
    </div>
  ),
  DialogHeader: ({ children }: any) => <>{children}</>,
  DialogTitle: ({ children }: any) => <h2 data-testid="dialog-title">{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
}))

// Sheet (mobile)
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children, open }: any) => (open ? <div data-testid="sheet">{children}</div> : null),
  SheetContent: ({ children }: any) => <div>{children}</div>,
  SheetHeader: ({ children }: any) => <>{children}</>,
  SheetTitle: ({ children }: any) => <h2>{children}</h2>,
  SheetDescription: ({ children }: any) => <p>{children}</p>,
}))

// Button
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...p }: any) => (
    <button data-testid="button" {...p}>
      {children}
    </button>
  ),
}))

// Input
vi.mock("@/components/ui/input", () => ({
  Input: (p: any) => <input {...p} />,
}))

// Label
vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...p }: any) => <label {...p}>{children}</label>,
}))

// Textarea (used in Step3)
vi.mock("@/components/ui/textarea", () => ({
  Textarea: (p: any) => <textarea {...p} />,
}))

// Badge
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...p }: any) => (
    <span data-testid="badge" {...p}>
      {children}
    </span>
  ),
}))

// Separator
vi.mock("@/components/ui/separator", () => ({
  Separator: () => <hr data-testid="separator" />,
}))

// Avatar
vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children }: any) => <div data-testid="avatar">{children}</div>,
  AvatarImage: ({ src, alt }: any) => <img src={src} alt={alt} data-testid="avatar-image" />,
  AvatarFallback: ({ children }: any) => <span data-testid="avatar-fallback">{children}</span>,
}))

// ScrollArea (used by StepWizard in original, but mobile mock renders directly)
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, ...p }: any) => (
    <div data-testid="scroll-area" {...p}>
      {children}
    </div>
  ),
}))

// Select (used in Step3)
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: any) => (
    <div data-testid="select" data-value={value}>
      {React.Children.map(children, (child: any) => {
        if (
          child?.type?.displayName === "SelectTrigger" ||
          child?.type?.displayName === "SelectContent"
        ) {
          return React.cloneElement(child, { onValueChange })
        }
        return child
      })}
    </div>
  ),
  SelectTrigger: ({ children, ...p }: any) => {
    const Trigger = (props: any) => (
      <button data-testid="select-trigger" {...props}>
        {props.children}
      </button>
    )
    Trigger.displayName = "SelectTrigger"
    return <Trigger {...p}>{children}</Trigger>
  },
  SelectContent: ({ children }: any) => <div data-testid="select-content">{children}</div>,
  SelectItem: ({ value, children }: any) => {
    const Item = (props: any) => (
      <button data-testid="select-item" data-value={props.value}>
        {props.children}
      </button>
    )
    Item.displayName = "SelectItem"
    return <Item value={value}>{children}</Item>
  },
  SelectValue: ({ placeholder }: any) => <span data-testid="select-value">{placeholder}</span>,
}))

// Popover (used in provider combobox)
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <div data-testid="popover">{children}</div>,
  PopoverTrigger: ({ children, ...p }: any) => (
    <button data-testid="popover-trigger" {...p}>
      {children}
    </button>
  ),
  PopoverContent: ({ children }: any) => <div data-testid="popover-content">{children}</div>,
}))

// Command (used in provider combobox)
vi.mock("@/components/ui/command", () => ({
  Command: ({ children }: any) => <div data-testid="command">{children}</div>,
  CommandEmpty: ({ children }: any) => <div data-testid="command-empty">{children}</div>,
  CommandGroup: ({ children }: any) => <div>{children}</div>,
  CommandInput: (p: any) => <input data-testid="command-input" {...p} />,
  CommandItem: ({ children, ...p }: any) => (
    <button data-testid="command-item" {...p}>
      {children}
    </button>
  ),
  CommandList: ({ children }: any) => <div>{children}</div>,
}))

// AddressForm (used in Step4)
vi.mock("../address-form", () => ({
  AddressForm: ({ value, onChange }: any) => (
    <div data-testid="address-form">
      <input
        data-testid="address-cep"
        value={value?.cep ?? ""}
        onChange={(e) => onChange?.({ ...value, cep: e.target.value })}
        placeholder="CEP"
      />
    </div>
  ),
}))

// FilePhotos (used in Step3)
vi.mock("../file-photos", () => ({
  FilePhotos: ({ label }: any) => <div data-testid="file-photos">{label}</div>,
}))

// StepWizard
vi.mock("../step-wizard", () => ({
  StepWizard: ({
    children,
    currentStep,
    validSteps,
    steps,
    onStepClick,
    onBack,
    onNext,
    onSubmit,
    submitting,
    currentStepValid,
    submitLabel,
    nextLabel,
  }: any) => (
    <div data-testid="step-wizard" data-step={currentStep}>
      {/* Step indicator labels */}
      <div data-testid="step-indicator">
        {steps.map((s: any) => (
          <button
            key={s.id}
            data-testid="step-btn"
            data-active={currentStep === s.id}
            onClick={() => onStepClick?.(s.id)}
          >
            {s.shortLabel ?? s.label}
          </button>
        ))}
      </div>
      {children}
      <div data-testid="step-footer">
        {currentStep > 1 && (
          <button data-testid="back-btn" onClick={onBack}>
            Voltar
          </button>
        )}
        {currentStep < steps.length ? (
          <button data-testid="next-btn" disabled={!currentStepValid} onClick={onNext}>
            {nextLabel ?? "Continuar"}
          </button>
        ) : (
          <button
            data-testid="submit-btn"
            disabled={submitting || !currentStepValid}
            onClick={onSubmit}
          >
            {submitLabel ?? "Confirmar"}
          </button>
        )}
      </div>
    </div>
  ),
  StepHeader: ({ title, description, icon: Icon }: any) => (
    <div data-testid="step-header">
      {title && <h3>{title}</h3>}
      {description && <p>{description}</p>}
    </div>
  ),
  InfoCard: ({ children, variant }: any) => (
    <div data-testid="info-card" data-variant={variant}>
      {children}
    </div>
  ),
}))

// API
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}))

// Constants
vi.mock("@/lib/constants", () => ({
  SERVICE_UNITS: ["UNIDADE", "METRO_LINEAR"],
  SERVICE_UNIT_LABELS: { UNIDADE: "Unidade", METRO_LINEAR: "Metro Linear" },
  SERVICE_UNIT_SHORT: { UNIDADE: "un", METRO_LINEAR: "m" },
}))

// Utils
vi.mock("@/lib/utils", () => ({
  cn: (...c: any[]) => c.filter(Boolean).join(" "),
}))

vi.mock("lucide-react", () => {
  const Icon = (p: any) => (
    <span data-testid="lucide-icon" data-name={p?.className}>
      {p?.children}
    </span>
  )
  Icon.displayName = "LucideIcon"
  return {
    Check: Icon,
    ChevronDown: Icon,
    Clock: Icon,
    Loader2: Icon,
    LogIn: Icon,
    MapPin: Icon,
    Pencil: Icon,
    Send: Icon,
    ShieldCheck: Icon,
    User: Icon,
    Wrench: Icon,
  }
})

// react-hook-form
vi.mock("react-hook-form", () => ({
  useForm: () => ({
    control: {},
    handleSubmit: (fn: any) => async (e?: any) => {
      e?.preventDefault?.()
      await fn({})
    },
    setValue: vi.fn(),
    getValues: () => ({}),
    watch: () => ({}),
    trigger: vi.fn(),
    reset: vi.fn(),
    formState: { errors: {}, isSubmitting: false },
    register: vi.fn(),
  }),
  useController: () => ({
    field: { value: "", onChange: vi.fn() },
    fieldState: {},
  }),
  FormProvider: ({ children }: any) => <>{children}</>,
}))

vi.mock("@hookform/resolvers/zod", () => ({
  zodResolver: () => ({}),
}))

vi.mock("zod", () => {
  const chainable = (methods: Record<string, any> = {}) => {
    const obj: Record<string, any> = { ...methods }
    // Add default chainable methods that return the same object
    ;["min", "max", "default", "optional", "nullable", "refine", "describe"].forEach((m) => {
      if (!obj[m]) obj[m] = () => obj
    })
    return obj
  }

  return {
    z: {
      object: () => chainable({ refine: () => chainable() }),
      string: () => chainable(),
      number: () => chainable(),
      array: () => chainable(),
      coerce: { number: () => chainable() },
      enum: () => chainable(),
      infer: () => ({}),
    },
  }
})

// -----------------------------------------------------------------------
// Mock data
// -----------------------------------------------------------------------

const mockProvidersList = {
  items: [
    {
      id: "prov-1",
      name: "Maria Silva",
      city: "São Paulo",
      verified: true,
      avatarUrl: null,
      rating: 4.8,
      reviewCount: 25,
    },
  ],
  total: 1,
}

const mockServicesList = [
  {
    id: "svc-1",
    title: "Instalação Elétrica",
    basePrice: 150,
    unit: "UNIDADE" as const,
    providerId: "prov-1",
    description: "Descrição do serviço",
  },
]

// -----------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()

  mockUIStore.quoteModal = { open: false, providerId: null, serviceId: null }
  mockUIStore.closeQuote = vi.fn()
  mockUIStore.openAuth = vi.fn()
  mockAuthStore.user = null

  mockUseQuery.mockImplementation((opts: { queryKey: string[] }) => {
    const key = opts.queryKey?.[0]
    if (key === "providers-options") {
      return { data: mockProvidersList, isLoading: false }
    }
    if (key === "services-by-provider") {
      return { data: mockServicesList, isLoading: false }
    }
    return { data: undefined, isLoading: false }
  })
})

function renderModal() {
  return render(<QuoteModal />)
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe("QuoteModal — rendering", () => {
  it("renders nothing when closed", () => {
    const { container } = renderModal()
    expect(container.querySelector('[data-testid="dialog"]')).not.toBeInTheDocument()
  })

  it("renders dialog with step wizard when open", () => {
    mockUIStore.quoteModal = { open: true, providerId: null, serviceId: null }
    renderModal()

    const dialogs = screen.getAllByTestId("dialog")
    expect(dialogs.length).toBeGreaterThan(0)
    expect(screen.getByTestId("dialog-title")).toHaveTextContent("Pedir orçamento")
    expect(screen.getByTestId("step-wizard")).toBeInTheDocument()
  })

  it("shows all 5 step labels", () => {
    mockUIStore.quoteModal = { open: true, providerId: null, serviceId: null }
    renderModal()

    const stepBtns = screen.getAllByTestId("step-btn")
    const labels = stepBtns.map((b) => b.textContent)
    expect(labels.some((l) => l?.includes("Prestador"))).toBe(true)
    expect(labels.some((l) => l?.includes("Serviço"))).toBe(true)
    expect(labels.some((l) => l?.includes("Detalhes"))).toBe(true)
    expect(labels.some((l) => l?.includes("Endereço"))).toBe(true)
    expect(labels.some((l) => l?.includes("Revisão"))).toBe(true)
  })

  it("starts on step 1 (Prestador)", () => {
    mockUIStore.quoteModal = { open: true, providerId: null, serviceId: null }
    renderModal()

    const wizards = screen.getAllByTestId("step-wizard")
    expect(wizards[0]).toHaveAttribute("data-step", "1")
  })
})

describe("QuoteModal — auth gate", () => {
  it("shows auth gate banner on step 1 when user is not logged in", () => {
    mockUIStore.quoteModal = { open: true, providerId: null, serviceId: null }
    mockAuthStore.user = null
    renderModal()

    expect(
      screen.getAllByText("Faça cadastro gratuito para pedir orçamentos").length,
    ).toBeGreaterThan(0)
  })

  it("does not call openAuth when user is logged in", () => {
    mockAuthStore.user = {
      id: "usr-1",
      name: "Test User",
      email: "test@test.com",
      role: "CLIENT",
      avatarUrl: null,
    }
    mockUIStore.quoteModal = { open: true, providerId: null, serviceId: null }
    renderModal()

    // openAuth should not be called just by opening the modal
    expect(mockUIStore.openAuth).not.toHaveBeenCalled()
  })
})

describe("QuoteModal — step navigation", () => {
  it("shows Continuar button on step 1", () => {
    mockUIStore.quoteModal = { open: true, providerId: null, serviceId: null }
    renderModal()

    const nextBtns = screen.getAllByTestId("next-btn")
    expect(nextBtns.length).toBeGreaterThan(0)
  })

  it("does not show Voltar button on step 1", () => {
    mockUIStore.quoteModal = { open: true, providerId: null, serviceId: null }
    renderModal()

    expect(screen.queryByTestId("back-btn")).not.toBeInTheDocument()
  })

  it("shows step header with title on step 1", () => {
    mockUIStore.quoteModal = { open: true, providerId: null, serviceId: null }
    renderModal()

    const stepHeaders = screen.getAllByTestId("step-header")
    const header = stepHeaders.find((h) => h.textContent?.includes("Escolha o prestador"))
    expect(header).toBeTruthy()
  })
})

describe("QuoteModal — with provider preset", () => {
  it("shows provider info card when providerId is preset", () => {
    mockUIStore.quoteModal = { open: true, providerId: "prov-1", serviceId: null }
    renderModal()

    // The provider name should appear (from providers query data)
    const providerElements = screen.getAllByText("Maria Silva")
    expect(providerElements.length).toBeGreaterThan(0)
  })
})
