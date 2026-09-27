#!/usr/bin/env node
/**
 * check-act-origin.mjs — o registro do ato CARREGA a matriz que ele declara ter
 * medido?
 *
 * O DEFEITO QUE ISTO FECHA. O registro do ato (`docs/benchmarks/guard-timing-
 * baseline.json` e o `-latest.json` da mesma rodada) afirma duas coisas ao mesmo
 * tempo: "MEDIDO: N sub-tests com M metades" e "a medição aconteceu no commit X"
 * (a ÂNCORA).
 *
 * A ÂNCORA É RESOLVIDA, NÃO DIGITADA. Até o esquema v6 o commit vinha gravado em
 * `meta.commit` — e o `--baseline` roda com a matriz já na ÁRVORE, então ele
 * gravava o PAI: a árvore de lá não carrega a matriz que o registro declara ter
 * medido (a suíte nova entra no commit SEGUINTE) e este gate acusava, com razão,
 * TODA rodada honesta — a re-ancoragem em DOIS commits era o preço. Um commit
 * não pode conter o próprio hash (o campo entra no blob→tree→commit), então o
 * PORTADOR (o commit que carrega o registro) não é gravável dentro dele: a v7
 * declara a regra (`meta.anchor = "carrier"`) e a procedência (`meta.parentCommit`),
 * e este gate RESOLVE o portador pela história (`origemDoRegistro`), aplicando as
 * três regras à árvore do commit que de fato carrega o registro. As duas afirmações podem divergir, e a divergência é INVISÍVEL
 * para todo guard que lê uma árvore só: o registro e o master concordam entre si
 * na árvore em que os dois estão, e mesmo assim o commit de origem pode NÃO
 * carregar a matriz declarada — foi o que aconteceu no repositório (medido: a
 * rodada anterior gravou `meta.commit` apontando um topo cuja árvore não
 * carregava a nona metade que o mesmo registro declara ter medido). O veredito
 * então fala de uma árvore que não existiu, e a proveniência da medição — o
 * número que o merge lê — descreve outra coisa.
 *
 * AS TRÊS REGRAS (cada uma nomeada no veredito), aplicadas à ÂNCORA RESOLVIDA:
 *   R1 — a âncora RESOLVE? Um nome que não é commit nenhum (o hash de uma
 *        reescrita que sumiu) não sustenta medição nenhuma.
 *   R2 — a âncora PERTENCE à história do HEAD? Fora dela, o número declarado não
 *        é reproduzível nesta árvore (a classe da reescrita).
 *   R3 — a MATRIZ DECLARADA é a que a árvore da origem CARREGA? Quatro leituras,
 *        todas com o número nos dois lados: a forma declarada EXISTE na origem,
 *        as METADES dela são as de lá, a árvore não carrega sub-test que o
 *        registro OMITE, e o TOTAL `subtests` bate com a árvore da origem.
 *
 * AS REGRAS SÃO PREDICADOS DE UMA LINHA — DE PROPÓSITO. Cada uma das sete
 * regras abaixo cabe numa linha, e a suíte de mutação
 * (`scripts/test-mutation-act-origin.sh`) cega EXATAMENTE uma por vez e exige
 * que o mesmo registro desonesto deixe de ser recusado. Uma regra que não se
 * deixa cegar não se deixa medir: um predicado que só funciona colado ao vizinho
 * não prova que é ele quem sustenta o veredito. Mexer nestas linhas sem passar a
 * suíte de mutação é mexer num instrumento que ninguém mais confere.
 *
 * O QUE FICA FORA, DECLARADO (nunca "verde por omissão"):
 *   · as metades são julgadas onde a suíte da origem declara o bloco `METADES=(`.
 *     Onde ela não declara, a forma entra no relatório como NÃO JULGADA e o
 *     julgamento daquela forma é só o do ID — o limite é dito, não presumido;
 *   · a proveniência por FAMÍLIA (`meta.reused`) não é julgada: ela diz de qual
 *     registro o valor de outra família foi REUSADO, e o sujeito daqui é a
 *     matriz do ato (`mutations`), que é a que o registro declara ter medido.
 *
 * Usage:
 *   node scripts/check-act-origin.mjs [--root DIR] [--head REF] [--json]
 *   node scripts/check-act-origin.mjs --help
 *
 * Exit codes:
 *   0 — o commit de origem de cada registro carrega a matriz que ele declara ter
 *       medido (as três regras passam nos dois registros) ✅
 *   1 — registro DESONESTO: alguma violação nomeada (o registro, a origem, a
 *       forma e os dois números saem no relatório) ❌
 *   2 — infra: `git` ausente, registro ilegível/JSON inválido, árvore inacessível,
 *       master sem o bloco `SUBTESTS=(` — não consegui medir, e não medir NUNCA
 *       vale verde ◐
 */

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { BENCH_ACT, BENCH_FAMILY, BENCH_PATH, deriveSubtestCount } from "./check-mutation-count.mjs"
// A ÂNCORA vem da folha (`origemDoRegistro`): o registro declara a REGRA
// (`meta.anchor = "carrier"`) quando o hash não é gravável dentro dele, e a
// resolução do PORTADOR é UMA só — a mesma que a idade da régua usa.
import { origemDoRegistro } from "./bench-families.mjs"
import { metadesDeclaradas } from "./metades.mjs"

const LATEST_PATH = "docs/benchmarks/guard-timing-latest.json"
const MASTER = "scripts/test-mutation-guards.sh"

const EXIT = { OK: 0, VIOLACAO: 1, INDISPONIVEL: 2 }

const USO = `uso: node scripts/check-act-origin.mjs [--root DIR] [--head REF] [--json]

  --root DIR   raiz do repositório a julgar (default: o cwd)
  --head REF   o commit em cuja história a origem tem de estar (default: HEAD)
  --json       o veredito como dados
  -h, --help   esta ajuda

Exit codes: 0 honesto · 1 registro desonesto (violação nomeada) · 2 não consegui
medir (git ausente, registro ilegível, árvore inacessível) — nunca verde.`

function git(root, args) {
  try {
    return {
      ok: true,
      out: execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 }),
    }
  } catch (erro) {
    return { ok: false, out: String(erro.stdout ?? ""), err: String(erro.stderr ?? erro.message) }
  }
}

// ── AS SETE REGRAS — um predicado de uma linha cada (ver o cabeçalho) ───────
// A suíte de mutação cega UMA por vez: marcador literal + linha substituta.

/** O registro declara o commit de origem? (a prosa sem o commit não é procedência) */
const temOrigem = (o) => typeof o === "string" && o.trim() !== ""
/** Um comando git que só responde sim/não (o objeto existe? está na história?). */
const gitOk = (root, ...args) => git(root, args).ok
/** R1 — o nome RESOLVE para um commit deste repositório? */
const origemResolve = (root, o) => gitOk(root, "rev-parse", "--verify", `${o}^{commit}`)
/** R2 — a origem PERTENCE à história do HEAD? */
const origemNaHistoria = (root, o, head) => gitOk(root, "merge-base", "--is-ancestor", o, head)
/** R3a — a forma declarada ESTÁ na árvore da origem? */
const formaAusente = (formas, id) => !formas.has(id)
/** R3b — as metades da forma são as que a ORIGEM carrega? (`null` = não julgada) */
const julgada = (n) => Number.isFinite(n)
const metadesDivergem = (naOrigem, dito) => julgada(naOrigem) && julgada(dito) && dito !== naOrigem
/** R3c — a árvore da origem carrega forma que o REGISTRO omite? */
const formaSobrando = (declaradas, id) => !declaradas.has(id)
/** R3d — o TOTAL declarado bate com a matriz da origem? */
const totalDiverge = (declarado, carregado) => declarado !== null && declarado !== carregado

/**
 * A matriz que uma ÁRVORE carrega: os ids e as metades que os próprios scripts
 * declaram ali — as duas leituras são as da casa (`deriveSubtestCount` do
 * `check-mutation-count` e `metadesDeclaradas` do `metades`), nunca uma segunda.
 */
function matrizDaArvore(root, ref) {
  const master = git(root, ["show", `${ref}:${MASTER}`])
  if (!master.ok) {
    return {
      erro: `a árvore de ${ref.slice(0, 8)} não tem ${MASTER} — o commit não carrega matriz nenhuma`,
    }
  }
  let derivada
  try {
    derivada = deriveSubtestCount(master.out)
  } catch (erro) {
    return { erro: `o ${MASTER} de ${ref.slice(0, 8)} não declara a matriz: ${erro.message}` }
  }
  const formas = new Map()
  const naoJulgadas = []
  for (const { id, script } of derivada.entries) {
    const suite = git(root, ["show", `${ref}:${script}`])
    if (!suite.ok) {
      formas.set(id, null)
      naoJulgadas.push(`${id} (a suíte ${script} não existe nessa árvore)`)
      continue
    }
    const metades = metadesDeclaradas(suite.out)
    if (!metades.ok) {
      formas.set(id, null)
      naoJulgadas.push(`${id} (${metades.motivo})`)
      continue
    }
    formas.set(id, metades.metades.length)
  }
  return { ids: derivada.ids, formas, naoJulgadas }
}

function julgarUm(root, caminho, head) {
  const violacoes = []
  const naoJulgadas = []
  let cru
  try {
    cru = readFileSync(join(root, caminho), "utf8")
  } catch (erro) {
    return { indisponivel: `${caminho}: não consegui LER o registro (${erro.message})` }
  }
  let registro
  try {
    registro = JSON.parse(cru)
  } catch (erro) {
    return { indisponivel: `${caminho}: o registro não é JSON válido (${erro.message})` }
  }

  // A ÂNCORA RESOLVIDA: `meta.commit` (v6, gravado) ou o PORTADOR (v7, o commit
  // que CARREGA o registro — resolvido pela história, porque um commit não pode
  // conter o próprio hash). O `via` diz qual respondeu, e não há fallback mudo.
  const resolvida = origemDoRegistro(registro, { head, path: caminho, cwd: root })
  const origem = temOrigem(resolvida.commit) ? resolvida.commit.trim() : ""
  if (!temOrigem(origem)) {
    violacoes.push(
      `${caminho}: o registro não declara a ÂNCORA (nem \`meta.commit\` gravado, nem \`meta.anchor = "carrier"\` com um portador resolvido pela história) — "medido em" sem origem não é procedência, é prosa`,
    )
    return { violacoes, naoJulgadas, origem: null }
  }
  const curto = origem.slice(0, 8)
  const viaPortador = resolvida.via === "carrier"
  const oque = viaPortador ? `o portador (o commit que carrega \`${caminho}\`)` : "`meta.commit`"

  if (!origemResolve(root, origem)) {
    violacoes.push(
      `${caminho}: R1 · ${oque} = \`${curto}\` não resolve para commit nenhum neste repositório — a origem declarada não existe (é a classe da reescrita, que troca o nome do commit preservando o assunto)`,
    )
    return { violacoes, naoJulgadas, origem }
  }

  if (!origemNaHistoria(root, origem, head)) {
    violacoes.push(
      `${caminho}: R2 · ${oque} = \`${curto}\` existe, mas está FORA da história de ${head.slice(0, 8)} — o número declarado não se reproduz nesta árvore (remédio: \`${BENCH_ACT}\` na árvore COMITADA, ou re-datar a origem para o nome vivo do mesmo ato)`,
    )
    return { violacoes, naoJulgadas, origem }
  }

  const familia = registro?.mutations
  if (familia === undefined || familia === null || typeof familia !== "object") {
    violacoes.push(
      `${caminho}: R3 · o registro não declara a família \`${BENCH_FAMILY}\` — sem a matriz declarada não há o que confrontar com a origem`,
    )
    return { violacoes, naoJulgadas, origem }
  }
  const declaradas = new Map()
  for (const forma of Array.isArray(familia.forms) ? familia.forms : []) {
    const id = typeof forma?.role === "string" ? forma.role.trim() : forma?.label
    if (typeof id === "string" && id !== "")
      declaradas.set(id, Number.isFinite(forma.metades) ? forma.metades : null)
  }

  const carregada = matrizDaArvore(root, origem)
  if (carregada.erro !== undefined) {
    violacoes.push(`${caminho}: R3 · ${carregada.erro}`)
    return { violacoes, naoJulgadas, origem }
  }
  naoJulgadas.push(...carregada.naoJulgadas)

  // R3a — cada forma DECLARADA existe na árvore da origem?
  for (const id of declaradas.keys()) {
    if (formaAusente(carregada.formas, id)) {
      violacoes.push(
        `${caminho}: R3 · a forma \`${id}\` é declarada como MEDIDA, e a árvore de \`${curto}\` não carrega esse sub-test no ${MASTER} — o registro declara medido o que a origem não tinha`,
      )
    }
  }
  // R3b — as METADES declaradas são as que a origem carrega?
  for (const [id, metades] of declaradas) {
    const naOrigem = carregada.formas.get(id)
    if (metadesDivergem(naOrigem, metades)) {
      violacoes.push(
        `${caminho}: R3 · a forma \`${id}\` é declarada com ${metades} metade(s) e a árvore de \`${curto}\` declara ${naOrigem} — as metades declaradas não são as que a origem carrega`,
      )
    }
  }
  // R3c — a árvore da origem carrega sub-test que o registro OMITE?
  for (const id of carregada.formas.keys()) {
    if (formaSobrando(declaradas, id)) {
      violacoes.push(
        `${caminho}: R3 · a árvore de \`${curto}\` carrega o sub-test \`${id}\` e o registro NÃO o declara — a medição declarada é MENOR que a matriz que ela diz ter medido`,
      )
    }
  }
  // R3d — o TOTAL declarado bate com a árvore da origem?
  const totalDeclarado = Number.isFinite(familia.subtests) ? familia.subtests : null
  if (totalDiverge(totalDeclarado, carregada.ids.length)) {
    violacoes.push(
      `${caminho}: R3 · o registro declara \`subtests: ${totalDeclarado}\` e a árvore de \`${curto}\` tem ${carregada.ids.length} sub-test(s)`,
    )
  }

  return {
    violacoes,
    naoJulgadas,
    origem,
    subtests: totalDeclarado,
    carregados: carregada.ids.length,
  }
}

function principal() {
  const args = process.argv.slice(2)
  let root = process.cwd()
  let head = "HEAD"
  let json = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "-h" || a === "--help") {
      console.log(USO)
      process.exit(EXIT.OK)
    }
    if (a === "--json") {
      json = true
      continue
    }
    if (a === "--root" || a === "--head") {
      const v = args[++i]
      if (v === undefined) {
        console.error(`❌ ${a} exige um valor\n${USO}`)
        process.exit(EXIT.INDISPONIVEL)
      }
      if (a === "--root") root = v
      else head = v
      continue
    }
    console.error(`❌ argumento desconhecido: ${a}\n${USO}`)
    process.exit(EXIT.INDISPONIVEL)
  }

  if (!git(root, ["rev-parse", "--git-dir"]).ok) {
    const motivo = `${root} não é um repositório git (ou o \`git\` não está no PATH)`
    if (json) console.log(JSON.stringify({ estado: "indisponivel", motivo }, null, 2))
    else console.error(`◐ check-act-origin: ${motivo} — não medido, nunca verde`)
    process.exit(EXIT.INDISPONIVEL)
  }
  const headResolvido = git(root, ["rev-parse", "--verify", "--quiet", `${head}^{commit}`])
  if (!headResolvido.ok) {
    const motivo = `\`${head}\` não resolve para um commit`
    if (json) console.log(JSON.stringify({ estado: "indisponivel", motivo }, null, 2))
    else console.error(`◐ check-act-origin: ${motivo} — não medido, nunca verde`)
    process.exit(EXIT.INDISPONIVEL)
  }
  const headSha = headResolvido.out.trim()

  const registros = []
  const indisponiveis = []
  for (const caminho of [BENCH_PATH, LATEST_PATH]) {
    const r = julgarUm(root, caminho, headSha)
    if (r.indisponivel !== undefined) {
      indisponiveis.push(r.indisponivel)
      continue
    }
    registros.push({ caminho, ...r })
  }

  const violacoes = registros.flatMap((r) => r.violacoes)
  const naoJulgadas = registros.flatMap((r) => r.naoJulgadas ?? [])

  if (json) {
    console.log(
      JSON.stringify(
        {
          estado:
            indisponiveis.length > 0
              ? "indisponivel"
              : violacoes.length > 0
                ? "desonesto"
                : "honesto",
          head: headSha,
          act: BENCH_ACT,
          registros: registros.map((r) => ({
            caminho: r.caminho,
            origem: r.origem ?? null,
            subtests: r.subtests ?? null,
            carregados: r.carregados ?? null,
            violacoes: r.violacoes,
          })),
          naoJulgadas,
          indisponiveis,
        },
        null,
        2,
      ),
    )
  } else {
    for (const r of registros) {
      const curto = (r.origem ?? "").slice(0, 8)
      if (r.violacoes.length === 0) {
        console.log(
          `check-act-origin: ✅ ${r.caminho} — a origem \`${curto}\` carrega a matriz declarada (${r.subtests} sub-test(s))`,
        )
      }
    }
    for (const v of violacoes) console.error(`❌ check-act-origin: ${v}`)
    for (const n of naoJulgadas) console.error(`   · não julgado (declarado): ${n}`)
    if (violacoes.length === 0 && indisponiveis.length === 0) {
      console.log(
        `check-act-origin: ✅ o registro do ato é HONESTO — o commit de origem carrega a matriz que ele declara ter medido`,
      )
    }
    for (const i of indisponiveis) console.error(`◐ check-act-origin: ${i}`)
    if (violacoes.length > 0)
      console.error(`❌ check-act-origin: registro DESONESTO (${violacoes.length} violação(ões))`)
  }

  if (indisponiveis.length > 0) process.exit(EXIT.INDISPONIVEL)
  process.exit(violacoes.length > 0 ? EXIT.VIOLACAO : EXIT.OK)
}

principal()
