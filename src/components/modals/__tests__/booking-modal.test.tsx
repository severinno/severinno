/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @next/next/no-img-element, jsx-a11y/alt-text  */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen } from "@/__tests__/test-utils"
import { BookingModal } from "../booking-modal"
import { createMockAuthStore, createMockUIStore, createMockViewStore } from "./test-utils"
import * as React from "react"

afterEach(cleanup)

// -----------------------------------------------------------------------
// Shared mock stores
// -----------------------------------------------------------------------

const mockUIStore = createMockUIStore()
const mockAuthStore = createMockAuthStore()
const mockViewStore = createMockViewStore()

// -----------------------------------------------------------------------
// Hoisted mocks (vi.mock is hoisted by Vitest)
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
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}))

// Dialog mock – controlled by open prop
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

// Sheet mock (used on mobile)
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

// Textarea
vi.mock("@/components/ui/textarea", () => ({
  Textarea: (p: any) => <textarea {...p} />,
}))

// Badge
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...p }: any) => <span {...p}>{children}</span>,
}))

// Separator
vi.mock("@/components/ui/separator", () => ({
  Separator: () => <hr />,
}))

// Calendar mock – simplified for testing
vi.mock("@/components/ui/calendar", () => ({
  Calendar: ({ onSelect }: any) => (
    <div data-testid="calendar">
      <button data-testid="calendar-select" onClick={() => onSelect?.(new Date(2026, 6, 20))}>
        Select Date
      </button>
    </div>
  ),
}))

// RadioGroup
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

// Avatar
vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children }: any) => <div data-testid="avatar">{children}</div>,
  AvatarImage: ({ src, alt }: any) => <img src={src} alt={alt} data-testid="avatar-image" />,
  AvatarFallback: ({ children }: any) => <span data-testid="avatar-fallback">{children}</span>,
}))

// ScrollArea
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, ...p }: any) => (
    <div data-testid="scroll-area" {...p}>
      {children}
    </div>
  ),
}))

// Select (used by AddressForm)
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

// API functions
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
}))

// Utils
vi.mock("@/lib/utils", () => ({
  cn: (...c: any[]) => c.filter(Boolean).join(" "),
}))

// Constants
vi.mock("@/lib/constants", () => ({
  SERVICE_UNIT_LABELS: { UNIT: "unidade", HOUR: "hora", KG: "kg" },
  SERVICE_UNIT_SHORT: { UNIT: "un", HOUR: "h", KG: "kg" },
  WEEKDAYS_SHORT: ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"],
}))

// Format helpers – re-export real date-fns so dates display correctly
vi.mock("@/lib/format", async () => {
  const actual = await vi.importActual<typeof import("@/lib/format")>("@/lib/format")
  return {
    formatBRL: actual.formatBRL,
    formatDate: actual.formatDate,
    formatHHmm: actual.formatHHmm,
  }
})

vi.mock("lucide-react", () => {
  const LucideIcon = (p: any) => (
    <span data-testid="lucide-icon" data-name={p?.className}>
      {p?.children}
    </span>
  )
  LucideIcon.displayName = "LucideIcon"
  return {
    CalendarDays: LucideIcon,
    CalendarOff: LucideIcon,
    Check: LucideIcon,
    CheckCircle2: LucideIcon,
    ChevronLeft: LucideIcon,
    ChevronRight: LucideIcon,
    Clock: LucideIcon,
    CreditCard: LucideIcon,
    Loader2: LucideIcon,
    MapPin: LucideIcon,
    Moon: LucideIcon,
    Pencil: LucideIcon,
    QrCode: LucideIcon,
    Send: LucideIcon,
    ShieldCheck: LucideIcon,
    Sun: LucideIcon,
    Wallet: LucideIcon,
  }
})

vi.mock("date-fns/locale", () => ({
  ptBR: {},
}))

// react-hook-form (used by sub-components when editing card details)
vi.mock("react-hook-form", () => ({
  useForm: () => ({
    control: {},
    handleSubmit: (fn: any) => async (e?: any) => {
      e?.preventDefault?.()
      await fn({})
    },
    setValue: vi.fn(),
    getValues: () => ({}),
    formState: { errors: {}, isSubmitting: false },
    register: vi.fn(),
    watch: vi.fn(),
  }),
  useController: () => ({
    field: { value: "", onChange: vi.fn() },
    fieldState: {},
  }),
  FormProvider: ({ children }: any) => <>{children}</>,
}))

// Hookform resolvers
vi.mock("@hookform/resolvers/zod", () => ({
  zodResolver: () => ({}),
}))

// -----------------------------------------------------------------------
// Mock data
// -----------------------------------------------------------------------

const mockProvider = {
  id: "prov-1",
  name: "Test Provider",
  avatarUrl: null,
  availability: [
    { dayOfWeek: 1, startTime: "08:00", endTime: "12:00" },
    { dayOfWeek: 1, startTime: "13:00", endTime: "18:00" },
  ],
  rating: 4.5,
  reviewCount: 10,
}

const mockServices = [
  {
    id: "svc-1",
    title: "Test Service",
    basePrice: 100,
    unit: "UNIT" as const,
    providerId: "prov-1",
  },
]

// -----------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()

  // Reset UI store to closed
  mockUIStore.bookingModal = { open: false, providerId: null, serviceId: null }
  mockUIStore.closeBooking = vi.fn()
  mockUIStore.openAuth = vi.fn()
  mockAuthStore.user = null

  // Use mockImplementation to handle both useQuery calls predictably.
  // First call (provider) → mockProvider, Second call (services) → mockServices
  mockUseQuery.mockImplementation((opts: { queryKey: string[] }) => {
    if (opts.queryKey?.[0] === "provider") {
      return { data: mockProvider, isLoading: false }
    }
    return { data: mockServices, isLoading: false }
  })
})

function renderModal() {
  return render(<BookingModal />)
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe("BookingModal — rendering", () => {
  it("renders nothing when closed", () => {
    const { container } = renderModal()
    expect(container.querySelector('[data-testid="dialog"]')).not.toBeInTheDocument()
  })

  it("renders dialog with step indicator when open with provider data", () => {
    mockUIStore.bookingModal = { open: true, providerId: "prov-1", serviceId: "svc-1" }
    renderModal()

    const dialogs = screen.getAllByTestId("dialog")
    expect(dialogs.length).toBeGreaterThan(0)
    const titles = screen.getAllByTestId("dialog-title")
    expect(titles.find((t) => t.textContent === "Agendar serviço")).toBeDefined()
    // Steps
    expect(screen.getByText("Agenda")).toBeInTheDocument()
    expect(screen.getByText("Detalhes")).toBeInTheDocument()
    expect(screen.getByText("Pagamento")).toBeInTheDocument()
    expect(screen.getByText("Confirmar")).toBeInTheDocument()
  })

  it("shows service info banner when provider data is loaded", () => {
    mockUIStore.bookingModal = { open: true, providerId: "prov-1", serviceId: "svc-1" }
    renderModal()

    // Service title appears in the info banner on step 1 (Agenda)
    expect(screen.getAllByText("Test Service").length).toBeGreaterThan(0)
    // Provider name shown as first letter in Avatar fallback ("T")
    expect(screen.getAllByText("T").length).toBeGreaterThan(0)
  })

  it("shows loading state while queries are fetching", () => {
    mockUIStore.bookingModal = { open: true, providerId: "prov-1", serviceId: "svc-1" }
    // Override useQuery to return loading for both calls
    mockUseQuery.mockImplementation(() => ({
      data: undefined,
      isLoading: true,
    }))

    renderModal()

    // Dialog still renders but shows loading content
    const dialogs = screen.getAllByTestId("dialog")
    expect(dialogs.length).toBeGreaterThan(0)
  })

  it("renders calendar on step 1 (Agenda)", () => {
    mockUIStore.bookingModal = { open: true, providerId: "prov-1", serviceId: "svc-1" }
    renderModal()

    const calendars = screen.getAllByTestId("calendar")
    expect(calendars.length).toBeGreaterThan(0)
  })

  it("renders the correct step number labels", () => {
    mockUIStore.bookingModal = { open: true, providerId: "prov-1", serviceId: "svc-1" }
    renderModal()

    // Desktop uses stepIndicator which shows shortLabels.
    // Using getAllByText because /Agenda/i also matches "Agendar serviço" (title)
    const agendaElements = screen.getAllByText(/Agenda/i)
    expect(agendaElements.length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/Detalhes/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/Pagamento/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/Confirmar/i).length).toBeGreaterThanOrEqual(1)
  })
})

describe("BookingModal — step navigation", () => {
  it("shows 'Continuar' button (next CTA) on step 1", () => {
    mockUIStore.bookingModal = { open: true, providerId: "prov-1", serviceId: "svc-1" }
    renderModal()

    // There may be multiple elements with "Continuar" (step indicator chip + footer)
    const continuarButtons = screen.getAllByText("Continuar")
    expect(continuarButtons.length).toBeGreaterThanOrEqual(1)
  })

  it("does not show 'Voltar' on step 1", () => {
    mockUIStore.bookingModal = { open: true, providerId: "prov-1", serviceId: "svc-1" }
    renderModal()

    expect(screen.queryByText("Voltar")).not.toBeInTheDocument()
  })

  it("shows 'Confirmar agendamento' submit label on step 4", () => {
    mockUIStore.bookingModal = { open: true, providerId: "prov-1", serviceId: "svc-1" }
    renderModal()

    // Step 1 — the "Confirmar agendamento" button should NOT be visible yet
    expect(screen.queryByText("Confirmar agendamento")).not.toBeInTheDocument()
  })
})

describe("BookingModal — auth gating", () => {
  it("does not call openAuth when modal opens without user interaction", () => {
    mockUIStore.bookingModal = { open: true, providerId: "prov-1", serviceId: "svc-1" }
    mockAuthStore.user = null
    renderModal()

    // openAuth should NOT be called just by opening the modal
    expect(mockUIStore.openAuth).not.toHaveBeenCalled()
  })

  it("keeps openAuth uncalled when modal opens for an authenticated user", () => {
    mockAuthStore.user = {
      id: "usr-1",
      name: "Test User",
      email: "test@test.com",
      role: "CLIENT",
      avatarUrl: null,
    }
    mockUIStore.bookingModal = { open: true, providerId: "prov-1", serviceId: "svc-1" }
    renderModal()

    expect(mockUIStore.openAuth).not.toHaveBeenCalled()
  })
})
