/**
 * normalize-crlf.test.ts
 *
 * Testes do script scripts/normalize-crlf.sh — normaliza o working tree para
 * LF (.sh/.ts/.md trackeados) e roda `git add --renormalize`, o fix
 * documentado no README (Bugs conhecidos) aplicável a qualquer checkout.
 *
 * Cobre:
 *   - --check: exit 1 + lista arquivos com CRLF; exit 0 quando limpo
 *   - fix padrão: converte CRLF→LF e renormaliza o index (status limpo)
 *   - preserva mudanças reais unstaged (nunca staggeia conteúdo)
 *   - --dry-run: lista sem modificar (arquivo continua CRLF)
 *   - repo sem arquivos .sh/.ts/.md trackeados → exit 0
 */

import { describe, it, expect, afterEach } from "vitest"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const NORMALIZER = resolve(process.cwd(), "scripts/normalize-crlf.sh")

const tmpDirs: string[] = []

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "crlf-norm-"))
  tmpDirs.push(dir)
  execFileSync("git", ["init", "-q"], { cwd: dir })
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir })
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir })
  // autocrlf=true: `git add` normaliza CRLF→LF no blob, working tree fica CRLF
  execFileSync("git", ["config", "core.autocrlf", "true"], { cwd: dir })
  return dir
}

function run(repoDir: string, args: string[] = []) {
  return spawnSync("bash", [NORMALIZER, ...args], {
    cwd: repoDir,
    encoding: "utf8",
    env: { ...process.env, CHECK_CRLF_ROOT: repoDir },
  })
}

function gitStatus(repoDir: string): string {
  return execFileSync("git", ["status", "--short"], { cwd: repoDir, encoding: "utf8" })
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ── --check ──────────────────────────────────────────────────────────────

describe("normalize-crlf.sh --check", () => {
  it("exit 1 e lista .sh/.ts/.md com CRLF", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "a.sh"), "#!/usr/bin/env bash\r\necho hi\r\n")
    writeFileSync(join(dir, "b.ts"), "export const x = 1\r\n")
    writeFileSync(join(dir, "c.md"), "# Title\r\n")
    execFileSync("git", ["add", "."], { cwd: dir })
    execFileSync("git", ["commit", "-qm", "init"], { cwd: dir })

    const res = run(dir, ["--check"])
    expect(res.status).toBe(1)
    expect(res.stdout).toContain("a.sh")
    expect(res.stdout).toContain("b.ts")
    expect(res.stdout).toContain("c.md")
  })

  it("exit 0 quando tudo LF", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "ok.sh"), "#!/usr/bin/env bash\necho hi\n")
    execFileSync("git", ["add", "."], { cwd: dir })
    execFileSync("git", ["commit", "-qm", "init"], { cwd: dir })

    const res = run(dir, ["--check"])
    expect(res.status).toBe(0)
  })
})

// ── fix padrão ───────────────────────────────────────────────────────────

describe("normalize-crlf.sh (fix)", () => {
  it("converte CRLF→LF e renormaliza o index (status limpo)", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "a.sh"), "#!/usr/bin/env bash\r\necho hi\r\n")
    writeFileSync(join(dir, "b.md"), "# Title\r\n")
    execFileSync("git", ["add", "."], { cwd: dir })
    execFileSync("git", ["commit", "-qm", "init"], { cwd: dir })

    const res = run(dir)
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("renormalize")
    expect(readFileSync(join(dir, "a.sh"), "utf8")).toBe("#!/usr/bin/env bash\necho hi\n")
    expect(readFileSync(join(dir, "b.md"), "utf8")).toBe("# Title\n")
    expect(gitStatus(dir).trim()).toBe("")
  })

  it("preserva mudanças reais unstaged (não staggeia conteúdo)", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "a.sh"), "#!/usr/bin/env bash\necho v1\n")
    execFileSync("git", ["add", "."], { cwd: dir })
    execFileSync("git", ["commit", "-qm", "init"], { cwd: dir })
    // mudança REAL + CRLF no working tree (não commitada)
    writeFileSync(join(dir, "a.sh"), "#!/usr/bin/env bash\r\necho v2-changed\r\n")

    const res = run(dir)
    expect(res.status).toBe(0)
    // continua MODIFICADO como unstaged (' M'), nunca staged ('M ')
    // NB: não usar .trim() — o espaço inicial diferencia unstaged de staged
    const status = gitStatus(dir)
    expect(status).toMatch(/^ M a\.sh/)
    expect(status).not.toMatch(/^M  a\.sh/)
    // conteúdo convertido para LF preservando a mudança real
    expect(readFileSync(join(dir, "a.sh"), "utf8")).toBe("#!/usr/bin/env bash\necho v2-changed\n")
  })
})

// ── --dry-run e edge cases ───────────────────────────────────────────────

describe("normalize-crlf.sh (dry-run / edge)", () => {
  it("--dry-run lista sem modificar (arquivo continua CRLF)", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "a.sh"), "#!/usr/bin/env bash\r\necho hi\r\n")
    execFileSync("git", ["add", "."], { cwd: dir })
    execFileSync("git", ["commit", "-qm", "init"], { cwd: dir })

    const res = run(dir, ["--dry-run"])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("a.sh")
    expect(readFileSync(join(dir, "a.sh"), "utf8")).toContain("\r\n")
  })

  it("repo sem arquivos .sh/.ts/.md trackeados → exit 0", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "notes.txt"), "apenas txt\n")
    execFileSync("git", ["add", "."], { cwd: dir })
    execFileSync("git", ["commit", "-qm", "init"], { cwd: dir })

    const res = run(dir)
    expect(res.status).toBe(0)
  })

  it("NORMALIZE_CRLF_EXTS permite escopo customizado", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "only.yml"), "a: b\r\n")
    execFileSync("git", ["add", "."], { cwd: dir })
    execFileSync("git", ["commit", "-qm", "init"], { cwd: dir })

    const res = spawnSync("bash", [NORMALIZER], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, CHECK_CRLF_ROOT: dir, NORMALIZE_CRLF_EXTS: ".yml" },
    })
    expect(res.status).toBe(0)
    expect(readFileSync(join(dir, "only.yml"), "utf8")).toBe("a: b\n")
  })
})
