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
 * CONTRATO DE SAIDA (medicao 2026-08-11, sec 11.21 - o awk inline movido
 * para ca): stdout = o remote sha APENAS (o .husky/pre-push captura como
 * PRE_PUSH_REMOTE_SHA para o Gate 3, substituindo o `printf | awk` do
 * hook - deriveRemoteSha); mensagens vao para o stderr (o stdout capturado
 * precisa ficar LIMPO para o sha); exit 0 = delecao pura (skip), exit 1 =
 * roda gates. Front path do hook: 3 subprocessos (cat + printf|awk +
 * printf|node) -> 1 spawn node, ~0.28s -> ~0.17s warm medido (A/B honesto
 * com a fiacao exata do hook, 3 runs cada, sec 11.21).
 *
 * Saida ASCII pura (gate file). Puro node, sem deps, <10ms.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ALL_ZEROS = /^0+$/

/**
 * Parse the pre-push stdin into field arrays: one per NON-EMPTY line,
 * split on whitespace. Shared by analyzePushStdin and deriveRemoteSha (the
 * 2-use helper convention - CRLF normalization + blank-line filter in ONE
 * place). Blank lines are filtered BEFORE parsing, so line indexes refer
 * to non-empty lines only (the documented divergence vs the awk's
 * literal-first-line `first` - see deriveRemoteSha).
 */
function parseRefLines(stdin) {
  return stdin
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => l.trim().split(/\s+/))
}

/**
 * Parse the pre-push hook stdin into ref lines and decide if it is a PURE
 * DELETION push. Exported for unit tests: the CLI (main) is a thin wrapper.
 * Returns { pureDeletion, total, deletions } - pureDeletion is true ONLY
 * when there is at least one ref line AND every line has an all-zeros local
 * sha (field 2). CRLF is normalized (a Windows checkout could produce it).
 */
export function analyzePushStdin(stdin) {
  const fields = parseRefLines(stdin)
  const deletions = fields.filter((f) => f.length >= 2 && ALL_ZEROS.test(f[1])).length
  const pureDeletion = fields.length > 0 && deletions === fields.length
  return { pureDeletion, total: fields.length, deletions }
}

/**
 * The remote-sha derivation for Gate 3, moved from the .husky/pre-push
 * inline awk into the checker (sec 11.21, medicao 2026-08-11): the awk
 * `NR == 1 { first = $4 } $2 !~ /^0+$/ { real = $4 } END { print (real !=
 * "" ? real : first) }` -> the LAST non-deletion line's field-4 wins;
 * fallback to the FIRST line's field-4. Equivalent to the awk on git's
 * 4-field stdin (verified against the discriminating cases in the vitest
 * suite). Two deliberate divergences, both unreachable via git's stdin:
 * (1) blank lines are FILTERED before parsing, so `first` is the first
 * NON-EMPTY line's field-4 (the awk's `first` would be the literal first
 * line's, i.e. "" for a leading blank line); (2) the `f.length >= 2`
 * guard keeps the LAST VALID real sha, where the awk would OVERWRITE
 * `real` with "" on a malformed 1-field line (then print `first`) - for a
 * 2-field line both behave the same (real = f[3] ?? "" = "").
 * Exported for unit tests (the hook now calls the CLI once and captures
 * stdout).
 */
export function deriveRemoteSha(stdin) {
  const fields = parseRefLines(stdin)
  const first = fields.length > 0 ? (fields[0][3] ?? "") : ""
  let real = ""
  for (const f of fields) {
    if (f.length >= 2 && !ALL_ZEROS.test(f[1])) real = f[3] ?? ""
  }
  return real || first
}

function main() {
  const stdin = fs.readFileSync(0, "utf8")
  // stdout = o remote sha APENAS (o hook captura como PRE_PUSH_REMOTE_SHA
  // para o Gate 3 - o awk inline movido para ca, sec 11.21); mensagens no
  // stderr para o stdout capturado ficar limpo; exit = veredicto 8.4.
  process.stdout.write(deriveRemoteSha(stdin) + "\n")
  const { pureDeletion, total, deletions } = analyzePushStdin(stdin)
  if (pureDeletion) {
    console.error(
      `check-push-deletion: PURE DELETION (${deletions}/${total} refs, local sha all-zeros) - skip pre-push gates`,
    )
    return 0
  }
  if (total === 0) {
    console.error("check-push-deletion: no refs (manual run?) - run gates")
  } else {
    console.error(
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
