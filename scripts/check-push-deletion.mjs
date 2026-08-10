#!/usr/bin/env node
/**
 * check-push-deletion.mjs - atalho de push de delecao pura no pre-push (2026-08)
 *
 * WHY: a secao 8.4 do gates-proofs.md mediu ~74s por push (fuzz:ci 53s + 3
 * gates 18s + encoding ~1.5s + docs <1s). Um push de DELECAO PURA
 * (`git push origin --delete branch` ou `:branch`) nao transporta NENHUM
 * commit novo - e housekeeping de branches: rodar a cadeia inteira e testar
 * nada. Este script e o atalho: le o stdin do hook (uma linha por ref:
 * "<local ref> <local sha> <remote ref> <remote sha>") e exit 0 quando TODAS
 * as refs sao delecoes (local sha all-zeros) - o .husky/pre-push pula a
 * cadeia inteira com aviso (~74s -> ~0.4s medido no hook real, node boot
 * domina - nao <10ms; o custo do checker puro e ~10ms, o do hook ~0.4s).
 *
 * SEMANTICA: delecao PURA = todas as linhas com local sha all-zeros. Push
 * MISTO (delecao + ref real na mesma chamada) NAO e delecao pura: carrega
 * codigo e os gates rodam (exit 1). Stdin vazio / invocacao manual (TTY) =
 * exit 1 (nada detectado - o hook preserva o comportamento atual).
 *
 * Saida ASCII pura (gate file). Puro node, sem deps, <10ms.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ALL_ZEROS = /^0+$/

/**
 * Parse the pre-push hook stdin into ref lines and decide if it is a PURE
 * DELETION push. Exported for unit tests: the CLI (main) is a thin wrapper.
 * Returns { pureDeletion, total, deletions } - pureDeletion is true ONLY
 * when there is at least one ref line AND every line has an all-zeros local
 * sha (field 2). CRLF is normalized (a Windows checkout could produce it).
 */
export function analyzePushStdin(stdin) {
  const lines = stdin.split(/\r?\n/).filter((l) => l.trim() !== "")
  const fields = lines.map((l) => l.trim().split(/\s+/))
  const deletions = fields.filter((f) => f.length >= 2 && ALL_ZEROS.test(f[1])).length
  const pureDeletion = fields.length > 0 && deletions === fields.length
  return { pureDeletion, total: fields.length, deletions }
}

function main() {
  const { pureDeletion, total, deletions } = analyzePushStdin(fs.readFileSync(0, "utf8"))
  if (pureDeletion) {
    console.log(
      `check-push-deletion: PURE DELETION (${deletions}/${total} refs, local sha all-zeros) - skip pre-push gates`,
    )
    return 0
  }
  if (total === 0) {
    console.log("check-push-deletion: no refs (manual run?) - run gates")
  } else {
    console.log(
      `check-push-deletion: not a pure deletion (${deletions}/${total} refs are deletions) - run gates`,
    )
  }
  return 1
}

// Entry-point guard: only run the CLI when executed directly (vitest imports
// analyzePushStdin for unit tests without side effects).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
