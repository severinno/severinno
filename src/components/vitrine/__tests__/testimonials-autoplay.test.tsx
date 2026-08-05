/**
 * testimonials-autoplay.test.tsx
 *
 * Testes de REGRESSÃO do crash do autoplay do Testimonials:
 *
 *   Cannot read properties of undefined (reading 'internalEngine')
 *     at Testimonials.useCallback[handleMouseLeave] (src/components/vitrine/testimonials.tsx)
 *
 * CAUSA RAIZ: o plugin do Embla Autoplay (embla-carousel-autoplay 8.x) só
 * inicializa `emblaApi`/`internalEngine` no `init()`, que o <Carousel>
 * dispara ao montar. Os handlers onMouseEnter/onMouseLeave do Testimonials
 * ficam no WRAPPER que SEMPRE renderiza (loading skeleton, erro, empty —
 * estados sem <Carousel>). Hover+leave durante o loading chamava
 * `autoplayPlugin.play()` num plugin NUNCA inicializado → crash.
 *
 * FIX: guard `if (!api) return` nos dois handlers — `api` (via setApi) só é
 * setado quando o carousel monta, o MESMO momento em que o plugin inicializa.
 * O mock abaixo REPRODUZ o comportamento real do plugin (play() lança o mesmo
 * erro quando chamado antes de init()) — se o guard for removido, o teste de
 * loading FALHA com o erro exato do bug.
 *
 * Cobre:
 *   1. loading (sem carousel) + hover/leave → play/stop NUNCA chamados, sem
 *      crash (o cenário exato do bug reportado);
 *   2. montado (com dados) → hover chama stop(), leave chama play() após o
 *      delay de 300ms (o comportamento de pause/resume NÃO é quebrado).
 *
 * Uso:
 *   npx vitest run --config vitest.config.ts src/components/vitrine/__tests__/testimonials-autoplay.test.tsx
 *
 *   (o vitest.config.unit.ts EXCLUI src/components/** — componente roda sob o
 *   config completo, que inclui o vitest.setup.tsx da vitrine)
 */

// Mock completo do lucide-react (padrão dos testes de vitrine).
import "./vitrine-a11y-setup"

import { describe, it, expect, vi, afterEach } from "vitest"
import * as React from "react"

import { render, cleanup, fireEvent, act } from "@/__tests__/test-utils"

// Os handlers onMouseEnter/onMouseLeave do Testimonials ficam no DIV interno
// (<div ref={ref} onMouseEnter onMouseLeave className="relative">), NÃO na
// section. E `fireEvent.mouseEnter` dispara um nativo `mouseenter`, que NÃO
// borbulha — o React polyfilla onMouseEnter via `mouseover`, então o evento
// nativo nunca chega ao handler. Por isso usamos mouseOver/mouseOut (que
// borbulham e acionam o polyfill do React) no div dos handlers.
function hoverEl(container: HTMLElement) {
  const el = container.querySelector("section > div.relative")
  if (!el) throw new Error("div de handlers (section > div.relative) não encontrado")
  return el as HTMLElement
}

// ── Estado mutável dos mocks (vi.hoisted — factories de vi.mock são hoisted) ──

const autoplay = vi.hoisted(() => ({
  play: vi.fn(),
  stop: vi.fn(),
  init: vi.fn(),
}))

const query = vi.hoisted(() => ({
  state: {
    data: undefined as { items: any[]; total: number; avgRating: number } | undefined,
    isLoading: true,
    isError: false,
    refetch: vi.fn(),
  },
}))

// ── Mocks ─────────────────────────────────────────────────────────────────

// Mock FIEL do embla-carousel-autoplay: play() lança o MESMO erro do plugin
// real quando chamado antes do init() — o teste falha se o guard for removido.
vi.mock("embla-carousel-autoplay", () => ({
  __esModule: true,
  default: () => {
    let initialized = false
    return {
      init: () => {
        initialized = true
        autoplay.init()
      },
      destroy: () => {
        initialized = false
      },
      play: () => {
        if (!initialized) {
          throw new Error("Cannot read properties of undefined (reading 'internalEngine')")
        }
        autoplay.play()
      },
      stop: () => {
        autoplay.stop()
      },
    }
  },
}))

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => query.state,
}))

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
}))

vi.mock("@/hooks/use-animation", () => ({
  useScrollReveal: () => ({ ref: { current: null }, visible: true }),
}))

// Carousel mock que SIMULA o mount real: chama plugin.init() + setApi(fakeApi)
// no efeito (como o useEmblaCarousel real faz).
vi.mock("@/components/ui/carousel", () => ({
  Carousel: ({ setApi, plugins, children }: any) => {
    // `plugins` é um array novo a cada render do pai e setApi sempre setaria
    // um objeto novo — adicioná-los aos deps causaria loop. O efeito DEVE
    // rodar 1x por mount, como o useEmblaCarousel real (init/setApi no mount).
    React.useEffect(() => {
      plugins?.forEach((p: any) => p.init?.())
      setApi?.({
        scrollSnapList: () => [0],
        selectedScrollSnap: () => 0,
        on: () => {},
        off: () => {},
        scrollPrev: () => {},
        scrollNext: () => {},
        scrollTo: () => {},
        canScrollPrev: () => false,
        canScrollNext: () => false,
      })
      // deps vazios de propósito (mount-once, como o embla). Inline: o
      // react-hooks reporta na linha do ARRAY de deps (`}, [])`), então o
      // disable vai na MESMA linha — imune a comentários futuros acima.
    }, []) // eslint-disable-line react-hooks/exhaustive-deps
    return <div data-testid="carousel">{children}</div>
  },
  CarouselContent: ({ children }: any) => <div>{children}</div>,
  CarouselItem: ({ children }: any) => <div>{children}</div>,
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...p }: any) => (
    <button type="button" {...p}>
      {children}
    </button>
  ),
}))

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...p }: any) => <span {...p}>{children}</span>,
}))

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}))

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <div>{children}</div>,
  TooltipProvider: ({ children }: any) => <>{children}</>,
}))

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children }: any) => <div>{children}</div>,
  AvatarImage: (p: any) => <img {...p} />,
  AvatarFallback: ({ children }: any) => <span>{children}</span>,
}))

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...p }: any) => <div {...p}>{children}</div>,
    header: ({ children, ...p }: any) => <header {...p}>{children}</header>,
    p: ({ children, ...p }: any) => <p {...p}>{children}</p>,
    h2: ({ children, ...p }: any) => <h2 {...p}>{children}</h2>,
    span: ({ children, ...p }: any) => <span {...p}>{children}</span>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

import Testimonials from "../testimonials"

const REVIEWS_DATA = {
  items: [
    {
      id: "r1",
      rating: 5,
      comment: "Excelente profissional, super recomendo!",
      createdAt: "2025-12-01T10:00:00Z",
      clientName: "Ana Oliveira",
      clientAvatar: null,
      providerName: "João Silva",
      providerAvatar: null,
      serviceTitle: "Consulta básica",
    },
    {
      id: "r2",
      rating: 4,
      comment: "Bom atendimento, preço justo.",
      createdAt: "2025-11-20T14:30:00Z",
      clientName: "Carlos Santos",
      clientAvatar: null,
      providerName: "Maria Lima",
      providerAvatar: null,
      serviceTitle: "Limpeza simples",
    },
  ],
  total: 2,
  avgRating: 4.5,
}

afterEach(() => {
  cleanup()
  autoplay.play.mockClear()
  autoplay.stop.mockClear()
  autoplay.init.mockClear()
})

describe("Testimonials — autoplay guard (regressão do crash do internalEngine)", () => {
  it("loading (sem carousel): hover/leave NÃO chamam play/stop — sem crash", async () => {
    query.state = {
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    }

    const { container } = render(<Testimonials />)
    // Skeleton presente, NENHUM carousel montado (api indefinido).
    expect(container.querySelector('[data-testid="skeleton"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="carousel"]')).toBeNull()

    const el = hoverEl(container)
    // Hover+leave durante o loading — o evento CHEGA ao handler (mouseOver
    // borbulha e aciona o onMouseEnter do React), mas o guard `!api` bloqueia:
    // play/stop nunca são chamados num plugin não inicializado → sem crash.
    fireEvent.mouseOver(el)
    fireEvent.mouseOut(el)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350))
    })

    expect(autoplay.play).not.toHaveBeenCalled()
    expect(autoplay.stop).not.toHaveBeenCalled()
    expect(autoplay.init).not.toHaveBeenCalled()
  })

  it("montado (com dados): hover chama stop() e leave chama play() após 300ms", async () => {
    query.state = {
      data: REVIEWS_DATA,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }

    const { container } = render(<Testimonials />)
    // Carousel montado → plugin inicializado + api setado.
    expect(container.querySelector('[data-testid="carousel"]')).not.toBeNull()
    expect(autoplay.init).toHaveBeenCalled()

    const el = hoverEl(container)
    fireEvent.mouseOver(el)
    expect(autoplay.stop).toHaveBeenCalledTimes(1)

    fireEvent.mouseOut(el)
    expect(autoplay.stop).toHaveBeenCalledTimes(1) // nenhuma chamada extra
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350))
    })
    expect(autoplay.play).toHaveBeenCalledTimes(1)
  })

  it("hover sem leave (mouse entra e fica): play() NÃO é chamado (timer nunca dispara)", async () => {
    query.state = {
      data: REVIEWS_DATA,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }

    const { container } = render(<Testimonials />)
    const el = hoverEl(container)
    fireEvent.mouseOver(el)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350))
    })
    expect(autoplay.stop).toHaveBeenCalledTimes(1)
    expect(autoplay.play).not.toHaveBeenCalled()
  })
})
