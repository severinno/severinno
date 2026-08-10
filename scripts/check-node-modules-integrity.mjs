#!/usr/bin/env node
/**
 * check-node-modules-integrity.mjs - guard de layout divergente do node_modules (2026-08)
 *
 * WHY: a secao 8.5 do gates-proofs.md documentou a classe de erro em que o
 * `bun install` COMUM nao detecta um node_modules divergente: o bun confia no
 * layout existente e reporta "no changes" mesmo quando o store esta corrompido
 * (react/react-dom duplicados -> invalid hook call em TODA a suite de
 * componentes; 114 testes vermelhos por motivo ambiental, nao de codigo). O
 * bun NAO reconcilia um layout divergente - o reparo e o install limpo
 * (`rm -rf node_modules && bun install --frozen-lockfile`, 160s, lock
 * byte-identical). Este guard e o sinal barato que trava essa classe ANTES de
 * o tsc/testes falharem com sintomas confusos.
 *
 * DETECCAO (default, DUAS camadas):
 *   1. PAR (o legado da 8.5): compara a VERSAO instalada de react e
 *      react-dom (via leitura direta de node_modules/<pkg>/package.json, sem
 *      require() - mais barato e imune a cache de modulos) com a versao
 *      RESOLVIDA no bun.lock (grep da linha `"react": ["react@19.2.3", ...]`
 *      do lock JSON do bun - o 1o elemento do array da entrada e o
 *      specifier resolvido). Divergiu = o node_modules nao reflete o lock
 *      -> o bun install comum nao repara -> falha com o comando de cura.
 *      Dois pacotes bastam: o par react/react-dom e o que, duplicado,
 *      derruba a suite inteira (a classe da 8.5); uma divergencia em
 *      qualquer outro pacote relevante aparece como sintoma em tsc/testes.
 *   2. EXTRANEOUS (o esquecido da 8.6): varre os pacotes de TOPO do
 *      node_modules (dirs diretos + cada `@scope/pkg` filho; pula dirs
 *      dot-prefixed - .bin/.cache/.prisma/.vite/.package-lock.json - e
 *      arquivos soltos) e cruza com o CONJUNTO de chaves do bun.lock
 *      (entradas array-valued `"key": ["key@ver", ...]`; specs de
 *      dependencia dentro de uma entrada sao string/object-valued e nunca
 *      casam). Um pacote instalado que NAO tem chave no lock = o resquicio
 *      do `bun add --no-save` sem restore (sec. 8.6): instalado fora do
 *      lock, invisivel para o bun install comum. Falha com a mesma cura.
 *      Custo ~10-30ms (regex de chaves + readdir do topo) - cabe no hook.
 *
 * --check-lock (OPCIONAL): o MESMO conceito estendido a TODOS os pacotes
 * diretos do package.json (dependencies + devDependencies +
 * optionalDependencies - peerDependencies ficam de fora: sao contratos do
 * consumidor, nao instalados pelo repo) contra o bun.lock. Para cada dep
 * direto: grep do specifier resolvido e comparacao com a versao instalada em
 * node_modules/<pkg>/package.json. Alem do registro npm, trata dois casos
 * honestamente:
 *   1. Alias `npm:foo@1.2.3` (a chave do package.json NAO e a chave do
 *      lock): resolve o nome REAL (`npm:@scope/x@1.2.3` -> `@scope/x`) e
 *      valida contra ele; a versao instalada le de node_modules/<alias>/.
 *   2. Specs nao-registry (workspace:, link:, file:, git, github:, http):
 *      nao tem versao greppable no mesmo formato - SKIP explicito (nome +
 *      spec impressos, nunca silencioso) e excluidos da contagem. Hoje o
 *      repo tem 0 (98 diretos registry), entao o contrato real e puro.
 * O fail-safe UNVERIFIABLE vale por dep registry: entrada do lock nao
 * localizada pelo grep (formato bun.lock futuro) = falha forcando update,
 * nunca clean silencioso. Custo ~100-300ms (98 package.json reads) - roda
 * sob demanda (CI opcional), NAO no pre-commit; o default (par) e o do hook.
 *
 * LIMITACAO (documentada, aceita): a comparacao e por VERSAO, nao por
 * conteudo/hash. Uma divergencia que preserva a versao (ex.: arquivos
 * corrompidos com o mesmo package.json) nao e detectada - e o mesmo limite
 * do proxy da 8.5; o proposito e flagrar o layout divergente (pacote de
 * versao errada ou ausente), nao corrupcao de bytes. Se o bun.lock nao
 * existe (repo nao instalado) o guard faz skip exit 0 - o CI e o setup
 * inicial cuidam disso; o hook so corre com node_modules presente.
 *
 * CUSTO: default <10-30ms (2 reads de package.json + 1 read do lock + 1
 * readdir do topo do node_modules + regex de chaves, puro node, sem deps);
 * --check-lock ~100-300ms (1 read do package.json do repo + N reads de
 * node_modules/<pkg>/package.json). Env override NODE_MODULES_ROOT (repo
 * sintetico p/ o vitest - espelha o NEXT_TYPES_ROOT do check-next-types e o
 * FRAGILE_SCAN_ROOT do fragile-range). Saida ASCII pura (gate file).
 */
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(process.env.NODE_MODULES_ROOT || process.cwd())
const LOCK = path.join(ROOT, "bun.lock")
// O par que, duplicado, derruba a suite inteira (a classe da secao 8.5).
const PKGS = ["react", "react-dom"]
const CHECK_LOCK = process.argv.slice(2).includes("--check-lock")

/** Escapa chars regex-especiais de um nome de pacote (ex.: '.' em nomes raros). */
function escapePkg(pkg) {
  return pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Le a versao resolvida de um pacote no bun.lock (grep da entrada JSON). */
function lockedVersion(lockText, pkg) {
  // bun.lock (lockfileVersion 1): "pkg": ["pkg@19.2.3", "https://...", ...]
  const esc = escapePkg(pkg)
  const m = lockText.match(new RegExp(`"${esc}": \\["${esc}@([^"]+)"`))
  return m ? m[1] : null
}

/** Le a versao instalada (ou null se o pacote nao esta em node_modules). */
function installedVersion(pkg) {
  const installedPath = path.join(ROOT, "node_modules", pkg, "package.json")
  return fs.existsSync(installedPath)
    ? JSON.parse(fs.readFileSync(installedPath, "utf8")).version
    : null
}

/**
 * O CONJUNTO de chaves de pacote do bun.lock. Uma entrada de pacote e
 * array-valued (`"pkg": ["pkg@ver", "https://...", ...]`); specs de
 * dependencia dentro de uma entrada sao string/object-valued e nunca
 * casam com o padrao. Scoped entra como `@scope/pkg`.
 */
function lockedKeys(lockText) {
  const keys = new Set()
  for (const m of lockText.matchAll(/"([^"]+)": \[/g)) keys.add(m[1])
  return keys
}

/**
 * Os pacotes de TOPO do node_modules (dirs diretos + cada `@scope/pkg`
 * filho). Pula dot-prefixed (`.bin`/`.cache`/`.prisma`/`.vite`/
 * `.package-lock.json`) e arquivos soltos. statSync protegido: um symlink
 * quebrado no topo nao pode derrubar o guard com throw (exit != 0 falso).
 */
function topLevelPackages() {
  const nm = path.join(ROOT, "node_modules")
  if (!fs.existsSync(nm)) return []
  const out = []
  for (const entry of fs.readdirSync(nm)) {
    if (entry.startsWith(".")) continue
    const full = path.join(nm, entry)
    let isDir = false
    try {
      isDir = fs.statSync(full).isDirectory()
    } catch {
      continue // symlink quebrado / race - nao e pacote instalado
    }
    if (!isDir) continue
    if (entry.startsWith("@")) {
      for (const sub of fs.readdirSync(full)) {
        let subDir = false
        try {
          subDir = fs.statSync(path.join(full, sub)).isDirectory()
        } catch {
          continue
        }
        if (subDir) out.push(`${entry}/${sub}`)
      }
      continue
    }
    out.push(entry)
  }
  return out
}

/**
 * Extraneous: instalado no TOPO do node_modules sem chave no lock - o
 * resquicio do `bun add --no-save` sem restore (sec. 8.6). O bun install
 * comum nao o remove (confia no layout existente - a mesma trust da 8.5).
 */
function extraneousTopLevel(lockText) {
  const keys = lockedKeys(lockText)
  return topLevelPackages().filter((p) => !keys.has(p))
}

/**
 * --check-lock: resolve a CHAVE do lock para um dep direto do package.json.
 * Retorna a chave do lock (nome registry, ou o target real de um alias npm:)
 * ou null quando o spec e nao-registry (sem versao greppable - skip explicito).
 */
function lockKeyFor(name, spec) {
  if (typeof spec !== "string") return null
  if (spec.startsWith("npm:")) {
    const m = spec.match(/^npm:(@?[^@]+)(?:@.*)?$/)
    return m ? m[1] : null
  }
  // git ssh-style (`git@github.com:org/repo.git`) tambem e nao-registry - o
  // formato `git@` nao tem versao greppable; sem isso ele cairia no
  // UNVERIFIABLE fail-safe com a mensagem ERRADA ("lock format changed?").
  if (/^(workspace:|link:|file:|git(?:[+:@]|$)|github:|http)/.test(spec)) return null
  return name
}

/** Os pacotes diretos do package.json (dependencies + devDependencies + optionalDependencies). */
function directDeps(pkgJson) {
  const deps = []
  for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, spec] of Object.entries(pkgJson[section] || {})) {
      deps.push({ name, spec })
    }
  }
  return deps
}

function printCure() {
  console.log("check-node-modules-integrity: node_modules divergente do lock - o bun install comum NAO repara (confia no layout existente)")
  console.log("check-node-modules-integrity: CURE: rm -rf node_modules && bun install --frozen-lockfile")
  console.log("check-node-modules-integrity: (sec. 8.5 do gates-proofs.md: install limpo, lock byte-identical, 160s)")
}

/** --check-lock: valida TODOS os pacotes diretos do package.json contra o bun.lock. */
function checkLock(lockText) {
  const pkgJsonPath = path.join(ROOT, "package.json")
  if (!fs.existsSync(pkgJsonPath)) {
    console.log("check-node-modules-integrity: --check-lock skip (no package.json to derive direct deps)")
    return 0
  }
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"))
  const skipped = []
  const checks = []
  for (const { name, spec } of directDeps(pkgJson)) {
    const key = lockKeyFor(name, spec)
    if (key === null) {
      skipped.push({ name, spec })
    } else {
      checks.push({ name, key })
    }
  }
  const diverged = []
  const unverifiable = []
  for (const c of checks) {
    const locked = lockedVersion(lockText, c.key)
    const installed = installedVersion(c.name)
    if (locked === null) {
      unverifiable.push(c.name)
      continue
    }
    if (installed !== locked) {
      diverged.push({ pkg: c.name, installed: installed || "MISSING", locked })
    }
  }
  if (unverifiable.length > 0) {
    console.log(`check-node-modules-integrity: --check-lock UNVERIFIABLE ${unverifiable.join("/")} - resolved version not found in bun.lock (lock format changed? update the guard)`)
    return 1
  }
  for (const s of skipped) {
    console.log(`check-node-modules-integrity: --check-lock SKIP ${s.name} (spec '${s.spec}') - non-registry, no version-greppable lock entry`)
  }
  if (diverged.length === 0) {
    console.log(`check-node-modules-integrity: --check-lock clean (${checks.length} direct packages match bun.lock; ${skipped.length} skipped non-registry)`)
    return 0
  }
  for (const d of diverged) {
    console.log(`check-node-modules-integrity: DIVERGENT ${d.pkg} installed=${d.installed} locked=${d.locked}`)
  }
  printCure()
  return 1
}

function main() {
  if (!fs.existsSync(LOCK)) {
    console.log("check-node-modules-integrity: skip (no bun.lock to compare)")
    return 0
  }
  const lockText = fs.readFileSync(LOCK, "utf8")
  if (CHECK_LOCK) {
    return checkLock(lockText)
  }
  const diverged = []
  const unverifiable = []
  for (const pkg of PKGS) {
    const locked = lockedVersion(lockText, pkg)
    const installed = installedVersion(pkg)
    // FAIL-SAFE: lock existe mas a entrada do pkg NAO foi localizada (ex.:
    // bun.lock v2 futuro muda o formato da linha) - nunca 'clean' silencioso
    // com o guard desligado; falha com mensagem explicita forcando a atualizacao.
    if (locked === null) {
      unverifiable.push(pkg)
      continue
    }
    if (installed !== locked) {
      diverged.push({ pkg, installed: installed || "MISSING", locked })
    }
  }
  if (unverifiable.length > 0) {
    console.log(`check-node-modules-integrity: UNVERIFIABLE ${unverifiable.join("/")} - resolved version not found in bun.lock (lock format changed? update the guard)`)
    return 1
  }
  if (diverged.length === 0) {
    const versions = PKGS.map((p) => lockedVersion(lockText, p)).join("/")
    const extraneous = extraneousTopLevel(lockText)
    if (extraneous.length > 0) {
      for (const p of extraneous) {
        console.log(
          `check-node-modules-integrity: EXTRANEOUS ${p} installed at node_modules/${p} but NOT in bun.lock (bun add --no-save sem restore?)`,
        )
      }
      printCure()
      return 1
    }
    console.log(
      `check-node-modules-integrity: clean (react/react-dom match bun.lock: ${versions}; 0 extraneous top-level packages)`,
    )
    return 0
  }
  for (const d of diverged) {
    console.log(
      `check-node-modules-integrity: DIVERGENT ${d.pkg} installed=${d.installed} locked=${d.locked}`,
    )
  }
  printCure()
  return 1
}

process.exitCode = main()
