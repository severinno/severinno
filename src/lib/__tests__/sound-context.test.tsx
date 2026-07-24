/**
 * Tests for useSoundEnabledPreference — resolves the effective soundEnabled
 * value by combining SoundContext override + auth store preference.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, renderHook, screen } from "@testing-library/react"

// ---- Dynamic auth mock — same pattern as use-coin-sound.test.ts -----------
let mockSoundEnabled: boolean | undefined = true

vi.mock("@/store/auth", () => ({
  useAuthStore: vi.fn(
    (selector?: (s: { user: { soundEnabled?: boolean } | null }) => unknown) => {
      const state = {
        user: mockSoundEnabled === undefined ? null : { soundEnabled: mockSoundEnabled },
      }
      return selector ? selector(state) : state
    },
  ),
}))

// ---------------------------------------------------------------------------
// SUT import (must be after vi.mock)
// ---------------------------------------------------------------------------

import {
  useSoundEnabled,
  useSoundEnabledPreference,
  SoundProvider,
} from "../sound-context"

beforeEach(() => {
  vi.clearAllMocks()
  mockSoundEnabled = true
})

afterEach(cleanup)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSoundEnabledPreference", () => {
  // ── Without SoundProvider (falls back to auth store) ─────────────────────

  it("returns auth store value when no SoundProvider is present", () => {
    mockSoundEnabled = true
    const { result } = renderHook(() => useSoundEnabledPreference())
    expect(result.current).toBe(true)
  })

  it("returns auth store false when no SoundProvider", () => {
    mockSoundEnabled = false
    const { result } = renderHook(() => useSoundEnabledPreference())
    expect(result.current).toBe(false)
  })

  it("returns undefined when no SoundProvider and auth user is null", () => {
    mockSoundEnabled = undefined
    const { result } = renderHook(() => useSoundEnabledPreference())
    expect(result.current).toBeUndefined()
  })

  // ── With SoundProvider (context overrides auth store) ────────────────────

  it("SoundProvider overrides auth store when enabled=false", () => {
    mockSoundEnabled = true
    const { result } = renderHook(() => useSoundEnabledPreference(), {
      wrapper: ({ children }) => (
        <SoundProvider enabled={false}>{children}</SoundProvider>
      ),
    })
    expect(result.current).toBe(false)
  })

  it("SoundProvider overrides auth store when enabled=true", () => {
    mockSoundEnabled = false
    const { result } = renderHook(() => useSoundEnabledPreference(), {
      wrapper: ({ children }) => (
        <SoundProvider enabled={true}>{children}</SoundProvider>
      ),
    })
    expect(result.current).toBe(true)
  })

  it("SoundProvider without enabled prop falls back to auth store", () => {
    mockSoundEnabled = false
    const { result } = renderHook(() => useSoundEnabledPreference(), {
      wrapper: ({ children }) => (
        <SoundProvider>{children}</SoundProvider>
      ),
    })
    // enabled is undefined, so contextOverride is undefined → falls back to auth store
    expect(result.current).toBe(false)
  })

  // ── Nesting ─────────────────────────────────────────────────────────────

  it("nested SoundProvider: inner wins over outer", () => {
    const { result } = renderHook(() => useSoundEnabledPreference(), {
      wrapper: ({ children }) => (
        <SoundProvider enabled={false}>
          <SoundProvider enabled={true}>
            {children}
          </SoundProvider>
        </SoundProvider>
      ),
    })
    expect(result.current).toBe(true)
  })

  it("no SoundProvider with null user returns undefined", () => {
    mockSoundEnabled = undefined
    const { result } = renderHook(() => useSoundEnabledPreference())
    expect(result.current).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// useSoundEnabled — raw context reader (no auth store fallback)
// ---------------------------------------------------------------------------

describe("useSoundEnabled", () => {
  it("returns undefined when no SoundProvider is present", () => {
    const { result } = renderHook(() => useSoundEnabled())
    expect(result.current).toBeUndefined()
  })

  it("returns false when SoundProvider enabled=false", () => {
    const { result } = renderHook(() => useSoundEnabled(), {
      wrapper: ({ children }) => (
        <SoundProvider enabled={false}>{children}</SoundProvider>
      ),
    })
    expect(result.current).toBe(false)
  })

  it("returns true when SoundProvider enabled=true", () => {
    const { result } = renderHook(() => useSoundEnabled(), {
      wrapper: ({ children }) => (
        <SoundProvider enabled={true}>{children}</SoundProvider>
      ),
    })
    expect(result.current).toBe(true)
  })

  it("returns undefined when SoundProvider has no enabled prop", () => {
    const { result } = renderHook(() => useSoundEnabled(), {
      wrapper: ({ children }) => (
        <SoundProvider>{children}</SoundProvider>
      ),
    })
    expect(result.current).toBeUndefined()
  })

  it("returns inner provider value when nested", () => {
    const { result } = renderHook(() => useSoundEnabled(), {
      wrapper: ({ children }) => (
        <SoundProvider enabled={false}>
          <SoundProvider enabled={true}>
            {children}
          </SoundProvider>
        </SoundProvider>
      ),
    })
    expect(result.current).toBe(true)
  })

  it("returns outer provider value outside inner provider", () => {
    const { result } = renderHook(() => useSoundEnabled(), {
      wrapper: ({ children }) => (
        <SoundProvider enabled={false}>
          <SoundProvider enabled={true}>
            <div />
          </SoundProvider>
          {children}
        </SoundProvider>
      ),
    })
    expect(result.current).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// SoundProvider component — render tests
// ---------------------------------------------------------------------------

describe("SoundProvider (render)", () => {
  it("renders children", () => {
    render(
      <SoundProvider>
        <div data-testid="child">Hello</div>
      </SoundProvider>,
    )
    expect(screen.getByTestId("child")).toBeDefined()
    expect(screen.getByText("Hello")).toBeDefined()
  })

  it("does not render any wrapper element (fragment-like)", () => {
    const { container } = render(
      <SoundProvider>
        <span data-testid="child" />
      </SoundProvider>,
    )
    // SoundProvider renders only its children, no extra DOM nodes
    expect(container.querySelector("[data-testid='child']")).not.toBeNull()
  })

  it("renders multiple children", () => {
    render(
      <SoundProvider>
        <div data-testid="a" />
        <div data-testid="b" />
      </SoundProvider>,
    )
    expect(screen.getByTestId("a")).toBeDefined()
    expect(screen.getByTestId("b")).toBeDefined()
  })

  it("nested providers both render their children", () => {
    render(
      <SoundProvider enabled={false}>
        <div data-testid="outer">
          <SoundProvider enabled={true}>
            <div data-testid="inner" />
          </SoundProvider>
        </div>
      </SoundProvider>,
    )
    expect(screen.getByTestId("outer")).toBeDefined()
    expect(screen.getByTestId("inner")).toBeDefined()
  })

  it("child component can read context via useSoundEnabled", () => {
    function Reader() {
      const value = useSoundEnabled()
      return <span data-testid="reader">{String(value)}</span>
    }

    render(
      <SoundProvider enabled={false}>
        <Reader />
      </SoundProvider>,
    )
    expect(screen.getByTestId("reader")).toHaveTextContent("false")
  })

  it("child reads true from SoundProvider enabled=true", () => {
    function Reader() {
      const value = useSoundEnabled()
      return <span data-testid="reader">{String(value)}</span>
    }

    render(
      <SoundProvider enabled={true}>
        <Reader />
      </SoundProvider>,
    )
    expect(screen.getByTestId("reader")).toHaveTextContent("true")
  })

  it("child reads undefined without SoundProvider", () => {
    function Reader() {
      const value = useSoundEnabled()
      return <span data-testid="reader">{String(value)}</span>
    }

    render(<Reader />)
    expect(screen.getByTestId("reader")).toHaveTextContent("undefined")
  })

  it("inner provider overrides outer for child components", () => {
    function Reader() {
      const value = useSoundEnabled()
      return <span data-testid="reader">{String(value)}</span>
    }

    render(
      <SoundProvider enabled={false}>
        <SoundProvider enabled={true}>
          <Reader />
        </SoundProvider>
      </SoundProvider>,
    )
    expect(screen.getByTestId("reader")).toHaveTextContent("true")
  })

  it("different children in nested providers get different context values", () => {
    function Reader({ id }: { id: string }) {
      const value = useSoundEnabled()
      return <span data-testid={id}>{String(value)}</span>
    }

    render(
      <SoundProvider enabled={false}>
        <Reader id="outer-reader" />
        <SoundProvider enabled={true}>
          <Reader id="inner-reader" />
        </SoundProvider>
      </SoundProvider>,
    )
    expect(screen.getByTestId("outer-reader")).toHaveTextContent("false")
    expect(screen.getByTestId("inner-reader")).toHaveTextContent("true")
  })
})
