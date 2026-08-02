/**
 * check-single-line-out-assign.test.ts
 *
 * Testes do guard scripts/check-single-line-out-assign.sh — falha quando um
 * .sh/.bash TRACKEADO sob scripts/ tem o padrão `comando "..." out=$(...)`
 * numa ÚNICA linha.
 *
 * Contexto: `out=$(...)` no início de um comando é atribuição, mas depois de
 * um comando + argumento QUOTADO vira ARGUMENTO POSICIONAL — `out` nunca é
 * setado e `$?` captura o comando errado. Em validate-seed-guards-matrix-
 * local.sh isso seria um FALSO POSITIVO: a string de count ("128 checks")
 * ainda passa no check-e2e-counts.mjs enquanto o script quebra em silêncio.
 *
 * Cobre:
 *   - forma correta (2 linhas: cell "..." / out=$(...)) → exit 0
 *   - padrão quebrado (1 linha) → exit 1 + file:line no output
 *   - .sh FORA de scripts/ → ignorado (escopo é scripts/)
 *   - .ts com o padrão → ignorado (só .sh/.bash)
 *   - sem .sh trackeado → exit 0
 *   - argumento inválido → exit 2
 */

import { describe, it, expect, afterEach } from "vitest"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const GUARD = resolve(process.cwd(), "scripts/check-single-line-out-assign.sh")

const tmpDirs: string[] = []

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "slo-assign-"))
  tmpDirs.push(dir)
  execFileSync("git", ["init", "-q"], { cwd: dir })
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir })
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir })
  return dir
}

function runGuard(repoDir: string, args: string[] = ["--ci"]) {
  return spawnSync("bash", [GUARD, ...args], {
    cwd: repoDir,
    encoding: "utf8",
    env: { ...process.env, CHECK_SINGLE_LINE_ROOT: repoDir },
  })
}

/** Escreve um arquivo relativo à raiz do repo fake e o trackeia. */
function addTracked(repoDir: string, relPath: string, content: string) {
  const full = join(repoDir, relPath)
  mkdirSync(join(full, ".."), { recursive: true })
  writeFileSync(full, content, "utf8")
  execFileSync("git", ["add", relPath], { cwd: repoDir })
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("check-single-line-out-assign.sh (temp git repo)", () => {
  it('exit 0 quando a forma correta (2 linhas: cell "..." / out=$(...)) é usada', () => {
    const dir = makeRepo()
    addTracked(
      dir,
      "scripts/validate.sh",
      [
        "#!/usr/bin/env bash",
        'cell() { echo "$1"; }',
        'cell "Rodando prod E2E (128 checks)..."',
        'out=$(cd "$SCRIPT_DIR" && bun run test:seed-prod-e2e 2>&1)',
        "code=$?",
        "",
      ].join("\n"),
    )

    const res = runGuard(dir)
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("OK")
  })

  it("exit 1 + file:line quando o padrão quebrado está numa única linha", () => {
    const dir = makeRepo()
    addTracked(
      dir,
      "scripts/bad.sh",
      [
        "#!/usr/bin/env bash",
        'cell "Rodando prod E2E (128 checks)..." out=$(cd "$SCRIPT_DIR" && bun run test:seed-prod-e2e 2>&1)',
        "code=$?",
        "",
      ].join("\n"),
    )

    const res = runGuard(dir)
    expect(res.status).toBe(1)
    expect(res.stdout).toContain("FAILED")
    // grep -nHE → "bad.sh:2:<conteúdo>"
    expect(res.stdout).toContain("bad.sh:2:")
    expect(res.stdout).toContain("out=$(")
  })

  it("ignora .sh FORA de scripts/ (escopo restrito a scripts/)", () => {
    const dir = makeRepo()
    addTracked(dir, "deploy/ops.sh", 'echo "x" out=$(cd /tmp && ls 2>&1)\n')

    const res = runGuard(dir)
    expect(res.status).toBe(0)
  })

  it("ignora .ts com o padrão (só .sh/.bash são varridos)", () => {
    const dir = makeRepo()
    addTracked(
      dir,
      "scripts/example.ts",
      '// cell "x" out=$(foo) — não é shell, deve ser ignorado\n',
    )

    const res = runGuard(dir)
    expect(res.status).toBe(0)
  })

  it("exit 0 quando não há .sh/.bash trackeado sob scripts/", () => {
    const dir = makeRepo()
    addTracked(dir, "scripts/README.md", "sem scripts\n")

    const res = runGuard(dir)
    expect(res.status).toBe(0)
  })

  it("exit 2 para argumento desconhecido", () => {
    const dir = makeRepo()
    addTracked(dir, "scripts/ok.sh", "#!/usr/bin/env bash\necho hi\n")

    const res = runGuard(dir, ["--nope"])
    expect(res.status).toBe(2)
    // O erro de argumento vai para STDERR (>&2) — o output capturado é o
    // concat stdout+stderr do spawnSync.
    expect(`${res.stdout}${res.stderr}`).toContain("unknown argument")
  })

  it("exit 1 também em subpasta de scripts/ (detecção recursiva)", () => {
    const dir = makeRepo()
    addTracked(dir, "scripts/ci/guards.sh", 'fail "falhou" out=$(bun run test 2>&1)\n')

    const res = runGuard(dir)
    expect(res.status).toBe(1)
    expect(res.stdout).toContain("guards.sh:1:")
  })
})
