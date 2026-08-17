#!/usr/bin/env node

// =============================================================================
// check-realtime-copy.mjs
//
// Description: CI guard (node-puro, <1s) que valida que o Dockerfile do
//   realtime (mini-services/realtime/Dockerfile) COPIA todo módulo local
//   importado — direta ou TRANSITIVAMENTE — por index.ts. Previne a regressão
//   de imagem quebrada: um módulo novo importado sem COPY correspondente
//   boota o container com "module not found" (o gap que quebrou 2x antes do
//   fix COPY *.ts ./).
//
// Derivação (fonte da verdade = CÓDIGO, nunca lista hardcoded):
//   - Módulos: closure transitivo dos imports locais (`from "./x"` /
//     `import ... from "./x"` / re-export `export { x } from "./x"`) a partir
//     de index.ts — cada módulo local é lido e seus próprios imports locais
//     são seguidos até fechar (guarda de ciclo). Imports de SUBDIRETÓRIO
//     (ex.: `./lib/helper`) são rastreados como `lib/helper` — o glob `*.ts`
//     do COPY NÃO recursa, então um módulo em subdiretório é module not
//     found no boot (flagrado na camada 2, ver abaixo).
//   - COPY: parse das linhas `COPY <src> <dest>` do Dockerfile. O glob
//     `*.ts` (ou `*.js`) cobre QUALQUER módulo top-level do diretório; o
//     dest `.` cobre o diretório INTEIRO (recursivo); uma lista explícita
//     exige que cada módulo importado esteja nela.
//
// Regras (todas as direções):
//   → (1) arquivo AUSENTE em QUALQUER lugar (resolved-set acumulado via
//         readModule) = module not found no boot — SEMPRE violação, mesmo que
//         o módulo esteja na lista do COPY (a lista não ressuscita arquivo
//         deletado; fecha o fail-open do skip por list-membership).
//   → (2) arquivo EXISTE mas o COPY não o alcança: subdiretório + glob `*.ts`
//         que não recursa (gated em hasGlob — a lista explícita é dona do
//         caso; no mixed glob+lista a entrada da lista cobre o subdir e não
//         flagra) OU ausente da lista explícita.
//   ← (reverse)   lista explícita no COPY com módulo SEM uso em index.ts =
//                 entrada órfã (arquivo morto na imagem — crescimento).
//   🛡 (fail-closed) index.ts, Dockerfile ou linha COPY ausentes = violação
//                 (sem fonte da verdade o guard não pode validar).
//
// Usage:
//   node scripts/check-realtime-copy.mjs [--root DIR]
//     --root  diretório a varrer (default: cwd) — usado nos testes de fixture
//
// Exit codes:
//   0 — pass (todo módulo importado tem arquivo no diretório; COPY cobre;
//             sem entradas órfãs)
//   1 — violações encontradas (lista módulo/arquivo + direção)
//   2 — flag desconhecida
//
// Escopo: mini-services/realtime (index.ts + Dockerfile + módulos locais).
//   Lê os 2 arquivos de contrato + o closure de imports. Node puro, sem deps.
// =============================================================================

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

/** Arquivos ignorados na varredura de entradas órfãs da lista do COPY. */
const IGNORED_MODULES = new Set(["index"])

/**
 * Apaga comentários (/* *\/ e //) preservando strings — a mesma convenção do
 * check-cache-patterns.mjs: uma menção em prosa/JSDoc (ex.: docstring citando
 * `from "./x"`) não pode contar como import real.
 */
export function stripComments(code) {
  let out = ""
  let i = 0
  let inBlock = false
  let quote = null
  while (i < code.length) {
    const ch = code[i]
    const next = code[i + 1]
    if (inBlock) {
      if (ch === "*" && next === "/") {
        out += "  "
        inBlock = false
        i += 2
      } else {
        out += " "
        i++
      }
      continue
    }
    if (quote) {
      out += ch
      if (ch === "\\") {
        out += next ?? ""
        i += 2
        continue
      }
      if (ch === quote) quote = null
      i++
      continue
    }
    if (ch === "/" && next === "*") {
      inBlock = true
      out += "  "
      i += 2
      continue
    }
    if (ch === "/" && next === "/") {
      out += "  "
      i += 2
      while (i < code.length && code[i] !== "\n") {
        out += " "
        i++
      }
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch
      out += ch
      i++
      continue
    }
    out += ch
    i++
  }
  return out
}

/**
 * Extrai os imports LOCAIS de um módulo TS (`from "./x"`, `import "./x"`,
 * re-export `export { a } from "./x"`). Normaliza: `./x` → `x`, `.ts`/`.js`
 * removido. Imports de pacotes (`socket.io`, `node:...`) e caminhos
 * absolutos NÃO são locais. Imports de SUBDIRETÓRIO (`./lib/helper`) são
 * normalizados para `lib/helper` — rastreados para o forward flagrar o gap
 * do glob (que não recursa).
 *
 * @param {string} source  conteúdo do arquivo TS
 * @returns {string[]} nomes de módulos locais (ex.: ["security", "lib/helper"])
 */
export function extractLocalImports(source) {
  const names = new Set()
  // from "./x" | from "./x.ts" | import "./x" | export { a } from "./x"
  const re = /\b(?:from|import)\s*["'](\.[^"']+)["']/g
  let m
  while ((m = re.exec(source)) !== null) {
    let name = m[1]
    name = name.replace(/^\.\//, "").replace(/\.(ts|js|tsx|jsx)$/, "")
    if (name) names.add(name)
  }
  return [...names]
}

/**
 * Closure TRANSITIVO dos módulos locais a partir do entry: cada módulo lido
 * é resolvido via readModule(name) → source|null; os imports locais dele são
 * seguidos até fechar (Set visited evita ciclos — ex.: security ↔ index).
 *
 * @param {string} entrySource  fonte do entry (index.ts)
 * @param {(name: string) => string | null} readModule  lê o arquivo do módulo
 * @returns {string[]} nomes de módulos locais (ex.: ["security", "port"])
 */
export function collectModuleClosure(entrySource, readModule) {
  const visited = new Set()
  const queue = extractLocalImports(entrySource)
  while (queue.length > 0) {
    const name = queue.shift()
    if (visited.has(name)) continue
    visited.add(name)
    const source = readModule(name)
    if (source === null) continue // arquivo ausente → violação (checkRealtimeCopy)
    for (const inner of extractLocalImports(source)) {
      if (!visited.has(inner)) queue.push(inner)
    }
  }
  return [...visited]
}

/**
 * Parse das linhas COPY do Dockerfile. Devolve os padrões de origem:
 *   - globs (`*.ts`, `*.js`, `.`) → `.` cobre o diretório INTEIRO (recursivo);
 *     `*.ts`/`*.js` cobrem qualquer módulo top-level
 *   - list (`COPY index.ts security.ts ./`) → módulos explícitos
 * Linhas de comentário, HEALTHCHECK, etc. são ignoradas. `--from=<stage>` é
 * ignorado (origem é um estágio anterior, não o contexto de build).
 *
 * @param {string} dockerfile  conteúdo do Dockerfile
 * @returns {{ globs: string[], list: string[] }} padrões de origem do COPY
 */
export function parseDockerfileCopies(dockerfile) {
  const globs = []
  const list = []
  for (const line of dockerfile.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("COPY ")) continue
    // COPY <src...> <dest> — ignora a flag --from (estágio anterior)
    const parts = trimmed
      .replace(/^COPY\s+/, "")
      .replace(/^--from=[^\s]+\s+/, "")
      .split(/\s+/)
      .filter(Boolean)
    const dest = parts[parts.length - 1]
    const srcs = parts.slice(0, -1)
    if (dest === "." || dest === "./" || dest === "/app" || dest === "/app/") {
      for (const src of srcs) {
        if (src === ".") globs.push(".") // diretório inteiro (recursivo)
        else if (src.includes("*")) globs.push(src)
        else if (/\.(ts|js|tsx|jsx)$/.test(src)) list.push(src.replace(/\.(ts|js|tsx|jsx)$/, ""))
      }
    }
  }
  return { globs, list }
}

/**
 * Valida a cobertura em 3 direções: (1) arquivo AUSENTE em qualquer lugar
 * (module not found — SEMPRE violação, mesmo que esteja na lista do COPY);
 * (2) arquivo EXISTE mas o COPY não o alcança (subdiretório com glob *.ts
 * que não recursa, ou ausente da lista explícita); (3) reverse — entrada
 * órfã na lista explícita.
 *
 * A separação (1) vs (2) evita o fail-open: um módulo na lista do COPY com
 * arquivo DELETADO passava silenciosamente no skip da lista (o buraco que o
 * reviewer achou) — aqui arquivo ausente é flagrado SEMPRE, a lista só
 * importa para a cobertura de arquivos que existem.
 *
 * @param {string[]} modules     closure transitivo de imports (ex.: ["security"])
 * @param {{ globs: string[], list: string[] }} copies  parse do COPY
 * @param {Set<string>} dirFiles  arquivos .ts top-level do diretório (sem ext)
 * @param {Set<string>} resolved  módulos cujo ARQUIVO existe em qualquer
 *                                lugar (top-level OU subdiretório)
 * @returns {string[]} violações (vazio = consistente)
 */
export function checkRealtimeCopy(modules, copies, dirFiles, resolved) {
  const violations = []
  const coversAll = copies.globs.includes(".")
  const hasGlob = coversAll || copies.globs.some((g) => /\*\.(ts|js)$/.test(g))

  // (1) forward — arquivo NÃO EXISTE em lugar nenhum → module not found no
  // boot SEMPRE (a lista do COPY não ressuscita um arquivo deletado).
  for (const name of modules) {
    if (!resolved.has(name)) {
      violations.push(
        `módulo '${name}' importado (direta ou transitivamente) por index.ts SEM arquivo ` +
          `.ts em qualquer diretório — module not found no boot do container (deleted ou nunca criado)`,
      )
    }
  }

  // (2) forward — arquivo existe mas o COPY não o alcança. `COPY . .` copia o
  // diretório INTEIRO (recursivo) — tudo coberto. Top-level: o glob *.ts
  // cobre. Subdiretório (`lib/helper`): o glob *.ts NÃO recursa — só a lista
  // explícita (ou COPY . .) o cobre. Gated em hasGlob: com lista explícita o
  // check de lista abaixo é dono do caso (sem double-flag nem mensagem de
  // glob enganosa — nit do reviewer).
  if (hasGlob && !coversAll) {
    for (const name of modules) {
      if (!resolved.has(name)) continue // já flagrado em (1)
      if (dirFiles.has(name)) continue // top-level: glob *.ts cobre
      if (copies.list.includes(name)) continue // lista explícita cobre o subdir (mixed glob+list — fix do reviewer)
      violations.push(
        `módulo '${name}' (subdiretório) NÃO é coberto pelo glob *.ts — o glob não recursa; ` +
          `use COPY explícito ('${name}.ts'), flatten ou COPY . .`,
      )
    }
  }

  // glob cobre top-level (ou diretório inteiro) — sem check de lista
  if (hasGlob) {
    return violations
  }

  // lista explícita — cada módulo importado (com arquivo) precisa estar no COPY
  for (const name of modules) {
    if (!resolved.has(name)) continue // já flagrado em (1)
    if (!copies.list.includes(name)) {
      violations.push(
        `módulo '${name}' importado por index.ts NÃO está na lista explícita do COPY — ` +
          `image quebrada no boot (adicione '${name}.ts' ao COPY ou use o glob *.ts)`,
      )
    }
  }

  // reverse — entrada da lista sem uso real (órfã)
  for (const entry of copies.list) {
    if (IGNORED_MODULES.has(entry)) continue
    if (!modules.includes(entry)) {
      violations.push(`entrada '${entry}' na lista explícita do COPY SEM uso em index.ts — órfã (remova)`)
    }
  }

  return violations
}

/**
 * Roda o guard num root (repo ou fixture). Retorna violações + arquivos.
 *
 * @param {string} root
 * @returns {{ violations: string[], files: Record<string, boolean> }}
 */
export function runCheck(root) {
  const indexPath = join(root, "mini-services", "realtime", "index.ts")
  const dockerPath = join(root, "mini-services", "realtime", "Dockerfile")
  const dirPath = join(root, "mini-services", "realtime")
  const violations = []
  const files = {
    index: existsSync(indexPath),
    dockerfile: existsSync(dockerPath),
  }

  if (!files.index) {
    violations.push("'mini-services/realtime/index.ts' ausente no root — sem a fonte da verdade dos imports")
  }
  if (!files.dockerfile) {
    violations.push("'mini-services/realtime/Dockerfile' ausente no root — sem o COPY a validar")
  }
  if (!files.index || !files.dockerfile) return { violations, files }

  // Comentários são apagados ANTES da extração — menção em prosa/docstring de
  // `from "./x"` não conta como import real (mesma convenção do cache-patterns).
  // `resolved` acumula os módulos cujo ARQUIVO existe (top-level ou subdir) —
  // é o que separa "arquivo deletado" (falha sempre) de "existe mas não coberto".
  const resolved = new Set()
  const readModule = (name) => {
    const p = join(dirPath, `${name}.ts`)
    if (!existsSync(p)) return null
    resolved.add(name)
    return stripComments(readFileSync(p, "utf8"))
  }

  const entrySource = stripComments(readFileSync(indexPath, "utf8"))
  const modules = collectModuleClosure(entrySource, readModule)

  // arquivos .ts top-level do diretório (sem extensão) — o que o glob copia
  const dirFiles = new Set()
  for (const name of readdirSync(dirPath)) {
    const abs = join(dirPath, name)
    if (statSync(abs).isFile() && /\.(ts|js)$/.test(name) && !name.startsWith(".")) {
      dirFiles.add(name.replace(/\.(ts|js)$/, ""))
    }
  }

  const copies = parseDockerfileCopies(readFileSync(dockerPath, "utf8"))
  if (copies.globs.length === 0 && copies.list.length === 0) {
    violations.push("nenhum COPY de fonte (.ts/.js) encontrado no Dockerfile — módulos não são copiados")
  }
  violations.push(...checkRealtimeCopy(modules, copies, dirFiles, resolved))
  return { violations, files }
}

function main() {
  const argv = process.argv.slice(2)
  let root = process.cwd()
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") {
      root = resolve(argv[++i])
    } else {
      console.error(`flag desconhecida: ${argv[i]} (use --root X)`)
      process.exit(2)
    }
  }

  const { violations } = runCheck(root)

  if (violations.length > 0) {
    console.error(`❌ ${violations.length} violação(ões) do COPY do realtime:\n`)
    for (const v of violations) console.error(`   - ${v}`)
    console.error(
      `\n   Todo módulo importado por mini-services/realtime/index.ts (direta ou\n` +
        `   transitivamente) precisa ter o arquivo .ts no diretório E ser coberto\n` +
        `   pelo COPY do Dockerfile (glob *.ts cobre top-level automaticamente;\n` +
        `   lista explícita precisa listar cada um; subdiretório não é coberto\n` +
        `   pelo glob). Sem isso o container boota com 'module not found'. O guard\n` +
        `   DERIVA do código — a lista não pode driftar.`,
    )
    process.exit(1)
  }

  console.log(
    `✅ Realtime COPY consistente — todo módulo importado por index.ts tem arquivo e cobertura no Dockerfile.`,
  )
  process.exit(0)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
