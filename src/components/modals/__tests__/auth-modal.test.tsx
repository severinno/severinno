/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@/__tests__/test-utils"
import { AuthModal } from "../auth-modal"
import {
  createMockAuthStore,
  createMockUIStore,
  createMockViewStore,
  TestQueryProvider,
} from "./test-utils"

// Shared mock stores
const mockAuthStore = createMockAuthStore()
const mockUIStore = createMockUIStore()
const mockViewStore = createMockViewStore()

// Store mock factories (use selector pattern + getState)
vi.mock("@/store/auth", () => ({
  useAuthStore: Object.assign((selector: (s: any) => unknown) => selector(mockAuthStore), {
    getState: () => mockAuthStore,
  }),
}))

vi.mock("@/store/ui", () => ({
  useUIStore: Object.assign((selector: (s: any) => unknown) => selector(mockUIStore), {
    getState: () => mockUIStore,
  }),
}))

vi.mock("@/store/view", () => ({
  useViewStore: Object.assign((selector: (s: any) => unknown) => selector(mockViewStore), {
    getState: () => mockViewStore,
  }),
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

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: any) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({ children }: any) => <div data-testid="dialog-content">{children}</div>,
  DialogHeader: ({ children }: any) => <>{children}</>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
}))

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children, value }: any) => (
    <div data-testid="tabs" data-value={value}>
      {children}
    </div>
  ),
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children, value }: any) => <button data-value={value}>{children}</button>,
  TabsContent: ({ children, value }: any) => <div data-tab-content={value}>{children}</div>,
}))

// Form: capture submitted values via a registry (vi.hoisted — required for vi.mock references)
const formValues = vi.hoisted(() => ({}) as Record<string, any>)
const mockHandleSubmit = vi.hoisted(() =>
  vi.fn((fn: (v: any) => void) => async (e?: any) => {
    e?.preventDefault?.()
    await fn(formValues)
  }),
)

vi.mock("@/components/ui/form", () => ({
  Form: ({ children, ...props }: any) => {
    // Pass through all props except 'control' and children to avoid nested forms.
    // The AuthModal wraps `<Form {...form}><form onSubmit={...}>` so we must NOT
    // wrap children in another <form> here (that would create nested forms and
    // the inner onSubmit would never fire).
    return <>{children}</>
  },
  FormField: ({ render, name }: any) => {
    const mockField = {
      value: formValues[name] ?? "",
      onChange: (v: any) => {
        formValues[name] = v?.target?.value ?? v
      },
      onBlur: () => {},
      name,
      ref: () => {},
    }
    return (
      <div data-field-name={name}>
        {typeof render === "function" ? render({ field: mockField }) : null}
      </div>
    )
  },
  FormItem: ({ children }: any) => <>{children}</>,
  FormLabel: ({ children }: any) => <label>{children}</label>,
  FormControl: ({ children }: any) => <>{children}</>,
  FormMessage: ({ children }: any) => (children ? <span>{children}</span> : null),
  FormDescription: ({ children }: any) => <p>{children}</p>,
}))

vi.mock("react-hook-form", () => ({
  useForm: (() => {
    const form = {
      control: {},
      handleSubmit: mockHandleSubmit,
      setValue: vi.fn((name, value) => {
        formValues[name] = value
      }),
      getValues: () => ({ ...formValues }),
      formState: { errors: {}, isSubmitting: false },
      register: vi.fn(),
      watch: vi.fn(),
    }
    return () => form
  })(),
  useController: () => ({ field: { value: "", onChange: vi.fn() }, fieldState: {} }),
  FormProvider: ({ children }: any) => <>{children}</>,
}))

// Other UI mocks
vi.mock("@/components/ui/input", () => ({ Input: (p: any) => <input {...p} /> }))
vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...p }: any) => <label {...p}>{children}</label>,
}))
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...p }: any) => <button {...p}>{children}</button>,
}))
vi.mock("@/components/ui/separator", () => ({ Separator: () => <hr /> }))

vi.mock("lucide-react", () => {
  const Icon = () => <span data-testid="icon" />
  Icon.displayName = "Icon"
  return {
    Mail: Icon,
    Lock: Icon,
    Eye: Icon,
    EyeOff: Icon,
    Loader2: Icon,
    UserRound: Icon,
    ShieldCheck: Icon,
    Check: Icon,
    ChevronDown: Icon,
    Copy: Icon,
    Wrench: Icon,
    BadgeCheck: Icon,
  }
})

vi.mock("@/lib/validators", () => ({
  loginSchema: { parse: vi.fn() },
  registerSchema: { parse: vi.fn() },
}))
vi.mock("@/lib/utils", () => ({ cn: (...c: any[]) => c.filter(Boolean).join(" ") }))
vi.mock("@hookform/resolvers/zod", () => ({ zodResolver: () => ({}) }))

beforeEach(() => {
  vi.clearAllMocks()
  Object.keys(formValues).forEach((k) => delete formValues[k])
  mockUIStore.authModal = { open: false, mode: "login", role: "CLIENT" }
  mockUIStore.openAuth.mockImplementation((mode?: string, role?: string) => {
    mockUIStore.authModal.open = true
    if (mode) mockUIStore.authModal.mode = mode as any
    if (role) mockUIStore.authModal.role = role as any
  })
  mockAuthStore.login.mockResolvedValue({ ok: true })
  mockAuthStore.register.mockResolvedValue({ ok: true })
})

describe("AuthModal — rendering", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <TestQueryProvider>
        <AuthModal />
      </TestQueryProvider>,
    )
    expect(container.querySelector('[data-testid="dialog"]')).not.toBeInTheDocument()
  })

  it("renders login form when open in login mode", () => {
    mockUIStore.authModal = { open: true, mode: "login", role: "CLIENT" }
    render(
      <TestQueryProvider>
        <AuthModal />
      </TestQueryProvider>,
    )
    // "Entrar" appears on tab trigger + submit button
    const elements = screen.getAllByText("Entrar")
    expect(elements.length).toBeGreaterThan(0)
  })

  it("renders register form when open in register mode", () => {
    mockUIStore.authModal = { open: true, mode: "register", role: "CLIENT" }
    render(
      <TestQueryProvider>
        <AuthModal />
      </TestQueryProvider>,
    )
    const elements = screen.getAllByText("Criar conta")
    expect(elements.length).toBeGreaterThan(0)
  })

  it("shows role toggle buttons in register mode", () => {
    mockUIStore.authModal = { open: true, mode: "register", role: "CLIENT" }
    render(
      <TestQueryProvider>
        <AuthModal />
      </TestQueryProvider>,
    )
    expect(screen.getAllByText("Cliente").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Prestador").length).toBeGreaterThan(0)
  })

  it("shows provider-specific fields when role is PROVIDER", () => {
    mockUIStore.authModal = { open: true, mode: "register", role: "PROVIDER" }
    render(
      <TestQueryProvider>
        <AuthModal />
      </TestQueryProvider>,
    )
    expect(screen.getByText("CPF / CNPJ")).toBeInTheDocument()
    expect(screen.getByText(/Como prestador/)).toBeInTheDocument()
  })

  it("renders demo credentials in login mode", () => {
    mockUIStore.authModal = { open: true, mode: "login", role: "CLIENT" }
    render(
      <TestQueryProvider>
        <AuthModal />
      </TestQueryProvider>,
    )
    // Demo credentials link — may appear once or in collapse/expand
    const elements = screen.getAllByText("Ver credenciais de demonstração")
    expect(elements.length).toBeGreaterThan(0)
  })
})

describe("AuthModal — form submission", () => {
  it("calls login() with email and password on login form submit", async () => {
    mockUIStore.authModal = { open: true, mode: "login", role: "CLIENT" }
    const { container } = render(
      <TestQueryProvider>
        <AuthModal />
      </TestQueryProvider>,
    )

    // Set form values via the shared registry
    formValues.email = "test@test.com"
    formValues.password = "test123"

    // Submit the form directly (fireEvent.click on submit button is unreliable in jsdom)
    const formEl = container.querySelector("form")
    expect(formEl).toBeTruthy()
    if (formEl) fireEvent.submit(formEl)

    // The form's handleSubmit should call the store's login
    expect(mockAuthStore.login).toHaveBeenCalled()
  })

  it("calls navigate on successful login", async () => {
    mockAuthStore.login.mockResolvedValue({ ok: true })
    mockUIStore.authModal = { open: true, mode: "login", role: "CLIENT" }
    const { container } = render(
      <TestQueryProvider>
        <AuthModal />
      </TestQueryProvider>,
    )

    formValues.email = "test@test.com"
    formValues.password = "test123"

    const formEl = container.querySelector("form")
    expect(formEl).toBeTruthy()
    if (formEl) fireEvent.submit(formEl)

    // Flush microtasks so the async onSubmit handler completes
    await new Promise((r) => setTimeout(r, 0))

    // login resolved with ok:true → should navigate and close
    expect(mockViewStore.navigate).toHaveBeenCalled()
  })

  it("shows error toast on failed login", async () => {
    mockAuthStore.login.mockResolvedValue({ ok: false, error: "Credenciais inválidas" })
    mockUIStore.authModal = { open: true, mode: "login", role: "CLIENT" }
    const { container } = render(
      <TestQueryProvider>
        <AuthModal />
      </TestQueryProvider>,
    )

    formValues.email = "test@test.com"
    formValues.password = "wrong"

    const formEl = container.querySelector("form")
    expect(formEl).toBeTruthy()
    if (formEl) fireEvent.submit(formEl)

    const { toast } = await import("sonner")
    expect(toast.error).toHaveBeenCalled()
  })

  it("calls register() on register form submit", async () => {
    mockUIStore.authModal = { open: true, mode: "register", role: "CLIENT" }
    const { container } = render(
      <TestQueryProvider>
        <AuthModal />
      </TestQueryProvider>,
    )

    formValues.name = "Test User"
    formValues.email = "new@test.com"
    formValues.password = "test123"
    formValues.confirmPassword = "test123"

    // TabsContent mock renders ALL tabs regardless of active tab.
    // Find the form inside the register tab specifically.
    const formEl = container.querySelector('[data-tab-content="register"] form')
    expect(formEl).toBeTruthy()
    if (formEl) fireEvent.submit(formEl)

    // Flush microtasks so the async onSubmit handler completes
    await new Promise((r) => setTimeout(r, 0))

    expect(mockAuthStore.register).toHaveBeenCalled()
  })
})
