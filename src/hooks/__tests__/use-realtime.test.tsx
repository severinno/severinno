/**
 * use-realtime.test.tsx
 *
 * Unit tests for the session:limit handling in src/hooks/use-realtime.ts.
 *
 * O realtime emite `session:limit` quando um socket ANTIGO do mesmo usuário
 * é derrubado por exceder o limite de sessões simultâneas POR ROLE (um
 * socket mais novo assumiu). O payload carrega o limite aplicado (`max`,
 * ex.: PROVIDER=2). O hook captura esse payload e expõe `lastSessionLimit`
 * para a UI exibir "limite N" — o mesmo valor que o painel admin mostra no
 * tooltip do kick. Coberto:
 *   - session:limit com max → lastSessionLimit preenchido + socket resetado
 *   - session:limit sem max / max inválido → max 0 (degradação graciosa)
 *   - lastSessionLimit inicial null (nenhum kick ainda)
 *   - singleton é resetado após o kick (novo mount cria socket NOVO)
 *
 * Padrão: renderHook do test-utils do repo (captura result.current via ref —
 * sem reatribuir variável de fora do componente no corpo do render, que o
 * eslint react-hooks/globals bloqueia).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, cleanup, type CustomRenderHookResult } from "@/__tests__/test-utils"

// ---------------------------------------------------------------------------
// Fake socket.io — vi.hoisted para o vi.mock conseguir referenciar
// ---------------------------------------------------------------------------

type FakeHandler = (data?: unknown) => void

function createFakeSocket() {
  const handlers = new Map<string, FakeHandler[]>()
  const socket = {
    connected: false,
    active: true,
    on: vi.fn((evt: string, fn: FakeHandler) => {
      const list = handlers.get(evt) ?? []
      list.push(fn)
      handlers.set(evt, list)
    }),
    off: vi.fn((evt: string, fn?: FakeHandler) => {
      if (!fn) handlers.delete(evt)
      else
        handlers.set(
          evt,
          (handlers.get(evt) ?? []).filter((h) => h !== fn),
        )
    }),
    emit: vi.fn(),
    disconnect: vi.fn(() => {
      socket.connected = false
      socket.active = false
    }),
    // Test helper: dispara um evento registrado (os handlers do hook).
    fire: (evt: string, data?: unknown) => {
      for (const fn of handlers.get(evt) ?? []) fn(data)
    },
  }
  return socket
}

const { mockIo, fakeSockets } = vi.hoisted(() => {
  const fakeSockets: ReturnType<typeof createFakeSocket>[] = []
  const mockIo = vi.fn(() => {
    const s = createFakeSocket()
    fakeSockets.push(s)
    return s
  })
  return { mockIo, fakeSockets }
})

vi.mock("socket.io-client", () => ({
  io: mockIo,
}))

import { useRealtime, type UseRealtimeResult } from "../use-realtime"

// ---------------------------------------------------------------------------
// Harness — renderHook do test-utils (result.current expõe o retorno do hook)
// ---------------------------------------------------------------------------

type RenderHookResult = CustomRenderHookResult<UseRealtimeResult>

let lastHook: RenderHookResult | null = null

beforeEach(() => {
  fakeSockets.length = 0
})

afterEach(() => {
  // Reseta o singleton do módulo (socketRef) — sem isso, o próximo teste
  // reutilizaria o socket fake anterior.
  lastHook?.result.current.disconnect()
  lastHook = null
  cleanup()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useRealtime — session:limit (payload max)", () => {
  it("expõe lastSessionLimit com o max do payload quando o socket é derrubado", () => {
    lastHook = renderHook(() => useRealtime())
    const socket = fakeSockets[0]!
    expect(socket).toBeDefined()

    act(() => {
      socket.fire("session:limit", { userId: "u1", reason: "session_limit", max: 2 })
    })

    expect(lastHook!.result.current.lastSessionLimit).not.toBeNull()
    expect(lastHook!.result.current.lastSessionLimit!.max).toBe(2)
    expect(lastHook!.result.current.lastSessionLimit!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // O kick reseta o socket (não reconecta em loop).
    expect(socket.disconnect).toHaveBeenCalled()
    expect(lastHook!.result.current.status).toBe("disconnected")
  })

  it("degradação graciosa: session:limit SEM max → lastSessionLimit.max = 0", () => {
    lastHook = renderHook(() => useRealtime())
    const socket = fakeSockets[0]!

    act(() => {
      socket.fire("session:limit", { userId: "u1", reason: "session_limit" })
    })

    expect(lastHook!.result.current.lastSessionLimit).not.toBeNull()
    expect(lastHook!.result.current.lastSessionLimit!.max).toBe(0)
    expect(socket.disconnect).toHaveBeenCalled()
  })

  it("degradação graciosa: max inválido (string/NaN/0/negativo) → 0", () => {
    lastHook = renderHook(() => useRealtime())
    const socket = fakeSockets[0]!

    act(() => {
      socket.fire("session:limit", { max: "2" as unknown as number })
    })
    expect(lastHook!.result.current.lastSessionLimit!.max).toBe(0)

    act(() => {
      socket.fire("session:limit", { max: NaN })
    })
    expect(lastHook!.result.current.lastSessionLimit!.max).toBe(0)

    act(() => {
      socket.fire("session:limit", { max: 0 })
    })
    expect(lastHook!.result.current.lastSessionLimit!.max).toBe(0)

    act(() => {
      socket.fire("session:limit", { max: -3 })
    })
    expect(lastHook!.result.current.lastSessionLimit!.max).toBe(0)
  })

  it("lastSessionLimit inicia null (nenhum kick ainda)", () => {
    lastHook = renderHook(() => useRealtime())
    expect(lastHook!.result.current.lastSessionLimit).toBeNull()
  })

  it("singleton é resetado após o kick — o próximo mount cria socket NOVO", () => {
    const firstResult = renderHook(() => useRealtime())
    const first = fakeSockets[0]!
    act(() => {
      first.fire("session:limit", { max: 2 })
    })
    // socketRef = null após o kick. O renderHook do test-utils desmonta o
    // root anterior automaticamente ao ser chamado de novo — um mount NOVO
    // de verdade (não um update do mesmo root), então o useEffect deps []
    // roda de novo e getSocket() cria um socket NOVO.
    lastHook = renderHook(() => useRealtime())
    expect(fakeSockets).toHaveLength(2)
    expect(fakeSockets[1]).not.toBe(first)
    // O hook do novo mount segue funcional.
    expect(lastHook!.result.current.lastSessionLimit).toBeNull()
    expect(firstResult.result.current.lastSessionLimit!.max).toBe(2)
  })
})
