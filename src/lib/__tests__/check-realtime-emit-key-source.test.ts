/**
 * Testes de scripts/check-realtime-emit-key-source.mjs — invariante do contrato
 * da REALTIME_EMIT_API_KEY: valor NUNCA em environment de compose; os consumers
 * (realtime, app, notification-worker) recebem o DOCKER SECRET
 * realtime_emit_api_key e leem via REALTIME_EMIT_API_KEY_FILE.
 *
 * A CLI real é exercida contra o REPO REAL (exit 0 — os três composes de
 * produção estão no desenho hoje) e contra FIXTURES em tmp (cada regra
 * violada), seguindo a convenção dos testes de check-*-cli do repo.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  collectViolations,
  readServiceSpec,
  scanKeyMentions,
  checkSecretsDir,
  trackedSecretFiles,
  EMIT_KEY_ENV,
  EMIT_KEY_FILE_ENV,
  EMIT_KEY_SECRET,
  EMIT_KEY_SECRET_PATH,
  EMIT_KEY_CONSUMERS,
  SCAN_FILES,
  EXIT,
} from "../../../scripts/check-realtime-emit-key-source.mjs"

const GUARD = join(process.cwd(), "scripts", "check-realtime-emit-key-source.mjs")

// ── helpers de fixture ──────────────────────────────────────────────────────

let dir: string

beforeEach(() => {
  dir = join(tmpdir(), `emit-key-guard-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Base canônica (o desenho aprovado) para compor fixtures. */
const BASE_OK = `secrets:
  realtime_emit_api_key:
    file: ./secrets/realtime_emit_api_key.secret
services:
  realtime:
    environment:
      PORT: 3003
      REALTIME_EMIT_API_KEY_FILE: /run/secrets/realtime_emit_api_key
    secrets:
      - realtime_emit_api_key
  app:
    environment:
      REALTIME_EMIT_API_KEY_FILE: /run/secrets/realtime_emit_api_key
    secrets:
      - realtime_emit_api_key
  notification-worker:
    environment:
      REALTIME_EMIT_API_KEY_FILE: /run/secrets/realtime_emit_api_key
    secrets:
      - realtime_emit_api_key
`

/** Troca a PRIMEIRA ocorrência do _FILE canônico (bloco do realtime). */
function replaceFirstRealtimeEnv(newValue: string): string {
  return BASE_OK.replace("REALTIME_EMIT_API_KEY_FILE: /run/secrets/realtime_emit_api_key", newValue)
}

/** Escreve a base e os dois canais include-only (desenho aprovado). */
function makeFixture(opts: { base?: string; example?: boolean; placeholder?: boolean } = {}) {
  writeFileSync(join(dir, "docker-compose.base.yml"), opts.base ?? BASE_OK)
  const channel = "include:\n  - path: docker-compose.base.yml\n"
  writeFileSync(join(dir, "docker-compose.prod.yml"), channel)
  writeFileSync(join(dir, "docker-compose.hostinger.yml"), channel)
  mkdirSync(join(dir, "secrets"), { recursive: true })
  if (opts.example !== false) {
    const content =
      opts.placeholder === false ? "valor-real-commitado" : "changeme_realtime_emit_api_key"
    writeFileSync(join(dir, "secrets", `${EMIT_KEY_SECRET}.secret.example`), content)
  }
}

const runCli = (args: string[]) => spawnSync("node", [GUARD, ...args], { encoding: "utf8" })

// ── unidades puras ──────────────────────────────────────────────────────────

describe("readServiceSpec", () => {
  it("lê environment em mapa e lista, e secrets em lista e em objetos", () => {
    const doc = {
      services: {
        realtime: {
          environment: { PORT: 3003, KEY: "v" },
          secrets: ["realtime_emit_api_key"],
        },
        app: {
          environment: ["KEY=da-lista", "HOST_KEY"],
          secrets: [{ source: "realtime_emit_api_key", target: "outro" }],
        },
      },
    }
    const rt = readServiceSpec(doc, "realtime")
    expect(rt).toEqual({
      found: true,
      env: { PORT: "3003", KEY: "v" },
      secrets: ["realtime_emit_api_key"],
    })
    const app = readServiceSpec(doc, "app")
    expect(app.env).toEqual({ KEY: "da-lista", HOST_KEY: "HOST_KEY" })
    expect(app.secrets).toEqual(["outro"])
  })

  it("serviço ausente → found:false", () => {
    expect(readServiceSpec({ services: {} }, "realtime")).toEqual({
      found: false,
      env: {},
      secrets: [],
    })
  })
})

describe("scanKeyMentions", () => {
  it("captura menções das DUAS chaves nos três composes e quem declara o secret", () => {
    makeFixture()
    const { mentions, declared, parseError } = scanKeyMentions(dir)
    expect(parseError).toBeNull()
    expect(mentions).toHaveLength(3)
    expect(mentions.every((m) => m.envKey === EMIT_KEY_FILE_ENV)).toBe(true)
    expect(mentions.map((m) => m.service)).toEqual(["realtime", "app", "notification-worker"])
    expect(declared).toEqual(["docker-compose.base.yml"])
  })

  it("YAML quebrado volta como parseError (fail-closed)", () => {
    makeFixture()
    writeFileSync(join(dir, "docker-compose.base.yml"), "services: [::::\n")
    const { parseError } = scanKeyMentions(dir)
    expect(parseError).toContain("docker-compose.base.yml")
  })
})

describe("checkSecretsDir", () => {
  it("example presente com placeholder e nenhum .secret no checkout", () => {
    makeFixture()
    const sec = checkSecretsDir(dir)
    expect(sec.examplePresent).toBe(true)
    expect(sec.exampleHasPlaceholder).toBe(true)
    expect(sec.committedSecrets).toEqual([])
  })

  it("detecta .example sem placeholder", () => {
    makeFixture({ placeholder: false })
    expect(checkSecretsDir(dir).exampleHasPlaceholder).toBe(false)
  })
})

describe("trackedSecretFiles", () => {
  it("fora de um repositório git devolve [] (não há prova, não há violação)", () => {
    makeFixture()
    expect(trackedSecretFiles(dir)).toEqual([])
  })
})

// ── collectViolations — cada regra contra a fixture ─────────────────────────

describe("collectViolations — desenhos sancionados e violações", () => {
  it("desenho aprovado (base + canais) não tem violação", () => {
    makeFixture()
    expect(collectViolations(dir)).toEqual([])
  })

  it(`R1: ${EMIT_KEY_ENV} com valor em environment é violação nomeando arquivo e serviço`, () => {
    makeFixture({ base: replaceFirstRealtimeEnv(`${EMIT_KEY_ENV}: "valor-aberto"`) })
    const v = collectViolations(dir)
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("docker-compose.base.yml (realtime)")
    expect(v[0]).toContain(EMIT_KEY_ENV)
    expect(v[0]).toContain("docker inspect")
  })

  it("R1 também reprova a forma ${VAR} (interpolar do .env do host é a fuga fechada)", () => {
    makeFixture({ base: replaceFirstRealtimeEnv(`${EMIT_KEY_ENV}: \${REALTIME_EMIT_API_KEY}`) })
    const v = collectViolations(dir)
    expect(v.some((x) => x.includes("docker inspect"))).toBe(true)
  })

  it("R2: consumer que menciona a chave sem receber o secret é violação", () => {
    makeFixture({
      base: BASE_OK.replace(
        `  app:
    environment:
      REALTIME_EMIT_API_KEY_FILE: /run/secrets/realtime_emit_api_key
    secrets:
      - realtime_emit_api_key
`,
        `  app:
    environment:
      REALTIME_EMIT_API_KEY_FILE: /run/secrets/realtime_emit_api_key
`,
      ),
    })
    const v = collectViolations(dir)
    expect(v.some((x) => x.includes("(app)") && x.includes("NÃO recebe o secret"))).toBe(true)
  })

  it("R2 reverso: consumer com o secret mas sem menção à chave é violação (órfão)", () => {
    makeFixture({
      base: BASE_OK.replace(
        `  notification-worker:
    environment:
      REALTIME_EMIT_API_KEY_FILE: /run/secrets/realtime_emit_api_key
    secrets:
      - realtime_emit_api_key
`,
        `  notification-worker:
    environment:
      LOG_LEVEL: info
    secrets:
      - realtime_emit_api_key
`,
      ),
    })
    const v = collectViolations(dir)
    expect(v.some((x) => x.includes("(notification-worker)") && x.includes("órfão"))).toBe(true)
  })

  it("R3: compose que menciona a chave sem declarar o secret no top-level é violação", () => {
    makeFixture({
      base: BASE_OK.replace(
        `secrets:
  realtime_emit_api_key:
    file: ./secrets/realtime_emit_api_key.secret
`,
        "",
      ),
    })
    const v = collectViolations(dir)
    expect(v.some((x) => x.includes("docker-compose.base.yml: menciona"))).toBe(true)
  })

  it("R5: caminho _FILE diferente do canônico é violação", () => {
    makeFixture({ base: replaceFirstRealtimeEnv("REALTIME_EMIT_API_KEY_FILE: /run/secrets/outro") })
    const v = collectViolations(dir)
    expect(v.some((x) => x.includes("caminho canônico"))).toBe(true)
  })

  it("R4: sem .example é violação; .example sem placeholder também", () => {
    makeFixture({ example: false })
    expect(collectViolations(dir).some((x) => x.includes("secret.example ausente"))).toBe(true)

    makeFixture({ placeholder: false })
    expect(collectViolations(dir).some((x) => x.includes("NÃO contém placeholder"))).toBe(true)
  })

  it("R4: *.secret local (untracked) é fluxo normal de dev — sem violação", () => {
    makeFixture()
    writeFileSync(join(dir, "secrets", `${EMIT_KEY_SECRET}.secret`), "valor-dev-local")
    expect(collectViolations(dir)).toEqual([])
  })

  it("compose ilegível é violação (fail-closed, não crash)", () => {
    makeFixture()
    writeFileSync(join(dir, "docker-compose.base.yml"), "services: [::::\n")
    const v = collectViolations(dir)
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("YAML inválido")
  })

  it("nenhum compose menciona a chave é violação (contrato sumiu)", () => {
    makeFixture({ base: "services:\n  realtime:\n    environment:\n      PORT: 3003\n" })
    const v = collectViolations(dir)
    expect(v.some((x) => x.includes("NENHUM compose"))).toBe(true)
  })
})

// ── CLI contra o REPO REAL ──────────────────────────────────────────────────

describe("check-realtime-emit-key-source — CLI (repo real)", () => {
  it("exit 0: os três composes de produção estão no desenho secret + _FILE", () => {
    const res = runCli([])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("✅")
    expect(res.stdout).toContain(EMIT_KEY_SECRET)
  })

  it("--json no repo real: ok:true", () => {
    const res = runCli(["--json"])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout) as { ok: boolean; violations: string[] }
    expect(parsed.ok).toBe(true)
    expect(parsed.violations).toEqual([])
  })

  it("--help sai 0 e documenta o contrato", () => {
    const res = runCli(["--help"])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("Usage:")
    expect(res.stdout).toContain("Exit codes:")
  })

  it("flag desconhecida sai 3 (uso inválido)", () => {
    expect(runCli(["--wat"]).status).toBe(3)
  })
})

// ── CLI contra FIXTURES ─────────────────────────────────────────────────────

describe("check-realtime-emit-key-source — CLI (fixtures)", () => {
  it("desenho aprovado → exit 0; R1 → exit 1 nomeando a violação", () => {
    makeFixture()
    expect(runCli(["--root", dir]).status).toBe(0)

    makeFixture({ base: replaceFirstRealtimeEnv(`${EMIT_KEY_ENV}: "aberta"`) })
    const res = runCli(["--root", dir])
    expect(res.status).toBe(1)
    expect(res.stderr).toContain(EMIT_KEY_ENV)
    expect(res.stderr).toContain("docker inspect")
  })

  it("--json na violação carrega a lista estruturada", () => {
    makeFixture({ base: replaceFirstRealtimeEnv(`${EMIT_KEY_ENV}: "aberta"`) })
    const res = runCli(["--root", dir, "--json"])
    expect(res.status).toBe(1)
    const parsed = JSON.parse(res.stdout) as { ok: boolean; violations: string[] }
    expect(parsed.ok).toBe(false)
    expect(parsed.violations[0]).toContain("docker inspect")
  })
})

// ── constantes do contrato ──────────────────────────────────────────────────

describe("contrato do guard", () => {
  it("constantes canônicas", () => {
    expect(EMIT_KEY_ENV).toBe("REALTIME_EMIT_API_KEY")
    expect(EMIT_KEY_FILE_ENV).toBe("REALTIME_EMIT_API_KEY_FILE")
    expect(EMIT_KEY_SECRET).toBe("realtime_emit_api_key")
    expect(EMIT_KEY_SECRET_PATH).toBe("/run/secrets/realtime_emit_api_key")
    expect(EMIT_KEY_CONSUMERS).toEqual(["realtime", "app", "notification-worker"])
    expect(SCAN_FILES).toEqual([
      "docker-compose.base.yml",
      "docker-compose.prod.yml",
      "docker-compose.hostinger.yml",
    ])
    expect(EXIT).toEqual({ OK: 0, VIOLATION: 1, UNAVAILABLE: 2, USAGE: 3 })
  })
})
