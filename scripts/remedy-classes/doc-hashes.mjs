/**
 * remedy-classes/doc-hashes.mjs
 *
 * A DECLARAÇÃO da classe `doc-hashes` do remédio do pre-commit — o defeito que o
 * guard DONO (`scripts/check-doc-hashes.mjs`) sabe consertar por máquina: a
 * CITAÇÃO DE COMMIT ÓRFÃ. A rewrite (rebase, `--amend`, a dobra de um conserto no
 * commit que ele conserta) troca o NOME do commit preservando o assunto — o
 * objeto antigo continua no repositório (o reflog o segura) — e a prosa que
 * apontava para ele passa a descrever um ato que ninguém consegue abrir.
 *
 * POR QUE O REMÉDIO É MECÂNICO AQUI (e não nos outros defeitos do guard): o nome
 * que a dobra deixou NÃO é um palpite — é o commit de MESMO assunto que está na
 * história, e o guard dono já o nomeia no veredito (`candidato`). O remédio faz
 * exatamente essa troca, e só ela: o token hex vira o nome vivo, na linha onde
 * ele está. O que NÃO tem remédio sai nomeado, nunca sumindo:
 *
 *   - a citação que não tem commit de mesmo assunto na história (o remédio não
 *     inventa um nome) e o token que não existe como commit nenhum (typo, cópia
 *     truncada de outro identificador) — os dois pedem a decisão de quem
 *     escreveu a citação (ou uma não-citação declarada);
 *   - o arquivo que a varredura não conseguiu ler: sem medição não há remédio.
 *
 * A RÉGUA NÃO MORA AQUI: o `fixAll` é IMPORTADO do guard dono, e a detecção e o
 * remendo são a MESMA execução dele (`dry` decide só se o arquivo é GRAVADO — o
 * que entra em `fixed` e o que sobra em `refused`/`recusados` é idêntico nos dois
 * modos). O que esta classe acrescenta é a leitura do desfecho: quais arquivos o
 * fixer remenda, o relatório que se mostra ANTES da pergunta e o motivo por
 * citação quando não há remendo mecânico.
 *
 * O ESTÁGIO é `add`: o fixer grava na ÁRVORE e quem leva o remendo ao COMMIT é o
 * `git add` do driver (que só estagia o que não tinha WIP não estagiado). A
 * varredura do guard é do repositório inteiro — o veredito é o do MESMO comando
 * que o CI roda —, então uma citação órfã fora deste commit é REMOVIDA como
 * retida, com o caminho à mão: o remendo é do defeito, a decisão de o que entra
 * no commit continua sendo de quem commita.
 *
 * O CANAL DO PR é a outra ponta (`scripts/remedy-canal/doc-hashes.mjs`): o mesmo
 * `fixAll`, o mesmo patch — publicado como comentário para quem abriu o PR
 * aplicar com um clique.
 *
 * E A CLASSE SE DECLARA INAPLICÁVEL SEM HISTÓRIA: a régua dela é o GRAFO do
 * repositório, então uma árvore sem commit nenhum em `HEAD` não tem contra o que
 * julgar — o guard dono responde fail-closed (exit 2) ali, e o remédio não tem o
 * que remendar. Sem esta declaração, uma rodada do remédio numa árvore assim
 * saía UNMEASURED (exit 2, "infra") mesmo com o guard dono respondendo o veredito
 * dele — e "não consegui medir" não pode ser o nome de "não há o que medir".
 */

import { execFileSync } from "node:child_process"

import { fixAll } from "../check-doc-hashes.mjs"

/** O guard dono desta classe (o `--fix` dele é a régua do remendo). */
const GUARD = "check-doc-hashes.mjs"

export default {
  id: "doc-hashes",
  ordem: 80,
  script: GUARD,
  label: "citação de commit órfã na prosa (o nome que a rewrite deixou está na história)",
  verde: "nenhuma citação de commit fora da história do HEAD",
  vermelho: "ainda há citação de commit órfã",
  estagio: "add",
  fixer: `node scripts/${GUARD} --fix`,
  sugere: (paths) => [
    `node scripts/${GUARD} --fix   # troca a citação órfã pelo nome que a dobra deixou — REVISE o diff`,
    `git add ${paths.join(" ")}`,
  ],
  //
  // O guard dono não depende do node_modules nem de serviço nenhum: quando ele
  // responde, responde. A ausência dele NÃO é caso desta função — a descoberta já
  // recusa a rodada inteira (exit 2) quando o `script` declarado não existe ou não
  // declara o fixer, e um remédio que oferecesse menos do que o repositório sabe
  // remendar seria pior que um remédio que não roda.
  //
  // O que ESTA função declara é a ANTE-CÂMARA da régua: sem um commit em `HEAD`
  // não há história, e sem história não há citação a julgar. A classe se diz
  // INAPLICÁVEL (o remédio segue e DIZ por quê) em vez de UNMEASURED, que faria a
  // rodada inteira sair `infra` por um estado em que o guard dono já dá o veredito
  // dele — fail-closed, exit 2. Nada é escondido: a ausência sai nomeada.
  aplicavel: (root) => {
    try {
      execFileSync("git", ["rev-parse", "--verify", "--quiet", "HEAD"], {
        cwd: root,
        stdio: "ignore",
      })
      return null
    } catch {
      return (
        "a árvore não tem commit nenhum em HEAD — a régua desta classe é a HISTÓRIA " +
        "do repositório (o guard dono responde fail-closed ali, exit 2)"
      )
    }
  },
  detectar(root) {
    // `dry: true` — a detecção NÃO grava. Quem grava é o `aplicar`, depois da
    // pergunta: um preview que já tivesse escrito tornaria o "não" mentira.
    const preview = fixAll(root, { dry: true })
    if (preview.indisponivel) return { indisponivel: preview.indisponivel }
    const linhas = []
    for (const f of preview.fixed) {
      linhas.push(`   ${f.file}:${f.line} — citação órfã de rewrite`)
      linhas.push(`     antes:  \`${f.before}\``)
      linhas.push(`     depois: \`${f.after}\` (o commit de MESMO assunto na história)`)
    }
    for (const r of preview.refused) {
      linhas.push(`   ⛔ ${r.file}:${r.line} — NÃO remendável: ${r.reason}`)
    }
    for (const r of preview.recusados) linhas.push(`   ⛔ ${r.file} — NÃO remendado: ${r.motivo}`)
    // As TRÊS fontes contam: o que o fixer troca, o que ele recusa por citação e o
    // arquivo inteiro que ele não conseguiu aceitar. Contar só a primeira daria
    // "0 violações" (verde) para um commit que ainda carrega a citação órfã — o
    // veredito da REVALIDAÇÃO é este número.
    const violacoes = preview.fixed.length + preview.refused.length + preview.recusados.length
    return {
      offenders: preview.fixed.map((f) => f.file),
      relatorio: linhas.join("\n"),
      detalhe: preview,
      recusas: preview.refused.map((r) => ({ file: r.file, reason: r.reason })),
      violacoes,
      semRemendo:
        violacoes > 0 && preview.fixed.length === 0
          ? "⛔ não há citação órfã MECANICAMENTE remendável neste repositório — o remédio não\n" +
            "   tocou em arquivo nenhum:\n" +
            linhas.join("\n") +
            "\n   O remédio troca o nome ANTIGO pelo commit de MESMO assunto que está na história;\n" +
            "   o que ele RECUSA (citação sem commit de mesmo assunto, hash que não existe como\n" +
            "   commit, arquivo ilegível) sai nomeado acima — esses pedem a decisão de quem\n" +
            "   escreveu a citação, ou uma não-citação declarada no guard."
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
        `✔ ${f.file}:${f.line} — citação trocada na ÁRVORE\n` +
        `     antes:  \`${f.before}\`\n     depois: \`${f.after}\``,
    )
    for (const r of aplicado.recusados) linhas.push(`   ⛔ ${r.file} — não remendado: ${r.motivo}`)
    for (const r of aplicado.refused) {
      linhas.push(`   ⛔ ${r.file}:${r.line} — não remendado: ${r.reason}`)
    }
    return { relatorio: linhas.join("\n"), detalhe: aplicado }
  },
}
