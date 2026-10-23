/**
 * Suíte E2E do bridge /emit do mini-service realtime — o serviço REAL sobe
 * como processo bun (porta livre via PORT, Redis apontado para buraco
 * negro: o adapter só publica, nada no caminho da resposta o exige) e a
 * suíte exercita o contrato HTTP por cima do processo vivo:
 *
 *   200 — chave correta + evento conhecido  → { ok: true, event }
 *   401 — chave errada OU header ausente    → { ok: false, error: "unauthorized" }
 *   503 — serviço SEM chave configurada     → { ok: false, error: "...not configured" }
 *         (dev: produção nem sobe sem chave — fail-closed do boot)
 *
 * O 200 roda com NODE_ENV=production de propósito: prova que o boot em
 * produção COM a chave (via env direta; nos composes ela entra por secret +
 * _FILE, ver check-realtime-emit-key-source) serve o bridge autenticado.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawn, type ChildProcess } from "node:child_process"
import { createServer as createNetServer } from "node:net"
import { join } from "node:path"

const ROOT = process.cwd()
const SERVICE = join(ROOT, "mini-services", "realtime", "index.ts")
const SERVICE_DIR = join(ROOT, "mini-services", "realtime")

/** bun que executa a suíte (vitest roda sob bun no repo); fallback no PATH. */
const BUN = process.versions.bun ? process.execPath : "bun"

/** Porta efêmera livre (race de TOCTOU é aceitável em teste local). */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer()
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number }
      srv.close(() => (port ? resolve(port) : reject(new Error("porta inválida"))))
    })
    srv.on("error", reject)
  })
}

let proc: ChildProcess | undefined
let stderrBuf = ""

/** Sobe o serviço real numa porta livre e espera o /health responder. */
async function startService(env: Record<string, string>): Promise<string> {
  const port = await getFreePort()
  const url = `http://127.0.0.1:${port}`
  stderrBuf = ""
  proc = spawn(BUN, [SERVICE], {
    cwd: SERVICE_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      // Redis inexistente: ioredis fica em retry em background; o /health e
      // o /emit respondem sem ele (o adapter só publica, fire-and-forget).
      REDIS_URL: "redis://127.0.0.1:6390",
      ...env,
    },
    stdio: ["ignore", "ignore", "pipe"],
  })
  proc.stderr?.on("data", (chunk: Buffer) => {
    stderrBuf = (stderrBuf + String(chunk)).slice(-2000)
  })
  await waitForHealth(url)
  return url
}

function waitForHealth(url: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  return (async function poll(): Promise<void> {
    while (Date.now() < deadline) {
      if (proc && proc.exitCode !== null) {
        throw new Error(`serviço morreu antes do /health (exit ${proc.exitCode}):\n${stderrBuf}`)
      }
      try {
        const res = await fetch(`${url}/health`)
        if (res.ok) return
      } catch {
        // ainda não escutou — retry
      }
      await new Promise((r) => setTimeout(r, 200))
    }
    throw new Error(`realtime não subiu em ${url} (${timeoutMs}ms):\n${stderrBuf}`)
  })()
}

type EmitResponse = { ok?: boolean; event?: string; error?: string }

async function postEmit(
  url: string,
  body: string,
  apiKey?: string,
): Promise<{ status: number; json: EmitResponse }> {
  const res = await fetch(`${url}/emit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey !== undefined ? { "x-api-key": apiKey } : {}),
    },
    body,
  })
  return { status: res.status, json: (await res.json()) as EmitResponse }
}

beforeEach(() => {
  proc = undefined
  stderrBuf = ""
})

afterEach(() => {
  proc?.kill("SIGTERM")
  proc = undefined
})

describe("E2E /emit — serviço real (bun, porta livre)", () => {
  it("200: produção com chave aceita evento conhecido e ecoa {ok:true, event}", async () => {
    const url = await startService({
      NODE_ENV: "production",
      REALTIME_EMIT_API_KEY: "e2e-key-".padEnd(32, "0"),
    })
    const res = await postEmit(
      url,
      JSON.stringify({ event: "notification:new", data: { toId: "user-e2e" } }),
      "e2e-key-".padEnd(32, "0"),
    )
    expect(res.status).toBe(200)
    expect(res.json).toEqual({ ok: true, event: "notification:new" })
  }, 30_000)

  it("401: chave errada OU header x-api-key ausente — mesmo com o serviço autenticado", async () => {
    const url = await startService({
      NODE_ENV: "production",
      REALTIME_EMIT_API_KEY: "e2e-key-".padEnd(32, "0"),
    })
    const errada = await postEmit(
      url,
      JSON.stringify({ event: "notification:new", data: { toId: "u" } }),
      "chave-invalida",
    )
    expect(errada.status).toBe(401)
    expect(errada.json).toEqual({ ok: false, error: "unauthorized" })

    const ausente = await postEmit(
      url,
      JSON.stringify({ event: "notification:new", data: { toId: "u" } }),
    )
    expect(ausente.status).toBe(401)
    expect(ausente.json).toEqual({ ok: false, error: "unauthorized" })
  }, 30_000)

  it("503: serviço sem chave configurada mantém /emit FECHADO (fail-closed, dev)", async () => {
    const url = await startService({ NODE_ENV: "development" })
    const comChave = await postEmit(
      url,
      JSON.stringify({ event: "notification:new", data: { toId: "u" } }),
      "qualquer-chave",
    )
    expect(comChave.status).toBe(503)
    expect(comChave.json.error).toContain("REALTIME_EMIT_API_KEY not configured")

    const semHeader = await postEmit(
      url,
      JSON.stringify({ event: "notification:new", data: { toId: "u" } }),
    )
    expect(semHeader.status).toBe(503)
  }, 30_000)
})
