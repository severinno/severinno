/**
 * Testes de scripts/check-realtime-env-parity.mjs — paridade do environment
 * EFETIVO (base + override) do serviço realtime entre os canais de produção.
 *
 * A CLI real é exercida contra o REPO REAL (exit 0 — os canais estão em
 * paridade hoje; --service app prova o caminho da divergência LEGÍTIMA,
 * exit 1) e contra FIXTURES em tmp (divergência real e infra), seguindo a
 * convenção dos testes de check-*-cli do repo.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  normalizeSource,
  readServiceEnv,
  effectiveServiceEnv,
  diffServiceEnv,
  PARITY_SERVICE,
  CHANNELS,
} from "../../../scripts/check-realtime-env-parity.mjs"

const GUARD = join(process.cwd(), "scripts", "check-realtime-env-parity.mjs")

// ── helpers de fixture ──────────────────────────────────────────────────────

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "realtime-parity-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const BASE_ENV_PADRAO =
  "      PORT: 3003\n      REDIS_URL: redis://redis:6379\n      REALTIME_EMIT_API_KEY: ${REALTIME_EMIT_API_KEY}\n"

/** Escreve base + dois canais (com overrides opcionais) em tmp. */
function makeCompose(
  opts: { baseEnv?: string; prodOverride?: string; hostOverride?: string } = {},
) {
  const base =
    `services:\n  redis:\n    image: redis:7\n  realtime:\n    environment:\n` +
    (opts.baseEnv ?? BASE_ENV_PADRAO)
  const channel = (override: string | undefined) =>
    override
      ? `include:\n  - path: docker-compose.base.yml\nservices:\n  realtime:\n    environment:\n${override}`
      : `include:\n  - path: docker-compose.base.yml\n`
  writeFileSync(join(dir, "docker-compose.base.yml"), base)
  writeFileSync(join(dir, "docker-compose.prod.yml"), channel(opts.prodOverride))
  writeFileSync(join(dir, "docker-compose.hostinger.yml"), channel(opts.hostOverride))
}

const runCli = (args: string[]) => spawnSync("node", [GUARD, ...args], { encoding: "utf8" })

// ── normalizeSource ─────────────────────────────────────────────────────────

describe("normalizeSource", () => {
  it("${VAR} vira o NOME da variável (fonte do contrato)", () => {
    expect(normalizeSource("${REALTIME_EMIT_API_KEY}")).toBe("REALTIME_EMIT_API_KEY")
  })

  it("${VAR:-default} e ${VAR:?msg} também viram o nome", () => {
    expect(normalizeSource("${CORS_ORIGIN:-https://severinno.com.br}")).toBe("CORS_ORIGIN")
    expect(normalizeSource("${SENHA:?obrigatória}")).toBe("SENHA")
  })

  it('literal passa intacto; não-string vira String(); vazio vira ""', () => {
    expect(normalizeSource("redis://redis:6379")).toBe("redis://redis:6379")
    expect(normalizeSource(3003)).toBe("3003")
    expect(normalizeSource(null)).toBe("")
  })
})

// ── readServiceEnv ──────────────────────────────────────────────────────────

describe("readServiceEnv", () => {
  it("lê environment em formato MAPA", () => {
    const f = join(dir, "mapa.yml")
    writeFileSync(
      f,
      "services:\n  realtime:\n    environment:\n      PORT: 3003\n      KEY: ${KEY}\n",
    )
    const { found, env } = readServiceEnv(f, "realtime")
    expect(found).toBe(true)
    expect(env).toEqual({ PORT: "3003", KEY: "KEY" })
  })

  it("lê environment em formato LISTA (- KEY, - KEY=valor, valor com =)", () => {
    const f = join(dir, "lista.yml")
    writeFileSync(
      f,
      "services:\n  realtime:\n    environment:\n      - PORT=3003\n      - HOST_KEY\n      - EQ=va=lue\n",
    )
    const { env } = readServiceEnv(f, "realtime")
    expect(env).toEqual({ PORT: "3003", HOST_KEY: "HOST_KEY", EQ: "va=lue" })
  })

  it("serviço ausente → found:false; serviço sem environment → {}", () => {
    const f = join(dir, "vazio.yml")
    writeFileSync(f, "services:\n  redis:\n    image: redis:7\n")
    expect(readServiceEnv(f, "realtime")).toEqual({ found: false, env: {} })

    const g = join(dir, "sem-env.yml")
    writeFileSync(g, "services:\n  realtime:\n    image: x\n")
    expect(readServiceEnv(g, "realtime")).toEqual({ found: true, env: {} })
  })

  it("YAML quebrado lança (infra — fail-closed)", () => {
    const f = join(dir, "quebrado.yml")
    writeFileSync(f, "services: [::::\n")
    expect(() => readServiceEnv(f, "realtime")).toThrow(/YAML inválido/)
  })
})

// ── effectiveServiceEnv (merge) e diffServiceEnv ────────────────────────────

describe("effectiveServiceEnv — merge base + override", () => {
  it("override SOBRESCREVE a base e ADICIONA", () => {
    makeCompose({
      baseEnv: "      PORT: 3003\n      KEY: ${KEY}\n",
      prodOverride: "      KEY: ${OUTRA_KEY}\n      CORS_ORIGIN: ${CORS_ORIGIN}\n",
    })
    const env = effectiveServiceEnv(
      join(dir, "docker-compose.prod.yml"),
      join(dir, "docker-compose.base.yml"),
      "realtime",
    )
    expect(env).toEqual({ PORT: "3003", KEY: "OUTRA_KEY", CORS_ORIGIN: "CORS_ORIGIN" })
  })

  it("serviço ausente nos DOIS arquivos do canal é infra (erro)", () => {
    const base = "services:\n  redis:\n    image: redis:7\n"
    const canal = "include:\n  - path: docker-compose.base.yml\n"
    writeFileSync(join(dir, "docker-compose.base.yml"), base)
    writeFileSync(join(dir, "docker-compose.prod.yml"), canal)
    expect(() =>
      effectiveServiceEnv(
        join(dir, "docker-compose.prod.yml"),
        join(dir, "docker-compose.base.yml"),
        "realtime",
      ),
    ).toThrow(/não existe/)
  })
})

describe("diffServiceEnv", () => {
  it("mapas iguais → sem divergência", () => {
    expect(diffServiceEnv({ A: "1", B: "2" }, { B: "2", A: "1" })).toEqual([])
  })

  it("variável só num lado é divergência com ausência marcada", () => {
    expect(diffServiceEnv({ A: "1" }, { A: "1", B: "B" })).toEqual([
      { key: "B", a: undefined, b: "B" },
    ])
  })

  it("valores diferentes aparecem dos dois lados", () => {
    expect(diffServiceEnv({ A: "1" }, { A: "2" })).toEqual([{ key: "A", a: "1", b: "2" }])
  })
})

// ── constantes do contrato ──────────────────────────────────────────────────

describe("contrato do guard", () => {
  it("serviço padrão é o realtime e os canais são prod/hostinger", () => {
    expect(PARITY_SERVICE).toBe("realtime")
    expect(CHANNELS).toEqual(["docker-compose.prod.yml", "docker-compose.hostinger.yml"])
  })
})

// ── CLI contra o REPO REAL ──────────────────────────────────────────────────

describe("check-realtime-env-parity — CLI (repo real)", () => {
  it("exit 0: realtime está em paridade entre os canais hoje", () => {
    const res = runCli([])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("✅")
    expect(res.stdout).toContain("realtime")
  })

  it("--json no repo real: ok:true e diffs vazios", () => {
    const res = runCli(["--json"])
    expect(res.status).toBe(0)
    const parsed = JSON.parse(res.stdout) as { ok: boolean; diffs: unknown[]; service: string }
    expect(parsed.ok).toBe(true)
    expect(parsed.diffs).toEqual([])
    expect(parsed.service).toBe("realtime")
  })

  it("--service app exit 1: a divergência DOCUMENTADA do app (rollout CSP só no prod) é detectada; os defaults de domínio não são (normalização por nome)", () => {
    const res = runCli(["--service", "app"])
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("CSP_REPORT_ONLY")
    expect(res.stderr).toContain("DIVERGE")
    // Defaults de domínio (.com.br vs .com) têm a MESMA fonte (${VAR:-…}) —
    // normalização por nome NÃO os sinaliza.
    expect(res.stderr).not.toContain("NEXT_PUBLIC_WS_URL")
  })

  it("--service inexistente é INFRA (exit 2), não divergência", () => {
    const res = runCli(["--service", "nao-existe"])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain("nao-existe")
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

describe("check-realtime-env-parity — CLI (fixtures)", () => {
  it("paridade na fixture → exit 0", () => {
    makeCompose()
    const res = runCli(["--root", dir])
    expect(res.status).toBe(0)
  })

  it("variável só num canal → exit 1 nomeando a chave e o canal", () => {
    makeCompose({ hostOverride: "      EXTRA_VAR: ${EXTRA_VAR}\n" })
    const res = runCli(["--root", dir])
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("EXTRA_VAR")
    expect(res.stderr).toContain("docker-compose.hostinger.yml")
  })

  it("valor divergente → exit 1 mostrando os dois lados", () => {
    makeCompose({
      prodOverride: "      CORS_ORIGIN: ${CORS_ORIGIN}\n",
      hostOverride: "      CORS_ORIGIN: ${OUTRA_CORS}\n",
    })
    const res = runCli(["--root", dir])
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("CORS_ORIGIN")
    expect(res.stderr).toContain("CORS_ORIGIN")
    expect(res.stderr).toContain("OUTRA_CORS")
  })

  it("compose ilegível → exit 2 (infra, fail-closed)", () => {
    makeCompose()
    writeFileSync(join(dir, "docker-compose.hostinger.yml"), "services: [::::\n")
    const res = runCli(["--root", dir])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain("infra")
  })

  it("--json na divergência carrega o diff estruturado", () => {
    makeCompose({ hostOverride: "      EXTRA_VAR: ${EXTRA_VAR}\n" })
    const res = runCli(["--root", dir, "--json"])
    expect(res.status).toBe(1)
    const parsed = JSON.parse(res.stdout) as {
      ok: boolean
      diffs: Array<{ key: string; a?: string; b?: string }>
    }
    expect(parsed.ok).toBe(false)
    expect(parsed.diffs).toEqual([{ key: "EXTRA_VAR", a: undefined, b: "EXTRA_VAR" }])
  })
})
