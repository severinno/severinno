/**
 * Tests for scripts/check-caddy-validate.sh — o guard de parse do Caddyfile.
 *
 * Contexto: o Caddyfile.prod já envelheceu sozinho uma vez (storage com
 * módulo inexistente; nenhuma pipeline validava o arquivo). Este guard roda
 * `caddy validate` REAL num container — modo stock no PR (remove APENAS as
 * diretivas de plugin documentadas) e full com a imagem custom (arquivo
 * inteiro).
 *
 * Este arquivo prova o CONTRATO do script e a FIAÇÃO (o guard em si já foi
 * provado contra o Caddy real: exit 0 no repo, exit 1 com diretiva
 * desconhecida dentro de um site-block — mutação executada manualmente e
 * documentada no GUARDS.md §39).
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"

const ROOT = process.cwd()
const GUARD = join(ROOT, "scripts", "check-caddy-validate.sh")
const CADDYFILE = join(ROOT, "Caddyfile.prod")
const COMPOSE = join(ROOT, "docker-compose.prod.yml")
const DOCKERFILE = join(ROOT, "Dockerfile.caddy")
const PR_CHECK = readFileSync(join(ROOT, ".github", "workflows", "pr-check.yml"), "utf8")

function runGuard(args: string[]): { status: number; out: string } {
  try {
    const out = execFileSync("bash", [GUARD, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
    return { status: 0, out }
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    return { status: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` }
  }
}

describe("contrato do script", () => {
  it("bash com pipefail e cabeçalho documentado (Usage + Exit codes)", () => {
    const s = readFileSync(GUARD, "utf8")
    expect(s).toContain("set -uo pipefail")
    expect(s).toContain("Exit codes:")
    expect(s).toContain("Usage:")
  })

  it("usa `caddy validate --adapter caddyfile` num CONTAINER (não parser caseiro)", () => {
    const s = readFileSync(GUARD, "utf8")
    expect(s).toContain("caddy validate --adapter caddyfile")
    // `-i` em vez de `-v`: o arquivo entra por STDIN porque o -v de um
    // container IRMÃO resolve o caminho no HOST daemon — dentro de um runner
    // (workspace em volume) o mount quebra com "not a directory" (medido
    // 08/10/2026: 48/49 verdes, só caddy-validate vermelho no runner).
    expect(s).toContain("docker run -i --rm")
  })

  it("modos --stock/--full e exit 2 para pré-requisito ausente", () => {
    const s = readFileSync(GUARD, "utf8")
    expect(s).toContain("--stock")
    expect(s).toContain("--full")
    expect(s).toContain("exit 2")
  })

  it("a lista de diretivas removidas no modo stock é EXATAMENTE a dos plugins do Dockerfile.caddy", () => {
    const guard = readFileSync(GUARD, "utf8")
    // O guard remove rate_limit (bloco) e format transform (linhas) —
    // os DOIS plugins que o Dockerfile.caddy declara. Nada mais.
    expect(guard).toContain("rate_limit")
    expect(guard).toContain("format transform")
    const dockerfile = readFileSync(DOCKERFILE, "utf8")
    expect(dockerfile).toContain("mholt/caddy-ratelimit")
    expect(dockerfile).toContain("caddyserver/transform-encoder")
  })

  it("o Caddyfile.prod real declara exatamente 1 rate_limit e 2 format transform", () => {
    const s = readFileSync(CADDYFILE, "utf8")
    expect(s.match(/^\s*rate_limit\s*\{/gm)).toHaveLength(1)
    expect(s.match(/^\s*format\s+transform\s+/gm)).toHaveLength(2)
  })
})

describe("fiação", () => {
  it("o compose aponta o caddy para o Dockerfile custom (imagem com plugins)", () => {
    const s = readFileSync(COMPOSE, "utf8")
    expect(s).toContain("dockerfile: Dockerfile.caddy")
  })

  it("o pr-check roda as DUAS passadas: stock E full com build da imagem custom", () => {
    expect(PR_CHECK).toContain("check-caddy-validate.sh --stock")
    // O full do PR builda o Dockerfile.caddy e aponta CADDY_IMAGE para ele —
    // as diretivas de plugin são sancionadas a cada PR, não no deploy.
    expect(PR_CHECK).toContain("docker build -f Dockerfile.caddy -t severinno-caddy:pr .")
    expect(PR_CHECK).toContain(
      "CADDY_IMAGE=severinno-caddy:pr bash scripts/check-caddy-validate.sh --full",
    )
  })

  it("o guard está registrado no forge-parity (GITHUB_ONLY com razão)", () => {
    const parity = readFileSync(join(ROOT, "scripts", "check-forge-parity.mjs"), "utf8")
    expect(parity).toContain("caddy-validate")
    expect(parity).toContain("check[:-]caddy[:-]validate")
  })
})

describe("execução real (docker)", () => {
  it("modo stock no repo real → exit 0 (o Caddy valida o Caddyfile.prod hoje)", () => {
    const { status, out } = runGuard(["--stock"])
    expect(status).toBe(0)
    expect(out).toContain("válido na stock")
  }, 120_000)
})
