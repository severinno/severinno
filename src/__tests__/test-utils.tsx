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

import { type ReactElement } from "react"
import { act } from "react"
import { flushSync } from "react-dom"
import { createRoot, type Root } from "react-dom/client"

// ── act-wrapped fireEvent ───────────────────────────────────────────────
// RTL's fireEvent uses RTL's own React instance for internal act(), which
// doesn't flush state updates in our custom render.  We wrap every fireEvent
// method with the project's act() to ensure state updates flush correctly.

import {
  fireEvent as rtlFireEvent,
  type FireFunction,
  type FireObject,
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

// Export the project's act (not RTL's — they have different React instances).
// RTL re-exports are for assertion utilities only: screen, waitFor, within.
export { act } from "react"

// Re-export RTL assertion utilities (unmodified)
export {
  screen,
  waitFor,
  waitForElementToBeRemoved,
  within,
  renderHook,
  type RenderOptions,
  type RenderResult,
} from "@testing-library/react"

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

  // act() wraps createRoot + flushSync so React 19 recognizes the test
  // environment and suppresses "An update to Root" warnings.
  act(() => {
    if (!root) {
      root = createRoot(container!)
    }
    flushSync(() => {
      root!.render(ui)
    })
  })

  return {
    container,
    baseElement: document.body,
    rerender: (newUi: ReactElement) => {
      flushSync(() => {
        root!.render(newUi)
      })
    },
    unmount: () => {
      flushSync(() => {
        root!.unmount()
      })
      root = null
      container = null
    },
    asFragment: () => {
      // Clone container children into a fragment for snapshot testing,
      // matching RTL's asFragment() behavior.
      const frag = document.createDocumentFragment()
      if (container) {
        frag.append(...Array.from(container.childNodes))
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
  if (root) {
    try {
      flushSync(() => {
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
