/**
 * remedy-classes/run-syntax.mjs
 *
 * A DECLARAÇÃO da classe `run-syntax` do remédio do pre-commit — o que o guard
 * DONO (`scripts/check-workflow-run-syntax.mjs`) sabe consertar.
 *
 * POR QUE A DECLARAÇÃO MORA AQUI, e não numa lista dentro do
 * `pre-commit-remedy.mjs`: o arquivo fica ao lado do diretório das demais
 * declarações e é DESCOBERTO pela varredura (`scripts/remedy-classes.mjs`), então
 * um fixer novo entra na oferta sem que ninguém edite o remédio. O nome do
 * arquivo É o id da classe, o `ordem` decide a posição na oferta e o `script`
 * nomeia o guard dono — os três são VALIDADOS na descoberta (nome = id, ordem
 * única, dono existente e com `--fix`).
 *
 * A RÉGUA NÃO MORA AQUI: o `fixAll` é IMPORTADO do gate dono. A classe declara
 * COMO ACHAR o defeito (rodando o recorte `--staged` do guard, que é o mesmo que
 * o hook roda) e o que fazer com o resultado — jamais uma segunda régua, que
 * divergiria da diagnose no dia em que uma das duas mudasse.
 */

import { fixAll } from "../check-workflow-run-syntax.mjs"

export default {
  id: "run-syntax",
  ordem: 10,
  // O guard dono: a régua vem dele, importada (por isso ele não é spawnado).
  script: "check-workflow-run-syntax.mjs",
  label: "cicatriz de `run:` (operador pendente no fim do corpo em bloco literal)",
  verde: "o recorte `--staged` voltou a passar",
  vermelho: "o recorte `--staged` CONTINUA vermelho",
  estagio: "add",
  fixer: "node scripts/check-workflow-run-syntax.mjs --fix",
  sugere: (paths) => [
    "node scripts/check-workflow-run-syntax.mjs --fix   # remenda a ÁRVORE — REVISE o diff",
    `git add ${paths.join(" ")}`,
  ],
  aplicavel: () => null,
  detectar(root, { bash }) {
    const preview = fixAll(root, { bash, staged: true, dry: true })
    if (preview.indisponivel) return { indisponivel: preview.indisponivel }
    if (preview.unread.length > 0) {
      return {
        indisponivel:
          "arquivo(s) ILEGÍVEL(is) — não ler não é o mesmo que estar válido:\n" +
          preview.unread.map((u) => `     ${u.file}: ${u.detail}`).join("\n"),
      }
    }
    const linhas = []
    const recusas = []
    for (const f of preview.fixed) {
      linhas.push(`   ${f.file}:${f.line} — operador pendente \`${f.operador}\``)
      linhas.push(`     antes:  ${f.antes}`)
      linhas.push(`     depois: ${f.depois}`)
    }
    for (const f of preview.refused) {
      linhas.push(`   ⛔ ${f.line ? `${f.file}:${f.line}` : f.file} — NÃO remendável: ${f.reason}`)
      recusas.push(f)
    }
    for (const f of preview.shellFailures) {
      linhas.push(
        `   ⛔ ${f.file}:${f.line} — \`shell:\` que o runner NÃO tem (classe que não é de` +
          ` parsing e que este remendo não toca): ${f.error}`,
      )
    }
    const violacoes =
      preview.failures.length + preview.scriptFailures.length + preview.shellFailures.length
    return {
      offenders: preview.fixed.map((f) => f.file),
      relatorio: linhas.length > 0 ? linhas.join("\n") : "",
      detalhe: preview.fixed,
      recusas,
      violacoes,
      semRemendo:
        violacoes > 0 && preview.fixed.length === 0
          ? "⛔ não há cicatriz MECÂNICA para remendar neste commit — o remédio não tocou em\n" +
            "   arquivo nenhum:\n" +
            linhas.join("\n") +
            "\n   A cicatriz que o remendo conhece é o OPERADOR PENDENTE no fim do corpo em bloco\n" +
            "   literal (`run: |`); a causa costuma estar a poucas linhas de onde o bash apontou."
          : null,
    }
  },
  aplicar(root, { bash }) {
    const aplicado = fixAll(root, { bash, staged: true })
    const linhas = aplicado.fixed.map(
      (f) =>
        `✔ ${f.file}:${f.line} — remendo aplicado na ÁRVORE: operador pendente \`${f.operador}\` removido\n` +
        `     antes:  ${f.antes}\n     depois: ${f.depois}`,
    )
    return { relatorio: linhas.join("\n"), detalhe: aplicado }
  },
}
