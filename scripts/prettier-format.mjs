#!/usr/bin/env node

// =============================================================================
// prettier-format.mjs
//
// O FORMATADOR DO REPOSITÓRIO, num lugar só: todo arquivo VERSIONADO que um
// script gera passa por aqui ANTES de ser gravado.
//
// POR QUE ELE EXISTE (o defeito medido, 26/09/2026)
//
// O `bench-guard-timing.mjs` gravava `JSON.stringify(dados, null, 2)` e o arquivo
// versionado NASCIA reprovando o `bun run lint`: o prettier colapsa o que cabe na
// largura (um array curto de números, um `treeState.staged` de dois caminhos) e o
// `JSON.stringify` expande TUDO. O hook recusou o commit, e o remédio ficou
// LOCAL — aquela função passou a chamar o binário do repositório. Só que a mesma
// armadilha continuava armada em todo gerador que não tinha aprendido a lição: os
// baselines (`--update`), o inventário de dependências, o badge do README, os
// blocos derivados da doc. Um gerador que não formata depende de QUEM O ESCREVEU
// adivinhar a largura do prettier — e adivinhação envelhece sem aviso: o número
// que hoje cabe na linha não cabe depois de um `ms` a mais.
//
// A REGRA (uma só, e é por isso que o módulo existe)
//
// Quem gera arquivo versionado escreve por `escreverFormatado`: o conteúdo é
// gravado e o MESMO binário que o `lint` roda (`node_modules/.bin/prettier`) o
// formata NO LUGAR. O gerado sai estável POR CONSTRUÇÃO, e não por sorte de
// largura. O `check-generated-format` é quem MEDE o produto — o arquivo na
// árvore e o que o gerador produz numa sandbox —, para o dia em que alguém
// acrescentar uma saída sem passar por aqui.
//
// O BINÁRIO É O DO REPOSITÓRIO, nunca o `prettier` do PATH: a régua que o CI e o
// hook rodam é a versão pinada no `devDependencies` do `package.json` — um
// binário de outra versão formata diferente e o arquivo gerado continuaria
// reprovando o lint.
//
// LIMITE DECLARADO: sem o binário (dependências não instaladas) ou com o
// prettier falhando, o helper DIZ o que aconteceu (`motivo`) e devolve
// `formatado: false` — não inventa veredito nem esconde a degradação. Quem
// FALHA é o guard (fail-closed): aqui o caminho comum não pode impedir uma
// medição de rodar, mas também não pode mentir que formatou.
//
// Usage:
//   node scripts/prettier-format.mjs           # onde mora o formatador e a versão medida
//   node scripts/prettier-format.mjs --json    # o mesmo, como dados
//   node scripts/prettier-format.mjs --help
//
//   Programático (o caminho de escrita de todo gerador de arquivo versionado):
//     import { escreverFormatado, escreverJsonFormatado } from "./prettier-format.mjs"
//     escreverJsonFormatado("docs/x.json", dados)          # grava E formata
//
// Exit codes:
//   0 — a consulta foi impressa (o binário existe)
//   2 — infra: o binário do prettier não está em `node_modules` (dependências
//       não instaladas) — a consulta sai com o motivo, sem cunhar veredito
//   3 — uso inválido
// =============================================================================

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"

/** Exit codes — o contrato da CLI (é uma CONSULTA; nada aqui julga repositório). */
export const EXIT = { OK: 0, UNAVAILABLE: 2, USAGE: 3 }

/** O binário do formatador, relativo à raiz do repositório. */
export const PRETTIER_REL = join("node_modules", ".bin", "prettier")

/**
 * O caminho ABSOLUTO do formatador do repositório.
 *
 * @param {string} [root]
 * @returns {string}
 */
export function caminhoDoFormatador(root = process.cwd()) {
  return join(root, PRETTIER_REL)
}

/**
 * O formatador do repositório está instalado?
 *
 * @param {string} [root]
 * @returns {boolean}
 */
export function formatadorDisponivel(root = process.cwd()) {
  return existsSync(caminhoDoFormatador(root))
}

/**
 * A versão do prettier que o repositório pinou — LIDA do pacote, não digitada.
 *
 * A consulta publica a versão porque o arquivo gerado depende dela: a régua que
 * o `lint` roda é esta, e um número escrito à mão aqui divergiria no primeiro
 * bump sem ninguém ver.
 *
 * @param {string} [root]
 * @returns {string|null}
 */
export function versaoDoFormatador(root = process.cwd()) {
  try {
    // O pacote é LIDO do disco, não resolvido por `require("prettier/…")`: uma
    // aresta de import aqui faria TODO script fiado neste helper — e TODO job
    // que roda um deles, inclusive os que não instalam — depender do pacote no
    // grafo de imports (o `check-job-deps` mede exatamente isso, e mediu: 10
    // jobs acusados quando a resolução era por `createRequire`). A versão é o
    // MESMO fato, lido do arquivo do pacote instalado.
    const pkg = JSON.parse(
      readFileSync(join(root, "node_modules", "prettier", "package.json"), "utf8"),
    )
    return typeof pkg?.version === "string" ? pkg.version : null
  } catch {
    return null
  }
}

/**
 * Formata UM arquivo já gravado, com o binário do repositório.
 *
 * É a metade separada de `escreverFormatado` para quem grava por outro caminho
 * (um fixer que escreve em vários arquivos, um `--write` de terceiro) e mesmo
 * assim tem de sair dentro do lint. NÃO lança: o desfecho é dado, com o motivo.
 *
 * @param {string} caminho
 * @param {{root?: string, run?: Function}} [opts]
 * @returns {{formatado: boolean, motivo: string|null}}
 */
export function formatarArquivo(caminho, { root = process.cwd(), run = spawnSync } = {}) {
  const bin = caminhoDoFormatador(root)
  if (!existsSync(bin)) {
    return {
      formatado: false,
      motivo: `prettier do repositório ausente (${PRETTIER_REL}) — o arquivo saiu CRU`,
    }
  }
  const r = run(bin, ["--write", caminho], { cwd: root, encoding: "utf8" })
  if (r?.error) {
    return { formatado: false, motivo: `prettier não rodou: ${r.error.message ?? r.error}` }
  }
  if (r.status !== 0) {
    const detalhe = String(r.stderr ?? "")
      .split("\n")
      .find((l) => l.trim() !== "")
    return {
      formatado: false,
      motivo: `o prettier do repositório saiu ${r.status}${detalhe ? `: ${detalhe.trim()}` : ""}`,
    }
  }
  return { formatado: true, motivo: null }
}

/**
 * GRAVA e FORMATA — o caminho de escrita de todo gerador de arquivo versionado.
 *
 * A ordem é essa (grava e formata no lugar) e não a inversa (formata em memória e
 * grava), por uma razão medida: formatar pelo arquivo faz o prettier resolver a
 * MESMA configuração que o `lint` usa para aquele caminho — `.prettierrc`,
 * `parser` inferido pela extensão, e as exclusões do `.prettierignore`. Um
 * `format()` em memória teria de reconstruir essa decisão a partir do nome do
 * arquivo, e uma reconstrução divergente gravaria um texto que o lint reprova.
 *
 * `formatar: false` existe para o gerador que precisa gravar CRU de propósito
 * (um teste que escreve um arquivo malformado para provar que o guard morde):
 * quem o usa DIZ isso no call site, e o `check-generated-format` cobra a
 * declaração de quem escreve em artefato versionado.
 *
 * @param {string} caminho
 * @param {string} conteudo
 * @param {{root?: string, run?: Function, encoding?: BufferEncoding, formatar?: boolean}} [opts]
 * @returns {{escrito: true, formatado: boolean, motivo: string|null}}
 */
export function escreverFormatado(
  caminho,
  conteudo,
  { root = process.cwd(), run = spawnSync, encoding = "utf8", formatar = true } = {},
) {
  writeFileSync(caminho, conteudo, encoding)
  if (!formatar)
    return { escrito: true, formatado: false, motivo: "formatação dispensada no call site" }
  return { escrito: true, ...formatarArquivo(caminho, { root, run }) }
}

/**
 * O atalho de JSON: `JSON.stringify(…, 2)` + a formatação do repositório.
 *
 * É o par exato do defeito que originou o módulo: o `JSON.stringify` com dois
 * espaços é a forma de PARTIDA (legível, diffável), e o prettier é quem decide a
 * forma FINAL (o que cabe na linha fica na linha). Gravar só o primeiro era o
 * commit que o hook recusava.
 *
 * @param {string} caminho
 * @param {unknown} dados
 * @param {{root?: string, run?: Function, formatar?: boolean}} [opts]
 * @returns {{escrito: true, formatado: boolean, motivo: string|null}}
 */
export function escreverJsonFormatado(caminho, dados, opts = {}) {
  return escreverFormatado(caminho, `${JSON.stringify(dados, null, 2)}\n`, opts)
}

const USAGE = `
 Uso: node scripts/prettier-format.mjs [--json] [--help]

   --json   a consulta como dados
   --help   esta ajuda

 O FATO: quem gera arquivo versionado grava por \`escreverFormatado\` — o conteúdo
 passa pelo MESMO binário do prettier que o \`lint\` roda, então o gerado sai
 estável POR CONSTRUÇÃO. Esta CLI só publica onde o formatador mora e a versão.
`

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE)
    process.exit(EXIT.OK)
  }
  const desconhecido = argv.find((a) => !["--json"].includes(a))
  if (desconhecido !== undefined) {
    console.error(`❌ argumento invalido: ${desconhecido}\n${USAGE}`)
    process.exit(EXIT.USAGE)
  }
  const root = process.cwd()
  const existe = formatadorDisponivel(root)
  const dados = {
    bin: PRETTIER_REL,
    disponivel: existe,
    versao: versaoDoFormatador(root),
    motivo: existe ? null : "dependências não instaladas (node_modules/.bin/prettier ausente)",
  }
  if (argv.includes("--json")) {
    console.log(JSON.stringify(dados, null, 2))
  } else if (existe) {
    console.log(
      `✅ Formador do repositório: ${dados.bin}${dados.versao ? ` (prettier ${dados.versao})` : ""} — todo gerado versionado grava por \`escreverFormatado\`.`,
    )
  } else {
    console.error(
      `❌ INFRA: ${dados.bin} não existe — dependências não instaladas; até lá nenhum gerado pode ser formatado por construção.`,
    )
  }
  process.exit(existe ? EXIT.OK : EXIT.UNAVAILABLE)
}

// True apenas quando executado diretamente — permite importar as funções puras
// sem disparar a consulta.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
