/**
 * E2E — allowlist pública de dados de usuário (regressão de segurança).
 *
 * Por que existe: `db.user.findFirst({ include })` sem `select` devolve TODAS as
 * colunas escalares de User, e as rotas serializavam com "a linha menos o
 * passwordHash" — vazando cpfCnpj, e-mail, endereço completo, URLs de KYC e
 * twoFactorSecret de TERCEIROS em `/api/providers/:id` (público, sem auth).
 *
 * Os testes unitários provam o CONTRATO da query e da projeção, mas usam um
 * Prisma mockado: só o app real prova que o Postgres honra o `select` e que a
 * resposta HTTP não carrega campo sensível. Este spec é essa prova.
 *
 * Pré-requisitos: infra do projeto no ar (PostGIS + Redis) e app em :3000
 *   make infra && bun run db:setup && bun run dev
 * Rodar:
 *   bunx playwright test e2e/provider-public-payload.spec.ts --project=chromium
 *
 * Sem banco o arquivo inteiro se AUTO-SKIPa (falha de ambiente não é regressão),
 * com o motivo do skip visível no relatório.
 */

import { test, expect, type APIRequestContext } from "@playwright/test"

/**
 * Espelho de `SENSITIVE_USER_FIELDS` (src/lib/api-server.ts). Duplicado de
 * propósito: este spec roda em Node puro e não pode importar um módulo
 * server-only. Se a lista de origem mudar, atualize aqui também — e é
 * justamente o teste unitário (response-pii-guard) que trava a origem.
 *
 * Vale para payload de TERCEIROS/anônimo. O corpo do PRÓPRIO usuário (login,
 * /auth/me) contém `email` legitimamente — o contrato `AuthUser` do store
 * exige — então lá a lista é `CREDENTIAL_KEYS`.
 */
const SENSITIVE_KEYS = [
  "passwordHash",
  "twoFactorSecret",
  "twoFactorBackupCodes",
  "cpfCnpj",
  "email",
  "identityDocUrl",
  "identitySelfieUrl",
  "lytexRecipientId",
  "sessionVersion",
  "servicePolygon",
  "travelFeePolicy",
  "deletedAt",
] as const

/** Campos que a UI (ProviderDetail/ProviderCard) consome — não podem sumir. */
const REQUIRED_DETAIL_KEYS = [
  "id",
  "name",
  "avatarUrl",
  "bio",
  "verified",
  "city",
  "state",
  "cep",
  "district",
  "whatsapp",
  "lat",
  "lng",
  "radiusKm",
  "rating",
  "reviewCount",
  "favoriteCount",
  "services",
  "availability",
  "reviews",
  "distanceKm",
  "favorited",
] as const

/**
 * Campos proibidos no corpo do PRÓPRIO usuário: credencial e documento.
 * Não inclui `email` (é a identidade de sessão) nem `updatedAt`/`active`
 * (metadados inócuos do próprio dono).
 */
const CREDENTIAL_KEYS = SENSITIVE_KEYS.filter((key) => key !== "email")

/**
 * Conta de teste para os fluxos autenticados.
 *
 * ⚠️ De propósito NÃO usamos `cliente@severinno.com`: as contas demo são
 * bloqueadas no login quando `NODE_ENV=production` (isDemoAccountsEnabled),
 * e é exatamente assim que o servidor do pm2 roda — usar uma demo faria os
 * testes de sessão pularem justamente na instância que importa. `maria@` é
 * uma CLIENT semeada comum (e tem CPF/endereço no banco, o que deixa o teste
 * de vazamento mais afiado).
 */
const CLIENT_EMAIL = process.env.E2E_CLIENT_EMAIL ?? "maria@severinno.com"
const CLIENT_PASSWORD = process.env.E2E_CLIENT_PASSWORD ?? "cliente123"

/**
 * Em CI (`E2E_REQUIRE_DATA=1`) falta de dado FALHA em vez de pular.
 *
 * Sem isso o gate seria vazio por construção: num banco recém-criado e sem
 * seed não há prestador nenhum, todos os testes se auto-skipam e o PR fica
 * verde tendo verificado exatamente nada — o pior tipo de gate, porque dá a
 * sensação de proteção sem a proteção.
 */
const REQUIRE_DATA = process.env.E2E_REQUIRE_DATA === "1"

function guardMissing(reason: string): void {
  if (REQUIRE_DATA) {
    throw new Error(
      `E2E_REQUIRE_DATA=1 exige um ambiente capaz de validar a allowlist, mas: ${reason}`,
    )
  }
  test.skip(true, reason)
}

function expectNoSensitiveKeys(
  payload: unknown,
  label: string,
  keys: readonly string[] = SENSITIVE_KEYS,
) {
  const record = payload as Record<string, unknown>
  for (const key of keys) {
    expect(record, `${label} não pode expor "${key}"`).not.toHaveProperty(key)
  }
}

/**
 * O banco está saudável? Sem ele, `/api/providers/:id` devolve 500/503 e o
 * status esperado (200/404) não é decidível — preferimos skip explícito a um
 * falso negativo silencioso.
 */
async function databaseUnavailable(request: APIRequestContext): Promise<string | null> {
  try {
    const response = await request.get("/api/health")
    const body = (await response.json()) as {
      checks?: Record<string, unknown>
    }
    const database = body.checks?.database
    if (database === "ok") return null
    return `database=${JSON.stringify(database ?? "unknown")} (status ${response.status()})`
  } catch (error) {
    return `health indisponível: ${String(error).slice(0, 120)}`
  }
}

/** Primeiro prestador listado publicamente, ou null se não houver dados. */
async function firstProviderId(request: APIRequestContext): Promise<string | null> {
  const response = await request.get("/api/providers?page=1&limit=5")
  if (!response.ok()) return null
  const body = (await response.json()) as { items?: Array<{ id?: string }> }
  return body.items?.find((item) => typeof item?.id === "string")?.id ?? null
}

test.beforeEach(async ({ request }) => {
  const reason = await databaseUnavailable(request)
  if (reason !== null) {
    guardMissing(
      `Banco indisponível (${reason}) — a allowlist pública só é verificável com dados reais. ` +
        "Suba a infra: make infra && bun run db:setup",
    )
  }
})

test.describe("payload público de prestador — allowlist de campos", () => {
  test("GET /api/providers/:id (sem sessão) não expõe credencial nem PII", async ({ request }) => {
    const providerId = await firstProviderId(request)
    if (!providerId) guardMissing("Sem prestadores semeados no banco (rode bun run db:seed).")

    const response = await request.get(`/api/providers/${providerId}`)
    expect(response.status()).toBe(200)

    const body = (await response.json()) as Record<string, unknown>
    expectNoSensitiveKeys(body, "provider detail")

    // O endpoint é público: sem cookie, `favorited` é false e a resposta é privada.
    expect(body.favorited).toBe(false)
    expect(response.headers()["cache-control"]).toContain("private")
  })

  test("GET /api/providers/:id preserva todos os campos que a UI usa", async ({ request }) => {
    const providerId = await firstProviderId(request)
    if (!providerId) guardMissing("Sem prestadores semeados no banco (rode bun run db:seed).")

    const body = (await (await request.get(`/api/providers/${providerId}`)).json()) as Record<
      string,
      unknown
    >

    for (const key of REQUIRED_DETAIL_KEYS) {
      expect(body, `campo de UI ausente: ${key}`).toHaveProperty(key)
    }
    expect(Array.isArray(body.services)).toBe(true)
    expect(Array.isArray(body.availability)).toBe(true)
    expect(Array.isArray(body.reviews)).toBe(true)
    expect(typeof body.rating).toBe("number")
    expect(typeof body.name).toBe("string")
  })

  test("distanceKm é calculado quando lat/lng são enviados", async ({ request }) => {
    const providerId = await firstProviderId(request)
    if (!providerId) guardMissing("Sem prestadores semeados no banco (rode bun run db:seed).")

    const detail = (await (await request.get(`/api/providers/${providerId}`)).json()) as Record<
      string,
      unknown
    >

    const lat = typeof detail.lat === "number" ? detail.lat : null
    const lng = typeof detail.lng === "number" ? detail.lng : null
    test.skip(lat === null || lng === null, "Prestador sem coordenadas no banco.")

    // Ponto a ~5km ao norte do prestador
    const response = await request.get(
      `/api/providers/${providerId}?lat=${lat! + 0.045}&lng=${lng}`,
    )
    expect(response.status()).toBe(200)

    const body = (await response.json()) as Record<string, unknown>
    expectNoSensitiveKeys(body, "provider detail (geo)")
    expect(typeof body.distanceKm).toBe("number")
    expect(body.distanceKm as number).toBeGreaterThan(0)
  })

  test("id inexistente devolve 404 sem vazar shape interno", async ({ request }) => {
    const response = await request.get("/api/providers/nao-existe-em-nenhum-banco")
    expect(response.status()).toBe(404)

    const body = (await response.json()) as Record<string, unknown>
    expectNoSensitiveKeys(body, "provider detail 404")
  })
})

test.describe("sessão e favoritos — allowlist de terceiros", () => {
  test("login devolve identidade sem credencial e com nome (contrato do AuthUser)", async ({
    request,
  }) => {
    const response = await request.post("/api/auth/login", {
      data: { email: CLIENT_EMAIL, password: CLIENT_PASSWORD },
    })
    if (response.status() === 401) {
      guardMissing(
        `Login recusado para ${CLIENT_EMAIL} — semeie o banco (bun run db:seed) ou ajuste ` +
          "E2E_CLIENT_EMAIL/E2E_CLIENT_PASSWORD.",
      )
    }
    expect(response.status()).toBe(200)

    const { user } = (await response.json()) as { user: Record<string, unknown> }
    expectNoSensitiveKeys(user, "login.user", CREDENTIAL_KEYS)
    // O e-mail do próprio usuário É esperado aqui (identidade de sessão)
    expect(typeof user.email).toBe("string")

    // Regressão corrigida: a resposta precisa alimentar o useAuthStore, que
    // espera `AuthUser.name` — antes o nome ficava undefined até o /auth/me.
    expect(typeof user.name).toBe("string")
    expect((user.name as string).length).toBeGreaterThan(0)
    expect(user.role).toBe("CLIENT")
  })

  test("GET /api/favorites não expõe PII dos prestadores favoritados", async ({ request }) => {
    const login = await request.post("/api/auth/login", {
      data: { email: CLIENT_EMAIL, password: CLIENT_PASSWORD },
    })
    if (login.status() === 401) guardMissing(`Login recusado para ${CLIENT_EMAIL} — banco semeado?`)
    expect(login.status()).toBe(200)

    const providerId = await firstProviderId(request)
    if (!providerId) guardMissing("Sem prestadores semeados no banco (rode bun run db:seed).")

    // Garante lista não-vazia: se o cliente não tem favoritos, favorita
    // agora e DESFAZ no fim (o endpoint é um toggle, então o estado é restaurado).
    let favorites = (await (await request.get("/api/favorites")).json()) as Array<
      Record<string, unknown>
    >
    let restore: (() => Promise<unknown>) | null = null

    if (favorites.length === 0) {
      await request.post(`/api/providers/${providerId}/favorite`)
      restore = () => request.post(`/api/providers/${providerId}/favorite`)
      favorites = (await (await request.get("/api/favorites")).json()) as Array<
        Record<string, unknown>
      >
    }

    try {
      expect(Array.isArray(favorites)).toBe(true)
      expect(favorites.length, "lista de favoritos vazia — nada para validar").toBeGreaterThan(0)

      for (const provider of favorites) {
        expectNoSensitiveKeys(provider, "favorites[].provider")
        // Contrato de ProviderCard (a UI de favoritos depende destes)
        expect(provider).toHaveProperty("name")
        expect(provider).toHaveProperty("rating")
        expect(provider).toHaveProperty("reviewCount")
        expect(provider).toHaveProperty("distanceKm")
        expect(Array.isArray(provider.services)).toBe(true)
      }
    } finally {
      if (restore) await restore()
    }
  })
})
