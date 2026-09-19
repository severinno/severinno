/**
 * remedy-classes/hook-commands.mjs
 *
 * A DECLARAÇÃO da classe `hook-commands` — caminho TIPADO num comando de hook
 * (o vizinho mais próximo existe). O guard DONO é
 * `scripts/check-hook-commands.mjs`, e o PLANO vem dele, importado (como o
 * `fixAll` da classe `run-syntax`): a classe não re-deriva nada — o mesmo módulo
 * que ACUSA é o que troca o token, e uma segunda descoberta divergiria da
 * diagnose (o defeito clássico: o gate acusa um caminho e o conserto mexe em
 * outro).
 *
 * O QUE ESTA CLASSE TEM DE PRÓPRIO: o arquivo que ela remenda é o ARQUIVO QUE O
 * HOOK ESTÁ EXECUTANDO. MEDIDO (casca de 12.957 bytes reescrita no meio da
 * própria execução, `sh -e` como o husky usa): exit 127 com `B39: not found` numa
 * linha POSTERIOR — o interpretador lê o arquivo por DESLOCAMENTO, e mudar o
 * tamanho desalinha o que ele ainda vai ler. Então o remendo vai para a ÁRVORE e
 * para o ÍNDICE e o veredito deste commit passa a ser o de um `git commit` NOVO:
 * continuar daqui mediria bytes fora de lugar (e o "not found" de uma linha que
 * ninguém mexeu seria lido como defeito do commit). É o `exigeRelancamento` que
 * diz isso ao driver.
 */

import { existsSync } from "node:fs"
import { join } from "node:path"

import {
  FIX_MAX_DISTANCE,
  aplicarRemendo,
  arquivosDoRemendo,
  planoDeRemendo,
  renderPlano,
} from "../check-hook-commands.mjs"
import { guardDoRepo } from "../remedy-shell-guard.mjs"

export default {
  id: "hook-commands",
  ordem: 50,
  script: "check-hook-commands.mjs",
  label: "caminho TIPADO num comando de hook (o vizinho mais próximo existe)",
  verde: "todo comando dos hooks resolve",
  vermelho: "ainda há comando de hook sem resolução",
  // O fixer grava na ÁRVORE (e o remédio leva ao ÍNDICE com `git add`).
  estagio: "add",
  fixer: "node scripts/check-hook-commands.mjs --fix",
  exigeRelancamento: true,
  sugere: (paths) => [
    "node scripts/check-hook-commands.mjs --fix   # mostra o ANTES/DEPOIS e PERGUNTA — REVISE o diff",
    `git add ${paths.join(" ")}`,
    "git commit   # NOVO: a casca que estava rodando foi reescrita (o remendo já está no ÍNDICE)",
  ],
  // Sem as duas âncoras o guard é INDETERMINADO (fail-closed) e esta classe não
  // mede nada — e medir OUTRA árvore (o repositório de quem executa) seria pior
  // que não medir: o verde não diria nada sobre este commit.
  aplicavel: (root) => {
    if (guardDoRepo(root, "check-hook-commands.mjs") === null)
      return "scripts/check-hook-commands.mjs não existe neste repositório"
    if (!existsSync(join(root, "package.json")))
      return "package.json ausente: o guard não julga esta árvore (fail-closed)"
    if (!existsSync(join(root, ".husky")))
      return ".husky/ ausente: não há comando de hook para julgar"
    return null
  },
  detectar(root) {
    const { infra, plano, recusas, report } = planoDeRemendo(root)
    if (infra) {
      return {
        indisponivel: ".husky/ ou package.json ausente/ilegível — sem medição não há remédio",
      }
    }
    const violacoes = report.violacoes.length
    const linhas = renderPlano(root, { plano, recusas })
    return {
      offenders: arquivosDoRemendo(plano),
      relatorio: linhas,
      violacoes,
      semRemendo:
        violacoes > 0 && plano.length === 0
          ? `⛔ não há caminho tipado com vizinho INEQUÍVOCO neste commit — o remédio não tocou em\n` +
            `   arquivo nenhum (o remendo só troca até ${FIX_MAX_DISTANCE} caractere(s) de diferença,\n` +
            `   com UM candidato só, e não escolhe entre empates):\n` +
            linhas
          : null,
    }
  },
  aplicar(root) {
    // O plano é RE-DERIVADO aqui (e o `aplicarRemendo` re-localiza cada token):
    // a pergunta pode ter esperado minutos, e o arquivo pode ter mudado nesse
    // meio. A régua continua sendo a do guard dono — este módulo não opina.
    const { plano } = planoDeRemendo(root)
    const { aplicados, recusados } = aplicarRemendo(root, plano)
    const linhas = aplicados.map((a) => `✔ ${a.arquivo}:${a.linha} — \`${a.de}\` → \`${a.para}\``)
    for (const r of recusados) linhas.push(`   ⛔ ${r.arquivo} — ${r.motivo}`)
    return { relatorio: linhas.join("\n"), detalhe: { aplicados } }
  },
}
