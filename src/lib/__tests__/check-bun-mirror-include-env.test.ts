/**
 * Testes da INVARIANTE 20 do check-bun-mirror — o include da
 * docker-compose.base.yml declara `env_file` apontando para o
 * compose-include.env VAZIO (a blindagem da armadilha de interpolação
 * descoberta na consolidação base+override: sem a declaração, o Compose
 * carregaria o .env do DIRETÓRIO da base e uma var de dev vazaria para o
 * render de produção quando o --env-file não define a variável).
 *
 * Funções puras contra FIXTURES + CLI real contra o REPO (padrão dos
 * testes check-bun-mirror-* do repo).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  checkBaseIncludeEnvFile,
  checkBaseIncludeEnvFileEmpty,
} from "../../../scripts/check-bun-mirror.mjs"

const GUARD = join(process.cwd(), "scripts", "check-bun-mirror.mjs")

// ── fixtures ────────────────────────────────────────────────────────────────

let dir: string

const CANAL_OK = `include:
  - path: docker-compose.base.yml
    env_file: [compose-include.env]
services:
  caddy:
    image: caddy:2-alpine
`

const ENV_VAZIO = `# Arquivo VAZIO de propósito: os includes da base o referenciam
# para garantir que a base nunca carregue o .env do diretório por conta própria.
# Não preencha este arquivo.
`

beforeEach(() => {
  dir = join(tmpdir(), `bun-mirror-include-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const runCli = (args: string[]) => spawnSync("node", [GUARD, ...args], { encoding: "utf8" })

// ── checkBaseIncludeEnvFile (função pura) ───────────────────────────────────

describe("checkBaseIncludeEnvFile", () => {
  it("canal com env_file vazio declarado → sem violação", () => {
    expect(checkBaseIncludeEnvFile("docker-compose.prod.yml", CANAL_OK)).toEqual([])
  })

  it("include SEM env_file → violação nomeando a armadilha", () => {
    const content = "include:\n  - path: docker-compose.base.yml\n"
    const v = checkBaseIncludeEnvFile("docker-compose.prod.yml", content)
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("NÃO declara env_file")
    expect(v[0]).toContain(".env do diretório da base")
  })

  it("env_file com OUTRO arquivo → violação (a garantia é o vazio canônico)", () => {
    const content = `include:\n  - path: docker-compose.base.yml\n    env_file: [outro.env]\n`
    const v = checkBaseIncludeEnvFile("docker-compose.hostinger.yml", content)
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("outro.env")
    expect(v[0]).toContain("compose-include.env")
  })

  it("include que NÃO referencia a base é fail-closed (infra)", () => {
    const content = "include:\n  - path: docker-compose.outra.yml\n"
    const v = checkBaseIncludeEnvFile("docker-compose.prod.yml", content)
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("divergiu da fonte comum")
  })

  it("sem bloco include é fail-closed (infra)", () => {
    const v = checkBaseIncludeEnvFile("docker-compose.prod.yml", "services: {}\n")
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("sem bloco include")
  })

  it("YAML inválido NÃO trava o guard (parser por texto; fail-closed pelo bloco ausente)", () => {
    // O guard não tem dependências (é copiado para fixtures sem node_modules),
    // então não há parser YAML — grosseria que impediria achar o `include:`
    // cai no fail-closed "sem bloco include", nunca num silêncio.
    const v = checkBaseIncludeEnvFile("docker-compose.prod.yml", "include: [::::\n")
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("fail-closed")
  })

  it("include em forma de STRING (sem env_file possível) tem violação própria", () => {
    // A forma string é aceita pelo Compose e NÃO tem onde declarar env_file —
    // a armadilha em pessoa, com remédio dedicado.
    const content = "include:\n  - docker-compose.base.yml\n"
    const v = checkBaseIncludeEnvFile("docker-compose.prod.yml", content)
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("forma de STRING")
    expect(v[0]).toContain("env_file: [compose-include.env]")
  })
})

// ── checkBaseIncludeEnvFileEmpty (função pura) ──────────────────────────────

describe("checkBaseIncludeEnvFileEmpty", () => {
  it("só comentários (ou vazio) → sem violação", () => {
    expect(checkBaseIncludeEnvFileEmpty("compose-include.env", ENV_VAZIO)).toEqual([])
    expect(checkBaseIncludeEnvFileEmpty("compose-include.env", "")).toEqual([])
  })

  it("atribuição CHAVE=valor → violação citando a linha", () => {
    const v = checkBaseIncludeEnvFileEmpty(
      "compose-include.env",
      `${ENV_VAZIO}\nPOSTGRES_PASSWORD=dev123\n`,
    )
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("POSTGRES_PASSWORD=dev123")
    expect(v[0]).toContain("VAZIO de propósito")
  })

  it("comentário com = dentro não é atribuição", () => {
    expect(
      checkBaseIncludeEnvFileEmpty("compose-include.env", "# a fonte é: --env-file x\n"),
    ).toEqual([])
  })
})

// ── CLI contra o REPO REAL ──────────────────────────────────────────────────

describe("invariante 20 — CLI no repo real", () => {
  it("exit 0: prod e hostinger declaram o env_file vazio e o arquivo está vazio", () => {
    const res = runCli([])
    expect(res.status).toBe(0)
    expect(res.stderr).not.toContain("env_file")
  })

  it("os dois canais declaram o include com env_file (a regra tem SUJEITO)", () => {
    // A invariante precisa estar exercitada de verdade no repo: se um canal
    // perder o bloco include ou a declaração, estas asserções (e o guard)
    // ficam vermelhas.
    for (const canal of ["docker-compose.prod.yml", "docker-compose.hostinger.yml"]) {
      const content = readFileSync(canal, "utf8")
      expect(checkBaseIncludeEnvFile(canal, content), canal).toEqual([])
    }
    const envContent = readFileSync("compose-include.env", "utf8")
    expect(checkBaseIncludeEnvFileEmpty("compose-include.env", envContent)).toEqual([])
  })
})
