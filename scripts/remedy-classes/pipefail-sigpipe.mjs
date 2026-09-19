/**
 * remedy-classes/pipefail-sigpipe.mjs
 *
 * A DECLARAÇÃO da classe `pipefail-sigpipe` do remédio do pre-commit — o defeito
 * que o guard DONO (`scripts/check-pipefail-sigpipe.mjs`) sabe consertar por
 * máquina: sob `set -o pipefail`, `PRODUTOR | grep -q PADRAO` pode morrer com
 * **141** MESMO quando o padrão é encontrado (o `grep -q` fecha o stdin no
 * primeiro casamento, o produtor leva SIGPIPE e a soma do pipeline vira 141), e
 * morre de forma INTERMITENTE — depende do TAMANHO da saída. O remédio é o
 * herestring (`grep -q PADRAO <<< "$PRODUTOR"`): nenhum pipe, nenhum produtor
 * para levar SIGPIPE, a mesma asserção.
 *
 * POR QUE ESTA CLASSE ENTROU DEPOIS DAS OUTRAS CINCO: o fixer existia (o `--fix`
 * do guard dono, com preview `--dry-run` para o comentário do PR), e a OFERTA do
 * pre-commit não o cobria — não por falta de remendo, mas porque o guard dono não
 * era executado pelo hook. Um fixer que o hook nunca invoca é um remendo que só
 * existe no CI, onde não há operador para confirmar: quem introduz a cicatriz
 * (uma reescrita mecânica de scripts, a classe que já mordeu 216 vezes este
 * repositório) corrigia à mão exatamente a linha que a máquina remenda. O guard
 * entrou na fase B do `.husky/pre-commit` no MESMO commit desta declaração — o
 * par declaração + guard rodando é o que torna o remendo oferecível.
 *
 * A RÉGUA NÃO MORA AQUI: o `fixAll` é IMPORTADO do guard dono, e a detecção e o
 * remendo são a MESMA execução dele (`dry` decide só se o arquivo é GRAVADO — o
 * que entra em `fixed` e o que sobra em `refused`/`recusados` é idêntico nos dois
 * modos). O que esta classe acrescenta é a leitura do desfecho: quais arquivos o
 * fixer remenda, o relatório que se mostra ANTES da pergunta e o motivo por
 * arquivo quando não há remendo mecânico.
 *
 * O ESTÁGIO é `add`: o fixer grava na ÁRVORE e quem leva o remendo ao COMMIT é o
 * `git add` do driver (que só estagia o que não tinha WIP não estagiado). A
 * varredura do guard é do REPOSITÓRIO INTEIRO (não do índice) — o veredito é o do
 * mesmo comando que o CI roda —, então um ofensor fora deste commit é REMOVIDO
 * como retido, com o caminho à mão: o remendo é do defeito, a decisão de o que
 * entra no commit continua sendo de quem commita.
 */

import { fixAll } from "../check-pipefail-sigpipe.mjs"

/** O guard dono desta classe (o `--fix` dele é a régua do remendo). */
const GUARD = "check-pipefail-sigpipe.mjs"

export default {
  id: "pipefail-sigpipe",
  ordem: 60,
  script: GUARD,
  label: "`PRODUTOR | grep -q` sob pipefail (o SIGPIPE que reprova de forma intermitente)",
  verde: "não há mais pipe quieto sob pipefail",
  vermelho: "ainda há `| grep -q` sob pipefail",
  estagio: "add",
  fixer: `node scripts/${GUARD} --fix`,
  sugere: (paths) => [
    `node scripts/${GUARD} --fix   # remenda a ÁRVORE (herestring) — REVISE o diff`,
    `git add ${paths.join(" ")}`,
  ],
  // A régua é IMPORTADA (como o `fixAll` da sintaxe), então a árvore sob remendo
  // não precisa carregar uma cópia do guard dono: o que a classe mede é ESTA
  // árvore com a régua de quem executa. A ausência (ou a superfície sem `--fix`)
  // do guard dono NÃO é caso desta função — a descoberta já recusa a rodada
  // inteira (exit 2) quando o `script` declarado não existe ou não declara o
  // fixer, e um remédio que oferecesse menos do que o repositório sabe remendar
  // seria pior que um remédio que não roda.
  aplicavel: () => null,
  //
  // E o CUIDADO com o que a varredura NÃO conseguiu ler: o arquivo que não abre,
  // o YAML que não parseia e a declaração de `shell:` que o parser não entende
  // fazem a detecção devolver `indisponivel` (abaixo) — nunca "nada a remendar".
  detectar(root) {
    // `dry: true` — a detecção NÃO grava. Quem grava é o `aplicar`, depois da
    // pergunta: um preview que já tivesse escrito tornaria o "não" mentira.
    const preview = fixAll(root, { dry: true })
    if (preview.indisponivel) return { indisponivel: preview.indisponivel }
    // Um arquivo que a varredura não conseguiu ler NÃO é "nada a remendar": o
    // guard dono recusa cunhar veredito sem ter lido o escopo, e o remédio segue
    // a mesma régua — sem medição não há oferta.
    if (preview.unread.length > 0) {
      return {
        indisponivel:
          "arquivo(s) do escopo que a varredura NÃO conseguiu ler (sem medição não há remédio):\n" +
          preview.unread.map((u) => `     ${u.path}: ${u.motivo}`).join("\n"),
      }
    }
    const linhas = []
    for (const f of preview.fixed) {
      linhas.push(`   ${f.file}:${f.line} — pipe quieto sob pipefail`)
      linhas.push(`     antes:  ${f.before}`)
      linhas.push(`     depois: ${f.after}`)
    }
    for (const r of preview.refused) {
      linhas.push(
        `   ⛔ ${r.line === null ? r.file : `${r.file}:${r.line}`} — NÃO remendável: ${r.reason}`,
      )
    }
    for (const r of preview.recusados) {
      linhas.push(`   ⛔ ${r.file} — NÃO remendado: ${r.motivo}`)
    }
    // As TRÊS fontes de violação contam: o que o fixer remenda, o que ele recusa
    // por arquivo e o arquivo inteiro que ele não conseguiu aceitar. Contar só a
    // primeira daria "0 violações" (verde) para um commit que ainda carrega a
    // cicatriz — o veredito da REVALIDAÇÃO é este número.
    const violacoes = preview.fixed.length + preview.refused.length + preview.recusados.length
    return {
      offenders: preview.fixed.map((f) => f.file),
      relatorio: linhas.join("\n"),
      detalhe: preview,
      recusas: preview.refused.map((r) => ({ file: r.file, reason: r.reason })),
      violacoes,
      semRemendo:
        violacoes > 0 && preview.fixed.length === 0
          ? "⛔ não há pipe quieto MECANICAMENTE remendável neste repositório — o remédio não\n" +
            "   tocou em arquivo nenhum:\n" +
            linhas.join("\n") +
            '\n   O remédio troca `PRODUTOR | grep -q PADRAO` por `grep -q PADRAO <<< "$(PRODUTOR)"`;\n' +
            "   o que ele RECUSA (produtor que pede captura à mão, forma que a reescrita não\n" +
            "   reduz, expressão do runner que a reescrita perderia) sai nomeado acima."
          : null,
    }
  },
  aplicar(root) {
    // O `fixAll(root)` de novo, e não o preview guardado: a pergunta pode ter
    // esperado minutos e o arquivo pode ter mudado nesse meio. A régua continua
    // sendo a do guard dono — este módulo não opina sobre o que é remendável.
    const aplicado = fixAll(root, { dry: false })
    if (aplicado.indisponivel) {
      return { relatorio: `❌ remendo indisponível: ${aplicado.indisponivel}`, detalhe: aplicado }
    }
    const linhas = aplicado.fixed.map(
      (f) =>
        `✔ ${f.file}:${f.line} — herestring aplicado na ÁRVORE\n` +
        `     antes:  ${f.before}\n     depois: ${f.after}`,
    )
    for (const r of aplicado.recusados) linhas.push(`   ⛔ ${r.file} — não remendado: ${r.motivo}`)
    for (const r of aplicado.refused) {
      linhas.push(
        `   ⛔ ${r.line === null ? r.file : `${r.file}:${r.line}`} — não remendado: ${r.reason}`,
      )
    }
    return { relatorio: linhas.join("\n"), detalhe: aplicado }
  },
}
