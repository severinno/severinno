/**
 * check-no-leaked-imports.test.ts
 *
 * Testes do guard de RESOLUÇÃO DE IMPORTS (scripts/check-no-leaked-imports.mjs) —
 * o bug que ele bloqueia: worktree aninhado no projeto pai, o tsc local resolve
 * um import de dep NÃO DECLARADA contra o node_modules do PAI (o Node sobe a
 * árvore), mascarando o erro que o CI limpo (checkout novo, sem pai) pegaria
 * como TS2307. Caso real: `z-ai-web-dev-sdk` importado em
 * src/app/api/chat/route.ts sem estar no package.json — meses despercebido.
 *
 * Cobre:
 *   - maskStrings: string/template/heredoc mascarados (fixture de teste que
 *     grava 'import x from "y"' como STRING não pode acusar leak)
 *   - extractBareSpecifiers: import/export-from/require()/import() dinâmico;
 *     pula relativo, @/ alias, node:/bun: builtin; subpath scoped → pacote
 *   - resolveImport: dentro do worktree → ok; FORA (node_modules do pai via
 *     require.resolve real) → leak; não-resolve + declarado → pending-install;
 *     não-resolve + não-declarado → undeclared (fail); server-only →
 *     compiler-level (ok)
 *   - CLI real (fixtures em temp dir): exit 0 limpo; exit 1 com dep que
 *     resolve fora; exit 1 com dep não-declarada e inexistente; exit 2 sem
 *     package.json
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-no-leaked-imports.test.ts
 */

import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  maskStrings,
  extractBareSpecifiers,
  isBareSpecifier,
  pkgFromSpec,
  resolveImport,
  findLeakedImports,
} from "../../../scripts/check-no-leaked-imports.mjs"

const SCRIPT = resolve(process.cwd(), "scripts/check-no-leaked-imports.mjs")
const tmpDirs: string[] = []

/** Cria um repo fixture com package.json + src/index.ts + node_modules local. */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "no-leak-"))
  tmpDirs.push(dir)
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ dependencies: { lodash: "^4.17.0" } }, null, 2),
    "utf8",
  )
  mkdirSync(join(dir, "src"))
  // node_modules local com lodash real (resolve dentro)
  mkdirSync(join(dir, "node_modules", "lodash"), { recursive: true })
  writeFileSync(
    join(dir, "node_modules", "lodash", "package.json"),
    JSON.stringify({ name: "lodash", main: "index.js", version: "4.17.21" }),
    "utf8",
  )
  writeFileSync(join(dir, "node_modules", "lodash", "index.js"), "module.exports = {}\n", "utf8")
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

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ── maskStrings ───────────────────────────────────────────────────────────

describe("maskStrings", () => {
  it("mascara TODAS as strings — inclusive o argumento de imports reais", () => {
    const src = 'const fixture = \'import isOdd from "is-odd"\\n\'\nimport lodash from "lodash"\n'
    const masked = maskStrings(src)
    // string de fixture (import fake em teste) totalmente mascarada
    expect(masked).not.toContain("is-odd")
    // o argumento do import REAL também é mascarado — o parse usa o
    // conteúdo CRU + filtro por posição (extractBareSpecifiers/stringRanges),
    // não o output mascarado (mascara só para exibir/inspecionar)
    expect(masked).not.toContain('"lodash"')
    // âncoras e identificadores FORA de strings permanecem
    expect(masked).toContain("import lodash from")
  })

  it("mascara template literal com escape", () => {
    const src = 'const t = `import x from \\"y\\"`\n'
    const masked = maskStrings(src)
    expect(masked).not.toContain("y")
  })
})

// ── extractBareSpecifiers ─────────────────────────────────────────────────

describe("extractBareSpecifiers", () => {
  it("pega import, export-from, require() e import() dinâmico", () => {
    const src = [
      'import lodash from "lodash"',
      'import "reflect-metadata"',
      'export { x } from "zod"',
      'const a = require("pg")',
      'const b = await import("socket.io")',
      'import type { T } from "@prisma/client"',
    ].join("\n")
    expect(extractBareSpecifiers(src).sort()).toEqual([
      "@prisma/client",
      "lodash",
      "pg",
      "reflect-metadata",
      "socket.io",
      "zod",
    ])
  })

  it("pula relativo, alias @/, node:/bun: builtin e builtins sem prefixo", () => {
    const src = [
      'import a from "./local"',
      'import b from "../up"',
      'import c from "@/lib/utils"',
      'import d from "node:fs"',
      'import e from "bun:test"',
      'import f from "path"',
    ].join("\n")
    expect(extractBareSpecifiers(src)).toEqual([])
  })

  it("NÃO extrai de comentários (prosa com import from)", () => {
    const src = "// re-exports from distance-fallback, geo-shared\nconst x = 1\n"
    expect(extractBareSpecifiers(src)).toEqual([])
  })

  it("NÃO extrai de strings de fixture em testes (o masking cobre)", () => {
    const src = 'writeFileSync(p, \'import isOdd from "is-odd"\\n\', "utf8")\n'
    expect(extractBareSpecifiers(src)).toEqual([])
  })
})

// ── isBareSpecifier / pkgFromSpec ─────────────────────────────────────────

describe("isBareSpecifier / pkgFromSpec", () => {
  it("classifica bare corretamente", () => {
    expect(isBareSpecifier("lodash")).toBe(true)
    expect(isBareSpecifier("@scope/pkg/sub")).toBe(true)
    expect(isBareSpecifier("./x")).toBe(false)
    expect(isBareSpecifier("@/lib/x")).toBe(false)
    expect(isBareSpecifier("node:fs")).toBe(false)
    expect(isBareSpecifier("bun:test")).toBe(false)
    expect(isBareSpecifier("path")).toBe(false)
  })

  it("subpath scoped normaliza para o pacote raiz", () => {
    expect(pkgFromSpec("@scope/pkg/sub")).toBe("@scope/pkg")
    expect(pkgFromSpec("zod/helpers")).toBe("zod")
    expect(pkgFromSpec("@prisma/client/runtime/client")).toBe("@prisma/client")
  })
})

// ── resolveImport ─────────────────────────────────────────────────────────

describe("resolveImport", () => {
  it("dentro do worktree → ok", () => {
    const dir = makeRepo()
    const r = resolveImport("lodash", join(dir, "src", "index.ts"), dir)
    expect(r.kind).toBe("ok")
    expect(r.leaked).toBe(false)
  })

  it("server-only (compiler-level Next) → ok mesmo sem pacote", () => {
    const dir = makeRepo()
    const r = resolveImport("server-only", join(dir, "src", "index.ts"), dir)
    expect(r.kind).toBe("ok")
    expect(r.leaked).toBe(false)
  })

  it("declarada mas não instalada → pending-install (não falha)", () => {
    const dir = makeRepo()
    // declara no package.json mas SEM o node_modules correspondente
    // Use a package name that is NOT installed system-wide
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
    pkg.dependencies["@nonexistent/test-pkg-for-leak-guard"] = "^1.0.0"
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2), "utf8")
    const r = resolveImport(
      "@nonexistent/test-pkg-for-leak-guard",
      join(dir, "src", "index.ts"),
      dir,
    )
    expect(r.kind).toBe("pending-install")
    expect(r.leaked).toBe(false)
  })

  it("não-declarada e não-instalada → undeclared (falha)", () => {
    const dir = makeRepo()
    const r = resolveImport("is-odd", join(dir, "src", "index.ts"), dir)
    expect(r.kind).toBe("undeclared")
    expect(r.leaked).toBe(true)
  })
})

// ── findLeakedImports (integração com fake parent node_modules) ───────────

describe("findLeakedImports", () => {
  it("detecta import que resolve no node_modules do PAI (leak real)", () => {
    // repo filho (worktree) SEM o pacote; pai COM o pacote — o require.resolve
    // sobe a árvore e acha no pai = o bug do z-ai.
    const parent = mkdtempSync(join(tmpdir(), "no-leak-parent-"))
    tmpDirs.push(parent)
    mkdirSync(join(parent, "node_modules", "z-ai-web-dev-sdk"), { recursive: true })
    writeFileSync(
      join(parent, "node_modules", "z-ai-web-dev-sdk", "package.json"),
      JSON.stringify({ name: "z-ai-web-dev-sdk", main: "index.js", version: "0.0.18" }),
      "utf8",
    )
    writeFileSync(
      join(parent, "node_modules", "z-ai-web-dev-sdk", "index.js"),
      "module.exports = {}\n",
      "utf8",
    )

    // worktree aninhado no pai
    const child = join(parent, "worktree")
    mkdirSync(join(child, "src"), { recursive: true })
    writeFileSync(
      join(child, "package.json"),
      JSON.stringify({ dependencies: {} }, null, 2),
      "utf8",
    )
    writeFileSync(
      join(child, "src", "route.ts"),
      'import { zai } from "z-ai-web-dev-sdk"\n',
      "utf8",
    )

    const { leaks, pending } = findLeakedImports(child)
    expect(leaks.length).toBe(1)
    expect(leaks[0].spec).toBe("z-ai-web-dev-sdk")
    expect(leaks[0].kind).toBe("leak")
    expect(pending).toEqual([])
  })

  it("import declarado e instalado no worktree → zero leaks", () => {
    const dir = makeRepo()
    const { leaks, pending } = findLeakedImports(dir)
    expect(leaks).toEqual([])
    expect(pending).toEqual([])
  })
})

// ── CLI real (fixtures em temp dir) ───────────────────────────────────────

describe("check-no-leaked-imports.mjs — CLI real (fixtures)", () => {
  it("exit 0: imports resolvem dentro do worktree", () => {
    const dir = makeRepo()
    const res = runCheck(dir)
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("resolvem dentro")
  })

  it("exit 1: import que resolve no node_modules do PAI (leak real)", () => {
    const parent = mkdtempSync(join(tmpdir(), "no-leak-cli-parent-"))
    tmpDirs.push(parent)
    mkdirSync(join(parent, "node_modules", "z-ai-web-dev-sdk"), { recursive: true })
    writeFileSync(
      join(parent, "node_modules", "z-ai-web-dev-sdk", "package.json"),
      JSON.stringify({ name: "z-ai-web-dev-sdk", main: "index.js" }),
      "utf8",
    )
    writeFileSync(
      join(parent, "node_modules", "z-ai-web-dev-sdk", "index.js"),
      "module.exports = {}\n",
      "utf8",
    )
    const child = join(parent, "worktree")
    mkdirSync(join(child, "src"), { recursive: true })
    writeFileSync(
      join(child, "package.json"),
      JSON.stringify({ dependencies: {} }, null, 2),
      "utf8",
    )
    writeFileSync(
      join(child, "src", "route.ts"),
      'import { zai } from "z-ai-web-dev-sdk"\n',
      "utf8",
    )

    const res = runCheck(child)
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("z-ai-web-dev-sdk")
    expect(res.stderr).toContain("worktree")
  })

  it("exit 1: dep não-declarada e não-instalada em lugar nenhum", () => {
    const dir = makeRepo()
    writeFileSync(join(dir, "src", "index.ts"), 'import isOdd from "is-odd"\n', "utf8")
    const res = runCheck(dir)
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("is-odd")
  })

  it("exit 0: server-only (compiler-level) não acusa", () => {
    const dir = makeRepo()
    writeFileSync(
      join(dir, "src", "index.ts"),
      'import "server-only"\nimport lodash from "lodash"\n',
      "utf8",
    )
    const res = runCheck(dir)
    expect(res.status).toBe(0)
  })

  it("exit 2: package.json ausente (fail-closed)", () => {
    const dir = mkdtempSync(join(tmpdir(), "no-leak-nopkg-"))
    tmpDirs.push(dir)
    const res = runCheck(dir)
    expect(res.status).toBe(2)
    expect(res.stderr).toContain("package.json ausente")
  })
})
