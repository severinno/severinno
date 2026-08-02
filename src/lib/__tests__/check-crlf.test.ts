/**
 * check-crlf.test.ts
 *
 * Testes do guard scripts/check-crlf.sh (e seu detector scripts/check_crlf.py)
 * — falha quando qualquer .sh/.bash TRACKEADO tem CRLF no working tree.
 *
 * Contexto: Git Bash tolera CRLF, mas containers Linux (act/CI) quebram com
 * `set: pipefail: invalid option name`. A detecção é por BYTES BRUTOS via
 * python (grep -q $'\r' falha no MSYS — que remove CR em modo texto).
 *
 * Cobre:
 *   - .sh LF trackeado → exit 0
 *   - .sh CRLF trackeado → exit 1 + arquivo listado no output
 *   - --fix converte CRLF → LF e volta a passar
 *   - repo sem .sh trackeado → exit 0
 *   - detector python puro: --fix trata CR solitário (não só CRLF)
 *   - CONTRATO DE ESCOPO (.ts FORA — decisão ESCOPO INTENCIONAL):
 *       - detector python é agnóstico a extensão: detecta CRLF em .ts e
 *         --fix converte (byte-based, sem filtro de extensão no argv)
 *       - o GUARD .sh NUNCA é chamado para .ts: repo com .ts CRLF no
 *         working tree → guard exit 0 (git ls-files '*.sh' '*.bash')
 *       - com .sh E .ts CRLF no mesmo repo, o guard lista SÓ o .sh
 */

import { describe, it, expect, afterEach } from "vitest"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const GUARD = resolve(process.cwd(), "scripts/check-crlf.sh")
const PY_DETECTOR = resolve(process.cwd(), "scripts/check_crlf.py")

const tmpDirs: string[] = []

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "crlf-guard-"))
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
    env: { ...process.env, CHECK_CRLF_ROOT: repoDir },
  })
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ── Guard integrado (temp git repo) ──────────────────────────────────────

describe("check-crlf.sh (temp git repo)", () => {
  it("exit 0 quando .sh trackeado usa LF", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "ok.sh"), "#!/usr/bin/env bash\nset -euo pipefail\necho hi\n")
    execFileSync("git", ["add", "ok.sh"], { cwd: dir })
    execFileSync("git", ["commit", "-qm", "init"], { cwd: dir })

    const res = runGuard(dir)
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("OK")
  })

  it("exit 1 e lista o arquivo quando .sh trackeado tem CRLF", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "bad.sh"), "#!/usr/bin/env bash\r\nset -euo pipefail\r\necho hi\r\n")
    execFileSync("git", ["add", "bad.sh"], { cwd: dir })
    execFileSync("git", ["commit", "-qm", "init"], { cwd: dir })

    const res = runGuard(dir)
    expect(res.status).toBe(1)
    expect(res.stdout).toContain("FAILED")
    expect(res.stdout).toContain("bad.sh")
  })

  it("exit 1 mesmo quando o CRLF está em .sh não staged (working tree)", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "clean.sh"), "#!/usr/bin/env bash\necho hi\n")
    execFileSync("git", ["add", "clean.sh"], { cwd: dir })
    execFileSync("git", ["commit", "-qm", "init"], { cwd: dir })
    // Simula o checkout Windows pré-.gitattributes: working tree vira CRLF
    writeFileSync(join(dir, "clean.sh"), "#!/usr/bin/env bash\r\necho hi\r\n")

    const res = runGuard(dir)
    expect(res.status).toBe(1)
    expect(res.stdout).toContain("clean.sh")
  })

  it("--fix converte CRLF → LF e o guard volta a passar", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "fixme.sh"), "#!/usr/bin/env bash\r\necho hi\r\n")
    execFileSync("git", ["add", "fixme.sh"], { cwd: dir })
    execFileSync("git", ["commit", "-qm", "init"], { cwd: dir })

    const fix = runGuard(dir, ["--fix"])
    expect(fix.status).toBe(0)
    expect(fix.stdout).toContain("fixed: fixme.sh")

    const res = runGuard(dir)
    expect(res.status).toBe(0)
  })

  it("exit 0 quando não há .sh trackeado", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "README.md"), "sem scripts\n")
    execFileSync("git", ["add", "README.md"], { cwd: dir })
    execFileSync("git", ["commit", "-qm", "init"], { cwd: dir })

    const res = runGuard(dir)
    expect(res.status).toBe(0)
  })

  it("detecta CRLF também em arquivo .bash", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "init.bash"), "#!/usr/bin/env bash\r\necho hi\r\n")
    execFileSync("git", ["add", "init.bash"], { cwd: dir })
    execFileSync("git", ["commit", "-qm", "init"], { cwd: dir })

    const res = runGuard(dir)
    expect(res.status).toBe(1)
    expect(res.stdout).toContain("init.bash")
  })
})

// ── Detector python puro ─────────────────────────────────────────────────

describe("check_crlf.py (detector bruto)", () => {
  it("--fix trata CR solitário (não apenas CRLF)", () => {
    const dir = mkdtempSync(join(tmpdir(), "crlf-py-"))
    tmpDirs.push(dir)
    const loneCr = join(dir, "lone-cr.sh")
    writeFileSync(loneCr, "echo a\r\necho b\recho c\n", "utf8")

    const res = spawnSync("python3", [PY_DETECTOR, "--fix", loneCr], { encoding: "utf8" })
    expect(res.status).toBe(0)
    const fixed = readFileSync(loneCr, "utf8")
    expect(fixed).toBe("echo a\necho b\necho c\n")
  })

  it("exit 1 e imprime o caminho quando detecta CRLF", () => {
    const dir = mkdtempSync(join(tmpdir(), "crlf-py-"))
    tmpDirs.push(dir)
    const bad = join(dir, "bad.sh")
    writeFileSync(bad, "#!/usr/bin/env bash\r\necho hi\r\n", "utf8")

    const res = spawnSync("python3", [PY_DETECTOR, bad], { encoding: "utf8" })
    expect(res.status).toBe(1)
    expect(res.stdout.trim()).toBe(bad)
  })

  it("exit 0 em arquivo LF e ignora arquivo ausente", () => {
    const dir = mkdtempSync(join(tmpdir(), "crlf-py-"))
    tmpDirs.push(dir)
    const ok = join(dir, "ok.sh")
    writeFileSync(ok, "echo hi\n", "utf8")
    const missing = join(dir, "nope.sh")
    expect(existsSync(missing)).toBe(false)

    const res = spawnSync("python3", [PY_DETECTOR, ok, missing], { encoding: "utf8" })
    expect(res.status).toBe(0)
  })
})

// ── Contrato de escopo (.ts FORA — decisão ESCOPO INTENCIONAL) ──────────────
//
// O detector python é agnóstico a extensão (lê bytes crus do argv — não tem
// filtro). O ESCOPO vive no GUARD .sh: `git ls-files '*.sh' '*.bash'` decide
// quais arquivos chegam ao detector. Este describe trava esse contrato em
// teste: .ts com CRLF nunca é escaneado pelo guard (nem listado, nem
// corrigido), enquanto o detector puro, se chamado diretamente com um .ts,
// o detecta e corrige normalmente.

describe("contrato de escopo (.ts fora dos guards CRLF)", () => {
  it("detector python detecta CRLF em .ts quando chamado diretamente (byte-based)", () => {
    const dir = mkdtempSync(join(tmpdir(), "crlf-ts-"))
    tmpDirs.push(dir)
    const ts = join(dir, "component.ts")
    writeFileSync(ts, "export const a = 1;\r\nexport const b = 2;\r\n", "utf8")

    const res = spawnSync("python3", [PY_DETECTOR, ts], { encoding: "utf8" })
    expect(res.status).toBe(1)
    expect(res.stdout.trim()).toBe(ts)
  })

  it("detector python --fix converte .ts CRLF → LF", () => {
    const dir = mkdtempSync(join(tmpdir(), "crlf-ts-"))
    tmpDirs.push(dir)
    const ts = join(dir, "component.ts")
    writeFileSync(ts, "export const a = 1;\r\nexport const b = 2;\r\n", "utf8")

    const fix = spawnSync("python3", [PY_DETECTOR, "--fix", ts], { encoding: "utf8" })
    expect(fix.status).toBe(0)
    const fixed = readFileSync(ts, "utf8")
    expect(fixed).toBe("export const a = 1;\nexport const b = 2;\n")
  })

  it("guard .sh exit 0 com .ts CRLF no working tree — .ts NÃO é escaneado", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "component.ts"), "export const a = 1;\r\nexport const b = 2;\r\n")
    execFileSync("git", ["add", "component.ts"], { cwd: dir })
    execFileSync("git", ["commit", "-qm", "init"], { cwd: dir })
    // Simula checkout Windows: working tree .ts vira CRLF — o guard NÃO deve
    // nem listar nem falhar (o CRLF em .ts não quebra nada; o clean filter do
    // git normaliza na comparação).
    writeFileSync(join(dir, "component.ts"), "export const a = 1;\r\nexport const b = 2;\r\n")

    const res = runGuard(dir)
    expect(res.status).toBe(0)
    expect(res.stdout).not.toContain("component.ts")
  })

  it("com .sh E .ts CRLF, o guard lista SÓ o .sh — .ts nunca chega ao detector", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "run.sh"), "#!/usr/bin/env bash\r\necho hi\r\n")
    writeFileSync(join(dir, "component.ts"), "export const a = 1;\r\n")
    execFileSync("git", ["add", "."], { cwd: dir })
    execFileSync("git", ["commit", "-qm", "init"], { cwd: dir })

    const res = runGuard(dir)
    expect(res.status).toBe(1)
    expect(res.stdout).toContain("run.sh")
    expect(res.stdout).not.toContain("component.ts")
  })
})
