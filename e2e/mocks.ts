import { type Page } from "@playwright/test"

// =========================================================================
// Tipos locais — shapes necessários para os mocks (sem dependência de @/)
// =========================================================================

export type MockServiceUnit = "UNIDADE" | "METRO_LINEAR" | "METRO_QUADRADO" | "METRO_CUBICO"

export type MockProviderService = {
  id: string
  title: string
  description?: string | null
  basePrice: number
  unit: MockServiceUnit
  photos?: string[]
  category?: { id: string; name: string } | null
}

export type MockProviderCard = {
  id: string
  name: string
  avatarUrl?: string | null
  coverUrl?: string | null
  bio?: string | null
  rating: number
  reviewCount: number
  verified: boolean
  city?: string | null
  distanceKm?: number | null
  lat?: number | null
  lng?: number | null
  services: MockProviderService[]
  completedBookings?: number
  memberSince?: string
}

export type MockProviderAvailability = {
  id: string
  dayOfWeek: number
  startTime: string
  endTime: string
}

export type MockProviderReview = {
  id: string
  rating: number
  comment?: string | null
  createdAt: string
  author?: { id: string; name: string; avatarUrl?: string | null } | null
}

export type MockProviderDetail = MockProviderCard & {
  whatsapp?: string | null
  address?: string | null
  district?: string | null
  state?: string | null
  cep?: string | null
  radiusKm?: number | null
  availability?: MockProviderAvailability[]
  reviews?: MockProviderReview[]
  favorited?: boolean
  favoriteCount?: number
}

export type MockPagedResult<T> = {
  items: T[]
  total: number
  page: number
  limit: number
}

export type MockCepResult = {
  cep: string
  street?: string
  district?: string
  city?: string
  state?: string
}

export type MockCategory = {
  id: string
  name: string
  slug: string
  icon?: string | null
  level: number
  parentId?: string | null
}

// =========================================================================
// Factory functions
// =========================================================================

let _idCounter = Date.now()

function uid(prefix = "mock"): string {
  return `${prefix}-${_idCounter++}`
}

export function createMockService(overrides?: Partial<MockProviderService>): MockProviderService {
  return {
    id: uid("svc"),
    title: "Instalação Elétrica",
    description: "Instalação de tomadas, interruptores e disjuntores",
    basePrice: 120,
    unit: "UNIDADE",
    photos: [],
    category: { id: "cat-eletrica", name: "Elétrica" },
    ...overrides,
  }
}

export function createMockProviderCard(overrides?: Partial<MockProviderCard>): MockProviderCard {
  return {
    id: uid("prov"),
    name: "Maria Silva",
    avatarUrl: null,
    coverUrl: null,
    bio: "Especialista em instalações elétricas residenciais com mais de 10 anos de experiência.",
    rating: 4.8,
    reviewCount: 42,
    verified: true,
    city: "São Paulo",
    distanceKm: 2.5,
    lat: -23.55,
    lng: -46.63,
    services: [createMockService()],
    completedBookings: 230,
    memberSince: "2023-01-15",
    ...overrides,
  }
}

export function createMockProviderDetail(
  overrides?: Partial<MockProviderDetail>,
): MockProviderDetail {
  const card = createMockProviderCard(overrides)
  return {
    ...card,
    whatsapp: "11999999999",
    address: "Av. Paulista, 1000",
    district: "Bela Vista",
    state: "SP",
    cep: "01310-100",
    radiusKm: 30,
    availability: [
      // Todos os 7 dias — o booking modal só gera horários se o dayOfWeek
      // do dia selecionado tiver bloco; cobrir só seg-sex fazia os testes
      // que rodam em fins de semana ficarem sem slots (Continuar disabled).
      { id: "avail-0", dayOfWeek: 0, startTime: "08:00", endTime: "18:00" },
      { id: "avail-1", dayOfWeek: 1, startTime: "08:00", endTime: "18:00" },
      { id: "avail-2", dayOfWeek: 2, startTime: "08:00", endTime: "18:00" },
      { id: "avail-3", dayOfWeek: 3, startTime: "08:00", endTime: "18:00" },
      { id: "avail-4", dayOfWeek: 4, startTime: "08:00", endTime: "18:00" },
      { id: "avail-5", dayOfWeek: 5, startTime: "08:00", endTime: "18:00" },
      { id: "avail-6", dayOfWeek: 6, startTime: "08:00", endTime: "18:00" },
    ],
    reviews: [
      {
        id: uid("rev"),
        rating: 5,
        comment: "Excelente profissional, muito atenciosa!",
        createdAt: "2024-12-01T10:00:00Z",
        author: { id: "client-1", name: "João Cliente", avatarUrl: null },
      },
      {
        id: uid("rev"),
        rating: 4,
        comment: "Bom serviço, pontual e cuidadosa.",
        createdAt: "2024-11-15T14:30:00Z",
        author: { id: "client-2", name: "Ana Souza", avatarUrl: null },
      },
    ],
    ...overrides,
  }
}

export function createMockProvidersList(count = 3): MockPagedResult<MockProviderCard> {
  const names = [
    "Maria Silva",
    "João Pedreiro",
    "Ana Pintora",
    "Carlos Encanador",
    "Fernanda Eletricista",
  ]
  const cats = [
    { id: "cat-eletrica", name: "Elétrica" },
    { id: "cat-construcao", name: "Construção" },
    { id: "cat-pintura", name: "Pintura" },
    { id: "cat-hidraulica", name: "Hidráulica" },
    { id: "cat-marcenaria", name: "Marcenaria" },
  ]
  const items = Array.from({ length: count }, (_, i) => {
    const idx = i % names.length
    return createMockProviderCard({
      id: `prov-${i + 1}`,
      name: names[idx],
      city: "São Paulo",
      services: [createMockService({ category: cats[idx] })],
    })
  })
  return { items, total: count, page: 1, limit: 20 }
}

export function createMockCepResult(overrides?: Partial<MockCepResult>): MockCepResult {
  return {
    cep: "01310-100",
    street: "Av. Paulista",
    district: "Bela Vista",
    city: "São Paulo",
    state: "SP",
    ...overrides,
  }
}

export function createMockReverseGeocode(
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    street: "Av. Paulista",
    district: "Bela Vista",
    city: "São Paulo",
    state: "SP",
    cep: "01310-100",
    displayName: "Av. Paulista, Bela Vista, São Paulo, SP, Brasil",
    ...overrides,
  }
}

export function createMockBookingResponse(
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    booking: {
      id: "booking-mock-1",
      status: "PENDING",
      paymentStatus: "PENDING",
      paymentMethod: "PIX",
      amount: 120,
      scheduledAt: new Date().toISOString(),
      service: createMockService(),
      provider: { id: "prov-1", name: "Maria Silva", avatarUrl: null },
      client: { id: "client-mock", name: "Test User", avatarUrl: null },
      payment: { id: "pay-1", status: "PENDING", method: "PIX", amount: 120 },
      ...overrides,
    },
  }
}

export function createMockPayResponse(
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    pixQrCode: "00020101021226930014br.gov.bcb.pix2571pix.example.com/qr/v2/teste123456789",
    pixKey: "teste-pix-key-12345",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    amount: 120,
    ...overrides,
  }
}

export function createMockUser(role: "CLIENT" | "PROVIDER" = "CLIENT"): Record<string, unknown> {
  return {
    id: uid("user"),
    name: role === "PROVIDER" ? "Maria Silva" : "Test User",
    email: "e2e-test@example.com",
    role,
    avatarUrl: null,
  }
}

export function createMockCategory(overrides?: Partial<MockCategory>): MockCategory {
  return {
    id: uid("cat"),
    name: "Elétrica",
    slug: "eletrica",
    icon: "Zap",
    level: 0,
    ...overrides,
  }
}

// =========================================================================
// Factory: quote requests (para fluxo de resposta de orçamento)
// =========================================================================

export function createMockQuoteRequest(overrides?: {
  status?: "PENDING" | "RESPONDED" | "APPROVED"
  itemStatus?: "PENDING" | "QUOTED"
}): Record<string, unknown> {
  const status = overrides?.status ?? "PENDING"
  const itemStatus = overrides?.itemStatus ?? "PENDING"

  return {
    id: "quote-mock-response-1",
    clientId: "client-mock-1",
    providerId: "prov-1",
    status,
    address: "Av. Paulista, 1000, Bela Vista, São Paulo, SP",
    cep: "01310-100",
    lat: -23.55,
    lng: -46.63,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    client: { id: "client-mock-1", name: "João Cliente", avatarUrl: null },
    provider: { id: "prov-1", name: "Maria Silva", avatarUrl: null },
    items: [
      {
        id: "qitem-response-1",
        requestId: "quote-mock-response-1",
        providerId: "prov-1",
        serviceId: "svc-1",
        description: "Instalação de 3 tomadas novas na sala. Fiação embutida.",
        quantity: 3,
        unit: "UNIDADE",
        photos: [],
        price: itemStatus === "QUOTED" ? 150 : null,
        providerNote: itemStatus === "QUOTED" ? "Material incluso. Válido por 7 dias." : null,
        status: itemStatus,
        createdAt: new Date().toISOString(),
        service: {
          id: "svc-1",
          title: "Instalação Elétrica",
          basePrice: 120,
          unit: "UNIDADE",
        },
        provider: {
          id: "prov-1",
          name: "Maria Silva",
          avatarUrl: null,
        },
      },
    ],
  }
}

// =========================================================================
// Options & setup
// =========================================================================

export type MockOptions = {
  /** Simula usuário autenticado (session ativa nos endpoints que exigem auth). */
  authenticated?: boolean
  /** Role do usuário logado (CLIENT | PROVIDER). Default CLIENT. */
  userRole?: "CLIENT" | "PROVIDER"
  /** Lista customizada de providers (substitui o default). */
  providers?: MockPagedResult<MockProviderCard>
  /** Detalhe do provider (substitui o default). */
  providerDetail?: MockProviderDetail
  /**
   * Estágio do orçamento para a listagem:
   * - "pending":   status PENDING, itens PENDING (provider vê para responder)
   * - "responded": status RESPONDED, itens QUOTED (cliente vê para aprovar)
   * - "approved":  status APPROVED (terminal)
   * Default "pending".
   */
  quoteStage?: "pending" | "responded" | "approved"
}

/**
 * Lê a sessão real do app (Zustand persist em localStorage) para saber se o
 * usuário está autenticado. Usado no gating de endpoints autenticados — assim
 * um fluxo que REGISTRA o usuário (mock de register devolve o user, o store
 * persiste em "severinno:auth") passa a estar autenticado para as chamadas
 * seguintes, em vez de depender só do flag estático `authenticated`.
 */
async function isAuthenticated(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem("severinno:auth")
      const parsed = raw ? JSON.parse(raw) : null
      return !!parsed?.state?.user
    } catch {
      return false
    }
  })
}

/**
 * Configura interceptors de rota para TODAS as APIs que o booking flow
 * utiliza. As requisições são interceptadas no navegador e respondidas
 * com dados mock — sem dependência de banco de dados ou serviços externos.
 *
 * Uso:
 *   test.beforeEach(async ({ page }) => {
 *     await setupApiMocks(page, { authenticated: true })
 *   })
 *
 * Para cenários de erro, importe as factories e use `page.route()` manualmente
 * com respostas customizadas (ex: 500, timeout, etc).
 */
export async function setupApiMocks(page: Page, options: MockOptions = {}) {
  const {
    authenticated = false,
    userRole = "CLIENT",
    providers,
    providerDetail,
    quoteStage = "pending",
  } = options

  // ── GET /api/providers (listagem pública) ──────────────────────────
  // NOTA: Playwright dá precedência ao ÚLTIMO route registrado (LIFO), então o
  // handler genérico **/api/providers** deve vir ANTES do pattern de detail —
  // se registrarmos o detail primeiro, o genérico engole as requisições
  // /api/providers/:id e o modal recebe a lista em vez do detail.
  await page.route("**/api/providers**", async (route, request) => {
    const url = new URL(request.url())
    const path = url.pathname

    // POST /api/providers/:id/favorite (toggle favorite)
    if (request.method() === "POST" && path.includes("/favorite")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ favorited: true }),
      })
    }

    // GET /api/providers (lista) — sem segmento de id no path
    if (request.method() === "GET" && !/\/api\/providers\/[^/?]+/.test(path)) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(providers ?? createMockProvidersList(3)),
      })
    }

    return route.fallback()
  })

  // GET /api/providers/:id (detalhe) — registrado por ÚLTIMO para ter
  // precedência sobre o genérico. O id pode ser alfanumérico (prov-1, uuid).
  await page.route(/\/api\/providers\/(?!favorite)[A-Za-z0-9-]+(\?|$)/, async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(providerDetail ?? createMockProviderDetail()),
    })
  })

  // ── GET /api/services?providerId=... ───────────────────────────────
  await page.route("**/api/services*", async (route, request) => {
    if (request.method() === "GET") {
      const url = new URL(request.url())
      const providerId = url.searchParams.get("providerId") ?? "unknown"
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          createMockService({
            id: `svc-${providerId}-1`,
            title: "Instalação Elétrica",
            basePrice: 120,
          }),
          createMockService({
            id: `svc-${providerId}-2`,
            title: "Troca de Tomadas",
            basePrice: 80,
          }),
          createMockService({
            id: `svc-${providerId}-3`,
            title: "Quadro de Distribuição",
            basePrice: 250,
          }),
        ]),
      })
    }
    return route.fallback()
  })

  // ── GET /api/categories ────────────────────────────────────────────
  await page.route("**/api/categories", async (route, request) => {
    if (request.method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          createMockCategory(),
          createMockCategory({
            id: "cat-construcao",
            name: "Construção",
            slug: "construcao",
            icon: "Building2",
          }),
          createMockCategory({
            id: "cat-pintura",
            name: "Pintura",
            slug: "pintura",
            icon: "Paintbrush",
          }),
        ]),
      })
    }
    return route.fallback()
  })

  // ── GET /api/geo/cep?cep=... ───────────────────────────────────────
  await page.route("**/api/geo/cep*", async (route, request) => {
    if (request.method() === "GET") {
      const url = new URL(request.url())
      const cep = url.searchParams.get("cep") ?? ""

      if (cep === "00000000") {
        return route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "CEP não encontrado" }),
        })
      }

      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(createMockCepResult({ cep })),
      })
    }
    return route.fallback()
  })

  // ── GET /api/geo/reverse?lat=...&lng=... ───────────────────────────
  await page.route("**/api/geo/reverse*", async (route, request) => {
    if (request.method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(createMockReverseGeocode()),
      })
    }
    return route.fallback()
  })

  // ── Auth (login, register, me, logout, forgot-password, reset-password) ──
  // Uses page.addInitScript() to override window.fetch at the JS level.
  // This is more reliable than page.route() which may have version-specific issues.
  const userMock = createMockUser(userRole)
  await page.addInitScript(`
    (() => {
      const __origFetch = window.fetch.bind(window);
      window.fetch = async (url, opts = {}) => {
        const path = typeof url === 'string' ? new URL(url, location.origin).pathname : url.url;
        const method = (opts.method || 'GET').toUpperCase();

        // POST /api/auth/forgot-password
        if (path.endsWith('/api/auth/forgot-password') && method === 'POST') {
          return new Response(JSON.stringify({ ok: true, message: "Se o e-mail estiver cadastrado, você receberá as instruções." }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // POST /api/auth/reset-password
        if (path.endsWith('/api/auth/reset-password') && method === 'POST') {
          try {
            const body = JSON.parse(opts.body || '{}');
            const token = body.token || '';
            if (token === 'expired-token') {
              return new Response(JSON.stringify({ error: "Este token expirou. Solicite uma nova redefinição de senha." }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            if (token === 'used-token') {
              return new Response(JSON.stringify({ error: "Este token já foi utilizado. Solicite uma nova redefinição de senha." }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
              });
            }
            if (token === 'invalid-token') {
              return new Response(JSON.stringify({ error: "Token inválido. Solicite uma nova redefinição de senha." }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
              });
            }
          } catch {}
          return new Response(JSON.stringify({ ok: true, message: "Senha redefinida com sucesso! Você já pode fazer login." }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // POST /api/auth/login
        if (path.endsWith('/api/auth/login') && method === 'POST') {
          return new Response(JSON.stringify({ user: ${JSON.stringify(userMock)} }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // POST /api/auth/register
        if (path.endsWith('/api/auth/register') && method === 'POST') {
          return new Response(JSON.stringify({ user: ${JSON.stringify(userMock)} }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // GET /api/auth/me — devolve o usuário se houver sessão real no
        // localStorage (criada por register/login no fluxo da UI) ou se o
        // flag estatico authenticated=true. Isso evita que um registro
        // recém-feito seja deslogado pelo me() subsequente.
        if (path.endsWith('/api/auth/me') && method === 'GET') {
          let user = null;
          if (${authenticated ? "true" : "false"}) {
            user = ${JSON.stringify(userMock)};
          } else {
            try {
              const raw = localStorage.getItem('severinno:auth');
              const parsed = raw ? JSON.parse(raw) : null;
              user = parsed?.state?.user ?? null;
            } catch {}
          }
          return new Response(JSON.stringify({ user }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // POST /api/auth/logout
        if (path.endsWith('/api/auth/logout') && method === 'POST') {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // All other requests pass through to original fetch
        return __origFetch(url, opts);
      };
    })();
  `)

  // ── Bookings ───────────────────────────────────────────────────────
  await page.route("**/api/bookings**", async (route, request) => {
    const url = new URL(request.url())
    const path = url.pathname
    // Estaticamente autenticado OU sessão real criada por register/login no
    // fluxo da própria UI (mock de auth devolve o user e o store persiste).
    const authed = authenticated || (await isAuthenticated(page))

    // POST /api/bookings/:id/pay
    if (request.method() === "POST" && /\/pay$/.test(path)) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(createMockPayResponse()),
      })
    }

    // POST /api/bookings (criar)
    if (request.method() === "POST") {
      if (!authed) {
        return route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ error: "Não autenticado" }),
        })
      }
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(createMockBookingResponse()),
      })
    }

    // GET /api/bookings (listar)
    if (request.method() === "GET") {
      if (!authed) {
        return route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ error: "Não autenticado" }),
        })
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [createMockBookingResponse().booking],
          total: 1,
          page: 1,
          limit: 20,
        }),
      })
    }

    return route.fallback()
  })

  // ── Quotes ─────────────────────────────────────────────────────────
  await page.route("**/api/quotes**", async (route, request) => {
    const url = new URL(request.url())
    const path = url.pathname
    const authed = authenticated || (await isAuthenticated(page))

    // POST /api/quotes (criar)
    if (request.method() === "POST") {
      if (!authed) {
        return route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ error: "Não autenticado" }),
        })
      }
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          quote: {
            id: "quote-mock-1",
            status: "PENDING",
            provider: { id: "prov-1", name: "Maria Silva", avatarUrl: null },
            items: [
              {
                id: "qitem-mock-1",
                service: {
                  id: "svc-1",
                  title: "Instalação Elétrica",
                  basePrice: 120,
                },
                quantity: 1,
                unit: "UNIDADE",
                status: "PENDING",
              },
            ],
          },
        }),
      })
    }

    // GET /api/quotes (listar)
    if (request.method() === "GET") {
      if (!authed) {
        return route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ error: "Não autenticado" }),
        })
      }

      // Retorna dados diferentes conforme quoteStage e role
      const role = url.searchParams.get("role") ?? "CLIENT"

      if (role === "PROVIDER") {
        // Provider: sempre vê itens PENDING para responder
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [createMockQuoteRequest({ status: "PENDING", itemStatus: "PENDING" })],
            total: 1,
            page: 1,
            limit: 200,
          }),
        })
      }

      // CLIENT role: retorna conforme quoteStage
      switch (quoteStage) {
        case "responded":
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              items: [createMockQuoteRequest({ status: "RESPONDED", itemStatus: "QUOTED" })],
              total: 1,
              page: 1,
              limit: 50,
            }),
          })
        case "approved":
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              items: [createMockQuoteRequest({ status: "APPROVED", itemStatus: "QUOTED" })],
              total: 1,
              page: 1,
              limit: 50,
            }),
          })
        default:
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              items: [createMockQuoteRequest({ status: "PENDING", itemStatus: "PENDING" })],
              total: 1,
              page: 1,
              limit: 50,
            }),
          })
      }
    }

    // PATCH /api/quotes/:id (update status — cliente aprova/rejeita)
    if (request.method() === "PATCH" && !path.includes("/items/")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          quote: {
            id: "quote-mock-1",
            status: "APPROVED",
            provider: { id: "prov-1", name: "Maria Silva" },
            client: { id: "client-mock", name: "Test User" },
          },
        }),
      })
    }

    // PATCH /api/quotes/:id/items/:itemId (responder item — provider)
    if (request.method() === "PATCH" && path.includes("/items/")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          item: {
            id: "qitem-response-1",
            price: 150,
            providerNote: "Orçamento para instalação elétrica.",
            status: "QUOTED",
          },
        }),
      })
    }

    return route.fallback()
  })

  // ── POST /api/upload (fotos) ───────────────────────────────────────
  await page.route("**/api/upload", async (route, request) => {
    if (request.method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          url: "https://example.com/uploads/mock-photo.jpg",
        }),
      })
    }
    return route.fallback()
  })
}
