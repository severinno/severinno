/**
 * Testes de scripts/check-route-handler-style.mjs — a invariante do ESTILO dos
 * route handlers: todo handler HTTP de `route.ts` usa o wrapper
 * withRoute/withParams (src/lib/api-route.ts); handler com try/catch +
 * handleError MANUAL reprova, salvo isenção viva na ALLOWLIST (addedAt +
 * reason, mesma régua de scripts/allowlist-review.mjs).
 *
 * A CLI real é exercida contra o REPO REAL (exit 0 — o congelamento do legado
 * está completo hoje; --list casa 1:1 com a ALLOWLIST) e contra FIXTURES em
 * tmp (cada regra violada), seguindo a convenção dos testes de check-*-cli.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { reviewAddedAtEntries } from "../../../scripts/allowlist-review.mjs"
import {
  collectViolations,
  extractHandlers,
  stripComments,
  ALLOWLIST,
  HTTP_METHODS,
  ROUTE_HANDLER_STYLE_REVIEW_DAYS,
} from "../../../scripts/check-route-handler-style.mjs"

const GUARD = join(process.cwd(), "scripts", "check-route-handler-style.mjs")

// ── helpers de fixture ──────────────────────────────────────────────────────

let dir: string

/** Handler manual canônico (o padrão que o guard reprova fora da allowlist). */
const MANUAL = (method: string, extra = "") => `
import { NextResponse } from "next/server"
import { handleError } from "@/lib/api-server"
export async function ${method}(request: Request) {
  try {
    ${extra}
    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleError(e)
  }
}
`

/** Arquivo com VÁRIOS handlers manuais (rotas com GET+POST allowlistados). */
const MANUAL_FILE = (handlers: string[]) => `
import { NextResponse } from "next/server"
import { handleError } from "@/lib/api-server"
${handlers
  .map(
    (m) => `
export async function ${m}(request: Request) {
  try {
    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleError(e)
  }
}
`,
  )
  .join("\n")}
`

/** Handler wrappado canônico (o desenho aprovado). */
const WRAPPED = (method: string) => `
import { withRoute } from "@/lib/api-route"
export const ${method} = withRoute("api.fixture.${method}", async () => {
  return Response.json({ ok: true })
})
`

beforeEach(() => {
  dir = join(tmpdir(), `route-style-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  // Árvore sintética: cada ROTA ganha UM arquivo com TODOS os handlers que a
  // sua ALLOWLIST isenta (rotas com GET+POST têm as duas entradas) — se a
  // varredura e a lista casarem 1:1, zero violação.
  const byRoute = new Map<string, string[]>()
  for (const entry of ALLOWLIST) {
    const handlers = byRoute.get(entry.route) ?? []
    handlers.push(entry.handler)
    byRoute.set(entry.route, handlers)
  }
  for (const [route, handlers] of byRoute) {
    const file = join(dir, route)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, MANUAL_FILE(handlers))
  }
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

const runCli = (args: string[]) => spawnSync("node", [GUARD, ...args], { encoding: "utf8" })

// ── unidades do scanner ─────────────────────────────────────────────────────

describe("stripComments", () => {
  it("remove linha inteira e inline, preserva `//` dentro de string", () => {
    const src = [
      "// comentário de topo",
      "export async function GET() {",
      '  const url = "http://x/y" // anotação',
      "  return url",
      "}",
    ].join("\n")
    const out = stripComments(src)
    expect(out).not.toContain("comentário")
    expect(out).not.toContain("anotação")
    expect(out).toContain('"http://x/y"')
  })
})

describe("extractHandlers", () => {
  it("reconhece function-decl e const-arrow; métodos HTTP cobertos", () => {
    const src = ["export async function GET() {}", "export const POST = async () => {}"].join("\n")
    const names = extractHandlers(src).map((h) => h.name)
    expect(names).toEqual(["GET", "POST"])
    expect(HTTP_METHODS).toContain("PATCH")
  })

  it("handler WRAPPED (= withRoute/withParams) não gera corpo escaneável", () => {
    const src = `export const GET = withRoute("api.x.GET", async () => { try {} catch (e) { return handleError(e) } })`
    const [h] = extractHandlers(src)
    expect(h.wrapped).toBe(true)
  })

  it("corpo com anotação de tipo (`Promise<{ id: string }>`) não engana o scanner", () => {
    const src = `
export async function GET(request: Request): Promise<{ id: string }> {
  try {
    return Response.json({ id: "x" })
  } catch (e) {
    return handleError(e)
  }
}
`
    const [h] = extractHandlers(src)
    expect(h.wrapped).toBe(false)
    expect(h.body).toContain("handleError")
  })

  it("handleError só em COMENTÁRIO não é chamada (catch custom sem mapping não reprova)", () => {
    const src = `
export async function GET(request: Request) {
  try {
    return Response.json({ ok: true })
  } catch (e) {
    // intencional: NÃO chame handleError(e) aqui — resposta custom degradada
    return Response.json({ ok: false, degraded: true })
  }
}
`
    const [h] = extractHandlers(src)
    expect(/\btry\s*{/.test(h.body)).toBe(true)
    expect(/\bhandleError\s*\(/.test(h.body)).toBe(false)
  })
})

// ── collectViolations — cada regra contra a árvore sintética ────────────────

describe("collectViolations — desenhos sancionados e violações", () => {
  it("árvore sintética onde a ALLOWLIST cobre EXATAMENTE a varredura → []", () => {
    expect(collectViolations(dir)).toEqual([])
  })

  it("handler manual FORA da allowlist → violação nomeando rota, handler e remédio", () => {
    const file = join(dir, "src/app/api/nova-features/route.ts")
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, MANUAL("POST"))
    const v = collectViolations(dir)
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("src/app/api/nova-features/route.ts (POST)")
    expect(v[0]).toContain("withRoute/withParams")
    expect(v[0]).toContain("ALLOWLIST")
  })

  it("handler wrappado novo não reprova (a migração é a saída honrada)", () => {
    const file = join(dir, "src/app/api/migrada/route.ts")
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, WRAPPED("GET"))
    expect(collectViolations(dir)).toEqual([])
  })

  it("rota allowlistada MIGRADA → entrada ociosa é violação (a lista encolhe)", () => {
    // Rota com UMA entrada só: a migração dela gera exatamente UMA ociosa.
    const entry = ALLOWLIST.find((e) => ALLOWLIST.filter((o) => o.route === e.route).length === 1)!
    writeFileSync(join(dir, entry.route), WRAPPED(entry.handler))
    const v = collectViolations(dir)
    expect(v).toHaveLength(1)
    expect(v[0]).toContain(`${entry.route} ${entry.handler}`)
    expect(v[0]).toContain("OCIOSA")
  })

  it("handler allowlistado REMOVIDO (arquivo sem o método) → entrada ociosa", () => {
    const entry = ALLOWLIST.find((e) => e.handler !== "GET")!
    writeFileSync(join(dir, entry.route), MANUAL("PUT")) // outro método
    const v = collectViolations(dir)
    expect(
      v.some((x) => x.includes("OCIOSA") && x.includes(`${entry.route} ${entry.handler}`)),
    ).toBe(true)
  })

  it("catch custom SEM handleError (intencional, resposta própria) não reprova", () => {
    const file = join(dir, "src/app/api/stream-custom/route.ts")
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(
      file,
      `
export async function GET(request: Request) {
  try {
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ ok: false }, { status: 503 })
  }
}
`,
    )
    expect(collectViolations(dir)).toEqual([])
  })

  it("src/app/api inexistente e árvore sem route.ts são INFRA (fail-closed — lança)", () => {
    const vazio = join(dir, "vazio")
    mkdirSync(vazio, { recursive: true })
    expect(() => collectViolations(vazio)).toThrow(/fail-closed/)

    const semRoutes = join(dir, "sem-routes")
    mkdirSync(join(semRoutes, "src/app/api"), { recursive: true })
    expect(() => collectViolations(semRoutes)).toThrow(/nenhum route\.ts/)
  })
})

// ── addedAt: a régua compartilhada (scripts/allowlist-review.mjs) ───────────

describe("addedAt — decisão registrada e janela de revisão", () => {
  it("toda entrada da ALLOWLIST tem addedAt válido (hoje, no repo real)", () => {
    const { invalid, aged } = reviewAddedAtEntries(ALLOWLIST, {
      idOf: (e: { route: string; handler: string }) => `${e.route} ${e.handler}`,
    })
    expect(invalid).toEqual([])
    expect(aged).toEqual([])
  })

  it("janela vencida vira violação com --review e ::warning:: no run normal", () => {
    const now = Date.now() + (ROUTE_HANDLER_STYLE_REVIEW_DAYS + 10) * 86_400_000
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    const revisao = collectViolations(dir, { now, review: true })
    expect(revisao.some((v) => v.includes("decisão vencida"))).toBe(true)

    const normal = collectViolations(dir, { now, review: false })
    expect(normal.some((v) => v.includes("decisão vencida"))).toBe(false)
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("::warning::"))).toBe(true)
  })
})

// ── CLI contra o REPO REAL ──────────────────────────────────────────────────

describe("check-route-handler-style — CLI (repo real)", () => {
  it("exit 0: o congelamento do legado cobre todos os pares de hoje", () => {
    const res = runCli([])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("✅")
    expect(res.stdout).toContain("withRoute/withParams")
  })

  it("--list casa 1:1 com a ALLOWLIST (nenhum par de fora, nenhuma entrada ociosa)", () => {
    const res = runCli(["--list"])
    expect(res.status).toBe(0)
    const listed = res.stdout
      .trim()
      .split("\n")
      .filter((l) => l.startsWith("src/app/api/"))
      .map((l) => l.trim())
    const allowed = ALLOWLIST.map((e) => `${e.route} ${e.handler}`).sort()
    expect([...listed].sort()).toEqual(allowed)
  })

  it("--json no repo real: ok:true", () => {
    const res = runCli(["--json"])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout) as { ok: boolean; violations: string[] }
    expect(parsed.ok).toBe(true)
    expect(parsed.violations).toEqual([])
  })

  it("--help sai 0 e documenta o contrato; flag desconhecida sai 3", () => {
    const help = runCli(["--help"])
    expect(help.status).toBe(0)
    expect(help.stdout).toContain("Usage:")
    expect(help.stdout).toContain("Exit codes:")
    expect(runCli(["--wat"]).status).toBe(3)
  })
})

// ── CLI contra FIXTURES ─────────────────────────────────────────────────────

describe("check-route-handler-style — CLI (fixtures)", () => {
  it("árvore sintética → exit 0; violação nova → exit 1 com remédio", () => {
    expect(runCli(["--root", dir]).status).toBe(0)

    const file = join(dir, "src/app/api/reprovada/route.ts")
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, MANUAL("DELETE"))
    const res = runCli(["--root", dir])
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("reprovada/route.ts (DELETE)")
    expect(res.stderr).toContain("Remédio")
  })

  it("--json na violação carrega a lista estruturada", () => {
    const file = join(dir, "src/app/api/json-mode/route.ts")
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, MANUAL("GET"))
    const res = runCli(["--root", dir, "--json"])
    expect(res.status).toBe(1)
    const parsed = JSON.parse(res.stdout) as { ok: boolean; violations: string[] }
    expect(parsed.ok).toBe(false)
    expect(parsed.violations[0]).toContain("json-mode/route.ts (GET)")
  })

  it("infra (sem src/app/api) sai 2", () => {
    mkdirSync(join(dir, "vazio"), { recursive: true })
    const res = runCli(["--root", join(dir, "vazio")])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain("infra")
  })
})
