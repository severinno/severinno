/**
 * remedy-classes/utf8.mjs
 *
 * A DECLARAÇÃO da classe `utf8` — o byte 0x97 (em dash do Windows-1252) nos
 * `.ts`/`.tsx` de `src/`. O guard DONO é `scripts/check-utf8.sh`.
 *
 * Duas declarações próprias desta classe:
 *   — a DETECÇÃO roda o MESMO comando que o runner do hook faz
 *     (`--dry-run --ci src/`): em dry-run o guard lista o que ELE remenderia, sem
 *     gravar nada, e o prefixo dessa lista é `  WOULD FIX: `;
 *   — o `naoRemendavel` é a METADE HONESTA: um UTF-8 inválido que não é o 0x97
 *     NÃO tem remédio mecânico, e sem essa regra "nenhum ofensor" seria lido como
 *     "nada a remendar" sobre um arquivo que o fixer não cobre.
 *
 * O `src/` é exigência de APLICABILIDADE da classe (o guard julga `src/`): num
 * repositório sem ele, a classe se declara não aplicável em vez de medir zero
 * arquivos e mentir "verde".
 */

import { classeDeGuardDeShell } from "../remedy-shell-guard.mjs"

export default classeDeGuardDeShell({
  id: "utf8",
  ordem: 40,
  script: "check-utf8.sh",
  label: "byte 0x97 (em dash do Windows-1252) nos `.ts`/`.tsx` de `src/`",
  verde: "os `.ts`/`.tsx` de `src/` estão em UTF-8 válido",
  vermelho: "ainda há byte 0x97 nos `.ts`/`.tsx` de `src/`",
  estagio: "add",
  deteccao: ["--dry-run", "--ci", "src/"],
  prefixo: "  WOULD FIX: ",
  exigeDir: "src",
  fixer: { argv: ["--fix", "src/"], comando: "bash scripts/check-utf8.sh --fix src/" },
  sugere: (paths) => [
    "bash scripts/check-utf8.sh --fix src/   # remenda a ÁRVORE — REVISE o diff",
    `git add ${paths.join(" ")}`,
  ],
  naoRemendavel: {
    regex: /^\s+(INVALID|MIXED):/,
    motivo: (n) =>
      `⛔ \`${n}\` arquivo(s) com UTF-8 INVÁLIDO que o fixer NÃO remenda\n` +
      "   (ele só troca o byte 0x97): esta classe não tem remédio mecânico aqui.",
  },
})
