#!/usr/bin/env node
/**
 * fuzz-targets.mjs - manifest de alvos das suites fuzz (secao 11.11 do
 * gates-proofs.md, adotado 2026-08-10).
 *
 * WHY THIS EXISTS: o fuzz:ci rodava TODAS as 6 suites em 6 spawns vitest
 * (~40.4s) a cada push - 71% do custo do pre-push. A avaliacao 11.11 mediu
 * que (a) o boot por-spawn domina o custo (6 suites em UMA invocacao =
 * 14.45s vs 40.4s) e (b) mapear por diff (solo as suites cujos alvos foram
 * tocados) corta o tipico para ~6-14s. O mapeamento por nome-colocado do
 * collectTestFiles NAO cobre fuzz (`address-autocomplete-fuzz.test.tsx` !=
 * `__tests__/address-autocomplete.test.tsx`) - precisa deste manifest
 * explicito: suite fuzz -> alvos de codigo.
 *
 * CONTRACT DE COBERTURA (a classe de gap silencioso da secao 11.11, ponto
 * 5): uma suite `*-fuzz*.test.{ts,tsx}` NOVA em src/ sem entrada neste
 * manifest rodaria SO no CI (o runner mapeado nao a selecionaria) - o
 * `--check-coverage` abaixo falha com o caminho exato, e o teste
 * REAL-REPO CONTRACT do fuzz-mapped.test.ts trava a sincronia nos dois
 * sentidos (nenhuma suite descoberta sem manifest; nenhuma entrada de
 * manifest orfa/renomeada).
 *
 * Aresta SHARED-HELPER: todas as suites importam o barrel `@/lib/__tests__`
 * (src/lib/__tests__/index.ts -> fuzz-utils.ts) e a consistency testa o
 * shim .mjs. Tocar QUALQUER um desses 3 dispara TODAS as suites (a suite de
 * consistency tem o fuzz-utils.mjs como alvo proprio; a aresta garante que
 * uma mudanca no helper nao passe despercebida nas demais).
 *
 * API (importavel - entry-point guarded, mesmo padrao dos outros guards):
 *   FUZZ_TARGETS, SHARED_HELPER_FILES, isFuzzFile(filePath),
 *   discoverFuzzSuites(root), selectFuzzSuites(touched),
 *   allFuzzSuites(), missingManifestSuites(root)
 *
 * CLI:
 *   node scripts/fuzz-targets.mjs                  # imprime o manifest
 *   node scripts/fuzz-targets.mjs --check-coverage # falha se uma suite
 *     fuzz descoberta em src/ nao tem entrada no manifest (exit 1 com os
 *     caminhos exatos; exit 0 = cobertura completa). Env override
 *     FUZZ_TARGETS_SCAN_ROOT aponta para um repo sintetico (testes
 *     hermeticos / provas), espelhando o PUSH_SUITE_SCAN_ROOT.
 *
 * Saida ASCII pura (gate file). Puro node, sem deps, <50ms.
 */
import { readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/**
 * Manifest suite -> alvos (caminhos POSIX relativos ao root do repo). A
 * ordem do array e a ordem de execucao do runner mapeado (dedupe preserva
 * a ordem do manifest). Mantenha os alvos de cada suite = os imports de
 * CODIGO do suite (nao os helpers de teste - a aresta shared-helper cobre
 * os helpers abaixo).
 */
export const FUZZ_TARGETS = [
  {
    suite: "src/lib/__tests__/benchmark-utils-fuzz.test.ts",
    targets: ["src/lib/benchmark-utils.ts"],
  },
  {
    suite: "src/lib/__tests__/cache-key-fuzz.test.ts",
    targets: ["src/lib/radius-expansion.ts"],
  },
  {
    suite: "src/lib/__tests__/distance-fallback-fuzz.test.ts",
    targets: ["src/lib/distance-fallback.ts"],
  },
  {
    suite: "src/lib/__tests__/radius-expansion-fuzz.test.ts",
    targets: ["src/lib/radius-expansion.ts"],
  },
  {
    suite: "src/lib/__tests__/fuzz-utils-consistency.test.ts",
    targets: ["src/lib/fuzz-utils.mjs", "src/lib/__tests__/fuzz-utils.ts"],
  },
  {
    suite: "src/components/vitrine/__tests__/address-autocomplete-fuzz.test.tsx",
    targets: ["src/components/vitrine/address-autocomplete.tsx"],
  },
]

/**
 * Aresta shared-helper: qualquer um destes arquivos tocado dispara TODAS as
 * suites (o barrel do `@/lib/__tests__` que todas importam + o shim .mjs).
 */
export const SHARED_HELPER_FILES = [
  "src/lib/__tests__/index.ts",
  "src/lib/__tests__/fuzz-utils.ts",
  "src/lib/fuzz-utils.mjs",
]

/** True para arquivos de suite fuzz (o mesmo match do run-all-fuzz.mjs). */
export function isFuzzFile(filePath) {
  const name = filePath.replace(/\\/g, "/").split("/").pop() ?? ""
  return /(?:^|[-._])fuzz[^/]*\.test\.[jt]sx?$/i.test(name)
}

/**
 * Descobre as suites fuzz sob <root>/src (arvore igual a do run-all-fuzz:
 * *.test.{ts,tsx} recursivo + filtro fuzz). Retorna caminhos POSIX
 * relativos ao root, ordenados. src/ ausente = [] (root sintetico minimo).
 */
export function discoverFuzzSuites(root = REPO_ROOT) {
  const src = path.join(root, "src")
  const found = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (isFuzzFile(entry.name)) found.push(full)
    }
  }
  walk(src)
  return found
    .map((f) => path.relative(root, f).replace(/\\/g, "/"))
    .sort()
}

/** Todas as suites do manifest (ordem do manifest). */
export function allFuzzSuites() {
  return FUZZ_TARGETS.map((e) => e.suite)
}

/**
 * Seleciona as suites cuja superficie foi tocada:
 *  - um arquivo shared-helper (barrel fuzz-utils) -> TODAS as suites;
 *  - senao, a uniao das suites cujo(s) alvo(s) aparecem em `touched`.
 * Normaliza backslashes (git emite POSIX, mas um teste Windows pode passar
 * caminhos nativos). Ordem = ordem do manifest, dedupe embutido.
 */
export function selectFuzzSuites(touched = [], manifest = FUZZ_TARGETS) {
  const norm = touched.map((f) => f.replace(/\\/g, "/"))
  if (norm.some((f) => SHARED_HELPER_FILES.includes(f))) return allFuzzSuites()
  const out = []
  for (const entry of manifest) {
    if (entry.targets.some((t) => norm.includes(t))) out.push(entry.suite)
  }
  return out
}

/**
 * Suites descobertas em src/ sem entrada no manifest - o gap silencioso da
 * secao 11.11 ponto 5 (rodaria so no CI, nunca no runner mapeado).
 */
export function missingManifestSuites(root = REPO_ROOT) {
  const manifestSet = new Set(allFuzzSuites())
  return discoverFuzzSuites(root).filter((s) => !manifestSet.has(s))
}

function main() {
  const args = process.argv.slice(2)
  const root = process.env.FUZZ_TARGETS_SCAN_ROOT
    ? path.resolve(process.env.FUZZ_TARGETS_SCAN_ROOT)
    : REPO_ROOT

  if (args.includes("--check-coverage")) {
    const missing = missingManifestSuites(root)
    if (missing.length === 0) {
      const n = discoverFuzzSuites(root).length
      console.log(
        `fuzz-targets: coverage clean (${n} suite(s) fuzz descoberta(s) em src/ - todas com entrada no manifest)`,
      )
      return 0
    }
    for (const suite of missing) {
      console.log(
        `fuzz-targets: FUZZ SUITE SEM MANIFEST em ${suite} (add ao FUZZ_TARGETS do scripts/fuzz-targets.mjs - o runner mapeado nao a seleciona, rodaria so no CI, secao 11.11 ponto 5)`,
      )
    }
    return 1
  }

  console.log("fuzz-targets: manifest suite -> alvos")
  for (const entry of FUZZ_TARGETS) {
    console.log(`  ${entry.suite}`)
    for (const t of entry.targets) console.log(`    -> ${t}`)
  }
  console.log("  shared-helper (dispara TODAS): " + SHARED_HELPER_FILES.join(", "))
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
