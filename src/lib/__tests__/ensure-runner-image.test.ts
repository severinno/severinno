// =============================================================================
// ensure-runner-image.test.ts
//
// Testes do scripts/ensure-runner-image.mjs — o comando que GARANTE a imagem do
// runner no registry antes do compose subir o act_runner.
//
// O que estes testes precisam provar (não é "roda sem erro"):
//   1. os TRÊS estados são distintos — existe / ausente / indeterminado — e
//      "não sei" NUNCA publica (publicar sobre um erro de permissão mascara a
//      causa e pode empurrar imagem por cima de um problema de credencial);
//   2. a garantia é a RELEITURA: publicação que "deu certo" e registry que
//      discorda → falha (exit 5), não sucesso otimista;
//   3. o fluxo HTTP de verdade funciona: registry Bearer (401 → challenge →
//      token → 200/403), 404 e queda de conexão — validado contra um registry
//      FAKE real (node:http) e não só com fetch injetado;
//   4. a CLI real devolve os exit codes que o deploy/gitea-up.sh usa como
//      contrato (0/2/3/4/5);
//   5. o cache da identidade do doctor deduplica a MESMA pergunta (os dois fatos
//      perguntam com timeouts diferentes — se o timeout entrasse na chave, o
//      cache seria decorativo) sem transformar indisponibilidade passageira em
//      resposta permanente.
//
// Usage:
//   bunx vitest run --config vitest.config.unit.ts src/lib/__tests__/ensure-runner-image.test.ts
// =============================================================================

import { spawn } from "node:child_process"
import { createServer, type Server } from "node:http"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  DEFAULT_ENV_FILE,
  EXIT,
  checkTagExists,
  choosePublishSource,
  createRegistryIdentityCache,
  ensureRunnerImage,
  parseArgs,
  parseEnvFile,
  registryEndpoints,
  resolveImageRef,
  verifyWithDocker,
} from "../../../scripts/ensure-runner-image.mjs"

const ROOT = process.cwd()
const SCRIPT = join(ROOT, "scripts", "ensure-runner-image.mjs")

const tmpDirs: string[] = []

function makeTmp(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ensure-img-${name}-`))
  tmpDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Escreve um env do compose num arquivo temporário e devolve o caminho. */
function makeEnvFile(values: Record<string, string>): string {
  const path = join(makeTmp("env"), "gitea.env")
  const body = Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")
  writeFileSync(path, `${body}\n`)
  return path
}

// ── Registry FAKE (HTTP real) ───────────────────────────────────────────────

type RegistryMode = "exists" | "missing" | "private" | "drop"

interface FakeRegistry {
  url: string
  port: string
  hits: string[]
  close: () => Promise<void>
}

/**
 * Sobe um registry OCI mínimo em 127.0.0.1:<porta aleatória>.
 *   exists  → 200 no manifesto
 *   missing → 404
 *   private → 401 com `WWW-Authenticate` (Bearer) → /token responde um token →
 *             o manifesto com o token volta 403 (pacote não público)
 *   drop    → derruba a conexão (registry inalcançável)
 */
function startRegistry(mode: RegistryMode): Promise<FakeRegistry> {
  const hits: string[] = []
  const server: Server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`)
    const url = req.url ?? ""
    const addr = server.address()
    const port = typeof addr === "object" && addr ? addr.port : 0

    if (url.startsWith("/token")) {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ token: "anon-token" }))
      return
    }
    if (mode === "drop") {
      req.socket.destroy()
      return
    }
    if (mode === "missing") {
      res.writeHead(404, { "content-type": "application/json" })
      res.end("{}")
      return
    }
    if (mode === "private") {
      if (req.headers.authorization === "Bearer anon-token") {
        res.writeHead(403)
        res.end("{}")
        return
      }
      res.writeHead(401, {
        "www-authenticate": `Bearer realm="http://127.0.0.1:${port}/token",service="fake",scope="repository:severinno/ubuntu-bun:pull"`,
      })
      res.end("{}")
      return
    }
    res.writeHead(200, { "content-type": "application/vnd.oci.image.manifest.v1+json" })
    res.end(req.method === "HEAD" ? undefined : "{}")
  })

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      const port = typeof addr === "object" && addr ? String(addr.port) : "0"
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        hits,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

// ── fetch / run fake (orquestração) ────────────────────────────────────────

interface FakeResponse {
  status: number
  ok: boolean
  headers: { get: (name: string) => string | null }
}

function fakeResponse(status: number, headers: Record<string, string> = {}): FakeResponse {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
  }
}

/** fetch que devolve respostas em sequência (a última repete). */
function sequenceFetch(steps: Array<FakeResponse | Error>) {
  let i = 0
  return async () => {
    const step = steps[Math.min(i++, steps.length - 1)]
    if (step instanceof Error) throw step
    return step
  }
}

interface RunCall {
  cmd: string
  args: string[]
}

interface FakeRunOptions {
  docker?: boolean
  gh?: boolean
  ghAuth?: boolean
  dockerManifest?: "exists" | "missing" | "denied"
  buildOk?: boolean
  pushOk?: boolean
  workflowRun?: "success" | "failure"
}

/** Run fake: registra as chamadas e responde o suficiente para orquestrar. */
function fakeRun(opts: FakeRunOptions = {}) {
  const {
    docker = true,
    gh = false,
    ghAuth = false,
    dockerManifest = "missing",
    buildOk = true,
    pushOk = true,
    workflowRun = "success",
  } = opts
  const calls: RunCall[] = []
  const out = (stdout = "", ok = true, stderr = "") => ({ ok, stdout, stderr, code: ok ? 0 : 1 })

  const run = (cmd: string, args: string[]) => {
    calls.push({ cmd, args })
    if (args[0] === "--version") {
      if (cmd === "docker")
        return docker ? out("Docker version 27.0.0") : out("", false, "not found")
      if (cmd === "gh") return gh ? out("gh version 2.62.0") : out("", false, "not found")
      return out("")
    }
    if (cmd === "gh" && args[0] === "auth")
      return ghAuth ? out("") : out("", false, "not logged in")
    if (cmd === "gh" && args[0] === "workflow") return out("")
    if (cmd === "gh" && args[0] === "run") {
      return out(
        JSON.stringify([
          {
            status: "completed",
            conclusion: workflowRun,
            databaseId: 42,
            url: "https://github.com/severinno/severinno/actions/runs/42",
          },
        ]),
      )
    }
    if (cmd === "docker" && args[0] === "manifest") {
      if (dockerManifest === "exists") return out("{}")
      if (dockerManifest === "missing")
        return out("", false, `no such manifest: ${args[args.length - 1]}`)
      return out("", false, "denied: requested access to the resource is denied")
    }
    if (cmd === "docker" && args[0] === "build")
      return buildOk ? out("") : out("", false, "build failed")
    if (cmd === "docker" && args[0] === "push")
      return pushOk ? out("") : out("", false, "denied: unauthenticated")
    return out("")
  }
  return { run, calls }
}

const silent = { pass: () => {}, fail: () => {}, warn: () => {}, info: () => {}, plain: () => {} }
const noSleep = async () => {}

// ═══════════════════════════════════════════════════════════════════════════
describe("parseEnvFile", () => {
  it("lê CHAVE=valor, ignora comentários e linhas inválidas", () => {
    const values = parseEnvFile(
      [
        "# comentário",
        "",
        "RUNNER_TOKEN=abc",
        "BUN_VERSION=1.3.14",
        "not a var",
        "IMAGE_REGISTRY = ghcr.io ",
      ].join("\n"),
    )
    expect(values).toEqual({
      RUNNER_TOKEN: "abc",
      BUN_VERSION: "1.3.14",
      IMAGE_REGISTRY: "ghcr.io",
    })
  })

  it("remove aspas (simples/duplas) e comentário inline FORA de aspas", () => {
    const values = parseEnvFile(
      [
        `IMAGE_NAMESPACE="severinno"`,
        `IMAGE_REGISTRY='ghcr.io'`,
        "BUN_VERSION=1.3.14 # pinada",
        `X="1 # nao"`,
      ].join("\n"),
    )
    expect(values.IMAGE_NAMESPACE).toBe("severinno")
    expect(values.IMAGE_REGISTRY).toBe("ghcr.io")
    expect(values.BUN_VERSION).toBe("1.3.14")
    expect(values.X).toBe("1 # nao")
  })
})

/**
 * O guard é JS: `resolveImageRef` devolve uma UNIÃO ref|erro. Estes helpers
 * estreitam a união verificando qual variante voltou — em vez de um cast, que
 * passaria silenciosamente se o formato mudasse.
 */
function expectRef(values: Record<string, string>): string {
  const r = resolveImageRef(values)
  if ("error" in r) throw new Error(`esperava ref, veio erro: ${r.error}`)
  return r.ref
}

function expectRefError(values: Record<string, string>): string {
  const r = resolveImageRef(values)
  if (!("error" in r)) throw new Error(`esperava erro, veio ref: ${r.ref}`)
  return r.error
}

describe("resolveImageRef", () => {
  it("usa os MESMOS defaults do compose (ghcr.io / severinno)", () => {
    expect(expectRef({ BUN_VERSION: "1.3.14" })).toBe("ghcr.io/severinno/ubuntu-bun:1.3.14")
  })

  it("respeita IMAGE_REGISTRY/IMAGE_NAMESPACE (inclusive registry local)", () => {
    expect(
      expectRef({
        IMAGE_REGISTRY: "http://127.0.0.1:5000",
        IMAGE_NAMESPACE: "org/repo",
        BUN_VERSION: "1.4.0",
      }),
    ).toBe("http://127.0.0.1:5000/org/repo/ubuntu-bun:1.4.0")
  })

  it("BUN_VERSION ausente/vazio → erro explícito (o compose montaria tag vazia)", () => {
    expect(expectRefError({})).toContain("BUN_VERSION")
    expect(expectRefError({ BUN_VERSION: "  " })).toContain("BUN_VERSION")
  })
})

describe("registryEndpoints", () => {
  it("separa registry/repositório/tag e assume HTTPS sem scheme", () => {
    expect(registryEndpoints("ghcr.io/severinno/ubuntu-bun:1.3.14")).toEqual({
      base: "https://ghcr.io",
      host: "ghcr.io",
      registry: "https://ghcr.io",
      repository: "severinno/ubuntu-bun",
      tag: "1.3.14",
    })
  })

  it("mantém o scheme explícito e a porta (registry local dos testes)", () => {
    expect(registryEndpoints("http://127.0.0.1:5000/ns/ubuntu-bun:1.3.14").base).toBe(
      "http://127.0.0.1:5000",
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe("checkTagExists — HTTP real contra registry fake", () => {
  it("200 → exists", async () => {
    const reg = await startRegistry("exists")
    try {
      const res = await checkTagExists(`http://127.0.0.1:${reg.port}/severinno/ubuntu-bun:1.3.14`)
      expect(res.state).toBe("exists")
      expect(reg.hits.some((h) => h.includes("/v2/severinno/ubuntu-bun/manifests/1.3.14"))).toBe(
        true,
      )
    } finally {
      await reg.close()
    }
  })

  it("404 → missing (o registry respondeu; não é dúvida)", async () => {
    const reg = await startRegistry("missing")
    try {
      expect(
        (await checkTagExists(`http://127.0.0.1:${reg.port}/severinno/ubuntu-bun:1.3.14`)).state,
      ).toBe("missing")
    } finally {
      await reg.close()
    }
  })

  it("401 + challenge → token anônimo → 403 → unauthorized (não confunde com missing)", async () => {
    const reg = await startRegistry("private")
    try {
      const res = await checkTagExists(`http://127.0.0.1:${reg.port}/severinno/ubuntu-bun:1.3.14`)
      expect(res.state).toBe("unauthorized")
      // o fluxo Bearer foi exercitado de verdade: pedimos o token ao realm
      expect(reg.hits.some((h) => h.startsWith("GET /token"))).toBe(true)
    } finally {
      await reg.close()
    }
  })

  it("conexão derrubada → unreachable (NUNCA 'missing')", async () => {
    const reg = await startRegistry("drop")
    try {
      expect(
        (await checkTagExists(`http://127.0.0.1:${reg.port}/severinno/ubuntu-bun:1.3.14`)).state,
      ).toBe("unreachable")
    } finally {
      await reg.close()
    }
  })

  it("405 no HEAD → cai para GET (registries sem HEAD)", async () => {
    const reg = await startRegistry("exists")
    try {
      const fetchImpl = async (_url: string, init: { method: string }) =>
        init.method === "HEAD" ? fakeResponse(405) : fakeResponse(200)
      expect(
        (await checkTagExists("ghcr.io/severinno/ubuntu-bun:1.3.14", { fetchImpl })).state,
      ).toBe("exists")
    } finally {
      await reg.close()
    }
  })
})

describe("verifyWithDocker — fallback do 401 (docker tem o login)", () => {
  it("manifest ok → exists-private", () => {
    const { run } = fakeRun({ dockerManifest: "exists" })
    expect(verifyWithDocker("ghcr.io/severinno/ubuntu-bun:1.3.14", { run }).state).toBe(
      "exists-private",
    )
  })

  it("'no such manifest' → missing (aí sim publicamos)", () => {
    const { run } = fakeRun({ dockerManifest: "missing" })
    expect(verifyWithDocker("ghcr.io/severinno/ubuntu-bun:1.3.14", { run }).state).toBe("missing")
  })

  it("'denied' → unauthorized (indeterminado, não publica)", () => {
    const { run } = fakeRun({ dockerManifest: "denied" })
    expect(verifyWithDocker("ghcr.io/severinno/ubuntu-bun:1.3.14", { run }).state).toBe(
      "unauthorized",
    )
  })
})

describe("choosePublishSource", () => {
  it("auto prefere o workflow canônico quando o gh está autenticado", () => {
    expect(
      choosePublishSource({ source: "auto", hasGh: true, hasGhAuth: true, hasDocker: true }),
    ).toBe("workflow")
  })

  it("auto cai para build+push local sem gh autenticado", () => {
    expect(
      choosePublishSource({ source: "auto", hasGh: true, hasGhAuth: false, hasDocker: true }),
    ).toBe("local")
    expect(
      choosePublishSource({ source: "auto", hasGh: false, hasGhAuth: false, hasDocker: true }),
    ).toBe("local")
  })

  it("source explícito que não pode ser honrado → null (falha, não troca em silêncio)", () => {
    expect(
      choosePublishSource({ source: "workflow", hasGh: true, hasGhAuth: false, hasDocker: true }),
    ).toBeNull()
    expect(
      choosePublishSource({ source: "local", hasGh: true, hasGhAuth: true, hasDocker: false }),
    ).toBeNull()
    expect(
      choosePublishSource({ source: "auto", hasGh: false, hasGhAuth: false, hasDocker: false }),
    ).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe("ensureRunnerImage — a releitura é a garantia", () => {
  it("env ausente → exit 2 e nenhuma consulta ao registry", async () => {
    const res = await ensureRunnerImage({
      envFile: join(makeTmp("sem-env"), "nao-existe.env"),
      fetchImpl: sequenceFetch([fakeResponse(200)]),
      run: fakeRun().run,
      emit: silent,
    })
    expect(res.code).toBe(EXIT.ENV)
  })

  it("BUN_VERSION vazio → exit 2", async () => {
    const res = await ensureRunnerImage({
      envFile: makeEnvFile({ RUNNER_TOKEN: "x" }),
      fetchImpl: sequenceFetch([fakeResponse(200)]),
      run: fakeRun().run,
      emit: silent,
    })
    expect(res.code).toBe(EXIT.ENV)
    expect(res.state).toBe("bad-env")
  })

  it("tag existe → exit 0 e NENHUM comando é executado (nem docker, nem gh)", async () => {
    const { run, calls } = fakeRun()
    const res = await ensureRunnerImage({
      envFile: makeEnvFile({ BUN_VERSION: "1.3.14" }),
      fetchImpl: sequenceFetch([fakeResponse(200)]),
      run,
      emit: silent,
    })
    expect(res.code).toBe(EXIT.OK)
    expect(res.state).toBe("exists")
    expect(calls).toEqual([])
  })

  it("tag ausente + --check → exit 4, não publica e não toca no docker", async () => {
    const { run, calls } = fakeRun()
    const res = await ensureRunnerImage({
      envFile: makeEnvFile({ BUN_VERSION: "1.3.14" }),
      fetchImpl: sequenceFetch([fakeResponse(404)]),
      run,
      emit: silent,
      check: true,
    })
    expect(res.code).toBe(EXIT.MISSING)
    expect(calls).toEqual([])
  })

  it("ausente + source=local → build+push e RE-CONFERE no registry → exit 0", async () => {
    const { run, calls } = fakeRun({ buildOk: true, pushOk: true })
    const res = await ensureRunnerImage({
      envFile: makeEnvFile({ BUN_VERSION: "1.3.14" }),
      fetchImpl: sequenceFetch([fakeResponse(404), fakeResponse(200)]),
      run,
      emit: silent,
      source: "local",
    })
    expect(res.code).toBe(EXIT.OK)
    expect(res.published).toBe(true)
    expect(calls.some((c) => c.cmd === "docker" && c.args[0] === "build")).toBe(true)
    expect(calls.some((c) => c.cmd === "docker" && c.args[0] === "push")).toBe(true)
  })

  it("publicou, mas a releitura NÃO confirma → exit 5 (nada de sucesso otimista)", async () => {
    const { run } = fakeRun()
    const res = await ensureRunnerImage({
      envFile: makeEnvFile({ BUN_VERSION: "1.3.14" }),
      fetchImpl: sequenceFetch([fakeResponse(404), fakeResponse(404)]),
      run,
      emit: silent,
      source: "local",
    })
    expect(res.code).toBe(EXIT.PUBLISH_FAILED)
    expect(res.published).toBe(true)
    expect(res.state).toBe("missing")
  })

  it("push falha → exit 5 com o remédio de credencial", async () => {
    const { run } = fakeRun({ pushOk: false })
    const res = await ensureRunnerImage({
      envFile: makeEnvFile({ BUN_VERSION: "1.3.14" }),
      fetchImpl: sequenceFetch([fakeResponse(404)]),
      run,
      emit: silent,
      source: "local",
    })
    expect(res.code).toBe(EXIT.PUBLISH_FAILED)
    expect(res.detail).toContain("push")
  })

  it("sem caminho de publicação (nem gh autenticado, nem docker) → exit 5", async () => {
    const { run, calls } = fakeRun({ docker: false, gh: false })
    const res = await ensureRunnerImage({
      envFile: makeEnvFile({ BUN_VERSION: "1.3.14" }),
      fetchImpl: sequenceFetch([fakeResponse(404)]),
      run,
      emit: silent,
      source: "auto",
    })
    expect(res.code).toBe(EXIT.PUBLISH_FAILED)
    expect(calls.some((c) => c.args[0] === "build")).toBe(false)
  })

  it("INDETERMINADO (rede fora) → exit 3 e NÃO publica", async () => {
    const { run, calls } = fakeRun()
    const res = await ensureRunnerImage({
      envFile: makeEnvFile({ BUN_VERSION: "1.3.14" }),
      fetchImpl: sequenceFetch([new Error("getaddrinfo ENOTFOUND ghcr.io")]),
      run,
      emit: silent,
      source: "auto",
    })
    expect(res.code).toBe(EXIT.UNKNOWN)
    expect(res.state).toBe("unreachable")
    expect(calls.some((c) => c.args[0] === "build" || c.args[0] === "push")).toBe(false)
  })

  it("401 com o docker dizendo que a tag EXISTE → exit 3 (pacote privado; o runner puxa sem credencial)", async () => {
    const { run, calls } = fakeRun({ dockerManifest: "exists" })
    const res = await ensureRunnerImage({
      envFile: makeEnvFile({ BUN_VERSION: "1.3.14" }),
      fetchImpl: sequenceFetch([fakeResponse(401, { "www-authenticate": "" })]),
      run,
      emit: silent,
    })
    expect(res.code).toBe(EXIT.UNKNOWN)
    expect(res.state).toBe("exists-private")
    expect(calls.some((c) => c.args[0] === "push")).toBe(false)
  })

  it("401 e o docker NÃO conhece a tag → é ausente: publica pelo workflow e confirma", async () => {
    const { run, calls } = fakeRun({
      dockerManifest: "missing",
      gh: true,
      ghAuth: true,
      workflowRun: "success",
    })
    const res = await ensureRunnerImage({
      envFile: makeEnvFile({ BUN_VERSION: "1.3.14" }),
      fetchImpl: sequenceFetch([fakeResponse(401, { "www-authenticate": "" }), fakeResponse(200)]),
      run,
      emit: silent,
      sleep: noSleep,
    })
    expect(res.code).toBe(EXIT.OK)
    expect(calls.some((c) => c.cmd === "gh" && c.args[0] === "workflow")).toBe(true)
    expect(calls.some((c) => c.cmd === "gh" && c.args[0] === "run")).toBe(true)
  })

  it("workflow conclui com falha → exit 5 (não espera a releitura)", async () => {
    const { run } = fakeRun({ gh: true, ghAuth: true, workflowRun: "failure" })
    const res = await ensureRunnerImage({
      envFile: makeEnvFile({ BUN_VERSION: "1.3.14" }),
      fetchImpl: sequenceFetch([fakeResponse(404), fakeResponse(200)]),
      run,
      emit: silent,
      sleep: noSleep,
    })
    expect(res.code).toBe(EXIT.PUBLISH_FAILED)
    expect(res.detail).toContain("failure")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe("parseArgs", () => {
  it("defaults: env do compose, source auto, sem publicar em --check", () => {
    const { opts } = parseArgs([])
    expect(opts.envFile).toBe(DEFAULT_ENV_FILE)
    expect(opts.source).toBe("auto")
    expect(opts.check).toBe(false)
  })

  it("--check / --gitea-env / --source", () => {
    const { opts } = parseArgs(["--check", "--gitea-env", "x.env", "--source", "workflow"])
    expect(opts).toMatchObject({ check: true, envFile: "x.env", source: "workflow" })
  })

  it("REJEITA --env-file: é flag do PRÓPRIO Node, consumida antes do script", () => {
    // Comportamento pinado (e não um detalhe): `node script.mjs --env-file X`
    // com X ausente morre com exit 9 e a mensagem do Node — nunca chega ao
    // nosso diagnóstico, justamente no caso em que o arquivo não existe. Por
    // isso a flag tem nome próprio.
    expect(parseArgs(["--env-file", "x.env"]).error).toContain("desconhecido")
  })

  it("argumento desconhecido e --source inválido → erro", () => {
    expect(parseArgs(["--nope"]).error).toContain("desconhecido")
    expect(parseArgs(["--source", "ftp"]).error).toContain("--source")
  })

  it("--help", () => {
    expect(parseArgs(["--help"]).help).toBe(true)
  })
})

describe("CLI real (scripts/ensure-runner-image.mjs)", () => {
  /**
   * Spawn ASSÍNCRONO (não spawnSync): o registry fake vive NESTE processo, e um
   * spawnSync bloquearia o event loop — o registry não responderia e todo teste
   * de CLI mediria timeout de rede em vez do contrato de exit code (foi
   * exatamente o que aconteceu antes de trocar para spawn).
   */
  function runCli(args: string[]): Promise<{ status: number | null; out: string }> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [SCRIPT, ...args], {
        cwd: ROOT,
        stdio: ["ignore", "pipe", "pipe"],
      })
      let out = ""
      child.stdout?.on("data", (chunk) => (out += chunk))
      child.stderr?.on("data", (chunk) => (out += chunk))
      child.on("close", (code) => resolve({ status: code, out }))
    })
  }

  it("--help → exit 1 com a usage", async () => {
    const { status, out } = await runCli(["--help"])
    expect(status).toBe(EXIT.USAGE)
    expect(out).toContain("Usage")
  })

  it("flag desconhecida → exit 1", async () => {
    expect((await runCli(["--turbo"])).status).toBe(EXIT.USAGE)
  })

  it("env ausente → exit 2 com o caminho do arquivo (nome próprio evita o exit 9 do Node)", async () => {
    const { status, out } = await runCli(["--gitea-env", "nao/existe.env", "--check"])
    expect(status).toBe(EXIT.ENV)
    expect(out).toContain("nao/existe.env")
  })

  it("tag ausente no registry → exit 4 (é o contrato que o gitea-up.sh usa)", async () => {
    const reg = await startRegistry("missing")
    try {
      const envFile = makeEnvFile({
        IMAGE_REGISTRY: reg.url,
        IMAGE_NAMESPACE: "severinno",
        BUN_VERSION: "1.3.14",
      })
      const { status, out } = await runCli(["--check", "--gitea-env", envFile])
      expect(status).toBe(EXIT.MISSING)
      expect(out).toContain("AUSENTE")
    } finally {
      await reg.close()
    }
  })

  it("tag presente → exit 0 e o --json traz o estado verificável", async () => {
    const reg = await startRegistry("exists")
    try {
      const envFile = makeEnvFile({
        IMAGE_REGISTRY: reg.url,
        IMAGE_NAMESPACE: "severinno",
        BUN_VERSION: "1.3.14",
      })
      const plain = await runCli(["--check", "--gitea-env", envFile])
      expect(plain.status).toBe(EXIT.OK)

      const asJson = await runCli(["--check", "--gitea-env", envFile, "--json"])
      expect(asJson.status).toBe(EXIT.OK)
      const payload = JSON.parse(asJson.out)
      expect(payload).toMatchObject({ code: EXIT.OK, state: "exists", check: true })
      expect(payload.ref).toBe(`${reg.url}/severinno/ubuntu-bun:1.3.14`)
      // a linha 'env' é o MESMO arquivo que o compose usa (--env-file)
      expect(payload.envFile).toBe(envFile)
    } finally {
      await reg.close()
    }
  })
})

// ── o cache da identidade: uma PERGUNTA, uma ida ao registry ──────────────
//
// O doctor faz a MESMA pergunta ("que build a tag serve hoje?") em DOIS fatos
// (a invariante 9 das referências não versionadas e o contrato da imagem
// publicada). Sem o cache eram duas idas idênticas — manifesto + config blob, e
// token em pacote privado. O cache é OTIMIZAÇÃO, então o que estes testes
// precisam provar não é "ficou rápido": é que ele NÃO muda o ESTADO devolvido.

describe("createRegistryIdentityCache — uma pergunta, uma ida; o estado não muda", () => {
  const REF = "http://127.0.0.1:0/severinno/ubuntu-bun:1.3.14"

  it("a MESMA pergunta → o probe roda UMA vez e o objeto é o MESMO", async () => {
    let calls = 0
    const probe = async () => {
      calls += 1
      return { state: "proven", digest: "sha256:abc", version: "1.3.14", detail: "ok" }
    }
    const cached = createRegistryIdentityCache({ probe })
    const [a, b, c] = await Promise.all([
      cached(REF, { expectedVersion: "1.3.14" }),
      cached(REF, { expectedVersion: "1.3.14" }),
      cached(REF, { expectedVersion: "1.3.14" }),
    ])
    expect(calls).toBe(1)
    expect(a).toBe(b)
    expect(b).toBe(c)

    const d = await cached(REF, { expectedVersion: "1.3.14" })
    expect(calls).toBe(1)
    expect(d).toBe(a)
  })

  it("chamadas CONCORRENTES deduplicam (a 2ª espera a 1ª, não abre outra conexão)", async () => {
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const probe = async () => {
      calls += 1
      await gate
      return { state: "missing", digest: null, version: null, detail: "HTTP 404" }
    }
    const cached = createRegistryIdentityCache({ probe })
    const first = cached(REF, { expectedVersion: "1.3.14" })
    const second = cached(REF, { expectedVersion: "1.3.14" })
    await Promise.resolve() // deixa o probe (agendado em microtask) começar
    // Com a 1ª AINDA EM VOO, a 2ª não pode ter aberto uma chamada própria: é
    // esse o ponto — a segunda espera a primeira em vez de uma conexão nova.
    expect(calls).toBe(1)
    release()
    const [a, b] = await Promise.all([first, second])
    expect(calls).toBe(1)
    expect(a).toBe(b)
  })

  it("ERRO não é cacheado: a próxima chamada tenta de novo (falha transitória ≠ veredito)", async () => {
    let calls = 0
    const probe = async () => {
      calls += 1
      if (calls === 1) throw new Error("rede caiu")
      return { state: "proven", digest: "sha256:ok", version: "1.3.14", detail: "ok" }
    }
    const cached = createRegistryIdentityCache({ probe })
    await expect(cached(REF)).rejects.toThrow("rede caiu")
    const res = await cached(REF)
    expect(res.state).toBe("proven")
    expect(calls).toBe(2)
    // Agora sim: o SUCESSO entra no cache.
    await cached(REF)
    expect(calls).toBe(2)
  })

  it("estado TRANSITÓRIO não é cacheado: 'eu não sei' não pode virar resposta permanente", async () => {
    // `unreachable`/`error` são AUSÊNCIA de resposta, não resposta. Cachear um
    // `unreachable` nascido de um timeout curto serviria "não sei" a um
    // consumidor que pediu com timeout maior e teria como PROVAR — a otimização
    // apagaria prova. Por isso o estado volta a ser tentado.
    let calls = 0
    const probe = async () => {
      calls += 1
      return { state: "unreachable", digest: null, version: null, detail: "timeout" }
    }
    const cached = createRegistryIdentityCache({ probe })
    expect((await cached(REF)).state).toBe("unreachable")
    expect((await cached(REF)).state).toBe("unreachable")
    expect(calls).toBe(2)
  })

  it("a RESPOSTA definitiva É cacheada (inclusive 'missing' e 'unauthorized')", async () => {
    let calls = 0
    const probe = async () => {
      calls += 1
      return { state: "missing", digest: null, version: null, detail: "HTTP 404" }
    }
    const cached = createRegistryIdentityCache({ probe })
    const a = await cached(REF)
    const b = await cached(REF)
    expect(calls).toBe(1)
    expect(a).toBe(b)
    expect(b.state).toBe("missing")
  })

  it("`timeoutMs` NÃO entra na chave — é o que faz a otimização existir de fato", async () => {
    // Os DOIS fatos do doctor perguntam com timeouts DIFERENTES (o das
    // referências usa 20s; o do contrato deixa o default do probe). Com o
    // timeout na chave o cache NUNCA acertaria e seria DECORATIVO — uma
    // "otimização" que não otimiza nada e não tem sintoma nenhum.
    let calls = 0
    const probe = async () => {
      calls += 1
      return { state: "proven", digest: "sha256:x", version: "1.3.14", detail: "ok" }
    }
    const cached = createRegistryIdentityCache({ probe })
    // Exatamente como os dois consumidores reais chamam.
    await cached(REF, { expectedVersion: "1.3.14", credentials: null, timeoutMs: 20000 })
    await cached(REF, { expectedVersion: "1.3.14", credentials: null })
    expect(calls).toBe(1)
  })

  it("a CHAVE separa o que muda a resposta: versão esperada e presença de credencial", async () => {
    const seen: string[] = []
    const probe = async (
      _ref: string,
      opts: { expectedVersion?: string | null; credentials?: unknown },
    ) => {
      seen.push(`${opts.expectedVersion ?? "-"}|${opts.credentials ? "auth" : "anon"}`)
      return { state: "proven", digest: `sha256:${seen.length}`, version: "1.0.0", detail: "ok" }
    }
    const cached = createRegistryIdentityCache({ probe })
    await cached(REF, { expectedVersion: "1.3.14" })
    await cached(REF, { expectedVersion: "1.3.15" })
    await cached(REF, { expectedVersion: "1.3.14", credentials: { user: "u", token: "s3cr3t" } })
    // Repetição da 1ª: cacheada, não acrescenta.
    await cached(REF, { expectedVersion: "1.3.14" })
    expect(seen).toEqual(["1.3.14|anon", "1.3.15|anon", "1.3.14|auth"])
  })

  it("o TOKEN nunca entra na CHAVE (o segredo não vira identidade consultável)", async () => {
    // Trocar o token do MESMO usuário não muda a pergunta. Se ele entrasse na
    // chave, cada credencial viraria uma ida nova ao registry — e um segredo
    // ficaria guardado numa chave de Map.
    let calls = 0
    const probe = async () => {
      calls += 1
      return { state: "proven", digest: "sha256:x", version: "1.0.0", detail: "ok" }
    }
    const cached = createRegistryIdentityCache({ probe })
    await cached(REF, { credentials: { user: "u", token: "token-A" } })
    await cached(REF, { credentials: { user: "u", token: "token-B" } })
    expect(calls).toBe(1)
  })
})
