#!/usr/bin/env node

// =============================================================================
// bench-freshness.mjs
//
// A IDADE da ORIGEM de cada DECLARAÇÃO datada — as famílias do bench, os números
// do modelo de latência e as tabelas de custo do README: quantos commits de HEAD
// separam o número que eles declaram do código que está aqui agora.
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
// AS OUTRAS DECLARAÇÕES QUE ENVELHECEM entram no MESMO fato (ver a seção abaixo):
// cada `ms` declarado do modelo de latência (`ci/merge-latency.json`) e cada
// tabela do README que declara duração. O que se cobra delas é o que se cobra da
// baseline: uma DATA DE ORIGEM visível, da qual a idade se mede — um número sem
// data própria não é "sem idade", é uma declaração que a régua recusa a datar
// por decurso.
//
// O TETO NÃO É DECLARADO À MÃO: o ritmo que o repositório ANDA, medido, é que o
// decide. A POLÍTICA (`POLITICA_DO_TETO`) diz o que não se mede — o ciclo do cron
// que re-mede (`guard-timing-alert`, semanal), QUANTOS ciclos uma re-medição
// perdida pode atrasar (2: uma semana perdida não abre ticket, duas abrem), a
// janela em que o ritmo é medido (28 dias = 4 ciclos) e o PISO por ciclo (um
// repositório parado daria teto 0 e acusaria tudo). O NÚMERO sai de
// `tetoDoRitmo(medirRitmoDeCommits(...))`: `ciclos × commits por ciclo`.
//
// A JANELA É MEDIDA, não escolhida por gosto — o teto que cada janela daria,
// re-medido em 22/09/2026 (`git rev-list --count --since`): 14 dias → 164 ·
// 21 dias → 163 · **28 dias → 157** · 35 dias → 139 · 90 dias → 79. (A janela
// ROLA: na véspera a de 14 dias dava 170 e a de 21, 165 — o número é do dia em
// que se mede, e é justamente por isso que a política declara a JANELA e não o
// número.) Janela curta: uma semana atípica manda no teto; longa: o ritmo de
// meses atrás decide o de hoje, e num repositório que acelerou o teto fica
// APERTADO em silêncio (a de 90 dias acusaria hoje 22 das 35 declarações QUE TÊM
// teto — 28 das 41, contando as tabelas do README, que são publicadas — todas
// de menos de uma semana em tempo de calendário). 4 ciclos é a janela que contém
// ciclos inteiros (a cadência semanal — fim de semana, feriado — se dilui) sem
// sair da ordem do horizonte que o teto cobre.
//
// FAIL-CLOSED: sem ritmo medido (git que não roda, saída que não é contagem) o
// teto cai na RESERVA declarada (`FRESHNESS_MAX_COMMITS_BEHIND`, 150 — os ~157
// que a janela de 28 dias dava quando a régua foi escrita), e o fato PUBLICA
// qual das duas réguas valeu (`teto.origem`) — nunca um teto silencioso.
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
//   0 — MEDIDA e todas as declarações frescas (dentro do teto do TIPO delas; a
//       tabela do README sem teto nunca vence por idade)
//   1 — MEDIDA e alguma declaração VENCIDA (atrás de mais de N commits) ou
//       DIVERGENTE (o commit de origem não é ancestral de HEAD — a história foi
//       reescrita e o número não se reproduz nesta árvore)
//   2 — NÃO MEDIDA (arquivo ausente/inválido, ou git incapaz de responder: o
//       veredito não pode afirmar frescor nem vencimento)
//   3 — uso inválido
//
// OBS: uma declaração SEM idade (fonte ilegível, `ms` sem a própria `data`,
// tabela sem âncora, clone raso) sai 0 aqui com a marca ⚠️ e o motivo na linha —
// quem transforma isso em INDETERMINADA é o doctor (seção 9/9) e o publicador
// (que suspende o fechamento enquanto a medição não cobrir todas elas).
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
 * A POLÍTICA do teto de idade: o que se DECLARA (o ciclo do cron e quantos
 * ciclos uma re-medição perdida pode atrasar) e o que se MEDE (o ritmo de
 * commits do repositório). O NÚMERO do teto não é declarado à mão: ele é o
 * produto `ciclos × commits por ciclo`, e o ritmo sai do git na hora de medir.
 *
 * O QUE É DECLARADO, e por quê:
 *   - `cicloDias: 7`    — o cron que re-mede a baseline (`guard-timing-alert`)
 *     é SEMANAL: o ciclo da política é o ciclo do dono, não um número escolhido;
 *   - `ciclos: 2`       — UMA semana perdida (cron que falhou, feriado, fila de
 *     runner) não abre ticket; DUAS abrem — é a decisão que o teto codifica;
 *   - `janelaDias: 28`  — a janela em que o ritmo é medido: QUATRO ciclos. Menos
 *     que isso, uma semana atípica manda no teto; mais, o ritmo de meses atrás
 *     decide o de hoje (a janela de 90 dias daria 79 e acusaria 22 das 35
 *     declarações que TÊM teto, todas com menos de uma semana de calendário —
 *     ver o cabeçalho);
 *   - `pisoDeCiclo: 20` — o PISO por ciclo. Um repositório parado (ou uma janela
 *     sem commits de código) daria um teto de 0 e acusaria TUDO; o piso é
 *     declarado, não medido, e quando ele morde o relatório diz.
 *
 * FAIL-CLOSED: quando o git não responde o ritmo (não é repositório, `HEAD`
 * ausente, objeto fora do checkout), o teto NÃO vira `null` (sem teto = tudo
 * fresco por omissão) nem um palpite: cai no TETO DE RESERVA × ciclos, e a causa
 * sai publicada no fato (`teto.origem: "reserva declarada"`).
 */
export const POLITICA_DO_TETO = {
  cicloDias: 7,
  ciclos: 2,
  janelaDias: 28,
  pisoDeCiclo: 20,
}

/**
 * O TETO DE RESERVA, em commits de HEAD — a política aplicada ao ritmo que o
 * repositório tinha quando este valor foi escrito (a janela de 28 dias da
 * política, re-medida em 22/09/2026 com `git rev-list --count --since`: 314
 * commits — 506 em 90 dias; o produto dá 157, e a reserva é o 150 que se
 * declarava à mão antes desta derivação).
 *
 * Ele NÃO é a fonte do teto: é o valor usado quando o ritmo não pôde ser medido
 * AGORA, e o fato diz qual dos dois valeu (`teto.origem`).
 */
export const FRESHNESS_MAX_COMMITS_BEHIND = 150

/**
 * MEDE o ritmo de commits do repositório na janela da política.
 *
 * O veredito é o do comando (`git rev-list --count`), não o de um filtro: uma
 * contagem vazia, um erro do git ou um número que não é inteiro positivo saem
 * como `unknown` com a CAUSA nomeada — e `unknown` aqui nunca vira "fresco",
 * porque o teto cai na reserva declarada e o fato publica qual régua valeu.
 *
 * @param {{cwd?: string, run?: Function, agora?: Date, politica?: typeof POLITICA_DO_TETO}} [options]
 * @returns {{state: "medido"|"unknown", desde: string, janelaDias: number, commits?: number, commitsPorCiclo?: number, reason: string|null}}
 */
export function medirRitmoDeCommits({
  cwd = REPO_ROOT,
  run = spawnSync,
  agora = new Date(),
  politica = POLITICA_DO_TETO,
} = {}) {
  const desde = new Date(agora.getTime() - politica.janelaDias * 86400000).toISOString()
  const base = { desde, janelaDias: politica.janelaDias, commits: null, commitsPorCiclo: null }
  // O canal de git é o MESMO dos outros medidores deste módulo (`run("git", args,
  // { cwd })`): a sonda injetada pelo teste responde por subcomando, e um
  // `-C` avulso aqui sairia por um canal que o dublê não conhece.
  const r = run("git", ["rev-list", "--count", `--since=${desde}`, "HEAD"], {
    cwd,
    encoding: "utf8",
    timeout: 30000,
  })
  if (r?.error || r?.status !== 0) {
    const causa = r?.error?.message ?? `exit ${r?.status ?? "?"}`
    return {
      ...base,
      state: "unknown",
      reason: `o git não respondeu a contagem de commits desde ${desde.slice(0, 10)} (${String(causa).split("\n")[0]})`,
    }
  }
  const commits = Number(String(r.stdout ?? "").trim())
  if (!Number.isInteger(commits) || commits <= 0) {
    const saida = String(r.stdout ?? "")
      .trim()
      .slice(0, 40)
    return {
      ...base,
      state: "unknown",
      reason: `o git respondeu algo que não é uma contagem de commits (${saida || "saída vazia"})`,
    }
  }
  const ciclosNaJanela = politica.janelaDias / politica.cicloDias
  return {
    ...base,
    state: "medido",
    commits,
    commitsPorCiclo: commits / ciclosNaJanela,
    reason: null,
  }
}

/**
 * Deriva o TETO de idade do ritmo medido: `ciclos × commits por ciclo`, com o
 * piso declarado como limite inferior. É o ÚNICO lugar que transforma ritmo em
 * teto — quem publica o número publica junto de onde ele veio.
 *
 * O objeto devolvido sai AUTO-DESCRITO (a política, o medido e o resultado): é
 * dele que o relatório, o doctor e a issue leem a procedência, e é ele que
 * permite recomputar o teto do lado de fora (`piso` × `ciclos` contra
 * `commits` ÷ `janelaDias` × `ciclos`) sem uma segunda cópia da regra.
 *
 * @param {{state: string, commitsPorCiclo?: number|null, reason?: string|null, desde?: string}} ritmo
 * @param {typeof POLITICA_DO_TETO} [politica]
 * @returns {TetoDeIdade}
 */
export function tetoDoRitmo(ritmo, politica = POLITICA_DO_TETO) {
  const base = {
    ciclos: politica.ciclos,
    cicloDias: politica.cicloDias,
    janelaDias: ritmo?.janelaDias ?? politica.janelaDias,
    pisoDeCiclo: politica.pisoDeCiclo,
    desde: ritmo?.desde ?? null,
    commits: ritmo?.commits ?? null,
  }
  if (ritmo?.state !== "medido" || typeof ritmo.commitsPorCiclo !== "number") {
    return {
      ...base,
      teto: FRESHNESS_MAX_COMMITS_BEHIND,
      origem: "reserva declarada",
      motivo: ritmo?.reason ?? "o ritmo de commits não foi medido",
      commitsPorCiclo: null,
    }
  }
  const piso = politica.pisoDeCiclo * politica.ciclos
  const bruto = Math.round(ritmo.commitsPorCiclo * politica.ciclos)
  return {
    ...base,
    teto: Math.max(piso, bruto),
    origem: "medido",
    commitsPorCiclo: ritmo.commitsPorCiclo,
    motivo:
      bruto < piso ? `o ritmo medido daria ${bruto} commit(s) e o PISO declarado é ${piso}` : null,
  }
}

/**
 * O TETO É POR TIPO DE DECLARAÇÃO, e cada um tem o SEU ritmo — um teto único
 * acusaria a prosa de custo (re-medida quando o GUARD muda) no ritmo do bench
 * (re-medido por cron), que é um alerta que sempre acende.
 *
 *   bench-family    idade  segue o teto DERIVADO do ritmo (dois ciclos do cron
 *                         semanal `guard-timing-alert` × commits por ciclo);
 *   declared-number idade  o modelo de latência é re-medido no MESMO ato em que o
 *                         job muda (e o dono confronta derivado × declarado);
 *   declared-table   null  a prosa de custo do README é re-medida quando o GUARD
 *                         muda, não por calendário: um teto em commits compararia
 *                         o ritmo do CÓDIGO com o ritmo da DOC e abriria alerta
 *                         permanente (as âncoras vivas hoje vão de 79 a 412
 *                         commits). O que a régua cobra dela é a ÂNCORA, e a
 *                         idade sai PUBLICADA — quem decide se o número ainda
 *                         vale é o dono dele, quando o guard mudar.
 */
export const FRESHNESS_CEILINGS = {
  "bench-family": "idade",
  "declared-number": "idade",
  "declared-table": null,
}

/**
 * O teto de um tipo de declaração, com o VALOR vindo da derivação do ritmo.
 *
 * A tabela declara a POLÍTICA do tipo (`"idade"` = segue o teto derivado; `null`
 * = sem teto, a idade só é publicada); o número sai de `tetoDoRitmo`. Um literal
 * aqui seria o defeito que este passo removeu: o teto voltaria a ser declarado à
 * mão, e o ritmo do repositório viveria em prosa.
 *
 * @param {string} kind
 * @param {number} tetoDeIdade o teto derivado (ou o de reserva, quando o ritmo não foi medido)
 */
export function ceilingOf(kind, tetoDeIdade = FRESHNESS_MAX_COMMITS_BEHIND) {
  const politica = kind in FRESHNESS_CEILINGS ? FRESHNESS_CEILINGS[kind] : "idade"
  return politica === null ? null : tetoDeIdade
}

/** O teto de um tipo, como TEXTO (o `null` diz que a idade é só publicada). */
export function ceilingLabel(kind, tetoDeIdade) {
  const teto = ceilingOf(kind, tetoDeIdade)
  return teto === null ? "sem teto (a idade é publicada)" : `${teto}`
}

/** A comparação que decide `aged` — com teto `null` NUNCA há vencimento. */
export function isAged(behind, kind, tetoDeIdade) {
  const teto = ceilingOf(kind, tetoDeIdade)
  return teto !== null && typeof behind === "number" && behind > teto
}

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
 * @property {string} [kind]            o TIPO da declaração (e com ele a POLÍTICA
 *                                      do teto dela); opcional porque um fato de
 *                                      famílias sozinho não o carrega
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
 * O TETO de idade EFETIVO com a PROCEDÊNCIA dele: o número e de onde ele veio
 * viajam JUNTOS, porque um teto sem origem é indistinguível de um teto medido.
 *
 * É o objeto que o doctor, o relatório e a issue repetem (`tetoLine`) — o
 * `origem` é o que separa "seguiu o ritmo de agora" de "o git não respondeu e
 * caiu na reserva declarada" de "o chamador fixou".
 *
 * @typedef {object} TetoDeIdade
 * @property {number} teto                o número efetivo, em commits de `head`
 * @property {"medido"|"reserva declarada"|"declarado pelo chamador"} origem
 * @property {number} ciclos              ciclos do cron que o teto cobre (a POLÍTICA)
 * @property {number} cicloDias
 * @property {number} janelaDias          a janela em que o ritmo foi medido
 * @property {number} pisoDeCiclo         o piso declarado por ciclo
 * @property {string|null} desde          o começo da janela medida
 * @property {number|null} commits        os commits contados na janela
 * @property {number|null} commitsPorCiclo
 * @property {string|null} motivo         por que o derivado caiu no piso (ou na reserva)
 */

/**
 * O FATO da idade inteiro — o shape que o doctor e o publicador compartilham.
 *
 * @typedef {object} BenchFreshness
 * @property {"measured"|"unavailable"} state
 * @property {string|null} file
 * @property {string} head
 * @property {number} maxBehind
 * @property {TetoDeIdade|null} teto    a procedência do teto efetivo (`null` num
 *                                     fato montado sem derivação — nunca um teto
 *                                     silencioso; `tetoLine` nomeia a dúvida)
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

  return assembleFact(families, { head, maxBehind })
}

/**
 * A MONTAGEM do fato — a parte pura que as DUAS leituras compartilham (as
 * famílias do bench e as declarações datadas do modelo/README). Os estados vêm
 * prontos de cada unidade; aqui só se conta, se nomeia e se deriva o remédio.
 *
 * @param {object[]} families  as unidades julgadas (cada uma com `state`/`behind`)
 * @param {{head?: string, maxBehind?: number, emptyReason?: string}} [options]
 * @returns {BenchFreshness}
 */
/** Como cada tipo de declaração se chama no relatório (a chave é o `kind`). */
export const NOMES_DE_TIPO = {
  "bench-family": "família do bench",
  "declared-number": "número declarado (modelo)",
  "declared-table": "tabela de custo (README)",
  "declaracao-sem-origem": "declaração SEM origem",
  "fonte-ilegivel": "fonte ilegível",
}

export function assembleFact(
  families,
  {
    head = "HEAD",
    maxBehind = FRESHNESS_MAX_COMMITS_BEHIND,
    teto = null,
    emptyReason = "o arquivo do bench não declara NENHUMA família medida — não há número para envelhecer",
  } = {},
) {
  const aged = families.filter((f) => f.state === "aged").map((f) => f.family)
  const diverged = families.filter((f) => f.state === "diverged").map((f) => f.family)
  const unknown = families.filter((f) => f.state === "unknown").map((f) => f.family)
  const medidas = families.filter((f) => typeof f.behind === "number")
  const behindMax = medidas.length > 0 ? Math.max(...medidas.map((f) => f.behind)) : null

  if (families.length === 0) {
    return unavailable(emptyReason, { head, maxBehind })
  }

  // O TETO POR TIPO vai DITO — e com o NÚMERO derivado do ritmo, não com o
  // literal da reserva: o teto efetivo é o mesmo para estes dois tipos, e a
  // prosa de custo do README fica de fora porque um alerta que sempre acende é
  // o defeito que o repositório já classificou como tal.
  const tetos = [...new Set(families.map((f) => f.kind ?? "bench-family"))]
    .map((k) => {
      const doTipo = ceilingOf(k, maxBehind)
      return `${NOMES_DE_TIPO[k] ?? k} ${doTipo === null ? "sem teto (a idade é publicada)" : `${doTipo} commits`}`
    })
    .join(", ")

  const detail =
    aged.length + diverged.length > 0
      ? `${families.length} declaração(ões) medida(s) e ${aged.length + diverged.length} VENCIDA(s): ` +
        `${aged.map((f) => `${f} a ${families.find((x) => x.family === f).behind} commit(s) atrás`).join(", ")}` +
        (diverged.length > 0
          ? `${aged.length > 0 ? " · " : ""}fora da história: ${diverged.join(", ")}`
          : "") +
        ` (teto por tipo: ${tetos})`
      : unknown.length > 0
        ? `${families.length} declaração(ões) medida(s), ${unknown.length} SEM idade (${unknown.join(", ")}) e nenhuma vencida conhecida (teto por tipo: ${tetos})`
        : `${families.length} declaração(ões) medida(s), a mais antiga ${behindMax} commit(s) atrás de ${head} (teto por tipo: ${tetos}) — nenhuma vencida`

  return {
    state: "measured",
    file: null,
    head,
    maxBehind,
    teto,
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
function unavailable(
  reason,
  { head = "HEAD", maxBehind = FRESHNESS_MAX_COMMITS_BEHIND, teto = null } = {},
) {
  return {
    state: "unavailable",
    file: null,
    head,
    maxBehind,
    teto,
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
  const vencidas = new Set([...aged, ...diverged])
  const porTipo = (tipo) =>
    families.filter((f) => vencidas.has(f.family) && (f.kind ?? "bench-family") === tipo)

  // O remédio de cada TIPO de declaração, derivado de quem venceu — mandar
  // re-mediar a baseline por causa de uma tabela do README seria um remédio que
  // não fecha a dívida que a régua acabou de nomear.
  if (porTipo("bench-family").length > 0) {
    out.push(
      `${REMEDY_COMMAND} — re-mede e move a baseline DE PROPÓSITO (o ato grava o commit de origem do que mediu); ` +
        `a jogada é deliberada porque o número declarado é o que a issue cobra`,
    )
  }
  if (porTipo("declared-number").length > 0) {
    out.push(
      `os números declarados (${MODEL_PATH}) saem da idade pela DATA de cada um: re-meça o número e atualize a \`date\` da PRÓPRIA entrada — a régua mede a idade da declaração, não a do ato (o \`meta.date\` é do arquivo)`,
    )
  }
  if (porTipo("declared-table").length > 0) {
    out.push(
      `as tabelas de custo do ${README_PATH} saem da idade pela âncora datada do bloco: re-meça o que envelheceu e atualize a âncora do bloco (a régua lê a data que ESTÁ na prosa)`,
    )
  }
  if (diverged.length > 0) {
    out.push(
      `as declarações ${diverged.join(", ")} foram datadas num commit que não está na história de HEAD (reescrita): ` +
        `o número delas não é reproduzível nesta árvore — re-medir (ou re-datar) é o único remédio`,
    )
  }
  if (unknown.length > 0) {
    out.push(
      `as declarações ${unknown.join(", ")} ficaram SEM idade: um clone RASO (fetch-depth) responde "o commit não está aqui", uma declaração sem a PRÓPRIA data responde "não a dataram" — nenhuma das duas é "está fresco", e o job que mede precisa da história`,
    )
  }
  if (out.length === 0) {
    const tipos = [...new Set(families.map((f) => f.kind ?? "bench-family"))]
      .map((k) => `${NOMES_DE_TIPO[k] ?? k}: ${ceilingLabel(k, maxBehind)}`)
      .join(", ")
    out.push(
      `nenhum: a mais antiga está ${Math.max(0, ...families.map((f) => f.behind ?? 0))} commit(s) atrás, e o teto de cada tipo está respeitado (${tipos})`,
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

/**
 * O TETO EFETIVO e a sua PROCEDÊNCIA, numa linha — o que o relatório, o doctor e
 * a issue repetem.
 *
 * Sem ela, um teto DERIVADO do ritmo de agora e um teto de RESERVA (o git não
 * respondeu) sairiam com o mesmo texto, e a diferença entre "o repositório anda
 * assim" e "não consegui medir" — que é a diferença entre um veredito e uma
 * dúvida — ficaria invisível justamente onde ela decide.
 *
 * O parâmetro é declarado pela PARTE que a função lê (`maxBehind` + `teto`), não
 * pelo fato inteiro: quem só tem a procedência em mãos — o teste da régua, um
 * chamador que montou o teto à mão — não precisa fabricar um fato completo para
 * publicar a linha.
 *
 * @param {{maxBehind?: number, teto?: TetoDeIdade|null}} [fact]
 * @returns {string}
 */
export function tetoLine(fact) {
  const t = fact?.teto
  if (!t) return `teto ${fact?.maxBehind ?? "?"} commits (a procedência não foi registrada)`
  const porCiclo = t.commitsPorCiclo === null ? null : Math.round(t.commitsPorCiclo * 10) / 10
  const de = {
    medido: `derivado do ritmo — ${t.commits} commits em ${t.janelaDias} dias (${porCiclo}/ciclo × ${t.ciclos} ciclos de ${t.cicloDias}d)`,
    "reserva declarada": `RESERVA declarada (o ritmo não foi medido: ${t.motivo})`,
    "declarado pelo chamador": "declarado pelo chamador (não é o teto derivado)",
  }[t.origem]
  return `teto ${t.teto} commits — ${de ?? t.origem}`
}

// ---------------------------------------------------------------------------
// AS DECLARAÇÕES DATADAS — o modelo de latência e as tabelas do README
// ---------------------------------------------------------------------------
//
// A régua nasceu medindo as FAMÍLIAS do bench, mas o defeito que ela nomeia não
// é do bench: é de QUALQUER número declarado cujo dono não diz de quando ele é.
// O modelo de latência de merge declara a duração de cada job (e, num job
// composto, de cada passo) e o README declara tabelas de custo — as duas coisas
// alimentam decisões e as duas envelhecem em silêncio, porque uma `date` sem
// idade é só uma data que ninguém lê.
//
// O QUE ENTRA NO MESMO FATO (o `kind` de cada unidade diz de onde ela vem):
//   - `bench-family`   — a origem é o COMMIT que a baseline grava (como sempre);
//   - `declared-number` — cada `ms` do modelo, com a origem derivada da DATA
//     DELE. Um número declarado SEM a própria data sai como `unknown` com a
//     causa nomeada: o `meta.date` do arquivo é a data do ATO, não a da medição,
//     e usá-lo em silêncio seria datar o número por decurso;
//   - `declared-table` — cada tabela do README que declara duração, com a origem
//     derivada da ÂNCORA DATADA do bloco. Tabela de custo sem âncora idem.
//
// A ORIGEM É DERIVADA, NÃO ARREDONDADA: a data vira o commit imediatamente
// ANTERIOR a ela (`git rev-list -1 --before`), e é esse commit que a sonda de
// idade mede — o MESMO `commitAge` das famílias, com os mesmos estados e a mesma
// contagem em commits. Uma segunda régua de idade divergiria da primeira no dia
// em que uma delas fosse ajustada.

/** O MODELO de latência de merge — um dos donos de números declarados. */
export const MODEL_PATH = join("ci", "merge-latency.json")

/** O README — onde vivem as tabelas de custo (as que declaram duração). */
export const README_PATH = "README.md"

/**
 * A célula de DURAÇÃO — o gatilho da exigência de âncora.
 *
 * A célula tem de COMEÇAR com a duração: um `500ms` no MEIO de uma frase (o
 * limiar de um teste, por exemplo) não é um custo declarado, e uma régua que
 * confundisse os dois pediria data de origem para a prosa que só cita um valor.
 * O que conta é a célula que AFIRMA o tempo: `~2s`, `<1s`, `131.5s`, `17.175s`.
 */
export const DURATION_CELL_RE = /^(?:\*\*)?\s*(?:≈|~|≤|<|>=?)?\s*\d+(?:[.,]\d+)?\s*(?:ms|s)\b/i

/** As células de uma linha de tabela Markdown (sem os pipes das pontas). */
export function cellsOf(linha) {
  const texto = String(linha ?? "").trim()
  if (!texto.startsWith("|")) return []
  return texto.replace(/^\|/, "").replace(/\|$/, "").split("|")
}

/** A linha de tabela DECLARA duração? (uma célula dela afirma o tempo) */
export function rowDeclaresDuration(linha) {
  return cellsOf(linha).some((celula) => DURATION_CELL_RE.test(celula))
}

/** Quantas linhas ACIMA da tabela pertencem ao bloco dela (a apresentação). */
export const BLOCK_LOOKBACK = 12

/**
 * A ÂNCORA DATADA de um texto — as TRÊS formas que o repositório já usa:
 * `dd/mm/aaaa` (`Medido em 17/09/2026`), `mm/aaaa` (os rodapés de medição antiga,
 * `Custo medido em 08/2026`) e `aaaa-mm-dd` (a forma do próprio modelo).
 *
 * A forma de MÊS não inventa o dia: a unidade é marcada como `month` e a origem
 * é o ÚLTIMO commit daquele mês — o mais novo possível —, nunca o primeiro (que
 * envelheceria a declaração por conta própria).
 *
 * @param {string} text
 * @returns {{date: string, kind: "day"|"month"}|null}
 */
export function dateAnchor(text) {
  const completo = /\b(\d{2})\/(\d{2})\/(\d{4})\b/.exec(text)
  if (completo) return { date: `${completo[3]}-${completo[2]}-${completo[1]}`, kind: "day" }
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text)
  if (iso) return { date: `${iso[1]}-${iso[2]}-${iso[3]}`, kind: "day" }
  const mes = /\b(\d{2})\/(\d{4})\b/.exec(text)
  if (mes) return { date: `${mes[2]}-${mes[1]}-01`, kind: "month" }
  return null
}

/**
 * A âncora como ela aparece na PROSA: `dd/mm/aaaa` para uma data, `mm/aaaa` para
 * a forma de mês (a que não declara o dia). O relatório mostra o que está escrito;
 * a normalização ISO é só a forma de comparar.
 */
export function anchorLabel(anchor) {
  if (!anchor) return null
  const [ano, mes, dia] = String(anchor.date).split("-")
  return anchor.kind === "month" ? `${mes}/${ano}` : `${dia}/${mes}/${ano}`
}

/** A expressão de `--before` do git para uma âncora (o fim do dia ou do mês). */
export function anchorBefore(anchor) {
  if (anchor.kind === "day") return `${anchor.date} 23:59:59`
  const [ano, mes] = anchor.date.split("-").map(Number)
  const proximo = mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, "0")}-01`
  return `${proximo} 00:00:00`
}

/**
 * O COMMIT de origem de uma âncora datada: o último commit de `head` que existia
 * quando a data (ou o mês) da âncora terminou.
 *
 * @param {{anchor: {date: string, kind: string}, head?: string, cwd?: string}} alvo
 * @param {{run?: Function}} [deps]
 * @returns {{commit: string|null, reason: string|null}}
 */
export function commitOfDate({ anchor, head = "HEAD", cwd = REPO_ROOT }, { run = spawnSync } = {}) {
  const saida = run("git", ["rev-list", "-1", `--before=${anchorBefore(anchor)}`, head], {
    cwd,
    encoding: "utf8",
  })
  if (saida?.error) {
    return {
      commit: null,
      reason: `git não pôde ser executado (${saida.error.message}) — a data ${anchor.date} não virou commit`,
    }
  }
  const commit = String(saida?.stdout ?? "").trim()
  if (saida?.status !== 0 || commit === "") {
    return {
      commit: null,
      reason: `nenhum commit de ${head} é anterior a ${anchor.date}${anchor.kind === "month" ? " (o fim do mês da âncora)" : ""} — a origem declarada não existe nesta história`,
    }
  }
  return { commit, reason: null }
}

/**
 * As unidades do MODELO de latência: cada `ms` declarado, com a SUA data.
 *
 * O TETO (`ceiling: true`, o `timeout-minutes` da pipeline) fica FORA: o número
 * dele não é uma medição, a origem é o próprio workflow, e o dono já confronta a
 * cópia com o valor vigente (`ceilingAged`). Julgar a idade de um limite seria
 * cobrar frescor de algo que não se mediu.
 *
 * @param {object} model  o `ci/merge-latency.json` já lido
 * @param {{file?: string}} [options]
 * @returns {{units: object[], problems: {id: string, file: string, reason: string}[]}}
 */
export function modelDeclarations(model, { file = MODEL_PATH } = {}) {
  const units = []
  const problems = []
  if (model === null || typeof model !== "object" || Array.isArray(model)) {
    return {
      units,
      problems: [
        {
          id: `modelo:${file}`,
          file,
          reason: `o modelo de latência não é um objeto (${file}) — um arquivo truncado não pode virar "nenhum número velho"`,
        },
      ],
    }
  }

  const coleta = (id, entry, onde) => {
    if (!entry.date) {
      problems.push({
        id,
        file,
        reason: `${onde} declara \`ms\` SEM data própria — a idade não se mede sobre um número que não diz de quando é (o \`meta.date\` do arquivo é a data do ATO, não a da medição)`,
      })
      return
    }
    const anchor = dateAnchor(String(entry.date))
    if (anchor === null) {
      problems.push({
        id,
        file,
        reason: `${onde} declara uma \`date\` que não é uma data (${entry.date})`,
      })
      return
    }
    units.push({
      family: id,
      kind: "declared-number",
      act: entry.provenance ?? "declarado",
      origin: "date",
      source: file,
      date: anchor.date,
      anchorKind: anchor.kind,
      label: onde,
      commit: null,
    })
  }

  for (const [forge, jobs] of Object.entries(model.jobs ?? {})) {
    for (const [nome, entry] of Object.entries(jobs ?? {})) {
      if (entry === null || typeof entry !== "object") continue
      if (Array.isArray(entry.steps)) {
        entry.steps.forEach((passo, i) => {
          if (typeof passo?.ms !== "number") return
          coleta(`${forge}/${nome}#${i + 1}`, passo, `o passo ${i + 1} de ${forge}/${nome}`)
        })
        continue
      }
      if (typeof entry.ms === "number" && entry.ceiling !== true) {
        coleta(`${forge}/${nome}`, entry, `o job ${forge}/${nome}`)
      }
    }
  }
  if (model.overhead && typeof model.overhead === "object" && !Array.isArray(model.overhead)) {
    coleta("overhead", model.overhead, "o overhead por job")
  }
  return { units, problems }
}

/**
 * As unidades do README: cada TABELA que declara duração, com a âncora datada do
 * bloco dela (a tabela + as linhas que a apresentam).
 *
 * A âncora é procurada no bloco INTEIRO, e a tabela sem ela é um PROBLEMA — não
 * uma tabela ignorada: uma tabela de custo sem data de origem é exatamente o que
 * esta régua existe para não deixar viver.
 *
 * @param {string} text  o README
 * @param {{file?: string, lookback?: number}} [options]
 * @returns {{units: object[], problems: {id: string, file: string, reason: string}[]}}
 */
export function readmeDeclarations(text, { file = README_PATH, lookback = BLOCK_LOOKBACK } = {}) {
  const units = []
  const problems = []
  const linhas = String(text ?? "").split("\n")

  let i = 0
  while (i < linhas.length) {
    if (!linhas[i].startsWith("|")) {
      i += 1
      continue
    }
    let fim = i
    while (fim < linhas.length && linhas[fim].startsWith("|")) fim += 1
    const tabela = linhas.slice(i, fim)
    const declaraDuracao = tabela.some((l) => rowDeclaresDuration(l))
    if (declaraDuracao) {
      const inicio = Math.max(0, i - lookback)
      const bloco = linhas.slice(inicio, fim)
      const comData = bloco
        .map((linha, k) => ({ linha, n: inicio + k + 1, anchor: dateAnchor(linha) }))
        .filter((x) => x.anchor !== null)
      const id = `${file}:L${i + 1}`
      if (comData.length === 0) {
        problems.push({
          id,
          file,
          reason: `a tabela em ${file}:${i + 1} declara DURAÇÃO sem âncora datada no bloco (as ${lookback} linhas acima dela) — um custo sem data de origem envelhece sem que ninguém saiba contra o quê`,
        })
      } else {
        const maisRecente = comData[comData.length - 1]
        units.push({
          family: id,
          kind: "declared-table",
          act: "declarado",
          origin: maisRecente.anchor.kind === "month" ? "month" : "date",
          source: file,
          date: maisRecente.anchor.date,
          anchorKind: maisRecente.anchor.kind,
          anchorLine: maisRecente.n,
          label: `a tabela em ${file}:${i + 1}`,
          commit: null,
        })
      }
    }
    i = fim
  }
  return { units, problems }
}

/**
 * AS UNIDADES DAS DECLARAÇÕES — lê os dois arquivos e resolve a origem de cada
 * número pela DATA dele.
 *
 * Fail-closed por fonte: um arquivo ilegível vira uma unidade `unknown` com a
 * causa (nunca a omissão de um conjunto que ninguém viu), e uma declaração sem
 * data própria vira uma unidade `unknown` idem.
 *
 * O TETO de cada unidade sai do TIPO dela (`ceilingOf(kind, tetoDeIdade)`) — e o
 * `tetoDeIdade` é o DERIVADO do ritmo, que o dono do fato (`readFreshness`) mede
 * uma vez e passa: uma segunda derivação aqui divergiria do teto que a frase do
 * fato publica.
 *
 * @param {{cwd?: string, model?: object, readme?: string, head?: string, maxBehind?: number, deps?: object}} [options]
 * @returns {{families: object[]}}
 */
export function declarationFamilies({
  cwd = REPO_ROOT,
  model,
  readme,
  head = "HEAD",
  maxBehind = FRESHNESS_MAX_COMMITS_BEHIND,
  deps = {},
} = {}) {
  const existe = deps.exists ?? existsSync
  const ler = deps.read ?? ((path) => readFileSync(path, "utf8"))
  const run = deps.run ?? spawnSync

  const leituraDoModelo = () => {
    if (model !== undefined) return { model, reason: null }
    const caminho = resolve(cwd, MODEL_PATH)
    if (!existe(caminho))
      return { model: null, reason: `o modelo de latência não existe: ${MODEL_PATH}` }
    try {
      return { model: JSON.parse(ler(caminho)), reason: null }
    } catch (error) {
      return {
        model: null,
        reason: `o modelo de latência é ilegível ou não é JSON válido (${MODEL_PATH}): ${error.message}`,
      }
    }
  }
  const leituraDoReadme = () => {
    if (readme !== undefined) return { text: readme, reason: null }
    const caminho = resolve(cwd, README_PATH)
    if (!existe(caminho)) return { text: null, reason: `o README não existe: ${README_PATH}` }
    try {
      return { text: ler(caminho), reason: null }
    } catch (error) {
      return { text: null, reason: `o README é ilegível (${README_PATH}): ${error.message}` }
    }
  }

  const modelo = leituraDoModelo()
  const prosa = leituraDoReadme()

  // A FONTE QUE NÃO SE LEU e a DECLARAÇÃO SEM ORIGEM são duas coisas: um arquivo
  // ilegível não perde "a data do número" — perdeu o arquivo inteiro, e o `kind`
  // disso (`fonte-ilegivel`) é o mesmo que o do bench ilegível. A distinção existe
  // para o veredito: um é "não consegui ler", o outro é "li e o dono não datou".
  const declaracoes = [
    modelo.reason === null
      ? { ...modelDeclarations(modelo.model), kind: "declaracao-sem-origem" }
      : {
          units: [],
          kind: "fonte-ilegivel",
          problems: [{ id: `modelo:${MODEL_PATH}`, file: MODEL_PATH, reason: modelo.reason }],
        },
    prosa.reason === null
      ? { ...readmeDeclarations(prosa.text), kind: "declaracao-sem-origem" }
      : {
          units: [],
          kind: "fonte-ilegivel",
          problems: [{ id: `readme:${README_PATH}`, file: README_PATH, reason: prosa.reason }],
        },
  ]

  const families = []
  for (const { units, problems, kind } of declaracoes) {
    for (const problema of problems) {
      families.push({
        family: problema.id,
        kind,
        act: null,
        origin: "ausente",
        source: problema.file,
        commit: null,
        date: null,
        ceiling: ceilingOf(kind, maxBehind),
        state: "unknown",
        behind: null,
        reason: problema.reason,
      })
    }
    for (const unidade of units) {
      const teto = ceilingOf(unidade.kind, maxBehind)
      const { commit, reason } = commitOfDate(
        { anchor: { date: unidade.date, kind: unidade.anchorKind }, head, cwd },
        { run },
      )
      const idade = commit
        ? commitAge({ commit, head, cwd }, { run })
        : { state: "unknown", behind: null, reason }
      families.push({
        ...unidade,
        commit,
        commitDate: null,
        ceiling: teto,
        state:
          idade.state === "ancestor"
            ? isAged(idade.behind, unidade.kind, maxBehind)
              ? "aged"
              : "fresh"
            : idade.state,
        behind: idade.behind,
        reason: idade.reason,
      })
    }
  }
  return { families }
}

/**
 * O FATO COMPLETO: as famílias do bench (`kind: bench-family`) + as declarações
 * datadas do modelo e do README, no MESMO julgamento e contra o MESMO teto.
 *
 * A falha de UMA fonte não apaga as outras: o bench ilegível não some — ele vira
 * uma unidade `unknown` nomeando o arquivo, porque "não consegui ler" não pode
 * terminar em "nada a julgar".
 *
 * @param {{cwd?: string, file?: string, head?: string, maxBehind?: number|null, politica?: object, agora?: Date, deps?: object, model?: object|null, readme?: string|null}} [options]
 * @returns {BenchFreshness}
 */
export function readFreshness({
  cwd = REPO_ROOT,
  file = BASELINE_PATH,
  head = "HEAD",
  maxBehind = null,
  politica = POLITICA_DO_TETO,
  agora = new Date(),
  deps = {},
  model = undefined,
  readme = undefined,
} = {}) {
  // O TETO EFETIVO, e a sua PROCEDÊNCIA: derivado do ritmo medido do repositório
  // (o caminho normal) ou declarado pelo CHAMADOR — o doctor com uma dúvida
  // datada e o teste, que precisa de um teto fixo para medir a fronteira. Nos
  // dois casos o número e a origem viajam JUNTOS no fato (`teto`), porque um teto
  // sem procedência é exatamente o que este passo removeu.
  const teto =
    maxBehind === null
      ? tetoDoRitmo(
          medirRitmoDeCommits({ cwd, run: deps.run ?? spawnSync, agora, politica }),
          politica,
        )
      : {
          teto: maxBehind,
          origem: "declarado pelo chamador",
          ciclos: politica.ciclos,
          cicloDias: politica.cicloDias,
          janelaDias: politica.janelaDias,
          pisoDeCiclo: politica.pisoDeCiclo,
          desde: null,
          commits: null,
          commitsPorCiclo: null,
          motivo: null,
        }
  const efetivo = teto.teto
  const bench = readBenchFreshness({ cwd, file, head, maxBehind: efetivo, deps })
  const doBench =
    bench.state === "measured"
      ? bench.families.map((f) => ({ ...f, kind: f.kind ?? "bench-family" }))
      : [
          {
            family: `bench:${bench.file ?? file}`,
            kind: "fonte-ilegivel",
            ceiling: ceilingOf("fonte-ilegivel"),
            act: null,
            origin: "ausente",
            source: bench.file ?? file,
            commit: null,
            date: null,
            state: "unknown",
            behind: null,
            reason: bench.reason,
          },
        ]
  const { families: declaradas } = declarationFamilies({
    cwd,
    model,
    readme,
    head,
    maxBehind: efetivo,
    deps,
  })
  const fato = assembleFact([...doBench, ...declaradas], {
    head,
    maxBehind: efetivo,
    teto,
    emptyReason:
      "nenhuma declaração datada foi lida (bench, modelo de latência e README) — não há número para envelhecer",
  })
  return { ...fato, file: bench.file ?? file, benchHead: bench.head ?? head }
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
      "\n  Mede a IDADE de cada declaração datada: o commit de origem de cada família\n" +
        "  MEDIDA do bench, a data própria de cada número declarado do modelo de\n" +
        "  latência (ci/merge-latency.json) e a âncora datada de cada tabela de custo\n" +
        "  do README — quantos commits de HEAD cada uma deixou para trás.\n" +
        `  O teto é DERIVADO do ritmo do repositório: ${POLITICA_DO_TETO.ciclos} ciclos de ` +
        `${POLITICA_DO_TETO.cicloDias}d × os commits por ciclo medidos na janela de ` +
        `${POLITICA_DO_TETO.janelaDias} dias (piso: ${POLITICA_DO_TETO.pisoDeCiclo}/ciclo), e o ` +
        `  relatório diz de onde o número veio; sem ritmo medido ele cai na reserva de\n` +
        `  ${FRESHNESS_MAX_COMMITS_BEHIND} commits e o motivo sai dito.\n\n` +
        "  --file: mede OUTRO arquivo do bench (default: docs/benchmarks/guard-timing-baseline.json).\n" +
        "  --head: mede contra outra ref (default: HEAD).",
    )
    return 0
  }

  const fact = readFreshness({ file: options.file, head: options.head })
  if (options.json) {
    console.log(JSON.stringify(fact, null, 2))
  } else {
    console.log(`📏 Régua do bench — ${freshnessLine(fact)}`)
    console.log(`📐 Teto de idade: ${tetoLine(fact)}`)
    for (const f of fact.families) {
      const marca = f.state === "fresh" ? "✅" : f.state === "aged" ? "❌" : "⚠️"
      const idade = f.behind === null ? f.state : `${f.behind} commit(s) atrás`
      // A ORIGEM de cada unidade, dita: um COMMIT (família do bench) ou a DATA
      // que se resolveu nele (número declarado do modelo, tabela do README).
      const origem =
        f.commit === null
          ? "?"
          : `${f.commit.slice(0, 12)}${
              f.date
                ? ` (âncora ${anchorLabel({ date: f.date, kind: f.anchorKind })})`
                : f.commitDate
                  ? ` (${f.commitDate})`
                  : ""
            }`
      console.log(
        `   ${marca} ${f.family}: ${idade} — origem ${origem}` +
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
