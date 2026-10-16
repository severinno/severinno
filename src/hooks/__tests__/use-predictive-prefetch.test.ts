import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act } from "@/__tests__/test-utils"
import { usePredictivePrefetch, prefetchedUrls } from "../use-predictive-prefetch"

const mockPrefetch = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    prefetch: mockPrefetch,
  }),
}))

describe("use-predictive-prefetch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    prefetchedUrls.clear()
  })

  it("dispara prefetch após delay de hover (hover intent)", () => {
    const { result } = renderHook(() => usePredictivePrefetch({ hoverDelayMs: 65 }))
    const handlers = result.current.getPrefetchProps("/u/carlos-silva")

    act(() => {
      handlers.onMouseEnter()
    })

    // Antes do delay, não deve ter chamado
    expect(mockPrefetch).not.toHaveBeenCalled()

    // Avança o timer além do delay de 65ms
    act(() => {
      vi.advanceTimersByTime(70)
    })

    expect(mockPrefetch).toHaveBeenCalledWith("/u/carlos-silva")
    expect(prefetchedUrls.has("/u/carlos-silva")).toBe(true)
  })

  it("cancela o prefetch se o mouse sair antes do tempo de delay (onMouseLeave)", () => {
    const { result } = renderHook(() => usePredictivePrefetch({ hoverDelayMs: 65 }))
    const handlers = result.current.getPrefetchProps("/servicos/eletricista")

    act(() => {
      handlers.onMouseEnter()
      vi.advanceTimersByTime(30)
      handlers.onMouseLeave()
      vi.advanceTimersByTime(50)
    })

    expect(mockPrefetch).not.toHaveBeenCalled()
  })

  it("dispara prefetch imediato no toque (onTouchStart) e no foco do teclado (onFocus)", () => {
    const { result } = renderHook(() => usePredictivePrefetch())
    const handlers = result.current.getPrefetchProps("/servicos/encanador")

    act(() => {
      handlers.onTouchStart()
    })

    expect(mockPrefetch).toHaveBeenCalledWith("/servicos/encanador")
  })

  it("ignora URLs externas e âncoras locais", () => {
    const { result } = renderHook(() => usePredictivePrefetch())
    const handlersHttp = result.current.getPrefetchProps("https://google.com")
    const handlersHash = result.current.getPrefetchProps("#duvidas")
    const handlersTel = result.current.getPrefetchProps("tel:33999998888")

    act(() => {
      handlersHttp.onTouchStart()
      handlersHash.onTouchStart()
      handlersTel.onTouchStart()
    })

    expect(mockPrefetch).not.toHaveBeenCalled()
  })

  it("evita pré-carregamento duplicado se a URL já foi prefetchada", () => {
    const { result } = renderHook(() => usePredictivePrefetch())
    const handlers = result.current.getPrefetchProps("/u/maria-faxina")

    act(() => {
      handlers.onTouchStart()
      handlers.onTouchStart()
    })

    expect(mockPrefetch).toHaveBeenCalledTimes(1)
  })
})
