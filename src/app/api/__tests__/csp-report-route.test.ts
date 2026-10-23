/**
 * Tests for GET /api/csp-report — painel do rollout da CSP.
 *
 * A rota agrega violações (type: "csp-violation") lidas dos logs do container
 * via `docker logs` (execFile mockado) e recomenda o passo de rollout:
 *   - zero violações bloqueantes (script-src/object-src/base-uri/
 *     frame-ancestors) → readyToEnforce = true;
 *   - qualquer blocker → permanecer em Report-Only e investigar.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { readContainerLogs } = vi.hoisted(() => ({ readContainerLogs: vi.fn() }))

// Parser e agregação continuam REAIS (são puros e são o objeto do teste);
// só a leitura de docker logs é mockada.
vi.mock("@/lib/csp-logs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/csp-logs")>()),
  readContainerLogs,
}))

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
  AuthError: class AuthError extends Error {
    code: string
    constructor(code: string) {
      super(code)
      this.name = "AuthError"
      this.code = code
    }
  },
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { GET } from "../csp-report/route"
import { parseCspLogs, aggregateCspViolations, summarizeStyleViolations } from "@/lib/csp-logs"
import { requireRole, AuthError } from "@/lib/auth"

/** Linha de log no formato que o Pino imprime no stdout do container. */
function logLine(o: Record<string, unknown>): string {
  return JSON.stringify({ level: 30, time: 1_727_800_000_000, ...o })
}

function violation(overrides: Record<string, unknown> = {}, time = 1_727_800_000_000): string {
  return logLine({
    type: "csp-violation",
    time,
    directive: "script-src",
    blockedUri: "https://evil.example/x.js",
    documentUri: "https://severinno.com.br/checkout",
    msg: "CSP violation report",
    ...overrides,
  })
}

function req(query = ""): Request {
  return new Request(`http://localhost:3000/api/csp-report${query}`)
}

/** Resolve readContainerLogs com stdout/stderr. */
function mockLogs(stdout: string, stderr = ""): void {
  readContainerLogs.mockResolvedValue({ stdout, stderr })
}

/** Rejeita readContainerLogs (docker ausente / sem permissão). */
function mockLogsError(message: string): void {
  readContainerLogs.mockRejectedValue(new Error(message))
}

// ── parseCspLogs (puro) ────────────────────────────────────────────────────

describe("parseCspLogs", () => {
  it("extrai apenas registros com type csp-violation", () => {
    const raw = [
      "log solto não-JSON",
      logLine({ type: "http-request", msg: "GET /api/x" }),
      violation(),
      "{json quebrado",
      violation(
        { directive: "img-src", blockedUri: "https://img.example/a.png" },
        1_727_800_060_000,
      ),
    ].join("\n")

    const parsed = parseCspLogs(raw)

    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toMatchObject({
      directive: "script-src",
      blockedUri: "https://evil.example/x.js",
      time: 1_727_800_000_000,
    })
    expect(parsed[1]?.directive).toBe("img-src")
  })

  it("aceita time em ISO string e defaulta campos ausentes", () => {
    const parsed = parseCspLogs(
      JSON.stringify({ type: "csp-violation", time: "2026-10-01T12:00:00.000Z" }),
    )

    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.time).toBe(Date.parse("2026-10-01T12:00:00.000Z"))
    expect(parsed[0]?.directive).toBe("unknown")
    expect(parsed[0]?.blockedUri).toBe("unknown")
  })
})

// ── aggregateCspViolations (puro) ──────────────────────────────────────────

describe("aggregateCspViolations", () => {
  it("agrega por diretiva/origem/documento e marca blockers", () => {
    const violations = parseCspLogs(
      [
        violation({}, 1_000),
        violation({}, 2_000), // mesma origem bloqueada da 1ª (2× evil.example)
        violation({ directive: "object-src", blockedUri: "https://evil.example/o.swf" }, 3_000),
        violation({ directive: "img-src", blockedUri: "https://img.cdn/a.png" }, 4_000),
      ].join("\n"),
    )

    const agg = aggregateCspViolations(violations, { windowHours: 24 }) as Record<string, unknown>

    expect(agg.total).toBe(4)
    expect(agg.windowHours).toBe(24)

    const byDirective = agg.byDirective as Array<{ directive: string; count: number }>
    expect(byDirective.find((d) => d.directive === "script-src")?.count).toBe(2)
    expect(byDirective.find((d) => d.directive === "object-src")?.count).toBe(1)

    const blocking = agg.blockingViolations as Array<{ directive: string }>
    expect(blocking.map((b) => b.directive).sort()).toEqual(["object-src", "script-src"])

    const sources = agg.topBlockedSources as Array<{ blockedUri: string; count: number }>
    expect(sources[0]?.count).toBe(2) // https://evil.example/x.js (2×)
    expect(sources).toHaveLength(3)

    expect((agg.observed as { first: string }).first).toBe(new Date(1_000).toISOString())
    expect((agg.observed as { last: string }).last).toBe(new Date(4_000).toISOString())

    const rollout = agg.rollout as { readyToEnforce: boolean; blockingCount: number }
    expect(rollout.readyToEnforce).toBe(false)
    expect(rollout.blockingCount).toBe(3)
  })

  it("sem violações → readyToEnforce=true (critério do plano de rollout)", () => {
    const agg = aggregateCspViolations([], { windowHours: 24 }) as Record<string, unknown>

    expect(agg.total).toBe(0)
    expect((agg.rollout as { readyToEnforce: boolean }).readyToEnforce).toBe(true)
    expect((agg.observed as { first: string | null }).first).toBeNull()
  })

  it("violação só de diretriz não-bloqueante (img-src) NÃO impede o enforce", () => {
    const violations = parseCspLogs(violation({ directive: "img-src" }))
    const agg = aggregateCspViolations(violations, { windowHours: 24 }) as Record<string, unknown>

    expect((agg.rollout as { readyToEnforce: boolean }).readyToEnforce).toBe(true)
    expect(agg.blockingViolations).toEqual([])
  })
})

// ── summarizeStyleViolations (puro) ───────────────────────────────────────

function sv(
  directive: string,
  blockedUri: string,
  documentUri: string,
  time: number,
): { time: number; directive: string; blockedUri: string; documentUri: string } {
  return { time, directive, blockedUri, documentUri }
}

describe("summarizeStyleViolations", () => {
  it("separa ATTR (dívida style={{}}) de ELEM (defeito imediato) com top documentos", () => {
    const s = summarizeStyleViolations([
      sv("style-src-attr", "inline", "https://x/admin", 1),
      sv("style-src-attr", "inline", "https://x/checkout", 2),
      sv("style-src-attr", "inline", "https://x/admin", 3),
      sv("style-src-elem", "inline", "https://x/erro", 4),
      sv("script-src", "https://evil/x.js", "https://x/y", 5), // fora da família
    ] as never) as Record<string, Record<string, unknown>>

    expect(s.attr?.count).toBe(3)
    expect(s.elem?.count).toBe(1)
    expect(s.attr?.topDocuments).toEqual([
      { documentUri: "https://x/admin", count: 2 },
      { documentUri: "https://x/checkout", count: 1 },
    ])
    expect(s.elem?.topDocuments).toEqual([{ documentUri: "https://x/erro", count: 1 }])
    // A ação orienta a RODADA certa para cada família.
    expect(String(s.attr?.action)).toContain("STYLE_MIGRATION_PLAN")
    expect(String(s.elem?.action)).toContain("check:inline-style")
  })

  it("topBlocked ordena por frequência (a origem repetida vem primeiro)", () => {
    const s = summarizeStyleViolations([
      sv("style-src-attr", "inline", "https://x/a", 1),
      sv("style-src-attr", "https://cdn.example/widget.js", "https://x/a", 2),
      sv("style-src-attr", "https://cdn.example/widget.js", "https://x/b", 3),
    ] as never) as Record<string, Record<string, unknown>>

    expect(s.attr?.topBlocked).toEqual([
      { blockedUri: "https://cdn.example/widget.js", count: 2 },
      { blockedUri: "inline", count: 1 },
    ])
  })

  it("sem violações de estilo → zeros e listas vazias (painel segue coerente)", () => {
    const s = summarizeStyleViolations([
      sv("script-src", "https://evil/x.js", "https://x/y", 1),
    ] as never) as Record<string, Record<string, unknown>>

    expect(s.attr?.count).toBe(0)
    expect(s.attr?.topBlocked).toEqual([])
    expect(s.attr?.topDocuments).toEqual([])
    expect(s.elem?.count).toBe(0)
  })
})

// ── GET /api/csp-report ────────────────────────────────────────────────────

describe("GET /api/csp-report", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireRole).mockResolvedValue({
      userId: "admin-1",
      role: "ADMIN",
      email: "a@a.com",
      name: "Admin",
    } as never)
  })

  it("403 para não-admin", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new AuthError("FORBIDDEN"))

    const res = await GET(req())

    expect(res.status).toBe(403)
    expect(readContainerLogs).not.toHaveBeenCalled()
  })

  it("200 com agregação das violações lidas do docker logs", async () => {
    mockLogs(
      [
        violation({}, 1_727_800_000_000),
        violation({}, 1_727_800_060_000),
        violation(
          { directive: "style-src", blockedUri: "https://font.example" },
          1_727_800_120_000,
        ),
        "ruído",
      ].join("\n"),
    )

    const res = await GET(req())
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(body.total).toBe(3)

    const rollout = body.rollout as { readyToEnforce: boolean; blockingCount: number }
    expect(rollout.readyToEnforce).toBe(false)
    expect(rollout.blockingCount).toBe(2)

    expect(readContainerLogs).toHaveBeenCalledWith(300, "app")
  })

  it("styleSummary no corpo: separa attr de elem para orientar o endurecimento", async () => {
    mockLogs(
      [
        violation(
          {
            directive: "style-src-attr",
            blockedUri: "inline",
            documentUri: "https://severinno.com.br/admin",
          },
          1_727_800_000_000,
        ),
        violation(
          {
            directive: "style-src-attr",
            blockedUri: "inline",
            documentUri: "https://severinno.com.br/vitrine",
          },
          1_727_800_060_000,
        ),
        violation(
          {
            directive: "style-src-elem",
            blockedUri: "inline",
            documentUri: "https://severinno.com.br/checkout",
          },
          1_727_800_120_000,
        ),
      ].join("\n"),
    )

    const res = await GET(req())
    const body = (await res.json()) as Record<string, unknown>
    const style = body.styleSummary as Record<string, Record<string, unknown>>

    expect(style.attr?.count).toBe(2)
    expect(style.elem?.count).toBe(1)
    expect(style.attr?.topDocuments).toEqual([
      { documentUri: "https://severinno.com.br/admin", count: 1 },
      { documentUri: "https://severinno.com.br/vitrine", count: 1 },
    ])
    expect(String(style.attr?.action)).toContain("STYLE_MIGRATION_PLAN")
  })

  it("sanitiza params: lines não-numérico/estourado cai no limite e container valida regex", async () => {
    mockLogs("")

    await GET(req("?lines=999999&container=app%3B%20rm%20-rf")) // "app; rm -rf"

    expect(readContainerLogs).toHaveBeenCalledWith(5000, "app")
  })

  it("log sem violações → readyToEnforce true e log de diagnóstico", async () => {
    mockLogs(logLine({ type: "http-request", msg: "GET /" }))

    const res = await GET(req())
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.total).toBe(0)
    expect((body.rollout as { readyToEnforce: boolean }).readyToEnforce).toBe(true)
  })

  it("docker logs indisponível → 200 com diagnostics (não quebra o painel)", async () => {
    mockLogsError("spawn docker ENOENT")

    const res = await GET(req())
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.total).toBe(0)
    const diagnostics = body.diagnostics as { dockerLogsError?: string }
    expect(diagnostics.dockerLogsError).toContain("ENOENT")
  })
})
