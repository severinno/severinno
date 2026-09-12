#!/usr/bin/env node

// =============================================================================
// check-contract-pairs.mjs
//
// Guard parametrizável (padrão check-mutation-timing-contract.mjs) que valida
// CONTRATOS DUPLICADOS do repo via pares arquivo↔marker: cada contrato em
// CONTRACTS declara um literal (valor ou marcador) que DEVE ser consistente
// entre vários arquivos — falhando quando um PR atualiza um lado e esquece o
// outro (o drift que a duplicação esconde até o runtime quebrar).
//
// Dois modos por contrato:
//   - mode "equal": cada par é {file, regex} com UM grupo de captura; o valor
//     capturado deve ser o MESMO em todos os pares. Zero matches num arquivo
//     = violação (o literal sumiu/foi renomeado). Vários matches por arquivo
//     são tolerados desde que todos tenham o mesmo valor.
//   - mode "contains": cada contrato tem marker + files[]; o marcador deve
//     existir como substring em TODOS os arquivos.
//
// Contratos reais wireados (fonte da verdade = mutation test + script):
//   1. BUDGET_MAX=240 (mutation test)   ↔ --max 240 (jobs do CI)      — equal
//   2. --warn-median 4  (mutation test)  ↔ --warn-median 4 (jobs CI)   — equal
//   3. --warn-margin 0.2 (mutation test) ↔ --warn-margin 0.2 (jobs CI) — equal
//   4. 'Usando Bun pré-instalado'      (script setup-bun-ci.sh ↔ guard) — contains
//   5. 'Restore Bun cache'  (workflow pr-check ↔ guard tier-2)         — contains
//
// NOTA (BUDGET_WARN/BUDGET_ALERT): NÃO são wireados de propósito — a faixa
// soft dos jobs virou DERIVADA da mediana (--warn-median) e o --alert só
// existe no mutation test; não há literal correspondente nos workflows para
// travar (a duplicação real é a do warn-median/warn-margin, acima).
//
// Usage:
//   node scripts/check-contract-pairs.mjs            # repo atual (working tree)
//   node scripts/check-contract-pairs.mjs --root X   # fixture (testes)
//   node scripts/check-contract-pairs.mjs --staged   # git diff --cached (pre-commit)
//   node scripts/check-contract-pairs.mjs --staged --base HEAD  # ref (CI)
//
// Modo --staged (espelho do check-bun-mirror.mjs --staged): lê os arquivos
// dos contratos do ÍNDICE git (git show :path) ou de uma REF (--base) e roda
// o MESMO checkContractPairs — um bump de literal staged num só local falha
// aqui ANTES do merge (estágio parcial).
//
// Exit codes:
//   0 — todos os contratos consistentes (pass)
//   1 — violação: drift em pelo menos um contrato (mensagem com o par)
//   2 — infra: arquivo ausente/ilegível OU git/ref indisponível (fail-closed)
// =============================================================================

import { readFileSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

/**
 * @typedef {{ name: string, mode: "equal", pairs: { file: string, regex: RegExp }[] }} EqualContract
 * @typedef {{ name: string, mode: "contains", marker: string, files: string[] }} ContainsContract
 * @typedef {EqualContract | ContainsContract} ContractSpec
 */

/**
 * CONTRATOS do repo — adicionar um contrato novo = adicionar uma entrada AQUI
 * (parametrizável por pares arquivo↔marker). As regexes dos workflows são
 * ESCOPO-DELIMITADAS pela invocação do medidor (node scripts/
 * measure-mutation-timing.mjs ...) para não casar outros --max de jobs
 * diferentes (ex.: o --max 10 do check-setup-bun-warm no benchmark-weekly).
 *
 * @type {ContractSpec[]}
 */
export const CONTRACTS = [
  {
    name: "budget duro do mutation-coord (BUDGET_MAX ↔ --max)",
    mode: "equal",
    pairs: [
      { file: "scripts/test-mutation-timing-budget.sh", regex: /BUDGET_MAX=(\d+)/ },
      {
        file: ".github/workflows/pr-check.yml",
        regex: /node scripts\/measure-mutation-timing\.mjs[\s\S]*?--max (\d+)/,
      },
      {
        file: ".github/workflows/benchmark-weekly.yml",
        regex: /node scripts\/measure-mutation-timing\.mjs[\s\S]*?--max (\d+)/,
      },
    ],
  },
  {
    name: "janela da mediana do mutation-coord (--warn-median)",
    mode: "equal",
    pairs: [
      { file: "scripts/test-mutation-timing-budget.sh", regex: /--warn-median (\d+)/ },
      {
        file: ".github/workflows/pr-check.yml",
        regex: /node scripts\/measure-mutation-timing\.mjs[\s\S]*?--warn-median (\d+)/,
      },
      {
        file: ".github/workflows/benchmark-weekly.yml",
        regex: /node scripts\/measure-mutation-timing\.mjs[\s\S]*?--warn-median (\d+)/,
      },
    ],
  },
  {
    name: "margem da mediana do mutation-coord (--warn-margin)",
    mode: "equal",
    pairs: [
      { file: "scripts/test-mutation-timing-budget.sh", regex: /--warn-margin ([\d.]+)/ },
      {
        file: ".github/workflows/pr-check.yml",
        regex: /node scripts\/measure-mutation-timing\.mjs[\s\S]*?--warn-margin ([\d.]+)/,
      },
      {
        file: ".github/workflows/benchmark-weekly.yml",
        regex: /node scripts\/measure-mutation-timing\.mjs[\s\S]*?--warn-margin ([\d.]+)/,
      },
    ],
  },
  {
    name: "marcador tier-1 'Usando Bun pré-instalado'",
    mode: "contains",
    marker: "Usando Bun pré-instalado",
    files: ["scripts/setup-bun-ci.sh", "scripts/check-tier1-fastpath.mjs"],
  },
  {
    // O par canônico do repo nomeia o step de cache e o guard de tier-2 casa
    // esse NOME no log do act. Se um lado mudar sozinho, o guard fica cego
    // (não acha a evidência e reporta passo ausente) — esta é a costura que
    // impede isso. O nome é o mesmo em TODAS as forjas (o par é copiado
    // byte a byte pelo check:bun-mirror, que trava a key ao lado dele).
    name: "step de cache 'Restore Bun cache'",
    mode: "contains",
    marker: "Restore Bun cache",
    files: [".github/workflows/pr-check.yml", "scripts/check-tier2-cache-restore.mjs"],
  },
]

/**
 * Valida uma ref git (ex.: HEAD, origin/main) — rejeita metacharacters de
 * shell/argumentos (espelho do check-mutation-timing-contract.mjs).
 *
 * @param {string} ref
 * @returns {boolean}
 */
export function isValidGitRef(ref) {
  return /^[a-zA-Z0-9._\-/]+$/.test(ref)
}

/**
 * Lê um arquivo do ESTADO git (índice via `:path`, ou ref via `ref:path`) —
 * a fonte do modo --staged. Indexado por `git show` (o índice é a fonte da
 * verdade do que SERIA commitado).
 *
 * @param {string} root  diretório do repo
 * @param {string|null} ref  ref git (null = índice)
 * @param {string} rel  caminho relativo do arquivo
 * @returns {{ content: string } | { error: string }}
 */
export function gitShowFile(root, ref, rel) {
  // git exige forward slashes no path (no Windows o join() produz `\\`).
  const gitPath = rel.split(/[\\/]/).join("/")
  const spec = ref ? `${ref}:${gitPath}` : `:${gitPath}`
  try {
    const content = execFileSync("git", ["-C", root, "show", spec], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    })
    return { content }
  } catch (e) {
    const stderr = (e.stderr ?? "").toString().trim().slice(0, 200)
    return { error: `git show '${spec}' falhou: ${stderr || e.message}` }
  }
}

// ── Helpers puros (exportados para testes) ────────────────────────────────

/** Lista de caminhos únicos referenciados pelos contratos (para leitura). */
export function contractFiles(contracts = CONTRACTS) {
  const seen = new Set()
  for (const c of contracts) {
    if (c.mode === "contains") for (const f of c.files) seen.add(f)
    else for (const p of c.pairs) seen.add(p.file)
  }
  return [...seen]
}

/**
 * Extrai TODOS os valores do grupo 1 do regex de um conteúdo (global: todos
 * os matches; a regex declarada não precisa de /g).
 *
 * @param {string} content
 * @param {RegExp} regex
 * @returns {string[]}
 */
export function extractPairValues(content, regex) {
  const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`)
  return [...String(content).matchAll(re)].map((m) => m[1]).filter((v) => v !== undefined)
}

/**
 * Valida um contrato mode "equal": o valor capturado deve ser o MESMO em
 * todos os pares. Zero matches num arquivo = violação (literal sumiu).
 *
 * @param {EqualContract} contract
 * @param {Record<string, string>} contents  arquivo → conteúdo
 * @returns {string[]} violações (vazio = consistente)
 */
export function checkEqualContract(contract, contents) {
  const violations = []
  const distinct = new Set()
  const perFile = []
  for (const pair of contract.pairs) {
    const content = contents[pair.file] ?? ""
    if (content === "") {
      violations.push(`arquivo '${pair.file}' não lido (ausente?) — fail-closed`)
      continue
    }
    const values = extractPairValues(content, pair.regex)
    if (values.length === 0) {
      violations.push(
        `padrão '${pair.regex}' não encontrado em ${pair.file} — literal removido ou renomeado?`,
      )
      continue
    }
    const local = [...new Set(values)]
    perFile.push(`'${pair.file}'=[${local.join(", ")}]`)
    for (const v of local) distinct.add(v)
  }
  if (distinct.size > 1) {
    violations.push(
      `valores DIVERGEM entre os locais: ${perFile.join(" vs ")} — atualize os pares de forma coordenada`,
    )
  }
  return violations
}

/**
 * Valida um contrato mode "contains": o marcador deve existir em TODOS os
 * arquivos listados.
 *
 * @param {ContainsContract} contract
 * @param {Record<string, string>} contents  arquivo → conteúdo
 * @returns {string[]} violações (vazio = consistente)
 */
export function checkContainsContract(contract, contents) {
  const violations = []
  for (const file of contract.files) {
    const content = contents[file] ?? ""
    if (!content.includes(contract.marker)) {
      violations.push(
        `marcador '${contract.marker}' AUSENTE em ${file} — o outro lado do contrato foi renomeado?`,
      )
    }
  }
  return violations
}

/**
 * Roda TODOS os contratos e agrega as violações (mensagens com o nome do
 * contrato para diagnóstico).
 *
 * @param {typeof CONTRACTS} contracts
 * @param {Record<string, string>} contents  arquivo → conteúdo
 * @returns {string[]} violações (vazio = tudo consistente)
 */
export function checkContractPairs(contracts, contents) {
  const violations = []
  for (const c of contracts) {
    const vs =
      c.mode === "contains" ? checkContainsContract(c, contents) : checkEqualContract(c, contents)
    for (const v of vs) violations.push(`[${c.name}] ${v}`)
  }
  return violations
}

// ── Varredura principal ───────────────────────────────────────────────────

/**
 * Lê todos os arquivos referenciados pelos contratos do working tree.
 *
 * @param {string} root  diretório do repo (ou fixture de teste)
 * @returns {{ data: Record<string, string> } | { error: string }}
 */
export function collectContractData(root) {
  const contents = {}
  for (const rel of contractFiles()) {
    const abs = join(root, rel)
    if (!existsSync(abs)) return { error: `${rel} ausente em ${root}` }
    try {
      contents[rel] = readFileSync(abs, "utf8")
    } catch (e) {
      return { error: `falha ao ler ${rel}: ${e.message}` }
    }
  }
  return { data: contents }
}

/**
 * Modo --staged: lê os arquivos dos contratos do ESTADO git (índice por
 * padrão, ou a ref dada) — validando o que SERIA commitado.
 *
 * @param {string} root  diretório do repo
 * @param {string|null} ref  ref git (null = índice)
 * @returns {{ data: Record<string, string> } | { error: string }}
 */
export function collectStagedData(root, ref) {
  const contents = {}
  for (const rel of contractFiles()) {
    const res = gitShowFile(root, ref, rel)
    if (res.error) return { error: res.error }
    contents[rel] = res.content
  }
  return { data: contents }
}

// ── CLI ───────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2)
  const rootIdx = argv.indexOf("--root")
  const root = rootIdx !== -1 ? argv[rootIdx + 1] : process.cwd()
  if (rootIdx !== -1 && !argv[rootIdx + 1]) {
    console.error("❌ --root exige um caminho")
    process.exit(2)
  }

  const staged = argv.includes("--staged")
  const baseIdx = argv.indexOf("--base")
  const base = baseIdx !== -1 ? argv[baseIdx + 1] : null
  if (baseIdx !== -1 && !argv[baseIdx + 1]) {
    console.error("❌ --base exige uma ref (ex.: HEAD, origin/main)")
    process.exit(2)
  }
  if (base && !staged) {
    console.error("❌ --base exige --staged (o --base só tem efeito no modo --staged)")
    process.exit(2)
  }
  if (staged && base !== null && !isValidGitRef(base)) {
    console.error(`❌ --base com ref inválida: '${base}'`)
    process.exit(2)
  }

  const { data, error } = staged ? collectStagedData(root, base) : collectContractData(root)
  if (error) {
    console.error(`❌ check-contract-pairs${staged ? " (--staged)" : ""}: ${error}`)
    process.exit(2)
  }

  const violations = checkContractPairs(CONTRACTS, data)
  if (violations.length > 0) {
    console.error(
      `❌ Contratos duplicados do repo inconsistentes entre os locais (${violations.length}):\n`,
    )
    for (const v of violations) console.error(`   - ${v}`)
    console.error(
      `\n   Adicionar um contrato novo = adicionar uma entrada em CONTRACTS (scripts/` +
        `\n   check-contract-pairs.mjs) com os pares arquivo↔marker. Bump de um literal` +
        `\n   (ex.: BUDGET_MAX) exige atualizar TODOS os pares no MESMO PR — este guard` +
        `\n   fecha o par. Modo --staged: o estado validado é o que SERIA commitado` +
        `\n   (índice${base ? ` / ref ${base}` : ""}), não o working tree.`,
    )
    process.exit(1)
  }

  console.log(
    `✅ ${CONTRACTS.length} contratos duplicados consistentes (${staged ? "staged — " : ""}BUDGET_MAX/warn-median/warn-margin/tier-1 markers ↔ workflows e action).`,
  )
  process.exit(0)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
