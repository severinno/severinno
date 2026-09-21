#!/usr/bin/env node

// =============================================================================
// bench-freshness.mjs
//
// A IDADE do commit de ORIGEM de cada família do bench: quantos commits de HEAD
// separam o número que a baseline versionada declara do código que está aqui
// agora.
//
// POR QUE ISSO PRECISA EXISTIR (o defeito real, medido): o
// `docs/benchmarks/guard-timing-baseline.json` guarda, por família, o ATO que
// mediu o número e o COMMIT que ele descreve (`meta.families`). Esse número é
// consumido por fora do bench — o modelo de latência de merge
// (`ci/merge-latency.json`) declara o custo do job a partir dele. Em 09/2026 a
// declaração do `mutation-guards` estava em 271.755ms enquanto a matriz media
// 380.700ms: **28% de divergência** que NINGUÉM viu, porque nada no repositório
// olhava QUANDO aquele número foi medido. O teto de tolerância da comparação
// (25%) só existe se alguém comparar — e a comparação rodava contra uma medição
// de outro commit, de outra contagem de sub-tests.
//
// O QUE ESTA RÉGUA MEDE — e o que ela NÃO mede. Ela mede FRESCOR: se o número
// declarado foi medido num commit que `HEAD` já deixou para trás. Ela NÃO diz que
// o número está errado: um commit a mais pode não mudar nada do que a família
// mede. O que ela impede é o SILÊNCIO — uma baseline de 400 commits atrás
// declarando custo para o merge é uma afirmação que ninguém re-mediu enquanto a
// árvore andou, e é exatamente aí que os 28% couberam.
//
// O TETO (`FRESHNESS_MAX_COMMITS_BEHIND`) É DECLARADO, não escolhido por gosto: o
// cron que re-mede (`guard-timing-alert`, semanal) move a baseline de propósito, e
// o ritmo MEDIDO do repositório é de ~10 commits/dia (303 em 30 dias, 494 em 90 —
// medido com `git log --since`), ou seja ~70 commits por ciclo do cron. O teto de
// 150 é DOIS ciclos: uma semana perdida (cron que falhou, feriado, fila) não abre
// ticket — duas semanas sem re-medição abrem. Abaixo disso o canal viraria ruído
// (o repositório já classificou alerta que sempre acende como defeito), acima
// disso o número teria passado meses envelhecendo sem que ninguém lesse.
//
// AS FONTES SÃO AS DO DONO, não uma segunda leitura: o conjunto de famílias é o
// `FAMILY_MEASURED` do `bench-guard-timing.mjs` (a MESMA régua que decide "foi
// medida?" na comparação e na procedência) e o arquivo é o `BASELINE_FILE` dele.
// Uma lista paralela de famílias aqui divergiria da que o bench usa justamente no
// dia em que uma família nova nascesse.
//
// A PROCEDÊNCIA vem de `meta.families` (o que o `familyProvenance` grava): `act`
// (`measured`/`reused`), `commit`, `commitDate` e `source`. Quando a baseline é
// ANTERIOR a essa tabela (o arquivo não tem `meta.families`), a origem cai para o
// `meta.commit` do arquivo — e isso é DITO no campo `origin` de cada família
// (`family` × `meta.commit`), porque um fallback silencioso seria uma segunda
// verdade sobre de quando o número é.
//
// FAIL-CLOSED (a mesma disciplina do resto do repositório): arquivo ausente,
// JSON inválido, família declarada medida sem commit, git que não roda ou commit
// que não está no checkout (clone raso) NÃO viram "fresca". Cada um sai com o seu
// estado (`unknown`/`diverged`) e o motivo, e o veredito do doctor os publica —
// um "não consegui medir" que passasse por verde é o alerta mudo desta classe.
//
// Usage:
//   node scripts/bench-freshness.mjs                 # a idade, em texto
//   node scripts/bench-freshness.mjs --json          # a idade, como dados
//   node scripts/bench-freshness.mjs --head HEAD~50  # contra outro ponto
//   node scripts/bench-freshness.mjs --file docs/benchmarks/guard-timing-latest.json
//   node scripts/bench-freshness.mjs --help
//
// Exit codes:
//   0 — MEDIDA e todas as famílias frescas (dentro do teto)
//   1 — MEDIDA e alguma família VENCIDA (atrás de mais de N commits) ou
//       DIVERGENTE (o commit de origem não é ancestral de HEAD — a história foi
//       reescrita e o número não se reproduz nesta árvore)
//   2 — NÃO MEDIDA (arquivo ausente/inválido, ou git incapaz de responder: o
//       veredito não pode afirmar frescor nem vencimento)
//   3 — uso inválido
// =============================================================================

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

// A RÉGUA DAS FAMÍLIAS vem do módulo-FOLHA (`bench-families.mjs`), não do
// `bench-guard-timing.mjs`: o módulo do bench resolve o comando do lint a partir
// do `package.json` NA CARGA, e quem só quer saber quais famílias um arquivo
// declara medidas não pode passar a exigir um `package.json` para carregar —
// medido: o doctor sobre uma cópia do repositório sem ele morria no import.
// A régua é UMA só: o dono a importa e reexporta de lá.
import { BASELINE_FILE, FAMILY_MEASURED, measuredFamilies } from "./bench-families.mjs"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(SCRIPT_DIR, "..")

/** A baseline versionada — o arquivo cuja idade este módulo mede (default). */
export const BASELINE_PATH = join("docs", "benchmarks", BASELINE_FILE)

/**
 * O TETO, em commits de HEAD (a régua da casa — ver o cabeçalho para o porquê
 * dos 150: dois ciclos do cron semanal, ao ritmo medido do repositório).
 */
export const FRESHNESS_MAX_COMMITS_BEHIND = 150

/** O comando que REMEDEIA (o mesmo que o corpo da issue cita). */
export const REMEDY_COMMAND = "bun run bench:guard-timing:baseline"

/**
 * A IDADE de UM commit de origem, medida por git.
 *
 * Três estados, e nenhum deles é um palpite: `ancestor` (o commit está na
 * história de `head` e a distância em commits é `behind`), `diverged` (o commit
 * EXISTE neste checkout mas não é ancestral de `head`: a história foi reescrita,
 * e contar `commit..head` daria um número que não significa "distância"), e
 * `unknown` (git não respondeu: não é repositório, git ausente, ou o objeto não
 * está no checkout — o caso do clone RASO, que o remédio nomeia).
 *
 * A ORDEM das perguntas importa: a existência do objeto vem primeiro, senão um
 * clone raso responderia "não é ancestral" para um commit que é ancestral, só não
 * está aqui — e a causa (`fetch-depth`) ficaria escondida atrás de outra.
 *
 * Pura na frente do processo: `run` é injetável, então o teste mede os três
 * estados sem git de verdade.
 *
 * @param {{commit?: string|null, head?: string, cwd?: string}} alvo
 * @param {{run?: Function, shallow?: () => boolean}} [deps]
 * @returns {{state: "ancestor"|"diverged"|"unknown", behind: number|null, reason: string}}
 */
export function commitAge(
  { commit = null, head = "HEAD", cwd = REPO_ROOT } = {},
  { run = spawnSync } = {},
) {
  const git = (args) => run("git", args, { cwd, encoding: "utf8" })

  if (!commit) {
    return {
      state: "unknown",
      behind: null,
      reason: "a família não declara commit de origem (nem na procedência, nem no meta do arquivo)",
    }
  }

  const existe = git(["cat-file", "-e", `${commit}^{commit}`])
  if (existe?.error) {
    return {
      state: "unknown",
      behind: null,
      reason: `git não pôde ser executado (${existe.error.message}) — a idade do commit ${commit} não foi medida`,
    }
  }
  if (existe?.status !== 0) {
    return {
      state: "unknown",
      behind: null,
      reason: `o commit de origem ${commit} não está neste checkout (clone raso/sem a história) — a idade não foi medida`,
    }
  }

  const ancestral = git(["merge-base", "--is-ancestor", commit, head])
  if (ancestral?.error) {
    return {
      state: "unknown",
      behind: null,
      reason: `git não pôde ser executado (${ancestral.error.message}) — a idade do commit ${commit} não foi medida`,
    }
  }
  if (ancestral?.status !== 0) {
    return {
      state: "diverged",
      behind: null,
      reason: `o commit de origem ${commit} existe mas NÃO é ancestral de ${head} — a história foi reescrita e o número medido ali não se reproduz nesta árvore`,
    }
  }

  const contagem = git(["rev-list", "--count", `${commit}..${head}`])
  const behind = Number.parseInt(String(contagem?.stdout ?? "").trim(), 10)
  if (contagem?.error || !Number.isFinite(behind)) {
    return {
      state: "unknown",
      behind: null,
      reason: `git não devolveu a distância de ${commit} a ${head}${contagem?.error ? ` (${contagem.error.message})` : ""} — a idade não foi medida`,
    }
  }
  return { state: "ancestor", behind, reason: `${behind} commit(s) de ${commit} até ${head}` }
}

/**
 * Uma família do fato: a idade dela E de onde o número veio.
 *
 * `origin` diz a PROCEDÊNCIA em vez de presumi-la: `family` quando o
 * `meta.families` do próprio arquivo grava o commit daquela família, `meta.commit`
 * quando só o ato inteiro foi gravado, e `ausente` quando o arquivo não diz nada.
 *
 * @typedef {object} FamilyAge
 * @property {string} family
 * @property {string|null} act          o ato do bench que a mediu (`measured`/…)
 * @property {"family"|"meta.commit"|"ausente"} origin
 * @property {string|null} source
 * @property {string|null} commit       o commit de ORIGEM gravado
 * @property {string|null} commitDate
 * @property {"fresh"|"aged"|"diverged"|"unknown"} state
 * @property {number|null} behind       commits de `commit` até `head`
 * @property {string} reason
 */

/**
 * O FATO da idade inteiro — o shape que o doctor e o publicador compartilham.
 *
 * @typedef {object} BenchFreshness
 * @property {"measured"|"unavailable"} state
 * @property {string|null} file
 * @property {string} head
 * @property {number} maxBehind
 * @property {FamilyAge[]} families
 * @property {string[]} aged
 * @property {string[]} diverged
 * @property {string[]} unknown
 * @property {number|null} behindMax
 * @property {string} detail
 * @property {string|null} reason
 * @property {string[]} remedies
 */

/**
 * O FATO da idade, derivado de um arquivo do bench.
 *
 * Só as famílias que o arquivo DECLARA MEDIDAS entram (`FAMILY_MEASURED`, a
 * régua do dono): uma família `not-measured` não tem número para envelhecer, e
 * cobrar frescor dela seria abrir dívida sobre o que a baseline nem declara.
 *
 * O commit é sondado UMA vez por valor (cache): as famílias de um mesmo ato
 * compartilham o mesmo commit, e medir seis vezes a mesma pergunta custaria seis
 * processos de git para responder a mesma coisa.
 *
 * @param {object|null} bench   o arquivo do bench (baseline ou latest)
 * @param {{maxBehind?: number, head?: string, probe?: (commit: string|null) => {state: string, behind: number|null, reason?: string}}} [options]
 * @returns {BenchFreshness}
 */
export function familyFreshness(
  bench,
  { maxBehind = FRESHNESS_MAX_COMMITS_BEHIND, head = "HEAD", probe = null } = {},
) {
  const meta = bench?.meta ?? {}
  const procedencia = meta?.families ?? {}

  if (probe === null) {
    return unavailable("a sonda de git não foi injetada — sem ela não há idade para medir", {
      head,
      maxBehind,
    })
  }

  const cache = new Map()
  const sonda = (commit) => {
    if (!cache.has(commit)) cache.set(commit, probe(commit))
    return cache.get(commit)
  }

  const families = []
  // O CONJUNTO vem da régua do dono (`measuredFamilies`, uma aplicação da MESMA
  // tabela que a comparação de tempo usa): uma lista paralela aqui divergiria no
  // dia em que uma família nascesse.
  for (const family of measuredFamilies(bench)) {
    const prov = procedencia?.[family] ?? null
    const commit = prov?.commit ?? meta?.commit ?? null
    const origin = prov?.commit ? "family" : meta?.commit ? "meta.commit" : "ausente"
    const idade = sonda(commit)
    const aged = idade.state === "ancestor" && idade.behind > maxBehind
    families.push({
      family,
      act: prov?.act ?? null,
      origin,
      source: prov?.source ?? null,
      commit,
      commitDate: prov?.commitDate ?? meta?.commitDate ?? null,
      state: idade.state === "ancestor" ? (aged ? "aged" : "fresh") : idade.state,
      behind: idade.behind,
      reason: idade.reason,
    })
  }

  const aged = families.filter((f) => f.state === "aged").map((f) => f.family)
  const diverged = families.filter((f) => f.state === "diverged").map((f) => f.family)
  const unknown = families.filter((f) => f.state === "unknown").map((f) => f.family)
  const medidas = families.filter((f) => typeof f.behind === "number")
  const behindMax = medidas.length > 0 ? Math.max(...medidas.map((f) => f.behind)) : null

  if (families.length === 0) {
    return unavailable(
      "o arquivo do bench não declara NENHUMA família medida — não há número para envelhecer",
      {
        head,
        maxBehind,
      },
    )
  }

  const detail =
    aged.length + diverged.length > 0
      ? `${families.length} família(s) medida(s) e ${aged.length + diverged.length} VENCIDA(s): ` +
        `${aged.map((f) => `${f} a ${families.find((x) => x.family === f).behind} commit(s) atrás`).join(", ")}` +
        (diverged.length > 0
          ? `${aged.length > 0 ? " · " : ""}fora da história: ${diverged.join(", ")}`
          : "") +
        ` (teto ${maxBehind} commits)`
      : unknown.length > 0
        ? `${families.length} família(s) medida(s), ${unknown.length} SEM idade (${unknown.join(", ")}) e nenhuma vencida conhecida (teto ${maxBehind} commits)`
        : `${families.length} família(s) medida(s), a mais antiga ${behindMax} commit(s) atrás de ${head} (teto ${maxBehind}) — nenhuma vencida`

  return {
    state: "measured",
    file: null,
    head,
    maxBehind,
    families,
    aged,
    diverged,
    unknown,
    behindMax,
    detail,
    reason: null,
    remedies: remediesFor({ aged, diverged, unknown, maxBehind, families }),
  }
}

/** O fato INDISPONÍVEL — o mesmo shape, com a causa nomeada (nunca "fresca"). */
function unavailable(reason, { head = "HEAD", maxBehind = FRESHNESS_MAX_COMMITS_BEHIND } = {}) {
  return {
    state: "unavailable",
    file: null,
    head,
    maxBehind,
    families: [],
    aged: [],
    diverged: [],
    unknown: [],
    behindMax: null,
    detail: reason,
    reason,
    remedies: [
      `confira que ${BASELINE_PATH} existe e que o checkout tem a história (um clone raso não responde a idade em commits)`,
    ],
  }
}

/** Os remédios, derivados do estado — o texto que a issue e o doctor repetem. */
function remediesFor({ aged, diverged, unknown, maxBehind, families }) {
  const out = []
  if (aged.length + diverged.length > 0) {
    out.push(
      `${REMEDY_COMMAND} — re-mede e move a baseline DE PROPÓSITO (o ato grava o commit de origem do que mediu); ` +
        `a jogada é deliberada porque o número declarado é o que a issue cobra`,
    )
  }
  if (diverged.length > 0) {
    out.push(
      `as famílias ${diverged.join(", ")} foram medidas num commit que não está na história de HEAD (reescrita): ` +
        `o número delas não é reproduzível nesta árvore — re-medir é o único remédio`,
    )
  }
  if (unknown.length > 0) {
    out.push(
      `as famílias ${unknown.join(", ")} ficaram sem idade: um clone RASO (fetch-depth) responde "o commit não está aqui", ` +
        `e não "está fresco" — o job que mede precisa da história`,
    )
  }
  if (out.length === 0) {
    out.push(
      `nenhum: a mais antiga está ${Math.max(0, ...families.map((f) => f.behind ?? 0))} commit(s) atrás, dentro do teto de ${maxBehind}`,
    )
  }
  return out
}

/**
 * O LEITOR: lê o arquivo do bench do disco e mede a idade das famílias dele.
 *
 * Fail-closed em CADA passo: arquivo ausente ou ilegível vira `unavailable` com a
 * causa (nunca um fato vazio, que o veredito leria como "sem família velha"), e
 * JSON quebrado idem. O `exists`/`read`/`probe` são injetáveis — o teste mede os
 * estados sem tocar o disco nem rodar git.
 *
 * @param {{cwd?: string, file?: string, head?: string, maxBehind?: number, deps?: {exists?: Function, read?: Function, probe?: Function, run?: Function}}} [options]
 * @returns {BenchFreshness} o mesmo shape de `familyFreshness`, com `file` preenchido
 */
export function readBenchFreshness({
  cwd = REPO_ROOT,
  file = BASELINE_PATH,
  head = "HEAD",
  maxBehind = FRESHNESS_MAX_COMMITS_BEHIND,
  deps = {},
} = {}) {
  const exists = deps.exists ?? existsSync
  const read = deps.read ?? ((path) => readFileSync(path, "utf8"))
  const run = deps.run ?? spawnSync
  const probe = deps.probe ?? ((commit) => commitAge({ commit, head, cwd }, { run }))
  const caminho = isAbsolute(file) ? file : resolve(cwd, file)
  const rotulo = isAbsolute(file) ? file : file

  if (!exists(caminho)) {
    return {
      ...unavailable(`o arquivo do bench não existe: ${rotulo}`, { head, maxBehind }),
      file: rotulo,
    }
  }

  let bench = null
  try {
    bench = JSON.parse(read(caminho))
  } catch (error) {
    return {
      ...unavailable(`o arquivo do bench não é JSON válido (${rotulo}): ${error.message}`, {
        head,
        maxBehind,
      }),
      file: rotulo,
    }
  }
  if (bench === null || typeof bench !== "object" || Array.isArray(bench)) {
    return {
      ...unavailable(
        `o arquivo do bench não é um objeto (${rotulo}) — uma leitura truncada não pode virar "sem família velha"`,
        {
          head,
          maxBehind,
        },
      ),
      file: rotulo,
    }
  }

  return { ...familyFreshness(bench, { maxBehind, head, probe }), file: rotulo }
}

/**
 * A frase do fato — UMA, usada pelo relatório do doctor e pelo publicador (e
 * pelos logs do CLI): duas prosas do mesmo número divergiriam.
 *
 * @param {BenchFreshness} fact
 * @returns {string}
 */
export function freshnessLine(fact) {
  if (!fact || fact.state !== "measured") {
    return `régua do bench NÃO medida: ${fact?.reason ?? "sem motivo declarado"}`
  }
  return fact.detail
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export const USAGE =
  "Uso: node scripts/bench-freshness.mjs [--json] [--file ARQUIVO] [--head REF] [--help]"

export function parseArgs(argv) {
  const options = { json: false, file: BASELINE_PATH, head: "HEAD", help: false, error: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--json") options.json = true
    else if (arg === "--file") {
      const value = argv[++i]
      if (value === undefined || value === "") options.error = "--file exige um caminho"
      else options.file = value
    } else if (arg === "--head") {
      const value = argv[++i]
      if (value === undefined || value === "") options.error = "--head exige uma ref"
      else options.head = value
    } else if (arg === "--help" || arg === "-h") options.help = true
    else options.error = `argumento desconhecido: ${arg}`
  }
  return options
}

/** SÍNCRONO de propósito: o módulo é importado pelo doctor e pelo publicador, e
 * um top-level await aqui contagiaria os dois com a carga assíncrona sem
 * necessidade — a medição é leitura de arquivo + `spawnSync`. */
function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.error) {
    console.error(`❌ ${options.error}`)
    console.error(USAGE)
    return 3
  }
  if (options.help) {
    console.log(USAGE)
    console.log(
      "\n  Mede a IDADE do commit de origem de cada família medida do bench: quantos\n" +
        "  commits de HEAD a baseline versionada já deixou para trás (teto declarado:\n" +
        `  ${FRESHNESS_MAX_COMMITS_BEHIND} — dois ciclos do cron semanal).\n\n` +
        "  --file: mede OUTRO arquivo do bench (default: docs/benchmarks/guard-timing-baseline.json).\n" +
        "  --head: mede contra outra ref (default: HEAD).",
    )
    return 0
  }

  const fact = readBenchFreshness({ file: options.file, head: options.head })
  if (options.json) {
    console.log(JSON.stringify(fact, null, 2))
  } else {
    console.log(`📏 Régua do bench — ${freshnessLine(fact)}`)
    for (const f of fact.families) {
      const marca = f.state === "fresh" ? "✅" : f.state === "aged" ? "❌" : "⚠️"
      const idade = f.behind === null ? f.state : `${f.behind} commit(s) atrás`
      console.log(
        `   ${marca} ${f.family}: ${idade} — origem ${f.commit ?? "?"}` +
          `${f.commitDate ? ` (${f.commitDate})` : ""}` +
          `${f.act ? ` · ${f.act}${f.source ? ` de ${f.source}` : ""}` : ""}`,
      )
    }
    for (const r of fact.remedies) console.log(`   → ${r}`)
  }

  if (fact.state !== "measured") return 2
  return fact.aged.length + fact.diverged.length > 0 ? 1 : 0
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) {
  let code = 1
  try {
    code = main()
  } catch (error) {
    console.error(`❌ ${error.message}`)
    code = 3
  }
  process.exit(code)
}
