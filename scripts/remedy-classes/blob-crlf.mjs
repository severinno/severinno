/**
 * remedy-classes/blob-crlf.mjs
 *
 * A DECLARAÇÃO da classe `blob-crlf` — CRLF/mixed no BLOB do ÍNDICE dos
 * `.sh`/`.bash`. O guard DONO é `scripts/check-blob-crlf.sh`.
 *
 * O fixer dele ESTAGIA POR CONTA PRÓPRIA (`git add --renormalize`): o remédio não
 * tem como re-estagiar um subconjunto, então o `estagio: "self"` é o que faz o
 * driver RETÊ-la quando algum ofensor tem WIP ou não é deste commit (o caminho à
 * mão, aí, é a única saída sem levar junto o que não é do remendo).
 */

import { classeDeGuardDeShell } from "../remedy-shell-guard.mjs"

export default classeDeGuardDeShell({
  id: "blob-crlf",
  ordem: 30,
  script: "check-blob-crlf.sh",
  label: "CRLF/mixed no BLOB do ÍNDICE dos `.sh`/`.bash`",
  verde: "os blobs `.sh`/`.bash` estão em LF",
  vermelho: "ainda há CRLF/mixed no BLOB do ÍNDICE",
  estagio: "self",
  deteccao: ["--ci"],
  fixer: { argv: ["--fix"], comando: "bash scripts/check-blob-crlf.sh --fix" },
  sugere: () => [
    "bash scripts/check-blob-crlf.sh --fix   # normaliza o ÍNDICE (git add --renormalize) — REVISE git diff --cached",
  ],
})
