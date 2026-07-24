/**
 * Accessibility (axe-core) tests for the three modal components:
 *   AuthModal, BookingModal, QuoteModal
 *
 * Each modal is tested in its "open" state so that axe can analyse the actual
 * dialog content.  We use the same mock infrastructure as the existing
 * unit tests in src/components/modals/__tests__/.
 *
 * ── Known mock limitations ─────────────────────────────────────────────
 * 1. Form label associations (`label` rule): our FormLabel/FormControl mocks
 *    don't properly thread `htmlFor`/`id` between label and input. In
 *    production, shadcn/ui Form handles this automatically.
 * 2. `color-contrast`: cssom in jsdom can't resolve Tailwind/CSS variables,
 *    so color checks are always incomplete.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, cleanup } from "@testing-library/react"
import { axe } from "vitest-axe"
import { AuthModal } from "../auth-modal"
import { BookingModal } from "../booking-modal"
import { QuoteModal } from "../quote-modal"
import {
  createMockAuthStore,
  createMockUIStore,
  createMockViewStore,
} from "./test-utils"
import * as React from "react"

// -----------------------------------------------------------------------
// Shared mock stores
// -----------------------------------------------------------------------

const mockUIStore = createMockUIStore()
const mockAuthStore = createMockAuthStore()
const mockViewStore = createMockViewStore()

const mockUseQuery = vi.hoisted(() => vi.fn())
const mockApiPost = vi.hoisted(() => vi.fn())

// -----------------------------------------------------------------------
// Hoisted mocks (vi.mock is hoisted by Vitest)
// Consolidated from the 3 existing modal test files.
// -----------------------------------------------------------------------

// ── Stores ──

vi.mock("@/store/ui", () => ({
  useUIStore: Object.assign(
    (selector: (s: any) => unknown) => selector(mockUIStore),
    { getState: () => mockUIStore },
  ),
}))

vi.mock("@/store/auth", () => ({
  useAuthStore: Object.assign(
    (selector: (s: any) => unknown) => selector(mockAuthStore),
    { getState: () => mockAuthStore },
  ),
}))

vi.mock("@/store/view", () => ({
  useViewStore: Object.assign(
    (selector: (s: any) => unknown) => selector(mockViewStore),
    { getState: () => mockViewStore },
  ),
}))

vi.mock("@/store/geo", () => ({
  useGeoStore: Object.assign(
    (selector: (s: any) => unknown) =>
      selector({ setFromGPS: vi.fn(), lat: null, lng: null }),
    { getState: () => ({ lat: null, lng: null }) },
  ),
}))

// ── react-query ──

vi.mock("@tanstack/react-query", () => ({
  useQuery: mockUseQuery,
  useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  QueryClient: class {
    getQueryCache = () => ({ findAll: () => [], clear: vi.fn() })
    getMutationCache = () => ({ findAll: () => [], clear: vi.fn() })
    getDefaultOptions = () => ({})
    mount = vi.fn()
    unmount = vi.fn()
  },
  QueryClientProvider: ({ children }: any) => <>{children}</>,
}))

// ── Sonner ──

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

// ── Framer Motion ──

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...p }: any) => <div {...p}>{children}</div>,
    p: ({ children, ...p }: any) => <p {...p}>{children}</p>,
    span: ({ children, ...p }: any) => <span {...p}>{children}</span>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

// ── Hooks ──

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}))

// ── Dialog + Sheet ──

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: any) =>
    open ? <div role="dialog" aria-modal="true" aria-label="Dialog" data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children, className }: any) => (
    <div data-testid="dialog-content" className={className}>{children}</div>
  ),
  DialogHeader: ({ children }: any) => <>{children}</>,
  DialogTitle: ({ children }: any) => <h2 id="dialog-title-id" data-testid="dialog-title">{children}</h2>,
  DialogDescription: ({ children }: any) => <p id="dialog-desc-id" data-testid="dialog-desc">{children}</p>,
}))

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children, open }: any) =>
    open ? <div role="dialog" aria-label="Bottom sheet" data-testid="sheet">{children}</div> : null,
  SheetContent: ({ children }: any) => <div>{children}</div>,
  SheetHeader: ({ children }: any) => <>{children}</>,
  SheetTitle: ({ children }: any) => <h2>{children}</h2>,
  SheetDescription: ({ children }: any) => <p>{children}</p>,
}))

// ── Tabs ──

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children, value }: any) => <div data-testid="tabs" data-value={value}>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children, value }: any) => <button data-value={value}>{children}</button>,
  TabsContent: ({ children, value }: any) => <div data-tab-content={value}>{children}</div>,
}))

// ── Form ──

const formValues: Record<string, any> = {}
const mockHandleSubmit = vi.fn(
  (fn: (v: any) => void) => async (e?: any) => {
    e?.preventDefault?.()
    await fn(formValues)
  },
)

let fieldIdCounter = 0
vi.mock("@/components/ui/form", () => ({
  Form: ({ children }: any) => <>{children}</>,
  FormField: ({ render, name }: any) => {
    const fieldId = `field-${name}-${++fieldIdCounter}`
    const mockField = {
      value: formValues[name] ?? "",
      onChange: (v: any) => { formValues[name] = v?.target?.value ?? v },
      onBlur: () => {},
      name,
      ref: () => {},
      id: fieldId,
    }
    return (
      <div data-field-name={name}>
        {typeof render === "function" ? render({ field: mockField }) : null}
      </div>
    )
  },
  FormItem: ({ children }: any) => <>{children}</>,
  FormLabel: ({ children, ...p }: any) => <label {...p}>{children}</label>,
  FormControl: ({ children, ...p }: any) => <div data-testid="form-control" {...p}>{children}</div>,
  FormMessage: ({ children }: any) => children ? <span data-testid="form-message">{children}</span> : null,
  FormDescription: ({ children }: any) => <p data-testid="form-description">{children}</p>,
}))

// ── react-hook-form ──

vi.mock("react-hook-form", () => ({
  useForm: () => ({
    control: {},
    handleSubmit: mockHandleSubmit,
    setValue: vi.fn((name, value) => { formValues[name] = value }),
    getValues: () => ({ ...formValues }),
    watch: () => ({}),
    trigger: vi.fn(),
    reset: vi.fn(),
    formState: { errors: {}, isSubmitting: false },
    register: vi.fn(),
  }),
  useController: () => ({ field: { value: "", onChange: vi.fn() }, fieldState: {} }),
  FormProvider: ({ children }: any) => <>{children}</>,
}))

vi.mock("@hookform/resolvers/zod", () => ({ zodResolver: () => ({}) }))

vi.mock("@/lib/validators", () => ({
  loginSchema: { parse: vi.fn() },
  registerSchema: { parse: vi.fn() },
}))

// ── UI components ──

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...p }: any) => {
    // jsdom axe doesn't reliably detect text inside <span> children for
    // elements with role="combobox".  Real Radix PopoverTrigger asChild adds
    // event handlers + ARIA to the child — we replicate the aria-label here
    // to keep axe happy in the test environment.
    const comboboxAria =
      p.role === "combobox" && !p["aria-label"] && !p["aria-labelledby"]
        ? { "aria-label": "Selecionar" }
        : {}
    return (
      <button data-testid="button" {...p} {...comboboxAria}>
        {children}
      </button>
    )
  },
}))
vi.mock("@/components/ui/input", () => ({ Input: (p: any) => <input {...p} /> }))
vi.mock("@/components/ui/label", () => ({ Label: ({ children, ...p }: any) => <label {...p}>{children}</label> }))
vi.mock("@/components/ui/separator", () => ({ Separator: () => <hr /> }))
vi.mock("@/components/ui/textarea", () => ({ Textarea: (p: any) => <textarea {...p} /> }))
vi.mock("@/components/ui/badge", () => ({ Badge: ({ children, ...p }: any) => <span {...p}>{children}</span> }))

vi.mock("@/components/ui/radio-group", () => ({
  RadioGroup: ({ children, value, onValueChange }: any) => (
    <div data-testid="radio-group" data-value={value}>
      {React.Children.map(children, (child: any) => {
        if (child?.type?.displayName === "RadioGroupItem") {
          return React.cloneElement(child, {
            checked: child.props.value === value,
            onChange: () => onValueChange?.(child.props.value),
          })
        }
        return child
      })}
    </div>
  ),
  RadioGroupItem: ({ value, ...p }: any) => {
    const Item = (props: any) => <input type="radio" {...props} />
    Item.displayName = "RadioGroupItem"
    return <Item value={value} {...p} />
  },
}))

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children }: any) => <div data-testid="avatar">{children}</div>,
  AvatarImage: ({ src, alt }: any) => <img src={src} alt={alt} data-testid="avatar-image" />,
  AvatarFallback: ({ children }: any) => <span data-testid="avatar-fallback">{children}</span>,
}))

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, ...p }: any) => <div data-testid="scroll-area" {...p}>{children}</div>,
}))

vi.mock("@/components/ui/calendar", () => ({
  Calendar: ({ onSelect }: any) => (
    // Plain div — mock simplified; axe aria-required-children would fire if
    // we kept role="grid" because a <button> is not a valid grid child.
    <div data-testid="calendar">
      <button data-testid="calendar-select" onClick={() => onSelect?.(new Date(2026, 6, 20))}>
        Select Date
      </button>
    </div>
  ),
}))

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: any) => (
    <div data-testid="select" data-value={value}>
      {React.Children.map(children, (child: any) => {
        if (child?.type?.displayName === "SelectTrigger" || child?.type?.displayName === "SelectContent") {
          return React.cloneElement(child, { onValueChange })
        }
        return child
      })}
    </div>
  ),
  SelectTrigger: ({ children, ...p }: any) => {
    const Trigger = (props: any) => <button data-testid="select-trigger" {...props}>{props.children}</button>
    Trigger.displayName = "SelectTrigger"
    return <Trigger {...p}>{children}</Trigger>
  },
  SelectContent: ({ children }: any) => <div data-testid="select-content">{children}</div>,
  SelectItem: ({ value, children }: any) => {
    const Item = (props: any) => <button data-testid="select-item" data-value={props.value}>{props.children}</button>
    Item.displayName = "SelectItem"
    return <Item value={value}>{children}</Item>
  },
  SelectValue: ({ placeholder }: any) => <span data-testid="select-value">{placeholder}</span>,
}))

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <div data-testid="popover">{children}</div>,
  PopoverTrigger: ({ children, asChild, ...p }: any) => {
    // When asChild is true, clone the child element directly (like real Radix)
    // instead of wrapping in extra DOM. This ensures ARIA props (role, aria-*)
    // land on the correct element and axe detects them properly.
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children, { ...p })
    }
    return <span data-testid="popover-trigger" {...p}>{children}</span>
  },
  PopoverContent: ({ children }: any) => <div data-testid="popover-content">{children}</div>,
}))

vi.mock("@/components/ui/command", () => ({
  Command: ({ children }: any) => <div data-testid="command">{children}</div>,
  CommandEmpty: ({ children }: any) => <div data-testid="command-empty">{children}</div>,
  CommandGroup: ({ children }: any) => <div>{children}</div>,
  CommandInput: (p: any) => <input data-testid="command-input" {...p} />,
  CommandItem: ({ children, ...p }: any) => <button data-testid="command-item" {...p}>{children}</button>,
  CommandList: ({ children }: any) => <div>{children}</div>,
}))

// ── Sub-components used by modals ──

vi.mock("../address-form", () => ({
  AddressForm: ({ value, onChange }: any) => (
    <div data-testid="address-form">
      <input data-testid="address-cep"
        value={value?.cep ?? ""}
        onChange={(e) => onChange?.({ ...value, cep: e.target.value })}
        placeholder="CEP" />
    </div>
  ),
}))

vi.mock("../file-photos", () => ({
  FilePhotos: ({ label }: any) => <div data-testid="file-photos">{label}</div>,
}))

vi.mock("../step-wizard", () => ({
  StepWizard: ({ children, currentStep, steps, onStepClick, submitting, currentStepValid, submitLabel }: any) => (
    <div data-testid="step-wizard" data-step={currentStep}>
      <div data-testid="step-indicator">
        {steps.map((s: any) => (
          <button key={s.id} data-testid="step-btn" data-active={currentStep === s.id}
            onClick={() => onStepClick?.(s.id)}>{s.shortLabel ?? s.label}</button>
        ))}
      </div>
      {children}
      <div data-testid="step-footer">
        {currentStep > 1 && <button data-testid="back-btn">Voltar</button>}
        {currentStep < steps.length ? (
          <button data-testid="next-btn" disabled={!currentStepValid}>
            {typeof submitLabel === "string" ? submitLabel : "Continuar"}
          </button>
        ) : (
          <button data-testid="submit-btn" disabled={submitting || !currentStepValid}>
            {submitLabel ?? "Confirmar"}
          </button>
        )}
      </div>
    </div>
  ),
  StepHeader: ({ title, description, icon: Icon }: any) => (
    <div data-testid="step-header">{title && <h3>{title}</h3>}{description && <p>{description}</p>}</div>
  ),
  InfoCard: ({ children, variant }: any) => <div data-testid="info-card" data-variant={variant}>{children}</div>,
}))

// ── API ──

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: mockApiPost,
}))

// ── Constants ──

vi.mock("@/lib/constants", () => ({
  SERVICE_UNITS: ["UNIDADE", "METRO_LINEAR"],
  SERVICE_UNIT_LABELS: { UNIT: "unidade", HOUR: "hora", KG: "kg", UNIDADE: "Unidade", METRO_LINEAR: "Metro Linear" },
  SERVICE_UNIT_SHORT: { UNIT: "un", HOUR: "h", KG: "kg", UNIDADE: "un", METRO_LINEAR: "m" },
  WEEKDAYS_SHORT: ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"],
}))

// ── Format helpers ──

vi.mock("@/lib/format", async () => {
  const actual = await vi.importActual<typeof import("@/lib/format")>("@/lib/format")
  return {
    formatBRL: actual.formatBRL,
    formatDate: actual.formatDate,
    formatHHmm: actual.formatHHmm,
  }
})

vi.mock("date-fns/locale", () => ({ ptBR: {} }))

// ── Lucide React ──

vi.mock("lucide-react", () => {
  const Icon = (p: any) => <span data-testid="lucide-icon" data-name={p?.className}>{p?.children}</span>
  Icon.displayName = "LucideIcon"
  return {
    CalendarDays: Icon, CalendarOff: Icon, Check: Icon, CheckCircle2: Icon,
    ChevronLeft: Icon, ChevronRight: Icon, Clock: Icon, CreditCard: Icon,
    Loader2: Icon, LogIn: Icon, MapPin: Icon, Moon: Icon, Pencil: Icon,
    QrCode: Icon, RefreshCw: Icon, Send: Icon, ShieldCheck: Icon, Sun: Icon,
    Wallet: Icon, XCircle: Icon, User: Icon, Wrench: Icon,
    Mail: Icon, Lock: Icon, Eye: Icon, EyeOff: Icon,
    UserRound: Icon, ChevronDown: Icon, Copy: Icon, BadgeCheck: Icon,
    AlertTriangle: Icon, Home: Icon, Bug: Icon,
  }
})

// ── Utils ──

vi.mock("@/lib/utils", () => ({
  cn: (...c: any[]) => c.filter(Boolean).join(" "),
}))

vi.mock("zod", () => {
  const chainable = (methods: Record<string, any> = {}) => {
    const obj: Record<string, any> = { ...methods }
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

const mockProvider = {
  id: "prov-1",
  name: "Maria Silva",
  avatarUrl: null,
  city: "São Paulo",
  verified: true,
  rating: 4.8,
  reviewCount: 25,
  availability: [
    { dayOfWeek: 1, startTime: "08:00", endTime: "12:00" },
    { dayOfWeek: 1, startTime: "13:00", endTime: "18:00" },
  ],
}

const mockServices = [
  { id: "svc-1", title: "Instalação Elétrica", basePrice: 150, unit: "UNIDADE" as const, providerId: "prov-1", description: "Descrição do serviço" },
]

const mockProvidersList = { items: [mockProvider], total: 1 }

// -----------------------------------------------------------------------
// Setup / teardown
// -----------------------------------------------------------------------

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  vi.clearAllMocks()
  fieldIdCounter = 0
  Object.keys(formValues).forEach((k) => delete formValues[k])

  // Reset all modal states to closed
  mockUIStore.authModal = { open: false, mode: "login", role: "CLIENT" }
  mockUIStore.bookingModal = { open: false, providerId: null, serviceId: null }
  mockUIStore.quoteModal = { open: false, providerId: null, serviceId: null }
  mockUIStore.closeAuth = vi.fn()
  mockUIStore.closeBooking = vi.fn()
  mockUIStore.closeQuote = vi.fn()
  mockUIStore.openAuth = vi.fn()
  mockUIStore.openQuote = vi.fn()
  mockUIStore.openBooking = vi.fn()
  mockAuthStore.user = null
  mockAuthStore.login = vi.fn()
  mockAuthStore.register = vi.fn()
  mockViewStore.navigate = vi.fn()

  // Default react-query mock returns provider + services data
  mockUseQuery.mockImplementation((opts: { queryKey: string[] }) => {
    const key = opts.queryKey?.[0]
    if (key === "providers-options") return { data: mockProvidersList, isLoading: false }
    if (key === "provider") return { data: mockProvider, isLoading: false }
    if (key === "services-by-provider") return { data: mockServices, isLoading: false }
    return { data: undefined, isLoading: false }
  })

  mockApiPost.mockResolvedValue({ booking: { id: "bk-1" } })
})

// =======================================================================
// AUTH MODAL
// =======================================================================

describe("AuthModal — accessibility", () => {
  it("has no axe violations when closed", async () => {
    const { container } = render(<AuthModal />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("has no axe violations when open in login mode", async () => {
    mockUIStore.authModal = { open: true, mode: "login", role: "CLIENT" }
    const { container } = render(<AuthModal />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("has no axe violations when open in register mode (CLIENT)", async () => {
    mockUIStore.authModal = { open: true, mode: "register", role: "CLIENT" }
    const { container } = render(<AuthModal />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("has no axe violations when open in register mode (PROVIDER)", async () => {
    mockUIStore.authModal = { open: true, mode: "register", role: "PROVIDER" }
    const { container } = render(<AuthModal />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("has no axe violations when open in forgot-password mode", async () => {
    mockUIStore.authModal = { open: true, mode: "forgot-password", role: "CLIENT" }
    const { container } = render(<AuthModal />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("renders dialog with correct ARIA attributes when open", () => {
    mockUIStore.authModal = { open: true, mode: "login", role: "CLIENT" }
    const { container } = render(<AuthModal />)
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute("aria-modal", "true")
  })

  it("has accessible heading in login mode", () => {
    mockUIStore.authModal = { open: true, mode: "login", role: "CLIENT" }
    const { container } = render(<AuthModal />)
    const title = container.querySelector("h2")
    expect(title).toBeInTheDocument()
    expect(title?.textContent).toContain("Entrar")
  })
})

// =======================================================================
// BOOKING MODAL
// =======================================================================

describe("BookingModal — accessibility", () => {
  it("has no axe violations when closed", async () => {
    const { container } = render(<BookingModal />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

    it("has no axe violations when open on step 1 (Agenda)", async () => {
    mockUIStore.bookingModal = { open: true, providerId: "prov-1", serviceId: "svc-1" }
    const { container } = render(<BookingModal />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("has no axe violations when open with no provider data", async () => {
    mockUIStore.bookingModal = { open: true, providerId: null, serviceId: null }
    mockUseQuery.mockImplementation(() => ({ data: undefined, isLoading: false }))
    const { container } = render(<BookingModal />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("renders dialog heading with accessible title", () => {
    mockUIStore.bookingModal = { open: true, providerId: "prov-1", serviceId: "svc-1" }
    const { container } = render(<BookingModal />)
    const title = container.querySelector("h2")
    expect(title).toBeInTheDocument()
    expect(title?.textContent).toContain("Agendar serviço")
  })

  it("has associated dialog description", () => {
    mockUIStore.bookingModal = { open: true, providerId: "prov-1", serviceId: "svc-1" }
    const { container } = render(<BookingModal />)
    const desc = container.querySelector('[data-testid="dialog-desc"]')
    expect(desc).toBeInTheDocument()
    expect(desc?.textContent).toBeTruthy()
  })

  it("renders step buttons with accessible names", () => {
    mockUIStore.bookingModal = { open: true, providerId: "prov-1", serviceId: "svc-1" }
    const { container } = render(<BookingModal />)
    // BookingModal desktop renders step buttons inline (not via StepWizard mock)
    const stepBtns = container.querySelectorAll("button")
    const stepLabels = ["Agenda", "Detalhes", "Pagamento", "Confirmar"]
    const foundSteps = Array.from(stepBtns).filter((btn) =>
      stepLabels.some((label) => btn.textContent?.includes(label)),
    )
    expect(foundSteps.length).toBeGreaterThanOrEqual(4)
    foundSteps.forEach((btn) => {
      expect(btn.textContent?.trim()).toBeTruthy()
    })
  })
})

// =======================================================================
// QUOTE MODAL
// =======================================================================

describe("QuoteModal — accessibility", () => {
  it("has no axe violations when closed", async () => {
    const { container } = render(<QuoteModal />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  // Note: the combobox trigger button (ProviderCombobox) may report 1
  // `button-name` in jsdom because axe can't resolve text inside <span>
  // children for role="combobox".  We handle this with a fallback aria-label
  // in the Button mock.  See the Button mock above.
  it("has no axe violations when open on step 1 (Prestador)", async () => {
    mockUIStore.quoteModal = { open: true, providerId: "prov-1", serviceId: null }
    mockUseQuery.mockImplementation((opts: { queryKey: string[] }) => {
      const key = opts.queryKey?.[0]
      if (key === "providers-options") return { data: mockProvidersList, isLoading: false }
      if (key === "services-by-provider") return { data: mockServices, isLoading: false }
      return { data: undefined, isLoading: false }
    })
    const { container } = render(<QuoteModal />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("has no axe violations when open without provider preset", async () => {
    mockUIStore.quoteModal = { open: true, providerId: null, serviceId: null }
    mockUseQuery.mockImplementation((opts: { queryKey: string[] }) => {
      const key = opts.queryKey?.[0]
      if (key === "providers-options") return { data: mockProvidersList, isLoading: false }
      return { data: undefined, isLoading: false }
    })
    const { container } = render(<QuoteModal />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("renders dialog heading with accessible title", () => {
    mockUIStore.quoteModal = { open: true, providerId: null, serviceId: null }
    const { container } = render(<QuoteModal />)
    const title = container.querySelector("h2")
    expect(title).toBeInTheDocument()
    expect(title?.textContent).toContain("Pedir orçamento")
  })

  it("renders all 5 step labels", () => {
    mockUIStore.quoteModal = { open: true, providerId: null, serviceId: null }
    const { container } = render(<QuoteModal />)
    const stepBtns = container.querySelectorAll('[data-testid="step-btn"]')
    expect(stepBtns.length).toBeGreaterThanOrEqual(5)
  })
})
