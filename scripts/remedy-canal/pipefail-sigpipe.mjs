/**
 * remedy-canal/pipefail-sigpipe.mjs
 *
 * A DECLARAÇÃO DO CANAL do remendo de SIGPIPE — o que o comentário do PR publica
 * quando o gate `Pipefail x grep quieto` acusa o `PRODUTOR | grep -q`.
 *
 * O par é com `scripts/remedy-classes/pipefail-sigpipe.mjs` (mesmo id): a CLASSE
 * diz o que o pre-commit OFERECE no commit, esta diz o que o canal PUBLICA no PR.
 * O comando do `--fix`, a ordem e o guard dono saem da classe; a prosa, daqui. O
 * contrato do bloco está documentado em `remedy-canal/run-syntax.mjs`, e o
 * `default` deste é `false` de propósito: o default do `fixerOf()` sem argumento
 * é o do `run-syntax`, e um segundo `true` faria a descoberta RECUSAR a rodada em
 * vez de escolher por ordem de arquivo.
 *
 * ESTE MÓDULO É UMA FOLHA (não importa nada): ver o cabeçalho de
 * `scripts/remedy-canal.mjs` para o ciclo que isso evita.
 */

export default {
  id: "pipefail-sigpipe",
  default: false,
  marker: "<!-- pipefail-sigpipe-remedy -->",
  gateJob: "Pipefail x grep quieto (SIGPIPE)",
  titulo: "🩹 Remendo mecânico — o gate SIGPIPE (`| grep -q` sob pipefail)",
  achado: (n) =>
    `O check **Pipefail x grep quieto (SIGPIPE)** encontrou **${n}** linha(s) com o pipeline` +
    "\nque dá **SIGPIPE** ao produtor: sob `set -o pipefail`, `PRODUTOR | grep -q PADRAO` pode sair" +
    "\n**141 MESMO com o padrão encontrado** (o `grep -q` fecha o stdin no primeiro casamento e quem" +
    "\nainda tinha bytes para escrever leva o sinal). O remédio é o herestring — nenhum pipe, nenhum" +
    "\nprodutor para levar o sinal.",
  naoCobre:
    "O fixer troca o pipeline por herestring SÓ quando o produtor é uma forma segura de capturar" +
    '\n(`echo "$VAR"`, `printf …`); estes casos têm motivo próprio e **precisam de mão**:',
  rodape:
    "> O remendo troca o PIPELINE, não a asserção: o texto do produtor vira a entrada do `grep`." +
    "\n> Ele **não inventa** intenção onde o produtor é um comando vivo — **o diff é o que se revisa**.",
}
