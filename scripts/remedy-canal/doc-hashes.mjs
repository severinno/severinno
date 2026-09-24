/**
 * remedy-canal/doc-hashes.mjs
 *
 * A DECLARAÇÃO DO CANAL do remendo das CITAÇÕES DE COMMIT — o que o comentário do
 * PR publica quando o gate `Doc commit citations (história do HEAD)` acusa a
 * citação órfã de uma rewrite.
 *
 * O par é com `scripts/remedy-classes/doc-hashes.mjs` (mesmo id): a CLASSE diz o
 * que o pre-commit OFERECE no commit, esta diz o que o canal PUBLICA no PR. O
 * comando do `--fix`, a ordem e o guard dono saem da classe; a prosa, daqui. O
 * contrato do bloco está documentado em `remedy-canal/run-syntax.mjs`, e o
 * `default` deste é `false` de propósito: o default do `fixerOf()` sem argumento
 * é o do `run-syntax`, e um segundo `true` faria a descoberta RECUSAR a rodada em
 * vez de escolher por ordem de arquivo.
 *
 * ESTE MÓDULO É UMA FOLHA (não importa nada): ver o cabeçalho de
 * `scripts/remedy-canal.mjs` para o ciclo que isso evita.
 *
 * O QUE ESTE PATCH É: a troca do NOME. O comentário publica o patch que
 * `node scripts/check-doc-hashes.mjs --fix` GRAVARIA — o token hex antigo vira o
 * commit de MESMO assunto que está na história do HEAD (o nome que a rewrite
 * deixou). Nada mais da linha é tocado: um comentário que reescrevesse a prosa em
 * volta do hash estaria inventando texto, e o que se revisa é o diff.
 */

export default {
  id: "doc-hashes",
  default: false,
  marker: "<!-- doc-hashes-remedy -->",
  gateJob: "Doc commit citations (história do HEAD)",
  titulo: "🩹 Remendo mecânico — a citação de commit órfã na prosa (`check-doc-hashes`)",
  achado: (n) =>
    `O check **Doc commit citations (história do HEAD)** achou **${n}** citação(ões) de commit` +
    "\nque NÃO pertencem à história do `HEAD`: a rewrite (rebase, `--amend`, a dobra de um conserto" +
    "\nno commit que ele conserta) troca o **NOME** do commit preservando o assunto — e o objeto" +
    '\nantigo continua no repositório (o reflog o segura), então um `git cat-file -e` diz "existe"' +
    "\ne a citação velha passa. A doc descreve um ato que ninguém consegue abrir.",
  naoCobre:
    "O fixer troca o TOKEN hex pelo commit de MESMO assunto na história — **só isso**." +
    "\nEstes casos NÃO têm remendo mecânico e **precisam de mão**:",
  rodape:
    "> O remendo troca o NOME, não a prosa: o diff é a linha com o hash vivo no lugar do morto." +
    "\n> Ele **não inventa** um nome onde não há commit de mesmo assunto — **o diff é o que se revisa**.",
}
