/**
 * check-unused-deps.test.ts
 *
 * Testes do guard de dependências NÃO UTILIZADAS
 * (scripts/check-unused-deps.mjs) — item #4 da auditoria: 5 deps órfãs reais
 * (08/2026): next-intl, react-markdown, @mdxeditor/editor, @tanstack/react-table,
 * zod-to-openapi (ZERO hits em código/config/scripts — removidas do
 * package.json). O guard escaneia TODO o código do repo procurando refs a
 * cada dep; falha (exit 1) quando uma dep tem ZERO referências.
 *
 * Cobre:
 *   - depPattern: boundary de palavra em ambos os lados (não casa substring
 *     de outra dep, ex.: "next" não casa "next-intl"); subpath suportado
 *     (ex.: "react-hook-form" casa "react-hook-form/...")
 *   - isAllowlisted: prefix @types/, sharp (uso implícito do Next), bun-types,
 *     @vitest/coverage-v8, husky/lint-staged (CLIs), prisma (CLI)
 *   - collectCodeFiles: pula node_modules/.next/docs/coverage, lockfiles,
 *     .snap, temp (_prefix), self-exclusion do próprio guard
 *   - findOrphanDeps: dep sem ref → órfã; dep com ref em código/script → ok;
 *     allowlist nunca é órfã; package.json auto-ref não conta
 *   - CLI real (fixtures em temp dir):
 *       - exit 0 quando todas as deps têm ref
 *       - exit 1 quando uma dep órfã existe (a mutação que o guard pega)
 *       - exit 1 com --json e orphanCount
 *       - exit 2 quando package.json ausente no root
 *
 * O modo fixture (--root temp) roda o guard real contra um mini-repo criado
 * no mktemp — determinístico e rápido, sem depender do repo real.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-unused-deps.test.ts
 */

import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  depPattern,
  depERE,
  isAllowlisted,
  collectCodeFiles,
  findOrphanDeps,
  findOrphanDepsStaged,
  isScannedPath,
} from "../../../scripts/check-unused-deps.mjs"

const SCRIPT = resolve(process.cwd(), "scripts/check-unused-deps.mjs")
const tmpDirs: string[] = []

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "unused-deps-"))
  tmpDirs.push(dir)
  // package.json com 2 deps usadas + 1 órfã
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        scripts: { lint: "eslint ." },
        dependencies: { lodash: "^4.17.0", "is-odd": "^3.0.1" },
        devDependencies: {},
      },
      null,
      2,
    ),
    "utf8",
  )
  // src/index.ts usa lodash (import) — is-odd órfã
  mkdirSync(join(dir, "src"))
  writeFileSync(
    join(dir, "src", "index.ts"),
    'import lodash from "lodash"\nconsole.log(lodash)\n',
    "utf8",
  )
  return dir
}

function runCheck(dir: string, args: string[] = []) {
  return spawnSync(process.execPath, [SCRIPT, "--root", dir, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
}

/** Cria um repo git real (init + config + commit base) num temp dir. */
function makeGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "unused-deps-git-"))
  tmpDirs.push(dir)
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ scripts: {}, dependencies: { lodash: "^4.17.0" } }, null, 2),
    "utf8",
  )
  mkdirSync(join(dir, "src"))
  writeFileSync(join(dir, "src", "index.ts"), 'import lodash from "lodash"\n', "utf8")
  git(dir, ["init", "-q", "-b", "main"])
  git(dir, ["config", "user.email", "test@example.com"])
  git(dir, ["config", "user.name", "Test"])
  git(dir, ["add", "-A"])
  git(dir, ["commit", "-qm", "base"])
  return dir
}

function git(dir: string, args: string[]): { status: number | null; stdout: string } {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" })
  return { status: r.status, stdout: r.stdout }
}

/** Atualiza o package.json do repo e dá git add (staged). */
function stageDep(dir: string, dep: string, version = "^1.0.0"): void {
  const pkgPath = join(dir, "package.json")
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>
  const deps = (pkg.dependencies ?? {}) as Record<string, string>
  deps[dep] = version
  pkg.dependencies = deps
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), "utf8")
  git(dir, ["add", "package.json"])
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ── depERE (git grep ERE — espelho do depPattern) ─────────────────────────

describe("depERE", () => {
  it("gera ERE POSIX com boundary espelhando o depPattern", () => {
    // ERE POSIX é para `git grep -E` — NÃO é compilável por RegExp JS
    // ([:alnum:] é classe POSIX). Aqui validamos o SHAPE da string; a
    // semântica real (casa import, não casa substring, casa CLI) é coberta
    // pelos testes CLI que rodam o git grep de verdade.
    expect(depERE("lodash")).toBe("(^|[^[:alnum:]_\\-])lodash([^[:alnum:]_\\-]|$)")
    expect(depERE("@types/node")).toBe("(^|[^[:alnum:]_\\-])@types/node([^[:alnum:]_\\-]|$)")
  })

  it("não escapa hífen (literal fora de classe no ERE — mesmo do depPattern)", () => {
    // O hífen do nome (zod-to-openapi) é literal em ERE fora de classe;
    // pontos e outros metacaracteres SÃO escapados.
    const ere = depERE("zod-to-openapi")
    expect(ere).toBe("(^|[^[:alnum:]_\\-])zod-to-openapi([^[:alnum:]_\\-]|$)")
    expect(depERE("@babel/core")).toContain("@babel/core")
  })
})

// ── isScannedPath (filtro dos hits do git grep --cached) ──────────────────

describe("isScannedPath", () => {
  it("aceita código e rejeita docs/lockfiles/temp", () => {
    expect(isScannedPath("src/index.ts")).toBe(true)
    expect(isScannedPath(".husky/pre-commit")).toBe(true)
    expect(isScannedPath("docs/API.md")).toBe(false)
    expect(isScannedPath("bun.lock")).toBe(false)
    expect(isScannedPath("run-server.sh")).toBe(false) // IGNORE_PREFIX run-
    expect(isScannedPath("node_modules/x.ts")).toBe(false) // dir ALWAYS_IGNORE
  })
})

// ── depPattern ────────────────────────────────────────────────────────────

describe("depPattern", () => {
  it("casa import com aspas e boundary de palavra", () => {
    expect(depPattern("lodash").test('import lodash from "lodash"')).toBe(true)
    expect(depPattern("lodash").test("const x = require('lodash')")).toBe(true)
  })

  it("NÃO casa substring de outra dep (next vs next-intl, react vs react-dom)", () => {
    expect(depPattern("next").test('from "next-intl"')).toBe(false)
    expect(depPattern("next").test('from "next-themes"')).toBe(false)
    expect(depPattern("react").test('from "react-markdown"')).toBe(false)
    expect(depPattern("react").test('from "react-dom"')).toBe(false)
    expect(depPattern("zod").test('from "zod-to-openapi"')).toBe(false)
  })

  it("suporta subpath do pacote (import de arquivo interno)", () => {
    expect(depPattern("react-hook-form").test('from "react-hook-form/../dist"')).toBe(true)
  })

  it("casa CLI em scripts (bunx/npx/run)", () => {
    expect(depPattern("eslint").test("bun run lint")).toBe(false) // lint é entry, não a dep
    expect(depPattern("eslint").test("eslint .")).toBe(true)
    expect(depPattern("prisma").test("prisma generate")).toBe(true)
  })
})

// ── isAllowlisted ─────────────────────────────────────────────────────────

describe("isAllowlisted", () => {
  it("@types/* por prefixo", () => {
    expect(isAllowlisted("@types/node").allowed).toBe(true)
    expect(isAllowlisted("@types/react").allowed).toBe(true)
  })

  it("uso implícito documentado: sharp, bun-types, coverage-v8, husky, lint-staged, prisma", () => {
    for (const d of [
      "sharp",
      "bun-types",
      "@vitest/coverage-v8",
      "husky",
      "lint-staged",
      "prisma",
    ]) {
      expect(isAllowlisted(d).allowed).toBe(true)
    }
  })

  it("dep normal NÃO é allowlist", () => {
    expect(isAllowlisted("lodash").allowed).toBe(false)
    expect(isAllowlisted("next").allowed).toBe(false)
  })
})

// ── collectCodeFiles ──────────────────────────────────────────────────────

describe("collectCodeFiles", () => {
  it("escaneia ts/tsx/sh/yml/css mas pula md/json-de-dados/lockfiles/snap", () => {
    const dir = mkdtempSync(join(tmpdir(), "unused-deps-files-"))
    tmpDirs.push(dir)
    mkdirSync(join(dir, "src"))
    mkdirSync(join(dir, "node_modules"))
    mkdirSync(join(dir, "docs"))
    writeFileSync(join(dir, "src", "a.ts"), "", "utf8")
    writeFileSync(join(dir, "src", "b.tsx"), "", "utf8")
    writeFileSync(join(dir, "node_modules", "junk.ts"), "", "utf8")
    writeFileSync(join(dir, "docs", "guide.md"), "", "utf8")
    writeFileSync(join(dir, "src", "data.json"), "", "utf8")
    writeFileSync(join(dir, "bun.lock"), "", "utf8")
    writeFileSync(join(dir, "README.md"), "", "utf8")
    writeFileSync(join(dir, "_temp-scan.tmp.mjs"), "", "utf8")
    writeFileSync(join(dir, "package.json"), "{}", "utf8")

    const files = collectCodeFiles(dir)
    expect(files).toContain("src/a.ts")
    expect(files).toContain("src/b.tsx")
    expect(files).toContain("package.json") // config JSON escaneada
    expect(files).not.toContain("node_modules/junk.ts")
    expect(files).not.toContain("docs/guide.md")
    expect(files).not.toContain("src/data.json")
    expect(files).not.toContain("bun.lock")
    expect(files).not.toContain("README.md")
    expect(files).not.toContain("_temp-scan.tmp.mjs")
  })

  it("escaneia Dockerfile* e .husky/* (arquivos SEM extensão — RUN bunx e hooks)", () => {
    const dir = mkdtempSync(join(tmpdir(), "unused-deps-docker-"))
    tmpDirs.push(dir)
    mkdirSync(join(dir, ".husky"))
    writeFileSync(join(dir, "Dockerfile"), "RUN bunx prisma generate\n", "utf8")
    writeFileSync(join(dir, "Dockerfile.worker"), "RUN bunx prisma generate\n", "utf8")
    writeFileSync(join(dir, ".husky", "pre-commit"), "bunx lint-staged\n", "utf8")
    writeFileSync(join(dir, ".husky", "pre-push"), "bunx lint-staged\n", "utf8")
    writeFileSync(join(dir, "run-server.sh"), "# dev script\n", "utf8") // ignorado (prefixo run-)

    const files = collectCodeFiles(dir)
    expect(files).toContain("Dockerfile")
    expect(files).toContain("Dockerfile.worker")
    expect(files).toContain(".husky/pre-commit")
    expect(files).toContain(".husky/pre-push")
    expect(files).not.toContain("run-server.sh") // IGNORE_PREFIX "run-"
  })
})

// ── findOrphanDeps ────────────────────────────────────────────────────────

describe("findOrphanDeps", () => {
  it("detecta a órfã e ignora a usada", () => {
    const dir = makeRepo()
    const { orphans, total } = findOrphanDeps(dir)
    expect(total).toBe(2)
    expect(orphans.map((o) => o.dep)).toEqual(["is-odd"])
  })

  it("allowlist nunca é órfã mesmo sem ref", () => {
    const dir = mkdtempSync(join(tmpdir(), "unused-deps-allow-"))
    tmpDirs.push(dir)
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify(
        { dependencies: { sharp: "^0.34.0", "@types/node": "^26", lodash: "^4" } },
        null,
        2,
      ),
      "utf8",
    )
    mkdirSync(join(dir, "src"))
    writeFileSync(join(dir, "src", "a.ts"), 'import lodash from "lodash"\n', "utf8")
    const { orphans } = findOrphanDeps(dir)
    expect(orphans).toEqual([]) // sharp e @types/node allowlist; lodash usada
  })

  it("scripts do package.json contam como referência (CLI)", () => {
    const dir = mkdtempSync(join(tmpdir(), "unused-deps-cli-"))
    tmpDirs.push(dir)
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { lint: "eslint ." }, devDependencies: { eslint: "^9" } }, null, 2),
      "utf8",
    )
    const { orphans } = findOrphanDeps(dir)
    expect(orphans).toEqual([]) // eslint via CLI no script
  })

  it("package.json auto-ref (campo deps) NÃO conta como referência", () => {
    const dir = mkdtempSync(join(tmpdir(), "unused-deps-selfref-"))
    tmpDirs.push(dir)
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { "is-odd": "^3" } }, null, 2),
      "utf8",
    )
    const { orphans } = findOrphanDeps(dir)
    expect(orphans.map((o) => o.dep)).toEqual(["is-odd"]) // o próprio campo deps não é ref
  })
})

// ── CLI real (fixtures em temp dir) ───────────────────────────────────────

describe("check-unused-deps.mjs — CLI real (fixtures)", () => {
  it("exit 0: todas as deps têm referência", () => {
    const dir = makeRepo()
    writeFileSync(
      join(dir, "src", "index.ts"),
      'import lodash from "lodash"\nimport isOdd from "is-odd"\n',
      "utf8",
    )
    const res = runCheck(dir)
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("todas com referência")
  })

  it("exit 1: dep órfã detectada (a mutação que o guard pega)", () => {
    const dir = makeRepo()
    const res = runCheck(dir)
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("is-odd")
  })

  it("exit 1 --json: orphanCount estruturado", () => {
    const dir = makeRepo()
    const res = runCheck(dir, ["--json"])
    expect(res.status).toBe(1)
    const j = JSON.parse(res.stdout)
    expect(j.total).toBe(2)
    expect(j.orphanCount).toBe(1)
    expect(j.orphans).toEqual(["is-odd"])
  })

  it("exit 0 --json quando limpo", () => {
    const dir = makeRepo()
    writeFileSync(
      join(dir, "src", "index.ts"),
      'import lodash from "lodash"\nimport isOdd from "is-odd"\n',
      "utf8",
    )
    const res = runCheck(dir, ["--json"])
    expect(res.status).toBe(0)
    expect(JSON.parse(res.stdout).orphanCount).toBe(0)
    expect(res.stdout).not.toBe("") // guarda: JSON estruturado sempre sai no stdout
  })

  it("exit 2: package.json ausente no root (fail-closed)", () => {
    const dir = mkdtempSync(join(tmpdir(), "unused-deps-nopkg-"))
    tmpDirs.push(dir)
    const res = runCheck(dir)
    expect(res.status).toBe(2)
    expect(res.stderr).toContain("package.json ausente")
  })
})

// ── MODO --staged (pre-commit) — repo git real ────────────────────────────

describe("check-unused-deps.mjs --staged — CLI real (repo git)", () => {
  it("exit 0: sem diff staged do package.json (caso comum do pre-commit)", () => {
    const dir = makeGitRepo()
    const res = runCheck(dir, ["--staged"])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("nenhuma dep adicionada")
  })

  it("exit 1: dep ADICIONADA no staged sem referência no índice", () => {
    const dir = makeGitRepo()
    stageDep(dir, "is-odd")
    const res = runCheck(dir, ["--staged"])
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("is-odd")
    expect(res.stderr).toContain("--staged")
  })

  it("exit 0: dep ADICIONADA com import TAMBÉM staged (par commitado)", () => {
    const dir = makeGitRepo()
    stageDep(dir, "is-odd")
    writeFileSync(
      join(dir, "src", "index.ts"),
      'import lodash from "lodash"\nimport isOdd from "is-odd"\n',
      "utf8",
    )
    git(dir, ["add", "src/index.ts"])
    const res = runCheck(dir, ["--staged"])
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("todas com referência")
  })

  it("exit 1: import em arquivo NÃO staged NÃO conta (o commit não o carrega)", () => {
    const dir = makeGitRepo()
    stageDep(dir, "is-odd")
    // import no working tree mas NÃO staged — o commit carregaria a dep órfã
    writeFileSync(
      join(dir, "src", "index.ts"),
      'import lodash from "lodash"\nimport isOdd from "is-odd"\n',
      "utf8",
    )
    const res = runCheck(dir, ["--staged"])
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("is-odd")
    expect(res.stderr).toContain("git add")
  })

  it("exit 0: dep allowlist adicionada (sharp) não acusa", () => {
    const dir = makeGitRepo()
    stageDep(dir, "sharp")
    const res = runCheck(dir, ["--staged"])
    expect(res.status).toBe(0)
  })

  it("--json: shape com mode/added/orphans", () => {
    const dir = makeGitRepo()
    stageDep(dir, "is-odd")
    const res = runCheck(dir, ["--staged", "--json"])
    expect(res.status).toBe(1)
    const j = JSON.parse(res.stdout)
    expect(j.mode).toBe("staged")
    expect(j.added).toEqual(["is-odd"])
    expect(j.orphanCount).toBe(1)
    expect(j.orphans).toEqual(["is-odd"])
  })
})

describe("findOrphanDepsStaged (função pura — índice vs HEAD)", () => {
  it("detecta dep adicionada órfã e ignora a usada no mesmo par", () => {
    const dir = makeGitRepo()
    stageDep(dir, "is-odd")
    writeFileSync(
      join(dir, "src", "index.ts"),
      'import lodash from "lodash"\nimport isOdd from "is-odd"\n',
      "utf8",
    )
    git(dir, ["add", "src/index.ts"])
    // 2ª dep órfã: só no package.json staged
    stageDep(dir, "chalk")
    const { added, orphans } = findOrphanDepsStaged(dir)
    expect(added.sort()).toEqual(["chalk", "is-odd"])
    expect(orphans.map((o) => o.dep)).toEqual(["chalk"])
  })

  it("sem diff staged → added vazio", () => {
    const dir = makeGitRepo()
    const { added, orphans } = findOrphanDepsStaged(dir)
    expect(added).toEqual([])
    expect(orphans).toEqual([])
  })

  it("referência em script do package.json staged conta (CLI)", () => {
    const dir = makeGitRepo()
    // adiciona dep + script que a usa, ambos staged
    const pkgPath = join(dir, "package.json")
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>
      scripts?: Record<string, string>
    }
    pkg.dependencies = { ...pkg.dependencies, eslint: "^9" }
    pkg.scripts = { lint: "eslint ." }
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), "utf8")
    git(dir, ["add", "package.json"])
    const { orphans } = findOrphanDepsStaged(dir)
    expect(orphans).toEqual([])
  })
})
