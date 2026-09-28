#!/usr/bin/env node
// =============================================================================
// check-artefatos-do-hook.mjs
//
// A LISTA DERIVADA DE ARTEFATOS DO HOOK NÃO PODE SAIR VAZIA (e a derivação tem de
// FECHAR) — o vínculo do hook com a derivação, e não só a matriz de mutação.
//
// Usage:
//   node scripts/check-artefatos-do-hook.mjs             # o hook do checkout
//   node scripts/check-artefatos-do-hook.mjs --json      # a derivação como dados
//   node scripts/check-artefatos-do-hook.mjs --root <d>  # o hook de outra raiz
//   node scripts/check-artefatos-do-hook.mjs -h
//
// Exit codes:
//   0 — a derivação FECHOU e a lista tem pelo menos UM artefato
//   1 — a derivação NÃO FECHA (o fecho de um comando do hook não resolve, um
//       comando citado pelo hook não existe no checkout, ou um guard não pôde ser
//       EXECUTADO) OU a lista derivada saiu VAZIA
//   2 — uso inválido
//
// O DEFEITO QUE ELE FECHA
//
// O `scripts/artefatos-do-hook.mjs` responde, por EXECUÇÃO, que arquivos do
// repositório os guards do hook LEEM — e é essa lista que o fixture do pre-commit
// MATERIALIZA (`artefatosDoFixture()`, o mesmo caminho dos testes e do doctor).
// Uma lista VAZIA não é uma lista pequena: é o fixture SEM artefato nenhum, e aí
// um guard fail-closed sobre um arquivo do repositório lê o ramo de INFRA na
// CÓPIA, de modo que o vermelho passa a ser do FIXTURE e não do defeito. É o
// defeito que a derivação existe para fechar, de volta pela porta de trás — e
// agora EM SILÊNCIO, porque uma lista vazia não tem entrada para nomear.
//
// ATÉ AQUI, QUEM A PEGAVA
//
// Só a MATRIZ DE MUTAÇÃO (`scripts/test-mutation-artefatos-do-hook.sh`, a metade
// M1 do sub-test `artefatos-do-hook`) media a CONSEQUÊNCIA da lista vazia — e ela
// roda no CI, no PR, DEPOIS do commit. No caminho do commit a lista podia sair
// `[]`, o commit saía, e a única testemunha era o PR (ou o `--no-verify` de quem
// não paga o hook). Este guard é o VÍNCULO com o hook: ele roda a MESMA derivação
// em TODO commit e RECUSA o commit quando a lista sai vazia — ou quando a
// derivação não fecha. O que ele não substitui: a matriz continua medindo as
// outras formas da derivação (a coleta que perde UM leitor, o rastreio da árvore).
//
// POR QUE A RECUSA MORA NO CHAMADOR, E NÃO NO `artefatosDoHook`
//
// A derivação devolve `{artefatos, problemas}` e a lista vazia NÃO é um problema
// dela: existem raízes (sintéticas, de teste) em que nenhum guard lê um arquivo do
// repositório e a resposta honesta é "nenhum" — é exatamente o que a CONTRA-PROVA
// ("o mesmo root com um hook que NÃO chama a guarda") e o LIMITE declarado ("um
// filho com ambiente PRÓPRIO não é alcançado") do `artefatos-do-hook.test.ts`
// medem, com `problemas` VAZIO de propósito. Quem sabe que, NESTE repositório, a
// lista vazia é um DEFEITO é o CHAMADOR — o hook. O julgamento fica onde ele
// existe, e a derivação continua sendo um mecanismo: ela MEDE, o guard DECIDE.
//
// O QUE ELE NÃO MEDE (limites declarados)
//
//   · a CORREÇÃO da derivação. Se ela perder um artefato e ainda assim devolver
//     uma lista não-vazia, quem acusa é o fixture que fica vermelho por INFRA (a
//     metade M2 da matriz) e o `porComando` do `--json`, que nomeia o leitor de
//     cada entrada. Aqui a régua é o TAMANHO (zero) e o FECHO da derivação;
//   · o CONTEÚDO esperado da lista. Fixar "9 artefatos" faria remover um leitor
//     legítimo reprovar este guard pelo motivo errado: o que o hook declara é que
//     a derivação vê ALGO, e o resto é da suíte da derivação.
// =============================================================================

import process from "node:process"

import { artefatosDoHook } from "./artefatos-do-hook.mjs"
import { REPO_ROOT } from "./hook-simulator.mjs"

/** Exit codes — o contrato da CLI. */
export const EXIT = { OK: 0, LISTA_VAZIA: 1, USO: 2 }

/**
 * O VEREDITO: a derivação do hook julga o que ela mesma não julga.
 *
 * Duas recusas, e a primeira é a do FECHO (a derivação não fechou: problema
 * nomeado, lista pela metade). A segunda só existe quando a primeira não falou
 * nada — porque uma derivação que NÃO FECHOU já devolve `[]`, e recusar de novo
 * pelo tamanho esconderia o problema que explica a lista.
 *
 * A lista vazia é um DEFEITO AQUI (e não em `artefatosDoHook`) porque é este o
 * chamador que sabe que, neste repositório, o fixture do pre-commit depende dela:
 * com `[]` o fixture não materializa nada e o vermelho de um guard fail-closed
 * passa a ser do FIXTURE.
 *
 * @param {{root?: string}} [opts] `root` permite derivar um hook MUTADO ou de
 *   fixture (os testes do guard o usam); o default é o hook do checkout.
 * @returns {{artefatos: string[], porComando: Record<string, string[]>,
 *   recusados: {rel: string, porque: string, comandos: string[]}[],
 *   comandos: string[], problemas: string[], recusas: string[]}}
 */
export function julgaArtefatosDoHook({ root } = {}) {
  const resultado = artefatosDoHook(root === undefined ? {} : { root })
  const recusas = [...resultado.problemas]
  if (recusas.length === 0 && resultado.artefatos.length === 0) {
    recusas.push(
      `a derivação FECHOU e a lista saiu VAZIA: nenhum dos ${resultado.comandos.length} ` +
        "comando(s) de node do hook abriu um arquivo do repositório. Sem artefato, o fixture " +
        "do pre-commit não materializa nada e um guard fail-closed sobre um arquivo do " +
        "repositório lê INFRA na cópia — o vermelho passa a ser do FIXTURE, não do defeito. " +
        "Se a leitura de artefato saiu do hook de propósito, isso é uma mudança DECLARADA " +
        "(o guard e o rastro dele mudam junto), nunca o silêncio de uma lista vazia.",
    )
  }
  return { ...resultado, recusas }
}

/** A ajuda da CLI. */
export const USAGE = `check-artefatos-do-hook — a lista derivada dos artefatos do hook não pode sair vazia

Usage:
  node scripts/check-artefatos-do-hook.mjs             # o hook do checkout
  node scripts/check-artefatos-do-hook.mjs --json      # com QUEM lê cada artefato
  node scripts/check-artefatos-do-hook.mjs --root <d>  # o hook de outra raiz
  node scripts/check-artefatos-do-hook.mjs -h

Exit codes:
  0 — a derivação fechou e a lista tem ao menos UM artefato
  1 — a derivação não fecha OU a lista derivada saiu vazia
  2 — uso inválido`

const isMain =
  !!process.argv[1] && process.argv[1].split(/[\\/]/).pop() === "check-artefatos-do-hook.mjs"

if (isMain) {
  const argv = process.argv.slice(2)
  let root = REPO_ROOT
  let json = false
  let erro = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--json") json = true
    else if (arg === "-h" || arg === "--help") {
      console.log(USAGE)
      process.exit(EXIT.OK)
    } else if (arg === "--root") {
      const proximo = argv[++i]
      if (proximo === undefined || proximo.startsWith("--")) erro = "--root exige um diretório"
      else root = proximo
    } else erro = `argumento desconhecido: ${arg}`
  }
  if (erro) {
    console.error(`check-artefatos-do-hook: ${erro}`)
    console.error(USAGE)
    process.exit(EXIT.USO)
  }

  const resultado = julgaArtefatosDoHook({ root })
  if (json) console.log(JSON.stringify({ raiz: root, ...resultado }, null, 2))
  else for (const a of resultado.artefatos) console.log(a)

  if (resultado.recusas.length > 0) {
    for (const p of resultado.recusas) console.error(`  ❌ ${p}`)
    process.exit(EXIT.LISTA_VAZIA)
  }
  if (!json) console.log(`check-artefatos-do-hook: ✅ ${resultado.artefatos.length} artefato(s)`)
  process.exit(EXIT.OK)
}
