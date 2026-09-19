/**
 * remedy-classes/crlf.mjs
 *
 * A DECLARAÇÃO da classe `crlf` — CR/CRLF no working tree dos `.sh`/`.bash`
 * rastreados. O guard DONO é `scripts/check-crlf.sh`: é ELE que acusa (com
 * `--ci`) e é o `--fix` DELE que remenda; aqui só se declara o argv, o prefixo da
 * lista de ofensores e como o remendo chega ao índice (`git add --renormalize`,
 * que re-grava o blob em LF sem tocar no conteúdo).
 *
 * O nome do arquivo É o id da classe; o guard dono é validado na descoberta
 * (existe, e a sua superfície declara `--fix`).
 */

import { classeDeGuardDeShell } from "../remedy-shell-guard.mjs"

export default classeDeGuardDeShell({
  id: "crlf",
  ordem: 20,
  script: "check-crlf.sh",
  label: "CR/CRLF no working tree dos scripts `.sh`/`.bash` rastreados",
  verde: "os `.sh`/`.bash` rastreados estão em LF",
  vermelho: "ainda há CRLF no working tree dos `.sh`/`.bash`",
  estagio: "renormalize",
  deteccao: ["--ci"],
  fixer: { argv: ["--fix"], comando: "bash scripts/check-crlf.sh --fix" },
  sugere: (paths) => [
    "bash scripts/check-crlf.sh --fix   # remenda a ÁRVORE — REVISE o diff",
    `git add --renormalize ${paths.join(" ")}`,
  ],
})
