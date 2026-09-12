/**
 * Guard: respostas que descrevem OUTRO usuário (ou o público anônimo) precisam
 * vir de uma allowlist explícita do Prisma.
 *
 * Motivação (achado 09/2026): `db.user.findFirst({ include: {...} })` sem
 * `select` devolve TODAS as colunas escalares de User. Como a serialização era
 * `const { passwordHash: _i, ...safe } = row`, o corpo da resposta carregava
 * `cpfCnpj`, `email`, `whatsapp`, endereço completo, URLs de KYC
 * (`identityDocUrl`/`identitySelfieUrl`) e `twoFactorSecret`/`twoFactorBackupCodes`
 * de um TERCEIRO — em `/api/providers/[id]` sem sequer exigir autenticação.
 *
 * Cobertura:
 *   1. `/api/providers/[id]` consulta com `select` (nunca `include`) e sem
 *      nenhum campo de SENSITIVE_USER_FIELDS — com contrato de UI preservado.
 *   2. `/api/favorites` idem para o provider aninhado.
 *   3. Guard estático: o idioma "spread menos passwordHash" não pode voltar
 *      a nenhum arquivo de `src/`.
 *   4. `toSessionUser()` (login/registro/me) é allowlist, não deny-list.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"
import {
  PUBLIC_PROVIDER_SELECT,
  SENSITIVE_USER_FIELDS,
  exactShape,
  toPublicProvider,
  toSessionUser,
  type PublicProviderPayload,
} from "@/lib/api-server"

// ---------------------------------------------------------------------------
// Mocks (declarados antes dos imports das rotas — vi.mock é hoisted)
// ---------------------------------------------------------------------------

const mockUserFindFirst = vi.hoisted(() => vi.fn())
const mockFavoriteFindMany = vi.hoisted(() => vi.fn())
const mockGetOptionalSession = vi.hoisted(() => vi.fn())
const mockRequireUser = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db", () => ({
  db: {
    user: { findFirst: (...args: any[]) => mockUserFindFirst(...args) },
    favorite: { findMany: (...args: any[]) => mockFavoriteFindMany(...args) },
  },
}))

vi.mock("@/lib/auth", () => ({
  getOptionalSession: (...args: any[]) => mockGetOptionalSession(...args),
  requireUser: (...args: any[]) => mockRequireUser(...args),
}))

vi.mock("@/lib/geo-server", () => ({
  haversineKm: () => 0,
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: { providers: {} },
}))

import { GET as getProviderDetail } from "../providers/[id]/route"
import { GET as getFavorites } from "../favorites/route"

// ---------------------------------------------------------------------------
// Fixtures — simula a linha REAL que o Postgres devolveria para o `select`
// declarado na rota (colunas não pedidas não existem no resultado).
// ---------------------------------------------------------------------------

function providerRowFromSelect(overrides: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {}
  for (const key of Object.keys(PUBLIC_PROVIDER_SELECT)) {
    base[key] = null
  }
  return {
    ...base,
    id: "prov-1",
    name: "Maria Silva",
    slug: "maria-silva",
    role: "PROVIDER",
    bio: "Encanadora",
    verified: true,
    active: true,
    city: "Governador Valadares",
    district: "Centro",
    state: "MG",
    cep: "35010-000",
    whatsapp: "+5533999999999",
    lat: -18.85,
    lng: -41.94,
    radiusKm: 30,
    avgRating: 4.7,
    reviewCount: 12,
    favoriteCount: 3,
    createdAt: new Date("2024-02-01"),
    updatedAt: new Date("2024-03-01"),
    services: [],
    availability: [],
    reviewsReceived: [],
    ...overrides,
  }
}

/** Pares chave/valor de SENSITIVE_USER_FIELDS como apareceriam num `include`. */
const sensitiveFixture = {
  passwordHash: "salt:hash",
  twoFactorSecret: "JBSWY3DPEHPK3PXP",
  twoFactorBackupCodes: '["abc"]',
  cpfCnpj: "123.456.789-00",
  email: "maria@exemplo.com",
  identityDocUrl: "https://cdn/rg.jpg",
  identitySelfieUrl: "https://cdn/selfie.jpg",
  lytexRecipientId: "rec_123",
  sessionVersion: 7,
  servicePolygon: { type: "Polygon" },
  travelFeePolicy: { perKm: 2 },
  deletedAt: null,
} as const

beforeEach(() => {
  vi.clearAllMocks()
  mockGetOptionalSession.mockResolvedValue(null)
  mockRequireUser.mockResolvedValue({ userId: "client-1", role: "CLIENT" })
})

// ---------------------------------------------------------------------------
// 1. /api/providers/[id] — público
// ---------------------------------------------------------------------------

describe("GET /api/providers/[id] — projeção pública", () => {
  it("consulta com select explícito e sem include", async () => {
    mockUserFindFirst.mockResolvedValue(providerRowFromSelect())

    await getProviderDetail(createMockRequest(), { params: Promise.resolve({ id: "prov-1" }) })

    const args = mockUserFindFirst.mock.calls[0][0] as { select?: object; include?: object }
    expect(args.include).toBeUndefined()
    expect(args.select).toBeTruthy()
  })

  it("não pede nenhuma coluna sensível ao banco", async () => {
    mockUserFindFirst.mockResolvedValue(providerRowFromSelect())

    await getProviderDetail(createMockRequest(), { params: Promise.resolve({ id: "prov-1" }) })

    const select = mockUserFindFirst.mock.calls[0][0].select as Record<string, unknown>
    for (const field of SENSITIVE_USER_FIELDS) {
      expect(select, `campo sensível "${field}" no select`).not.toHaveProperty(field)
    }
  })

  it("preserva o contrato de UI do ProviderDetail", async () => {
    mockUserFindFirst.mockResolvedValue(providerRowFromSelect())

    await getProviderDetail(createMockRequest(), { params: Promise.resolve({ id: "prov-1" }) })

    const select = mockUserFindFirst.mock.calls[0][0].select as Record<string, unknown>
    for (const field of [
      "id",
      "name",
      "slug",
      "avatarUrl",
      "coverUrl",
      "bio",
      "verified",
      "city",
      "district",
      "state",
      "cep",
      "whatsapp",
      "lat",
      "lng",
      "radiusKm",
      "avgRating",
      "reviewCount",
      "favoriteCount",
      "createdAt",
      "services",
      "availability",
      "reviewsReceived",
    ]) {
      expect(select, `campo de UI ausente: ${field}`).toHaveProperty(field)
    }
  })

  it("a resposta não contém credencial/PII mesmo que o banco devolva a linha inteira", async () => {
    // Defesa em profundidade: mesmo um mock "generoso" (linha completa, como um
    // `include` devolveria) não pode atravessar o `...safe` da rota.
    mockUserFindFirst.mockResolvedValue(
      providerRowFromSelect(sensitiveFixture as unknown as Record<string, unknown>),
    )

    const res = await getProviderDetail(createMockRequest(), {
      params: Promise.resolve({ id: "prov-1" }),
    })
    const parsed = await parseResponse(res)
    const body = parsed.body as Record<string, unknown>

    expect(parsed.status).toBe(200)
    for (const field of SENSITIVE_USER_FIELDS) {
      expect(body, `campo sensível "${field}" vazou na resposta`).not.toHaveProperty(field)
    }
    // O que a UI realmente usa continua presente
    expect(body).toHaveProperty("name", "Maria Silva")
    expect(body).toHaveProperty("whatsapp", "+5533999999999")
    expect(body).toHaveProperty("rating", 4.7)
    expect(body).toHaveProperty("distanceKm", null)
  })
})

// ---------------------------------------------------------------------------
// 2. /api/favorites — descreve terceiros para o cliente logado
// ---------------------------------------------------------------------------

describe("GET /api/favorites — projeção de terceiros", () => {
  it("projeta o provider com select explícito e sem include", async () => {
    mockFavoriteFindMany.mockResolvedValue([
      { provider: providerRowFromSelect(sensitiveFixture as unknown as Record<string, unknown>) },
    ])

    await getFavorites(createMockRequest())

    const args = mockFavoriteFindMany.mock.calls[0][0] as {
      select?: { provider?: { select?: object; include?: object } }
      include?: unknown
    }
    expect(args.include).toBeUndefined()
    const providerSelect = args.select?.provider
    expect(providerSelect).toBeTruthy()
    expect(providerSelect?.include).toBeUndefined()

    for (const field of SENSITIVE_USER_FIELDS) {
      expect(providerSelect?.select, `campo sensível "${field}" no select`).not.toHaveProperty(
        field,
      )
    }
    expect(providerSelect?.select).toHaveProperty("services")
  })

  it("a resposta não contém credencial/PII e mantém os campos da UI", async () => {
    mockFavoriteFindMany.mockResolvedValue([
      { provider: providerRowFromSelect(sensitiveFixture as unknown as Record<string, unknown>) },
    ])

    const res = await getFavorites(createMockRequest())
    const parsed = await parseResponse(res)
    const body = parsed.body as unknown as Array<Record<string, unknown>>

    expect(parsed.status).toBe(200)
    expect(body).toHaveLength(1)
    for (const field of SENSITIVE_USER_FIELDS) {
      expect(body[0], `campo sensível "${field}" vazou na resposta`).not.toHaveProperty(field)
    }
    expect(body[0]).toHaveProperty("name", "Maria Silva")
    expect(body[0]).toHaveProperty("rating", 4.7)
    expect(body[0]).toHaveProperty("distanceKm", null)
  })
})

// ---------------------------------------------------------------------------
// 3. Guard estático — o idioma "spread menos passwordHash" não pode voltar
// ---------------------------------------------------------------------------

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "__mocks__" || entry.name === "generated") {
        continue
      }
      collectSourceFiles(path, out)
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(path)
    }
  }
  return out
}

describe("guard estático: serialização de User", () => {
  it("nenhum arquivo de src/ usa `const { passwordHash: x, ...rest } = row`", () => {
    // Monta o padrão em pedaços para que o próprio arquivo de teste não se
    // auto-detecte (o literal completo apareceria na varredura).
    const pattern = new RegExp("passwordHash:" + "\\s*[\\w$]+\\s*,\\s*" + "\\.\\.\\.")
    const offenders = collectSourceFiles("src").filter((file) =>
      pattern.test(readFileSync(file, "utf8")),
    )

    expect(
      offenders,
      `Serialização por subtração de passwordHash encontrada em: ${offenders.join(", ")}. ` +
        "Use uma allowlist explícita do Prisma (PUBLIC_PROVIDER_SELECT / SESSION_USER_SELECT) " +
        "ou toSessionUser() — ver SENSITIVE_USER_FIELDS em src/lib/api-server.ts.",
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 3c. Guard estático — consulta de User com `include` (devolve toda coluna)
// ---------------------------------------------------------------------------
//
// O bug de 09/2026 não nasceu na serialização: nasceu em
// `db.user.findFirst({ include })`, que já traz cpfCnpj/e-mail/2FA/KYC para
// dentro do processo. A projeção da resposta fecha a saída; esta varredura fecha
// a entrada — inclusive em páginas SSR e sitemap, que não passam por um
// `check:pii-allowlist` de rota.

/** Remove comentários e literais preservando o comprimento (posições estáveis). */
function stripLiteralsAndComments(src: string): string {
  let out = ""
  let i = 0
  while (i < src.length) {
    const two = src.slice(i, i + 2)
    if (two === "//") {
      const end = src.indexOf("\n", i)
      const stop = end === -1 ? src.length : end
      out += " ".repeat(stop - i)
      i = stop
    } else if (two === "/*") {
      const end = src.indexOf("*/", i + 2)
      const stop = end === -1 ? src.length : end + 2
      out += src.slice(i, stop).replace(/[^\n]/g, " ")
      i = stop
    } else if (src[i] === '"' || src[i] === "'" || src[i] === "`") {
      const quote = src[i]
      let j = i + 1
      while (j < src.length && src[j] !== quote) {
        if (src[j] === "\\") j++
        j++
      }
      const stop = Math.min(j + 1, src.length)
      out += src.slice(i, stop).replace(/[^\n]/g, " ")
      i = stop
    } else {
      out += src[i]
      i++
    }
  }
  return out
}

/** Índice do delimitador que fecha o grupo aberto em `openIdx` (ou -1). */
function matchBalanced(src: string, openIdx: number): number {
  const open = src[openIdx]
  const close = open === "(" ? ")" : open === "{" ? "}" : "]"
  let depth = 0
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i]
    if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** `true` se `key` aparece como chave de PRIMEIRO nível do objeto `arg`. */
function hasTopLevelKey(arg: string, key: string): boolean {
  const re = new RegExp(`(?:^|[^\\w$.])${key}\\b`, "g")
  let m: RegExpExecArray | null
  while ((m = re.exec(arg))) {
    const keyStart = m.index + m[0].length - key.length
    let depth = 0
    for (let i = 0; i < keyStart; i++) {
      const c = arg[i]
      if (c === "{" || c === "(" || c === "[") depth++
      else if (c === "}" || c === ")" || c === "]") depth--
    }
    const after = arg.slice(keyStart + key.length)
    if (depth === 1 && /^\s*(:|,|\}|$)/.test(after)) return true
  }
  return false
}

const USER_QUERY_RE =
  /\b[A-Za-z_$][\w$]*\.user\.(findFirst|findUnique|findUniqueOrThrow|findFirstOrThrow|findMany|create|update|updateMany|upsert|delete|deleteMany|count|aggregate|groupBy)\s*\(/g

function findUserQueriesWithInclude(root: string): string[] {
  const offenders: string[] = []
  for (const file of collectSourceFiles(root)) {
    const raw = readFileSync(file, "utf8")
    // Opt-out explícito e auditável (nunca silencioso) para uso interno legítimo.
    if (raw.includes("pii-guard:allow-include")) continue
    const src = stripLiteralsAndComments(raw)
    USER_QUERY_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = USER_QUERY_RE.exec(src))) {
      const parenIdx = src.indexOf("(", m.index)
      const end = matchBalanced(src, parenIdx)
      if (end === -1) continue
      const arg = src.slice(parenIdx + 1, end)
      if (arg.trimStart()[0] !== "{") continue
      if (hasTopLevelKey(arg, "include")) offenders.push(`${file} → .user.${m[1]}({ include })`)
    }
  }
  return offenders
}

describe("guard estático: consulta de User sem projeção", () => {
  it("nenhum `.user.*({ include })` em src/ (devolve toda coluna escalar de User)", () => {
    const offenders = findUserQueriesWithInclude("src")

    expect(
      offenders,
      `Consulta de User com \`include\` encontrada em: ${offenders.join(" | ")}. ` +
        "Um `include` em User devolve TODA coluna escalar (cpfCnpj, email, phone, " +
        "twoFactorSecret, URLs de KYC) e foi exatamente essa a origem do vazamento de " +
        "09/2026. Use `select` explícito (PUBLIC_PROVIDER_SELECT / SESSION_USER_SELECT / " +
        "USER_PUBLIC_SELECT) ou marque a exceção com `pii-guard:allow-include`.",
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 3d. Guard estático — relação de User incluída sem `select`
// ---------------------------------------------------------------------------
//
// `booking.findUnique({ include: { provider: true, client: true } })` carrega
// DUAS linhas completas de User (CPF, e-mail, 2FA) só para ler o nome — o mesmo
// idioma do achado de 09/2026, um nível acima do `.user.*` direto. Foi esta
// varredura que encontrou os três casos reais em `src/lib/dispatch.ts`.

/** Campos que são relações para `User` em prisma/schema.prisma. */
const USER_RELATION_FIELDS = [
  "provider",
  "client",
  "user",
  "admin",
  "fromUser",
  "toUser",
  "updatedBy",
  "providers",
] as const

const PRISMA_CALL_RE =
  /\b[A-Za-z_$][\w$]*\.\w+\.(findFirst|findUnique|findUniqueOrThrow|findFirstOrThrow|findMany|create|update|updateMany|upsert|delete|deleteMany|count|aggregate|groupBy)\s*\(/g

/** Objeto literal que é valor de `key:` no PRIMEIRO nível de `arg` (ou null). */
function topLevelObjectFor(arg: string, key: string): string | null {
  const re = new RegExp(`(?:^|[^\\w$.])${key}\\s*:`, "g")
  let m: RegExpExecArray | null
  while ((m = re.exec(arg))) {
    const wordStart = m.index + m[0].indexOf(key)
    let depth = 0
    for (let i = 0; i < wordStart; i++) {
      const c = arg[i]
      if (c === "{" || c === "(" || c === "[") depth++
      else if (c === "}" || c === ")" || c === "]") depth--
    }
    if (depth !== 1) continue
    let j = m.index + m[0].length
    while (j < arg.length && /\s/.test(arg[j])) j++
    if (arg[j] !== "{") return null
    const end = matchBalanced(arg, j)
    return end === -1 ? null : arg.slice(j + 1, end)
  }
  return null
}

/**
 * Remove blocos `_count: { ... }` de uma projeção.
 *
 * `_count: { select: { providers: true } }` conta as linhas e devolve um NÚMERO —
 * não é a relação, então não pode ser confundido com um vazamento (foi o único
 * falso positivo que esta varredura produziu: admin/settlements/route.ts).
 */
function stripCountSelectors(src: string): string {
  let out = src
  for (;;) {
    const m = /(?:^|[^\w$.])_count\s*:\s*\{/.exec(out)
    if (!m) return out
    const braceIdx = m.index + m[0].length - 1
    const end = matchBalanced(out, braceIdx)
    if (end === -1) return out
    out = out.slice(0, m.index) + " ".repeat(end - m.index + 1) + out.slice(end + 1)
  }
}

function findIncludedUserRelations(root: string): string[] {
  const offenders: string[] = []
  for (const file of collectSourceFiles(root)) {
    const raw = readFileSync(file, "utf8")
    if (raw.includes("pii-guard:allow-user-relation")) continue
    const src = stripLiteralsAndComments(raw)
    PRISMA_CALL_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = PRISMA_CALL_RE.exec(src))) {
      const parenIdx = src.indexOf("(", m.index)
      const end = matchBalanced(src, parenIdx)
      if (end === -1) continue
      const arg = src.slice(parenIdx + 1, end)
      const rawProjection = topLevelObjectFor(arg, "include") ?? topLevelObjectFor(arg, "select")
      if (!rawProjection) continue
      const projection = stripCountSelectors(rawProjection)
      for (const field of USER_RELATION_FIELDS) {
        // `field: true` em qualquer profundidade da projeção = linha inteira de
        // User (inclusive aninhado, ex.: `services: { select: { provider: true } }`).
        if (new RegExp(`(?:^|[^\\w$.])${field}\\s*:\\s*true\\b`).test(projection)) {
          offenders.push(`${file} → \`${field}: true\` na projeção`)
        }
      }
    }
  }
  return offenders
}

describe("guard estático: relação de User sem projeção", () => {
  it("nenhuma projeção Prisma inclui uma relação de User com `true`", () => {
    const offenders = findIncludedUserRelations("src")

    expect(
      offenders,
      `Relação de User incluída sem projeção em: ${offenders.join(" | ")}. ` +
        "`provider: true` / `client: true` / `user: true` devolvem TODA coluna escalar de " +
        "User (cpfCnpj, email, phone, twoFactorSecret, URLs de KYC). Use " +
        "`{ select: { name: true } }` ou marque a exceção com " +
        "`pii-guard:allow-user-relation`.",
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 3b. Trava de compilação (exactShape) — verificada pelo `bun run typecheck`
// ---------------------------------------------------------------------------
//
// O TypeScript NÃO aplica excess property check em propriedades vindas de
// spread, então restringir só o tipo de destino não impede `{...linhaLarga}`.
// O `@ts-expect-error` abaixo é o teste do compilador: se a trava afrouxar, o
// tsc passa a reportar "Unused '@ts-expect-error' directive" e o typecheck falha.

type Body = PublicProviderPayload & { rating: number }

describe("trava de compilação: exactShape", () => {
  it("aceita o payload projetado e rejeita o spread da linha larga", () => {
    const wide = providerRowFromSelect(sensitiveFixture as unknown as Record<string, unknown>)
    const projected = toPublicProvider(wide)

    const ok = exactShape<Body>()({ ...projected, rating: 4.5 })
    expect(ok.rating).toBe(4.5)
    expect(ok).not.toHaveProperty("cpfCnpj")
    expect(ok).not.toHaveProperty("twoFactorSecret")

    // @ts-expect-error — espalhar a linha larga (cpfCnpj/email/2FA) não compila
    const leak = exactShape<Body>()({ ...wide, rating: 4.5 })
    // Se o compilador deixasse passar, o vazamento estaria de volta:
    expect(leak).toBeDefined()
  })

  it("continua aceitando um objeto estritamente mais estreito", () => {
    const projected = toPublicProvider(providerRowFromSelect())
    const { name, whatsapp } = exactShape<PublicProviderPayload>()(projected)
    expect(name).toBe("Maria Silva")
    expect(whatsapp).toBe("+5533999999999")
  })
})

// ---------------------------------------------------------------------------
// 4. toSessionUser — usado por login/registro
// ---------------------------------------------------------------------------

describe("toSessionUser", () => {
  it("projeta a linha inteira para a identidade pública do próprio usuário", () => {
    const projected = toSessionUser({
      ...(sensitiveFixture as unknown as Record<string, unknown>),
      id: "user-1",
      name: "João",
      email: "joao@exemplo.com",
      role: "CLIENT",
    } as never) as unknown as Record<string, unknown>

    // `email` é o e-mail DO PRÓPRIO usuário (a identidade de sessão precisa
    // dele); credenciais e documentos de KYC nunca entram.
    const mustNotAppear = SENSITIVE_USER_FIELDS.filter((f) => f !== "email")
    for (const field of mustNotAppear) {
      expect(projected, `campo sensível "${field}" na identidade de sessão`).not.toHaveProperty(
        field,
      )
    }
    expect(projected).toEqual({
      id: "user-1",
      name: "João",
      email: "joao@exemplo.com",
      role: "CLIENT",
      avatarUrl: null,
      verified: false,
      twoFactorEnabled: false,
      identityStatus: null,
    })
  })
})
