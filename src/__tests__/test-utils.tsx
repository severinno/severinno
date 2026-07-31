// ═══════════════════════════════════════════════════════════════════════════
//  Custom Render — React 19 + jsdom + vitest compatibility layer
// ═══════════════════════════════════════════════════════════════════════════
//
//  PROBLEM
//  ───────
//  @testing-library/react@16 bundles its own React instance, confirmed by:
//    React.act === RTL.act → false (different functions in memory)
//
//  When RTL's render() calls act() and createRoot() internally, it uses its
//  own React, not the project's. The hooks dispatcher never synchronizes,
//  causing "Invalid hook call" in jsdom tests.
//
//  SOLUTION
//  ────────
//  Use the PROJECT's react-dom createRoot + flushSync directly, bypassing
//  RTL's internal render entirely. Re-export RTL utilities (screen,
//  fireEvent, waitFor) for assertions.
//
//  USAGE (in test files)
//  ─────
//    // Replace this:
//    //   import { render, screen, fireEvent } from "@testing-library/react"
//    //
//    // With this:
//    import { render, screen, fireEvent, cleanup } from "@/__tests__/test-utils"
//    import { waitFor, within } from "@/__tests__/test-utils"
//
//  Common exports:
//    render      — renderiza componente com createRoot + flushSync (projeto)
//    screen      — queries de asserção (getByText, getByTestId, ...)
//    fireEvent   — eventos embrulhados em act() do projeto
//    waitFor     — espera assíncrona por mudanças no DOM
//    within      — escopo de queries a um elemento específico
//    cleanup     — desmonta root e limpa o DOM (chamar em afterEach)
//    act         — act() do projeto (para interações personalizadas)
//
//  IMPORTANT
//  ─────────
//  Always call cleanup() in afterEach to reset the DOM between tests:
//    import { afterEach } from "vitest"
//    import { cleanup } from "@/__tests__/test-utils"
//    afterEach(() => { cleanup() })
//
// ═══════════════════════════════════════════════════════════════════════════

import { type ReactElement, type ComponentType, createElement } from "react"
import { act } from "react"
import { flushSync } from "react-dom"
import { createRoot, type Root } from "react-dom/client"

// ── act-wrapped fireEvent ───────────────────────────────────────────────
// RTL's fireEvent uses RTL's own React instance for internal act(), which
// doesn't flush state updates in our custom render.  We wrap every fireEvent
// method with the project's act() to ensure state updates flush correctly.

import {
  fireEvent as rtlFireEvent,
  screen,
  waitForElementToBeRemoved,
  within,
  type FireFunction,
  type FireObject,
  type RenderOptions,
  type RenderResult,
} from "@testing-library/react"

function createActWrappedFireEvent(): FireFunction & FireObject {
  const wrapped = ((element: Element | Node | Document | Window, event: Event) => {
    let result = false
    act(() => {
      result = rtlFireEvent(element, event)
    })
    return result
  }) as FireFunction & FireObject

  // Copy all named fireEvent methods (click, change, submit, keyDown, etc.)
  for (const key of Object.keys(rtlFireEvent) as Array<keyof typeof rtlFireEvent>) {
    const originalFn = rtlFireEvent[key]
    if (typeof originalFn === "function") {
      ;(wrapped as unknown as Record<string, unknown>)[key] = (...args: unknown[]) => {
        let result: unknown
        act(() => {
          result = (originalFn as (...a: unknown[]) => unknown)(...args)
        })
        return result
      }
    }
  }

  return wrapped
}

export const fireEvent = createActWrappedFireEvent()

// ── act-aware waitFor / findByText ─────────────────────────────────────
// RTL's own waitFor/findByText wrap their ENTIRE polling loop in a single
// act() call.  With React 19, act() only flushes state updates when the act
// callback EXITS — so a post-fetch setState resolving inside a long-running
// polling loop is never flushed until the loop's own timeout, deadlocking
// (the DOM stays mid-update forever, e.g. stuck on "Reindexando…").
//
// These replacements poll with SHORT act() calls per iteration: each check
// flushes the microtask queue (fetch→json→setState) inside act and returns,
// so updates land inside act (no "An update to Root was not wrapped in
// act(...)" warnings) AND the next check sees a fresh DOM.

export async function waitFor<T>(
  callback: () => T,
  options?: { timeout?: number; interval?: number },
): Promise<T> {
  const timeout = options?.timeout ?? 1000
  const interval = options?.interval ?? 50
  const start = Date.now()
  let lastError: unknown

  for (;;) {
    try {
      return await act(async () => {
        // Yield to the microtask queue so pending fetch→setState chains run
        // inside this act's scope.
        await Promise.resolve()
        return callback()
      })
    } catch (err) {
      lastError = err
      if (Date.now() - start > timeout) {
        throw lastError
      }
      // Sleep inside act so timer-driven responses (slow fetch mocks) also
      // resolve inside act, never outside it.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, interval))
      })
    }
  }
}

/** act-aware findByText — same signature as RTL's screen.findByText. */
export async function findByText(
  text: Parameters<typeof screen.getByText>[0],
  options?: Parameters<typeof screen.getByText>[1],
  waitForOptions?: { timeout?: number; interval?: number },
): Promise<HTMLElement> {
  return waitFor(() => screen.getByText(text, options), waitForOptions)
}

// Export the project's act (not RTL's — they have different React instances).
// RTL re-exports are for assertion utilities only: screen, within.
export { act } from "react"

// Re-export RTL assertion utilities (unmodified) — waitFor is replaced by the
// act-aware version above, so it is intentionally NOT re-exported here.
export { screen, waitForElementToBeRemoved, within }
export type { RenderOptions, RenderResult }

// ---------------------------------------------------------------------------
// Custom renderHook — uses project's React instance (not RTL's)
// ---------------------------------------------------------------------------
// RTL's renderHook uses its own React instance, which causes "Invalid hook
// call" when the hook's React dispatcher doesn't match.  We render a minimal
// test component using the project's own createRoot + flushSync, capturing
// the hook's return value via a mutable ref.
//
// Supports:
//   - wrapper component (for Context providers)
//   - initialProps (re-renders with new props)
//   - rerender (updates props and re-executes the hook)
//   - unmount (cleans up the root container)

export interface CustomRenderHookResult<Result> {
  result: { current: Result }
  rerender: (props?: Record<string, unknown>) => void
  unmount: () => void
}

/** Container + root shared with render() — cleanup() handles disposal. */
let hookContainer: HTMLDivElement | null = null
let hookRoot: Root | null = null

export function renderHook<Result, Props extends Record<string, unknown> = Record<string, unknown>>(
  hook: (props: Props) => Result,
  options?: {
    initialProps?: Props
    wrapper?: ComponentType<{ children: React.ReactNode }>
  },
): CustomRenderHookResult<Result> {
  const resultRef: { current: Result } = { current: undefined as unknown as Result }

  // Cleanup previous render if present (e.g. if renderHook is called twice
  // without an intermediate cleanup() call)
  if (hookRoot) {
    try {
      flushSync(() => {
        hookRoot!.unmount()
      })
    } catch {
      // Expected if root was already unmounted
    }
  }
  if (hookContainer && hookContainer.parentNode) {
    hookContainer.parentNode.removeChild(hookContainer)
  }

  hookContainer = document.createElement("div")
  document.body.appendChild(hookContainer)
  hookRoot = createRoot(hookContainer)

  const TestComponent: React.FC<Record<string, unknown>> = (props) => {
    resultRef.current = hook(props as Props)
    return null
  }

  const renderUI = (ui: React.ReactNode) => {
    // Same as render(): act() flushes synchronously in the test env — no
    // flushSync inside act (avoids "An update to Root was not wrapped in
    // act(...)" warnings).
    act(() => {
      hookRoot!.render(ui)
    })
  }

  // Wrap with wrapper if provided
  const Wrapper = options?.wrapper
  if (Wrapper) {
    renderUI(
      createElement(
        Wrapper,
        null,
        createElement(TestComponent, (options?.initialProps ?? {}) as Props),
      ),
    )
  } else {
    renderUI(createElement(TestComponent, (options?.initialProps ?? {}) as Props))
  }

  return {
    result: resultRef,
    rerender: (newProps?: Record<string, unknown>) => {
      const merged = { ...(options?.initialProps ?? {}), ...newProps } as Props
      if (Wrapper) {
        renderUI(createElement(Wrapper, null, createElement(TestComponent, merged)))
      } else {
        renderUI(createElement(TestComponent, merged))
      }
    },
    unmount: () => {
      if (hookRoot) {
        try {
          act(() => {
            hookRoot!.unmount()
          })
        } catch {
          // Expected if root was already unmounted
        }
        hookRoot = null
      }
      if (hookContainer && hookContainer.parentNode) {
        hookContainer.parentNode.removeChild(hookContainer)
      }
      hookContainer = null
    },
  }
}

// ---------------------------------------------------------------------------
// Internal state — singleton container reused across renders in the same
// test file.  Always call cleanup() in afterEach!
// ---------------------------------------------------------------------------

let container: HTMLDivElement | null = null
let root: Root | null = null

export interface CustomRenderResult {
  container: HTMLDivElement
  baseElement: HTMLElement
  rerender: (ui: ReactElement) => void
  unmount: () => void
  asFragment: () => DocumentFragment
  debug: () => void
}

/**
 * Render a React element using the project's own createRoot + flushSync.
 *
 * ✅ createRoot + flushSync from project → Works
 * ❌ RTL internal render                   → "Invalid hook call"
 *
 * Always pair with `cleanup()` in `afterEach`.
 */
export function render(ui: ReactElement): CustomRenderResult {
  if (!container) {
    container = document.createElement("div")
    document.body.appendChild(container)
  }

  // act() wraps createRoot + render.  React 19's act() flushes synchronously
  // in test environments (IS_REACT_ACT_ENVIRONMENT=true), so no flushSync is
  // needed here — in fact, calling flushSync INSIDE act() triggers the
  // "An update to Root inside a test was not wrapped in act(...)" warning
  // because flushSync bypasses act's update queue.
  act(() => {
    if (!root) {
      root = createRoot(container!)
    }
    root!.render(ui)
  })

  return {
    container,
    baseElement: document.body,
    rerender: (newUi: ReactElement) => {
      act(() => {
        root!.render(newUi)
      })
    },
    unmount: () => {
      act(() => {
        root!.unmount()
      })
      root = null
      container = null
    },
    asFragment: () => {
      // Clone container children into a fragment for snapshot testing,
      // matching RTL's asFragment() behavior.
      //
      // IMPORTANT: we CLONE the nodes (child.cloneNode(true)) instead of
      // MOVING them (frag.append(node) detaches the node from the container).
      // Moving breaks cleanup(): root.unmount() later tries to remove the
      // nodes from the container, which throws NotFoundError — "The node to
      // be removed is not a child of this node".
      const frag = document.createDocumentFragment()
      if (container) {
        for (const child of Array.from(container.childNodes)) {
          frag.appendChild(child.cloneNode(true))
        }
      }
      return frag
    },
    debug: () => {
      // eslint-disable-next-line no-console
      console.log(container?.innerHTML ?? "(empty)")
    },
  }
}

/**
 * Cleanup: unmount the root and remove the container from the DOM.
 *
 * MUST be called in `afterEach` to prevent cross-test contamination:
 *
 *   import { afterEach } from "vitest"
 *   import { cleanup } from "@/__tests__/test-utils"
 *   afterEach(() => { cleanup() })
 */
export function cleanup(): void {
  // Cleanup hook-specific root (renderHook uses its own container + root)
  if (hookRoot) {
    try {
      act(() => {
        hookRoot!.unmount()
      })
    } catch {
      // Expected if root was already unmounted
    }
    hookRoot = null
  }
  if (hookContainer && hookContainer.parentNode) {
    hookContainer.parentNode.removeChild(hookContainer)
  }
  hookContainer = null

  // Cleanup render root (render() uses its own container + root)
  if (root) {
    try {
      act(() => {
        root!.unmount()
      })
    } catch {
      // Expected if root was already unmounted
    }
    root = null
  }
  if (container && container.parentNode) {
    container.parentNode.removeChild(container)
  }
  container = null
}
