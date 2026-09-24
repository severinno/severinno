// scripts/bench-table.mjs — a TABELA por sub-test e o PARÁGRAFO de custo
// DERIVADOS do registro versionado (a família `mutations` da baseline).
//
// O DEFEITO MEDIDO que esta folha fecha: a tabela do `docs/GUARDS.md` e o
// parágrafo do `README.md` declaravam o custo sub-test a sub-test ESCRITO À MÃO,
// e quem os reescrevia era o operador, a cada ato. Quando os dois lados
// divergem, é a prosa que mente: aqui a prosa declarava `524.0s` e `238 metades`
// enquanto o registro versionado dizia `404.9s` e `240 metades` — a mesma classe
// do número declarado do job, um nível abaixo (o § do `check:mutation-count`).
//
// A fonte única é o REGISTRO, e nada mais: cada `ms`, cada metade, cada soma,
// cada fatia e a procedência saem dos `forms` do arquivo. O que está declarado
// nesta folha é a única coisa que não tem medição de onde sair — as GLOSAS (a
// prosa editorial de uma linha por forma). Elas vivem AQUI, num mapa, e não em
// três lugares à mão: uma forma sem glosa renderiza sem ela.
//
// Quem ESCREVE é o ato (`bench-guard-timing.mjs --baseline --merge`, depois de
// versionar a rodada) e quem JULGA é o `check:mutation-count` (o dono do
// "a baseline × a prosa que a declara"): o bloco tem de ser BYTE A BYTE o que
// esta folha renderiza do registro versionado, ou o gate falha nomeando a
// primeira linha divergente.
//
// Módulo-FOLHA: sem I/O na carga, para poder ser importado por um teste (o
// `escreverDocs` recebe o `ler`/`escrever` por injeção).
//
// Usage:
//   import { escreverDocs, tabelaSubTests, paragrafoCusto } from "./bench-table.mjs"
//   node scripts/bench-guard-timing.mjs --only mutations --json --baseline --merge
//
// Exit codes:
//   0 — o módulo é FOLHA: não executa nada na carga e não julga repositório
//       nenhum; o veredito do que ele escreve é do `check:mutation-count`

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import process from "node:process"

/** O mapa id→glosa — a ÚNICA prosa desta folha (o resto é derivado). */
export const GLOSAS = {
  "pre-commit-proof": "a declaração dos recusadores, a descida e o CONTROLE",
  "bench-freshness": "a régua da idade e o CONTEÚDO da origem",
  "cut-stages": "as três invariantes duras do corte do GitHub",
  "github-deps": "a catraca do inventário do GitHub",
  "mirror-coverage": "o CONTROLE, a soma por tabela e o pulo sem motivo",
  "stack-per-commit": "a prova de cada commit da pilha passar sozinho",
  "doc-hashes": "a régua do hash citado na prosa",
  "lint-scope": "o escopo do lint derivado do próprio comando",
}

/** Onde a tabela (GUARDS) e o parágrafo (README) vivem, e o que os fecha. */
export const BLOCO_GUARDS = {
  abre: "<!-- bench:mutations:tabela — DERIVADA do registro (`mutations` da baseline); não edite à mão: o ato a reescreve -->",
  fecha: "<!-- /bench:mutations:tabela -->",
}

export const BLOCO_README = {
  abre: "<!-- bench:mutations:custo — DERIVADO do registro (`mutations` da baseline); não edite à mão: o ato o reescreve -->",
  fecha: "<!-- /bench:mutations:custo -->",
}

const s = (ms) => `${(ms / 1000).toFixed(1)}s`
const pct = (parte, todo) => (todo > 0 ? Math.round((parte / todo) * 100) : 0)

/** A mediana de uma lista de números (a do meio, e a média das duas no par). */
export function mediana(valores) {
  const v = [...valores].sort((a, b) => a - b)
  if (v.length === 0) return 0
  const meio = Math.floor(v.length / 2)
  return v.length % 2 ? v[meio] : Math.round((v[meio - 1] + v[meio]) / 2)
}

/**
 * O ESTADO da matriz lido do registro versionado — a única entrada de tudo o
 * que é renderizado.
 *
 * O `harness` é a DIFERENÇA (`wallMs - soma dos sub-tests`), não uma constante:
 * é o que a conta à mão esquece, e é o que muda quando a rodada muda de host.
 * A projeção do próximo sub-test é a média MEDIDA dos scripts + o harness por
 * sub-test — dita como projeção, nunca como medição.
 *
 * @param {object | null} registro  o `docs/benchmarks/guard-timing-baseline.json` lido
 * @returns {null | {subtests: number, metades: number, somaSubTestsMs: number, harnessMs: number,
 *   wallMs: number, medianaMs: number, projecaoMs: number, concentracaoPct: number, verdes: number,
 *   formas: Array<{role: string, glosa: string | null, ms: number, metades: number, exit: number}>,
 *   vermelhas: Array<{role: string, glosa: string | null, ms: number, metades: number, exit: number}>,
 *   procedencia: {commit: string, dia: string, treeState: unknown, versao: unknown}}}
 *   `null` quando a família não foi medida (nada a renderizar)
 */
export function estadoDaMatriz(registro) {
  const m = registro?.mutations
  if (!m || !Array.isArray(m.forms) || m.forms.length === 0) return null

  const forms = m.forms.map((f) => {
    const role = String(f.role ?? f.label ?? "?")
    return {
      role,
      glosa: GLOSAS[role] ?? null,
      ms: Number(f.ms) || 0,
      metades: Number(f.metades) || 0,
      exit: Number(f.exit ?? 0),
    }
  })
  const caros = [...forms].sort((a, b) => b.ms - a.ms || a.role.localeCompare(b.role))
  const somaSubTestsMs = forms.reduce((a, f) => a + f.ms, 0)
  const metades = forms.reduce((a, f) => a + f.metades, 0)
  const wallMs = Number(m.wallMs) || somaSubTestsMs
  const harnessMs = Math.max(0, wallMs - somaSubTestsMs)
  const n = forms.length
  const dez = caros.slice(0, 10).reduce((a, f) => a + f.ms, 0)

  return {
    subtests: n,
    formas: caros,
    metades,
    somaSubTestsMs,
    harnessMs,
    wallMs,
    medianaMs: mediana(forms.map((f) => f.ms)),
    projecaoMs: Math.round(somaSubTestsMs / n + harnessMs / n),
    concentracaoPct: pct(dez, somaSubTestsMs),
    verdes: forms.filter((f) => f.exit === 0).length,
    vermelhas: forms.filter((f) => f.exit !== 0),
    procedencia: procedenciaDe(registro),
  }
}

/** A procedência do registro — o commit de ORIGEM e o ato que o gravou. */
export function procedenciaDe(registro) {
  const meta = registro?.meta ?? {}
  const commit = meta.commit ?? "?"
  const quando = String(meta.commitDate ?? meta.timestamp ?? "").slice(0, 10)
  const dia = quando ? quando.split("-").reverse().join("/") : "?"
  return { commit, dia, treeState: meta.treeState ?? null, versao: meta.version ?? null }
}

/** A largura de cada coluna de uma tabela markdown, para ela sair alinhada. */
function larguras(linhas) {
  return linhas.reduce((max, celulas) => celulas.map((c, i) => Math.max(max[i] ?? 0, c.length)), [])
}

/**
 * A TABELA por sub-test — todas as formas do registro, do mais caro ao mais
 * barato. Sem corte editorial: um corte à mão é mais uma decisão que envelhece
 * (a tabela ANTIGA mostrava treze linhas e uma reticência).
 */
export function tabelaSubTests(estado) {
  if (!estado) return null
  const cabecalho = ["sub-test", "wall time", "fatia", "metades"]
  const corpo = estado.formas.map((f) => [
    f.glosa ? `\`${f.role}\` (${f.glosa})` : `\`${f.role}\``,
    s(f.ms),
    `${pct(f.ms, estado.somaSubTestsMs)}%`,
    String(f.metades),
  ])
  const somaLinha = [
    `**soma dos ${estado.subtests} sub-tests**`,
    `**${s(estado.somaSubTestsMs)}**`,
    "100%",
    `**${estado.metades}**`,
  ]
  const harnessLinha = [
    "harness (parse das metades, tabelas, subida do master)",
    s(estado.harnessMs),
    "",
    "",
  ]
  const totalLinha = ["**total do master**", `**${s(estado.wallMs)}**`, "", ""]

  const w = larguras([cabecalho, ...corpo, somaLinha, harnessLinha, totalLinha])
  // O id à esquerda (é texto) e as três colunas numéricas à direita — a leitura
  // de uma coluna de tempo/comando é alinhada pela vírgula, como no relatório.
  const linha = (celulas) =>
    `| ${celulas.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join(" | ")} |`
  const separador = `| ${w.map((largura, i) => (i === 0 ? "-".repeat(largura) : `${"-".repeat(largura - 1)}:`)).join(" | ")} |`

  const { dia, commit } = estado.procedencia
  const feridas = estado.vermelhas.length
    ? ` **${estado.vermelhas.length} sub-test(s) NÃO passaram** (${estado.vermelhas.map((f) => `\`${f.role}\``).join(", ")}): o custo deles não julga nada.`
    : ""
  const legenda =
    `Cada sub-test do master, MEDIDO e VERSIONADO — o ato de ${dia} (\`${commit}\`): ` +
    `**${estado.verdes}/${estado.subtests} verdes**, **${estado.metades} metades**.${feridas}`

  const leitura =
    `**Dez** sub-tests pagam **${estado.concentracaoPct}%** da conta e a mediana é **${s(estado.medianaMs)}**: ` +
    `a cauda é barata, e o harness sai da DIFERENÇA entre o total e a soma dos sub-tests, não de uma constante. ` +
    `O sub-test NOVO entra na rodada seguinte **MEDIDO**, e o PRÓXIMO acrescenta **~${s(estado.projecaoMs)}** ` +
    `(PROJEÇÃO: a média dos scripts medidos mais o harness por sub-test). A coluna de metades é DERIVADA da ` +
    `matriz (§ acima) — o ato a reescreve depois da herança e diz o que fez (\`metadesDaMatriz\`). ` +
    `Esta TABELA (e esta leitura) é **DERIVADA do registro**: quem a reescreve é o ATO, e o ` +
    `\`check:mutation-count\` recusa o commit em que ela divirja dele — a prosa não tem número próprio.`

  return [
    legenda,
    "",
    linha(cabecalho),
    separador,
    ...corpo.map(linha),
    linha(somaLinha),
    linha(harnessLinha),
    linha(totalLinha),
    "",
    leitura,
  ].join("\n")
}

/** O PARÁGRAFO de custo do README — os mesmos fatos, em prosa. */
export function paragrafoCusto(estado) {
  if (!estado) return null
  const { dia, commit } = estado.procedencia
  const topo = estado.formas
    .slice(0, 4)
    .map((f) => `\`${f.role}\` (${s(f.ms)}, ${pct(f.ms, estado.somaSubTestsMs)}%)`)
  const feridas = estado.vermelhas.length
    ? ` **LIMITE DECLARADO:** na rodada do ato, ${estado.vermelhas.length} sub-test(s) NÃO passaram ` +
      `(${estado.vermelhas.map((f) => `\`${f.role}\``).join(", ")}) — o custo deles não julga nada.`
    : ""

  return [
    `**O custo do job mais caro do PR não é uma conta à mão** (família \`mutations\` do`,
    `\`bench-guard-timing\`). O job \`mutation-guards\` roda ${estado.subtests} sub-tests, e o que CADA um`,
    `custa é medido pelo próprio master (\`--json\`) e versionado sub-test a sub-test no`,
    `registro: o ato VERSIONADO de ${dia} (\`${commit}\`) — o MESMO comando, com a árvore COMMITADA —`,
    `mediu **${s(estado.somaSubTestsMs)}** de sub-tests + **${s(estado.harnessMs)}** de harness =`,
    `**${s(estado.wallMs)}**, com ${topo.slice(0, 3).join(", ")} e ${topo[3]} no topo — antes disso`,
    `ninguém sabia QUAL sub-test pagava a conta. A mediana é **${s(estado.medianaMs)}**, dez sub-tests`,
    `pagam **${estado.concentracaoPct}%** da soma, e o registro guarda **${estado.metades} metades**.`,
    `Quem entra com um sub-test novo não compõe nada: ele entra **MEDIDO** na rodada seguinte`,
    `(forma nova no relatório), e a projeção de quanto o PRÓXIMO acrescenta (**~${s(estado.projecaoMs)}**) é dita`,
    `como **PROJEÇÃO** — a média dos scripts já medidos mais o harness por sub-test.${feridas}`,
    "",
    // Sem ESPAÇO no fim da linha: o prettier da doc o removeria e o bloco vivo
    // deixaria de bater com o renderizado (o defeito que a régua pega).
    `Esta prosa é **DERIVADA**: quem a reescreve é o ato (o bloco é dele), e o`,
    `\`check:mutation-count\` recusa o commit em que ela divirja do registro versionado.`,
  ].join("\n")
}

/**
 * O conteúdo do bloco como a DOC o guarda: uma linha em BRANCO depois do
 * marcador de abertura.
 *
 * Não é estética: o marcador é um comentário HTML, e o prettier (o `bun run
 * lint` passa `--check` na doc) separa o comentário do parágrafo com uma linha
 * em branco — sem ela, o bloco sairia do ato já fora do padrão do repositório.
 */
export function conteudoDoBloco(conteudo) {
  return `\n${conteudo}`
}

/** As linhas esperadas DENTRO dos marcadores — a régua do guard. */
export function linhasDoBloco(conteudo) {
  return ["", ...String(conteudo).split("\n")]
}

/** Acha o bloco delimitado por dois marcadores. `null` quando ele não existe. */
export function blocoDoTexto(texto, { abre, fecha }) {
  const linhas = String(texto).split("\n")
  const i = linhas.findIndex((l) => l.trim() === abre)
  const f = linhas.findIndex((l) => l.trim() === fecha)
  if (i === -1 || f === -1 || f < i) return null
  const aberturas = linhas.filter((l) => l.trim() === abre).length
  const fechamentos = linhas.filter((l) => l.trim() === fecha).length
  if (aberturas !== 1 || fechamentos !== 1) return null
  return {
    inicio: i,
    fim: f,
    conteudo: linhas.slice(i + 1, f),
    linhaDoInicio: i + 1,
    linhaDoFim: f + 1,
  }
}

/** Troca o CONTEÚDO do bloco, preservando os marcadores (o que o ato escreve). */
export function substituirBloco(texto, { abre, fecha }, conteudo) {
  const bloco = blocoDoTexto(texto, { abre, fecha })
  if (!bloco) return null
  const linhas = String(texto).split("\n")
  return [
    ...linhas.slice(0, bloco.inicio + 1),
    ...conteudo.split("\n"),
    ...linhas.slice(bloco.fim),
  ].join("\n")
}

/**
 * Os DOIS blocos que o ato reescreve: o arquivo, os marcadores e o renderizador.
 * A ordem é a da leitura: a doc dos guards primeiro, a porta de entrada depois.
 */
export const DOCS = [
  {
    arquivo: "docs/GUARDS.md",
    bloco: BLOCO_GUARDS,
    render: tabelaSubTests,
    nome: "a tabela por sub-test",
  },
  {
    arquivo: "README.md",
    bloco: BLOCO_README,
    render: paragrafoCusto,
    nome: "o parágrafo de custo",
  },
]

/**
 * Escreve os dois blocos a partir do registro — o que o ATO faz depois de
 * versionar a rodada.
 *
 * Fail-closed por arquivo, e não no todo: um bloco cujo marcador sumiu é
 * devolvido como `semMarcador` (o operador o posiciona UMA vez; do ato em diante
 * ele é reescrito), e um arquivo que já está igual sai como `jaEstava` — o ato
 * diz o que fez em cada um, em vez de afirmar que reescreveu os dois.
 *
 * @param {{cwd?: string, registro: object | null, ler?: Function, escrever?: Function, existe?: Function}} o
 * @returns {Array<{arquivo: string, nome: string, status: string, antes?: string, depois?: string}>}
 */
export function escreverDocs({
  registro,
  ler,
  escrever,
  existe = existsSync,
  cwd = process.cwd(),
}) {
  const estado = estadoDaMatriz(registro)
  const lerArquivo = ler ?? ((p) => readFileSync(p, "utf8"))
  const escreverArquivo = escrever ?? ((p, t) => writeFileSync(p, t))
  // Sem a família medida NÃO se toca no arquivo: não há o que renderizar, e
  // reescrever o bloco com "nada" trocaria a prosa por um vazio silencioso.
  if (estado === null)
    return DOCS.map(({ arquivo, nome }) => ({ arquivo, nome, status: "naoMedida" }))
  return DOCS.map(({ arquivo, bloco, render, nome }) => {
    const caminho = join(cwd, arquivo)
    if (!existe(caminho)) return { arquivo, nome, status: "ausente" }
    const texto = lerArquivo(caminho)
    const vivo = blocoDoTexto(texto, bloco)
    if (!vivo) return { arquivo, nome, status: "semMarcador" }
    const conteudo = render(estado)
    if (conteudo === null) return { arquivo, nome, status: "naoMedida" }
    if (vivo.conteudo.join("\n") === conteudoDoBloco(conteudo))
      return { arquivo, nome, status: "jaEstava" }
    escreverArquivo(caminho, substituirBloco(texto, bloco, conteudoDoBloco(conteudo)))
    return { arquivo, nome, status: "reescrito" }
  })
}

/** O bloco VIVO de um arquivo × o que a folha renderiza — a régua do guard. */
export function divergencia(conteudoVivo, conteudoRenderizado) {
  if (conteudoVivo.length !== conteudoRenderizado.length) {
    return {
      linha: Math.min(conteudoVivo.length, conteudoRenderizado.length) + 1,
      esperado:
        conteudoRenderizado[Math.min(conteudoVivo.length, conteudoRenderizado.length)] ??
        "(fim do bloco)",
      vivo:
        conteudoVivo[Math.min(conteudoVivo.length, conteudoRenderizado.length)] ?? "(fim do bloco)",
      motivo: "o bloco tem um número de linha diferente do renderizado",
    }
  }
  for (let i = 0; i < conteudoVivo.length; i++) {
    if (conteudoVivo[i] !== conteudoRenderizado[i]) {
      return {
        linha: i + 1,
        esperado: conteudoRenderizado[i],
        vivo: conteudoVivo[i],
        motivo: "a linha divirge do renderizado",
      }
    }
  }
  return null
}
