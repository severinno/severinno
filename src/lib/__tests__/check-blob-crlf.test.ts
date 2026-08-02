/**
 * check-blob-crlf.test.ts
 *
 * Testes do guard scripts/check-blob-crlf.sh (e seu detector
 * scripts/check_blob_crlf.py) — falha quando o BLOB commitado de qualquer
 * .sh/.bash trackeado tem CRLF/mixed EOL (coluna `i/` de `git ls-files
 * --eol`), independente do working tree.
 *
 * Contexto: um `.sh` commitado com CRLF no blob reproduz CRLF em TODO
 * checkout futuro (qualquer branch), quebrando bash em containers Linux
 * (`set: pipefail: invalid option name`). O guard de working tree
 * (check-crlf.sh) não pega isso — daí este guard de blob.
 *
 * Cobre:
 *   - blob LF → exit 0
 *   - blob CRLF (commit com autocrlf=false) → exit 1 + arquivo listado
 *   - working tree CRLF MAS blob LF (autocrlf=true) → exit 0 (prova que o
 *     guard lê o BLOB, não o working tree)
 *   - --fix: adiciona .gitattributes e roda git add --renormalize →
 *     guard passa
 *   - repo sem .sh/.bash → exit 0
 *   - extensão .bash também é escaneada
 *   - blob CRLF injetado via git hash-object -w --literally + update-index
 *     --cacheinfo (plumbing — não depende de autocrlf) → detecta i/crlf
 *     e --fix renormaliza para i/lf
 */

import { describe, it, expect, afterEach } from "vitest"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const GUARD = resolve(process.cwd(), "scripts/check-blob-crlf.sh")

const tmpDirs: string[] = []

/** autocrlf=false por padrão: `git add` NÃO normaliza, blob guarda bytes crus. */
function makeRepo(autocrlf = "false"): string {
  const dir = mkdtempSync(join(tmpdir(), "blob-crlf-"))
  tmpDirs.push(dir)
  execFileSync("git", ["init", "-q"], { cwd: dir })
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir })
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir })
  execFileSync("git", ["config", "core.autocrlf", autocrlf], { cwd: dir })
  return dir
}

function run(repoDir: string, args: string[] = ["--ci"]) {
  return spawnSync("bash", [GUARD, ...args], {
    cwd: repoDir,
    encoding: "utf8",
    env: { ...process.env, CHECK_CRLF_ROOT: repoDir },
  })
}

function commitAll(dir: string, msg = "init") {
  execFileSync("git", ["add", "."], { cwd: dir })
  execFileSync("git", ["commit", "-qm", msg], { cwd: dir })
}

function indexEol(dir: string, file: string): string {
  const out = execFileSync("git", ["ls-files", "--eol", "--", file], { cwd: dir, encoding: "utf8" })
  return (out.trim().split(/\s+/)[0] || "").replace("i/", "")
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ── Blob LF ──────────────────────────────────────────────────────────────

describe("check-blob-crlf.sh (blob LF)", () => {
  it("exit 0 quando blob é LF", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "ok.sh"), "#!/usr/bin/env bash\necho hi\n")
    commitAll(dir)

    expect(indexEol(dir, "ok.sh")).toBe("lf")
    const res = run(dir)
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("OK")
  })
})

// ── Blob CRLF ────────────────────────────────────────────────────────────

describe("check-blob-crlf.sh (blob CRLF)", () => {
  it("exit 1 e lista o arquivo quando blob tem CRLF (autocrlf=false)", () => {
    const dir = makeRepo("false")
    writeFileSync(join(dir, "bad.sh"), "#!/usr/bin/env bash\r\necho hi\r\n")
    commitAll(dir)

    expect(indexEol(dir, "bad.sh")).toBe("crlf")
    const res = run(dir)
    expect(res.status).toBe(1)
    expect(res.stdout).toContain("FAILED")
    expect(res.stdout).toContain("bad.sh")
  })

  it("detecta também arquivos .bash", () => {
    const dir = makeRepo("false")
    writeFileSync(join(dir, "init.bash"), "#!/usr/bin/env bash\r\necho hi\r\n")
    commitAll(dir)

    const res = run(dir)
    expect(res.status).toBe(1)
    expect(res.stdout).toContain("init.bash")
  })

  it("exit 0 quando working tree é CRLF MAS blob é LF (autocrlf=true)", () => {
    // autocrlf=true: git add normaliza CRLF→LF no blob, working tree fica CRLF
    const dir = makeRepo("true")
    writeFileSync(join(dir, "mixed.sh"), "#!/usr/bin/env bash\r\necho hi\r\n")
    commitAll(dir)

    expect(indexEol(dir, "mixed.sh")).toBe("lf")
    const res = run(dir)
    expect(res.status).toBe(0)
  })

  it("--fix: adiciona .gitattributes e roda renormalize → guard passa", () => {
    const dir = makeRepo("false")
    writeFileSync(join(dir, "fixme.sh"), "#!/usr/bin/env bash\r\necho hi\r\n")
    commitAll(dir)
    expect(run(dir).status).toBe(1)

    // Simula o fix documentado: .gitattributes declara eol=lf, renormalize
    writeFileSync(join(dir, ".gitattributes"), "*.sh text eol=lf\n*.bash text eol=lf\n")
    const fix = run(dir, ["--fix"])
    expect(fix.status).toBe(0)

    expect(indexEol(dir, "fixme.sh")).toBe("lf")
    expect(run(dir).status).toBe(0)
  })
})

// ── Blob CRLF injetado via hash-object --literally (plumbing) ───────────────

describe("check_blob_crlf.py (blob CRLF injetado via hash-object --literally)", () => {
  /**
   * Injeta um blob com bytes LITERAIS de CRLF direto no index, sem depender
   * de autocrlf: `git hash-object -w --literally` grava o objeto blob com os
   * bytes exatos (--literally ignora validação/filtros) e
   * `git update-index --add --cacheinfo` o registra no index — simulando
   * fielmente um `.sh` COMMITADO com CRLF no blob (i/crlf), o cenário que o
   * guard foi criado para pegar (reproduz CRLF em todo checkout futuro).
   */
  function injectCrlfBlob(dir: string, file: string): void {
    const content = Buffer.from("#!/usr/bin/env bash\r\necho hi\r\n", "utf8")
    // 1. Blob com os bytes CRLF exatos (--stdin evita dependência do arquivo)
    const hash = execFileSync("git", ["hash-object", "-w", "--literally", "--stdin"], {
      cwd: dir,
      input: content,
    })
      .toString()
      .trim()
    // 2. Registra o blob no index como se tivesse sido commitado assim
    execFileSync("git", ["update-index", "--add", "--cacheinfo", `100644,${hash},${file}`], {
      cwd: dir,
    })
    // 3. Working tree com os mesmos bytes (para o --fix/renormalize operar)
    writeFileSync(join(dir, file), content)
  }

  it("detecta i/crlf do blob injetado (exit 1 + arquivo listado)", () => {
    const dir = makeRepo()
    injectCrlfBlob(dir, "literal.sh")

    expect(indexEol(dir, "literal.sh")).toBe("crlf")
    const res = run(dir)
    expect(res.status).toBe(1)
    expect(res.stdout).toContain("FAILED")
    expect(res.stdout).toContain("literal.sh")
  })

  it("--fix renormaliza o blob injetado → i/lf e guard passa", () => {
    const dir = makeRepo()
    injectCrlfBlob(dir, "literal.sh")
    expect(run(dir).status).toBe(1)

    // fix documentado: .gitattributes declara eol=lf + git add --renormalize
    writeFileSync(join(dir, ".gitattributes"), "*.sh text eol=lf\n*.bash text eol=lf\n")
    const fix = run(dir, ["--fix"])
    expect(fix.status).toBe(0)

    expect(indexEol(dir, "literal.sh")).toBe("lf")
    expect(run(dir).status).toBe(0)
  })
})

// ── Edge cases ───────────────────────────────────────────────────────────

describe("check-blob-crlf.sh (edge)", () => {
  it("exit 0 quando não há .sh/.bash trackeado", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "README.md"), "sem scripts\n")
    commitAll(dir)

    const res = run(dir)
    expect(res.status).toBe(0)
  })

  it("exit 2 com argumento desconhecido", () => {
    const dir = makeRepo()
    const res = run(dir, ["--bogus"])
    expect(res.status).toBe(2)
  })
})
