/**
 * mocks.tsx
 *
 * Shared mock factories and helpers for admin component tests.
 * These are imported via async vi.mock() factories to avoid vitest's
 * hoisting restriction (vi.mock() runs before static imports resolve).
 *
 * Usage in a test file:
 *
 *   vi.mock("lucide-react", async () => {
 *     const { MockIcon } = await import("./mocks")
 *     return { Database: MockIcon, RefreshCw: MockIcon, … }
 *   })
 *
 *   vi.mock("@/components/ui/alert-dialog", async () => {
 *     const { createAlertDialogMock } = await import("./mocks")
 *     return createAlertDialogMock()
 *   })
 *
 *   vi.mock("sonner", async () => {
 *     const { toastMock } = await import("./mocks")
 *     return { toast: toastMock }
 *   })
 */

import React from "react"
import { vi } from "vitest"
import { screen, fireEvent } from "@testing-library/react"

// ===========================================================================
// lucide-react — icon placeholder component
// ===========================================================================

export const MockIcon: React.FC<{ className?: string; "data-testid"?: string }> = (p) => (
  <span data-testid={p?.["data-testid"] ?? "lucide-icon"} data-class={p?.className} />
)
MockIcon.displayName = "LucideIcon"

// ===========================================================================
// AlertDialog — div-based stub for jsdom compatibility
// Simulates onOpenChange when clicking the trigger so that the component's
// internal showReindexConfirm state is updated.
// ===========================================================================

export function createAlertDialogMock() {
  const AlertDialog = ({ open, children, onOpenChange }: any) => (
    <div data-testid="alert-dialog" data-open={String(open)}>
      {React.Children.map(children, (child: any) => {
        if (
          React.isValidElement(child) &&
          (child as any).type?.displayName === "AlertDialogTrigger"
        ) {
          return React.cloneElement(child as React.ReactElement<any>, { onOpenChange })
        }
        return child
      })}
      {open && <div data-testid="alert-dialog-open" />}
    </div>
  )

  const AlertDialogTrigger = Object.assign(
    function AlertDialogTriggerInner({ asChild, children, onOpenChange }: any) {
      if (asChild && React.isValidElement(children)) {
        return React.cloneElement(children as React.ReactElement<any>, {
          onClick: (...args: any[]) => {
            onOpenChange?.(true)
            const childOnClick = (children as React.ReactElement<any>).props.onClick
            if (childOnClick) childOnClick(...args)
          },
        })
      }
      return (
        <button type="button" onClick={() => onOpenChange?.(true)}>
          {children}
        </button>
      )
    },
    { displayName: "AlertDialogTrigger" },
  )

  const AlertDialogContent = ({ children }: any) => (
    <div data-testid="alert-dialog-content">{children}</div>
  )

  const AlertDialogHeader = ({ children }: any) => <div>{children}</div>

  const AlertDialogFooter = ({ children }: any) => (
    <div data-testid="alert-dialog-footer">{children}</div>
  )

  const AlertDialogTitle = ({ children }: any) => <div>{children}</div>

  const AlertDialogDescription = ({ children }: any) => <div>{children}</div>

  const AlertDialogAction = ({ disabled, onClick, children }: any) => (
    <button type="button" disabled={disabled} data-testid="alert-dialog-action" onClick={onClick}>
      {children}
    </button>
  )

  const AlertDialogCancel = ({ children }: any) => <button type="button">{children}</button>

  return {
    AlertDialog,
    AlertDialogTrigger,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogFooter,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogAction,
    AlertDialogCancel,
  }
}

// ===========================================================================
// sonner toast — silent mock
// ===========================================================================

/** Shared mock instance — imported via async vi.mock factory. */
export const toastMock = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}

// ===========================================================================
// Fetch mock helpers for REINDEX API
// ===========================================================================

/** Type for the per-test fetch response function. */
export type FetchResponseFn = () => Promise<Response>

/** Build a successful REINDEX API response. */
export function buildReindexSuccessResponse(): Response {
  return new Response(
    JSON.stringify({
      success: true,
      message: "3/3 índices reindexados com sucesso.",
      indexes: [
        { name: "idx_user_location_gist", durationMs: 1234, ok: true },
        { name: "idx_booking_location_gist", durationMs: 567, ok: true },
        { name: "idx_quoterequest_location_gist", durationMs: 321, ok: true },
      ],
      totalDurationMs: 2122,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  )
}

/** Build a failure REINDEX API response. */
export function buildReindexFailureResponse(message = "Erro interno"): Response {
  return new Response(
    JSON.stringify({
      success: false,
      message,
      indexes: [],
      totalDurationMs: 0,
    }),
    { status: 500, headers: { "Content-Type": "application/json" } },
  )
}

/** Build a slow REINDEX API response (useful for testing loading states). */
export function buildReindexSlowResponse(delayMs = 100): Promise<Response> {
  return new Promise((resolve) =>
    setTimeout(
      () =>
        resolve(
          new Response(
            JSON.stringify({
              success: true,
              message: "reindexado com sucesso",
              indexes: [],
              totalDurationMs: 0,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        ),
      delayMs,
    ),
  )
}

// ===========================================================================
// recharts — pass-through mock for JSDOM + React 19
// ===========================================================================

/**
 * Recharts is not SVG-capable under JSDOM (React 19 + recharts 2.x hooks crash
 * with "Cannot read properties of null (reading 'useRef')"). This mock returns
 * pass-through placeholders — chart titles/data render outside the SVG.
 *
 * Usage in a test file (async-import pattern):
 *
 *   vi.mock("recharts", async () => {
 *     const { createRechartsMock } = await import("./mocks")
 *     return createRechartsMock()
 *   })
 */
export function createRechartsMock() {
  const PassThrough = ({ children }: any) => <div>{children}</div>
  const Leaf = () => null
  return {
    ResponsiveContainer: PassThrough,
    AreaChart: PassThrough,
    BarChart: PassThrough,
    LineChart: PassThrough,
    PieChart: PassThrough,
    Area: Leaf,
    Bar: Leaf,
    Line: Leaf,
    Pie: Leaf,
    Cell: Leaf,
    CartesianGrid: Leaf,
    XAxis: Leaf,
    YAxis: Leaf,
    Tooltip: Leaf,
  }
}

// ===========================================================================
// GistDegradationPanel — shared default props for tests
// ===========================================================================

/**
 * Default props for rendering GistDegradationPanel in a test.
 * Uses realistic values (P95=90ms, radius=15km, model max=35.2ms, 4/5 scales
 * exceed the model).  Individual tests can override specific fields via spread:
 *
 *   render(<GistDegradationPanel {...DEFAULT_PROPS} gistDegraded={false} />)
 */
export const DEFAULT_GIST_DEGRADATION_PROPS = {
  gistDegraded: true,
  p95Mean: 90,
  radiusKm: 15,
  snapPct: 9,
  maxModelAtSelectivity: 35.2,
  exceedingCount: 4,
}

// ===========================================================================
// GistReindexButton — shared default props for tests
// ===========================================================================

/**
 * Default props for rendering GistReindexButton in a test.
 * Both props are optional in the component, so the default is empty.
 * Exporting this constant lets tests override specific fields via spread:
 *
 *   render(<GistReindexButton {...DEFAULT_GIST_REINDEX_PROPS} isRefetching={true} />)
 */
export const DEFAULT_GIST_REINDEX_PROPS: Record<string, never> = {}

// ===========================================================================
// Helper: click through the full REINDEX flow
// ===========================================================================

/**
 * Simulates clicking "Executar REINDEX" → confirmation button.
 * Waits for the result indicator (sucesso/Falha/Erro) before returning.
 */
export async function clickExecuteReindex() {
  fireEvent.click(screen.getByText("Executar REINDEX"))
  fireEvent.click(screen.getByTestId("alert-dialog-action"))
  await screen.findByText(/sucesso|Falha|Erro/, undefined, { timeout: 2000 })
}
