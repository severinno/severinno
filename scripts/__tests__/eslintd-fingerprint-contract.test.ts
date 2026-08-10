/**
 * eslintd-fingerprint-contract.test.ts - trava a enumeracao manual de plugins
 * do eslintd-shim.sh contra a config real (2026-08).
 *
 * WHY: o fingerprint do shim (secao 11.6 do gates-proofs.md) tem a lista de
 * plugins que a config pode carregar MANUALMENTE - se um plugin NOVO for
 * adicionado ao eslint.config.mjs (ou a deps do eslint-config-next) e alguem
 * esquecer de adiciona-lo ao hash, uma edicao de config que dependa dele nao
 * forca o restart do daemon (staleness silenciosa - a classe que a 11.2
 * recusou e a 11.6 fechou com o shim). Este teste trava a enumeracao contra
 * a realidade em 3 camadas, sem rede e sem subprocess (so fs + regex):
 *
 * 1. COVERAGE DOS IMPORTS: todo import de plugin/config do eslint.config.mjs
 *    (eslint-config-next/*) deve estar no fingerprint do shim.
 * 2. COVERAGE DAS DEPS DE PLUGIN: todo eslint-plugin-* (direto do
 *    eslint-config-next OU transitivo do meta-package typescript-eslint) deve
 *    estar no fingerprint - a versao de um plugin que a config carrega muda,
 *    o daemon precisa reiniciar.
 * 3. NADENCIO: pacotes que o shim hash (plugins) devem EXISTIR no node_modules
 *    - um plugin renomeado/removido com o hash estatico apontando para um
 *    path morto deixaria o fingerprint cego para a versao dele.
 *
 * A lista do shim NAO e duplicada aqui: o teste extrai os `for p in ...` do
 * proprio scripts/eslintd-shim.sh (regex nos blocos), entao uma mudanca na
 * enumeracao do shim atualiza o teste automaticamente - o contrato e a
 * RELACAO shim-vs-config, nao uma copia da lista.
 *
 * Subprocess-free (fs + regex, sem spawn) - timeouts explicitos por seguranca
 * (o scan-timeouts guard exige timeout explicito em teste que possa esperar).
 */
import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const SHIM = path.join(ROOT, "scripts", "eslintd-shim.sh")
const CONFIG = path.join(ROOT, "eslint.config.mjs")
const NEXT_CFG_PKG = path.join(ROOT, "node_modules", "eslint-config-next", "package.json")

/** The manual plugin list the shim hashes, extracted from its own `for p in ...` blocks. */
function shimHashedPackages(): string[] {
  const src = fs.readFileSync(SHIM, "utf8")
  const pkgs: string[] = []
  // The two `for p in <list>; do` blocks in eslintd-shim.sh (config bundles + plugins).
  const re = /for p in ([^;]+); do/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    for (const name of m[1].split(/\s+/)) {
      const clean = name.trim().replace(/\\$/, "") // the loop's line-continuation backslash
      if (clean) pkgs.push(clean)
    }
  }
  return [...new Set(pkgs)]
}

/** Direct plugin deps of eslint-config-next (the config bundle the app imports). */
function nextConfigPluginDeps(): string[] {
  const pkg = JSON.parse(fs.readFileSync(NEXT_CFG_PKG, "utf8"))
  return Object.keys(pkg.dependencies || {}).filter((d) => /eslint-plugin|typescript-eslint/.test(d))
}

/** The transitive plugin deps of the `typescript-eslint` meta-package (parser + plugin). */
function typescriptEslintDeps(): string[] {
  const pkgPath = path.join(ROOT, "node_modules", "typescript-eslint", "package.json")
  if (!fs.existsSync(pkgPath)) return []
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
  return Object.keys(pkg.dependencies || {}).filter((d) => /eslint-plugin|parser/.test(d))
}

/** The packages eslint.config.mjs imports that the shim should cover (config bundles). */
function configImports(): string[] {
  const src = fs.readFileSync(CONFIG, "utf8")
  const out: string[] = []
  const re = /from\s+["']([^"']+)["']/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    const spec = m[1]
    if (spec.startsWith("eslint-config-next/")) out.push(spec)
  }
  return out
}

describe("eslintd-shim fingerprint - a enumeracao manual vs a config real (sec 11.6)", () => {
  it("COVERAGE IMPORTS: todo eslint-config-next/* importado pela config esta no hash do shim", () => {
    const hashed = shimHashedPackages()
    for (const imp of configImports()) {
      expect(hashed, `eslint.config.mjs importa ${imp} mas o shim nao o enumera no fingerprint`).toContain(imp)
    }
  }, 30000)

  it("COVERAGE DEPS: todo plugin que a config carrega (deps do eslint-config-next + transitivas do typescript-eslint) esta no hash do shim", () => {
    const hashed = shimHashedPackages()
    const expected = [...nextConfigPluginDeps(), ...typescriptEslintDeps()]
    expect(expected.length).toBeGreaterThan(0)
    for (const dep of expected) {
      expect(
        hashed,
        `eslint-config-next/typescript-eslint dependem de ${dep} mas o shim nao o enumera no fingerprint - um bump de versao dele nao reiniciaria o daemon`,
      ).toContain(dep)
    }
  }, 30000)

  it("EXISTENCIA: todo plugin que o shim enumera existe no node_modules (path de hash vivo)", () => {
    const hashed = shimHashedPackages()
    for (const name of hashed) {
      if (name.startsWith("eslint-config-next/")) continue // bundles, resolvidos pelo for de config
      const pkgPath = path.join(ROOT, "node_modules", name, "package.json")
      expect(
        fs.existsSync(pkgPath),
        `o shim hasheia ${name} mas node_modules/${name}/package.json nao existe - enumeracao morta, versao invisivel ao fingerprint`,
      ).toBe(true)
    }
  }, 30000)

  it("SANITY: a lista do shim nao esta vazia e o eslint.config.mjs importa config bundles (contrato vivo)", () => {
    expect(shimHashedPackages().length).toBeGreaterThan(0)
    expect(configImports().length).toBeGreaterThan(0)
  }, 30000)
})
