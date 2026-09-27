#!/usr/bin/env node

// =============================================================================
// merge-latency.mjs — o CUSTO dos gates em LATENCIA DE MERGE
//
// O problema que isto resolve: a tabela de overhead do repositório lista o custo
// de cada gate e convida a SOMAR — mas a soma não é o que o PR espera. Um PR não
// paga 39s (master de mutação) + 4min (lint) + 2min (typecheck) + ... : ele paga
// o CAMINHO CRÍTICO, e com poucos runners pagos o que sobra é a FILA. Duas contas
// diferentes, e a segunda é a que decide se alguém espera 3 minutos ou 12.
//
// O que este script modela, por forja:
//   1. o GRAFO dos jobs (`needs:`) da pipeline real — lido do arquivo, não escrito
//      aqui (uma cópia do grafo envelheceria em silêncio: renomear um job ou
//      acrescentar um `needs:` mudaria a latência sem nada ficar vermelho);
//   2. a DURAÇÃO de cada job, com PROCEDÊNCIA declarada (`ci/merge-latency.json`:
//      ms + fonte + data) e, quando o benchmark cobre o mesmo instrumento, a
//      CONFRONTAÇÃO entre o declarado e o derivado — um número declarado que
//      envelheceu aparece como divergência, em vez de virar verdade por decurso;
//   2b. e, num job que declara os seus PASSOS em vez de um total (`steps`), a
//      COMPOSIÇÃO: cada passo mede aqui (fonte + data) ou se LIGA a uma forma
//      versionada do benchmark (`from: { family, form }`), e o total é a soma.
//      Um passo que repete à mão o número que a baseline já publica cria DOIS
//      números do mesmo passo — foi assim que o passo do job do count declarava
//      3870ms contra 3897ms da forma `mutation-count` da baseline, 27ms de
//      diferença de CONTEXTO que ninguém veria. Ligado à forma, o número do passo
//      não vive aqui: a suíte mudar de custo move o modelo junto. E a cobertura é
//      EXATA — todo `run:` contado, todo passo declarado existente —, porque um
//      passo novo passaria a custar ZERO na conta do PR;
//   3. a LATÊNCIA: com N runners, o PR espera o MAKESPAN (a fila incluída), não a
//      cadeia mais longa. Com 1 runner o makespan degenera na SOMA; com runners
//      suficientes, no caminho crítico. Os dois extremos são reportados, porque é
//      a diferença entre eles que hoje se confunde.
//
// FAIL-CLOSED, como o resto do repositório: um job que roda no PR e não tem
// duração (nem declarada, nem derivada) deixa o veredito INDETERMINADO e é
// NOMEADO. Nunca zero: um gate que não foi medido não é um gate instantâneo.
//
// O `if:` de um job que não se consegue classificar (roda no PR? não roda?)
// também indetermina o veredito: incluir um job que não roda infla a latência, e
// excluir um que roda a esconde — nenhuma das duas é uma medida. E o `if:` que
// este arquivo lê é o do JOB (chave filha direta, o nível de `runs-on:`), não o
// de um PASSO: ler o de dentro de `steps:` fazia um job incondicional parecer
// condicional — e o veredito ficava indeterminado por causa de um passo.
//
// A ÚLTIMA PORTA antes de "não sei" é o TETO que a PRÓPRIA pipeline declara:
// `timeout-minutes` do job. Um job cujo custo é dominado por um passo que não
// se mede fora do runner (baixar/rodar `act`, serviço de PostGIS) entra pelo
// teto — um LIMITE SUPERIOR, nomeado como tal — em vez de faltar. O que a porta
// NÃO cobre: job sem duração E sem teto. Esse continua indeterminando o
// veredito, que é o ponto (um gate que não foi medido não é instantâneo).
//
// O MODO `--check` é o que torna isto MECANICO: ele julga SÓ o dono do merge e
// fecha a conta — se um job novo entra na pipeline do PR sem duração declarada
// (nem derivável do benchmark), o comando sai 2 e o PR fica vermelho. Sem ele,
// a latência publicada ENCOLHERIA em silêncio a cada job que ninguém mediu, que
// é exatamente o defeito que a soma de gates independentes já escondia.
//
// Usage:
//   node scripts/merge-latency.mjs [opções]
//
// Opções:
//   --forge <gitea|github>  mede só uma forja (default: as duas)
//   --runners <N>           sobrepõe o nº de runners concorrentes do modelo
//   --check                 só o veredito do DONO DO MERGE (o gate do PR)
//   --root <dir>            mede OUTRO checkout (fixture; default: a raiz do repo)
//   --json                  saída estruturada (para consumo por outro script)
//   -h, --help              esta ajuda
//
// Exit codes:
//   0 — PRONTA: todos os jobs que rodam no PR têm duração e classificação
//   1 — erro de uso (flag/valor inválido, modelo ilegível)
//   2 — INDETERMINADA: falta duração ou classificação de algum job do PR
// =============================================================================

import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { jobsLayout, jobKeyName, yamlChildKey } from "./forge-workflows.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, "..")

/** O modelo: durações por job (com procedência), runners concorrentes e metadata. */
export const MODEL_PATH = "ci/merge-latency.json"
/** O benchmark versionado: a SEGUNDA fonte, usada para confrontar o declarado. */
export const BENCH_PATH = "docs/benchmarks/guard-timing-latest.json"

/**
 * As forjas e a pipeline que cada uma roda no PR. A ordem é a do relatório; a
 * `role` é a mesma linguagem do `check-forge-parity` (dona do merge × espelho).
 */
export const FORGES = [
  { id: "gitea", file: ".gitea/workflows/ci.yml", role: "dona do merge" },
  { id: "github", file: ".github/workflows/pr-check.yml", role: "espelho" },
]

/** Margem a partir da qual declarado × derivado deixa de ser ruído de medição. */
export const DIVERGENCE_TOLERANCE = 0.25

export const STATE = {
  READY: "ready",
  UNKNOWN: "indeterminate",
}

/**
 * O papel de quem DECIDE o merge. A latência do espelho pode ser parcial — o
 * GitHub declara o que ainda não mediu, e isso é um fato, não uma promessa. A
 * do dono do merge NÃO: se ela não cobre todos os jobs do PR, o número que o
 * repositório publica está medindo menos pipeline do que existe, e o
 * denominador encolhe em silêncio a cada job novo.
 */
export const MERGE_OWNER_ROLE = "dona do merge"

/**
 * A duração RESOLVIDA de um job, com a procedência que a torna revisável.
 *
 * @typedef {object} Duration
 * @property {number|null} ms  `null` = NÃO MEDIDO (nunca zero)
 * @property {string} [provenance]  "declarado" ou "derivado (benchmark)"
 * @property {string} [source]  a fonte escrita do número declarado
 * @property {boolean} [diverges]  declarado × derivado além da tolerância
 * @property {boolean} [ceiling]  o número é um TETO (`timeout-minutes` do job), não uma medição
 * @property {number} [timeoutMinutes]  o `timeout-minutes` de onde o teto saiu
 * @property {{declaredMs: number, pipelineMs: number}} [ceilingAged]  o teto declarado divergiu do `timeout-minutes` da pipeline
 * @property {number} [derivedMs]  a soma dos passos que o benchmark conhece
 * @property {boolean} [derivedIsFloor]  o derivado é PISO (tem passo fora do benchmark)
 * @property {number} [derivedUnmatched]  quantos passos ficaram fora
 * @property {number} [factor]  derivado / declarado
 * @property {{run: string, ms: number, derived: boolean, label: string|null, commit: string|null, source: string|null, date?: string|null}[]} [steps]  os passos do job composto (o derivado LÊ o benchmark)
 * @property {string[]} [stepProblems]  por que os passos NÃO fecham (o job fica sem duração)
 */

/**
 * O relatório de UMA forja.
 *
 * @typedef {object} ForgeReport
 * @property {string} forge
 * @property {string} file
 * @property {string} role
 * @property {number} runners  quantos jobs rodam JUNTOS (a fila)
 * @property {string} runnersSource
 * @property {({name: string, needs: string[], whyOnPr: string} & Duration)[]} jobs  os que rodam no PR
 * @property {{name: string, why: string}[]} skippedOnPr  fora do PR, NOMEADOS
 * @property {{name: string, why: string}[]} unclassified  `if:` que não se entende
 * @property {string[]} missing  jobs do PR sem duração — o que indetermina
 * @property {{name: string, declaredMs: number, derivedMs: number, derivedIsFloor: boolean, derivedUnmatched: number, factor: number}[]} divergences
 * @property {{name: string, ms: number, timeoutMinutes: number}[]} ceilings  jobs que entraram pelo TETO da pipeline (limite, não medição)
 * @property {number} sumOfGatesMs
 * @property {number} sumWithoutCeilingsMs  a soma SEM os jobs que entraram por TETO
 * @property {boolean} sumComplete
 * @property {number|null} criticalPathMs
 * @property {string[]|null} criticalPath
 * @property {number|null} latencyMs  o MAKESPAN: o que o PR espera
 * @property {number|null} serialMs  o pior caso (1 runner)
 * @property {number|null} parallelismSavingMs
 * @property {string} state
 * @property {string[]} unknowns
 */

/**
 * O relatório inteiro: uma seção por forja + o veredito do dono do merge.
 *
 * @typedef {object} Report
 * @property {string} modelPath
 * @property {string} benchPath
 * @property {string|null} benchCommit
 * @property {ForgeReport[]} sections
 * @property {{forge: string, state: string, latencyMs: number|null, missing: string[], unclassified: string[]}|null} mergeOwner
 * @property {string} state
 */

// ── leitura do YAML (mesma leitura de jobs do resto do repositório) ─────────

/**
 * A linha de uma CHAVE filha direta de um job — o mesmo nível de `runs-on:` e
 * `steps:`. Delega ao `yamlChildKey` (`forge-workflows.mjs`), que MEDE a
 * indentação em vez de presumir 2 e ignora o que vive mais fundo: é por isso que
 * um `if:` de PASSO (dentro de `steps:`) não é confundido com o do job.
 *
 * @param {string[]} lines
 * @param {number} headerIdx
 * @param {number} jobIndent
 * @param {string} key
 * @returns {string|null}
 */
function jobChildLine(lines, headerIdx, jobIndent, key) {
  const idx = yamlChildKey(lines, headerIdx, jobIndent, key)
  return idx === null ? null : lines[idx].trim()
}

/**
 * O `timeout-minutes` do job, se ele declarar um — o TETO declarado pela própria
 * pipeline, lido (não copiado aqui).
 *
 * @param {string[]} lines
 * @param {number} headerIdx
 * @param {number} jobIndent
 * @returns {number|null}
 */
function jobTimeoutMinutes(lines, headerIdx, jobIndent) {
  const raw = jobChildLine(lines, headerIdx, jobIndent, "timeout-minutes")
  if (raw === null) return null
  const m = /^timeout-minutes:\s*(\d+)\s*(?:#.*)?$/.exec(raw)
  return m ? Number(m[1]) : null
}

/**
 * Os jobs de uma pipeline: nome, `needs`, a linha do `if:` DO JOB (se houver), o
 * `timeout-minutes` declarado e os comandos `run:` de cada passo.
 *
 * A leitura é deliberadamente rasa (indentação + chaves), como a do
 * `forge-workflows.mjs`: não é um parser de YAML, é o suficiente para responder
 * "quem depende de quem" e "o que este job executa" — e a mesma leitura que os
 * outros guards usam, para não existir uma segunda régua de YAML no repositório.
 *
 * @param {string} content
 * @returns {{name: string, needs: string[], ifLine: string|null, timeoutMinutes: number|null, runLines: string[]}[]}
 */
export function parseJobs(content) {
  const lines = content.split(/\r?\n/)
  const { jobsIdx, jobIndent } = jobsLayout(lines)
  if (jobIndent === null || jobsIdx === -1) return []

  const jobs = []
  let current = null
  // A varredura começa no `jobs:` — sem isso os gatilhos de `on:` (`push:`,
  // `pull_request:`, `merge_group:`) estão no MESMO nível de indentação dos jobs
  // e entrariam como jobs que ninguém mediu.
  for (let i = jobsIdx + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === "" || line.trim().startsWith("#")) continue
    const indent = line.match(/^[ \t]*/)[0].length
    if (indent < jobIndent) continue

    if (indent === jobIndent) {
      const name = jobKeyName(line, jobIndent)
      if (name) {
        current = {
          name,
          needs: [],
          // O `if:` do JOB — chave filha DIRETA. Um `if:` de passo vive dentro
          // de `steps:`, mais fundo: lê-lo aqui fazia o job parecer condicional
          // por causa de um passo e indeterminava o veredito à toa.
          ifLine: jobChildLine(lines, i, jobIndent, "if"),
          timeoutMinutes: jobTimeoutMinutes(lines, i, jobIndent),
          runLines: [],
        }
        jobs.push(current)
        continue
      }
    }
    if (!current) continue

    const trimmed = line.trim()
    // `needs:` inline (`[a, b]`) ou em bloco (linhas seguintes com `- x`).
    const inlineNeeds = /^needs:\s*\[(.*)\]\s*$/.exec(trimmed)
    if (inlineNeeds) {
      current.needs = inlineNeeds[1]
        .split(",")
        .map((n) => n.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean)
      continue
    }
    if (/^needs:\s*$/.test(trimmed)) {
      for (let k = i + 1; k < lines.length; k++) {
        const child = lines[k]
        if (child.trim() === "" || child.trim().startsWith("#")) continue
        const childIndent = child.match(/^[ \t]*/)[0].length
        if (childIndent <= indent) break
        const item = /^-\s*([^\s#]+)/.exec(child.trim())
        if (item) current.needs.push(item[1].replace(/^["']|["']$/g, ""))
        else if (!child.trim().startsWith("-")) break
      }
      continue
    }
    const run = /^(?:-\s*)?run:\s*(.+)$/.exec(trimmed)
    if (run && !trimmed.startsWith("#")) current.runLines.push(run[1].trim())
  }
  return jobs
}

/**
 * O job roda num PR? `true`/`false` quando dá para decidir pelo `if:` (ou pelo
 * override declarado), `null` quando NÃO dá — e `null` indetermina o veredito.
 *
 * As condições reconhecidas são as que o repositório realmente usa, e são
 * reconhecidas pelo que ELAS dizem, não por uma lista de jobs:
 *   · `always()`                          → roda (é o "sempre" explícito);
 *   · push para `main`/outra branch       → NÃO roda em PR (o evento não é PR);
 *   · `workflow_dispatch`                 → NÃO roda em PR (é disparo manual).
 * Qualquer outra coisa é `null`: preferimos não saber a saber errado.
 *
 * @param {{ifLine: string|null}} job
 * @param {boolean|null} override  decisão escrita no modelo (vence a inferência)
 * @returns {{onPr: boolean|null, why: string}}
 */
export function classifyOnPr(job, override = null) {
  if (override === true) return { onPr: true, why: "declarado no modelo (skippedOnPr: false)" }
  if (override === false) return { onPr: false, why: "declarado no modelo (skippedOnPr: true)" }
  if (!job.ifLine) return { onPr: true, why: "sem `if:` — roda em todo evento da pipeline" }
  const cond = job.ifLine
    .replace(/^if:\s*/, "")
    .replace(/#.*$/, "")
    .trim()
  if (/always\(\)/.test(cond)) return { onPr: true, why: "`always()` — roda sempre" }
  if (/github\.event_name\s*==\s*['"]workflow_dispatch['"]/.test(cond)) {
    return { onPr: false, why: "só em `workflow_dispatch` (disparo manual)" }
  }
  if (/refs\/heads\//.test(cond) && !/pull_request/.test(cond)) {
    return { onPr: false, why: "condicionado a ref de push (não é evento de PR)" }
  }
  return { onPr: null, why: `\`if:\` não classificado: \`${cond}\`` }
}

// ── duração: declarada (com procedência) e derivada (do benchmark) ──────────

/**
 * A chave do INSTRUMENTO de um comando — para que `bun run check:registry-source`
 * e `node scripts/check-registry-source.mjs` sejam o MESMO gate com duas formas de
 * invocação (que é o caso neste repositório: o benchmark invoca pela entry do
 * package.json, as pipelines chamam o script direto). Sem a normalização, o
 * confronto declarado × derivado acusaria divergência em todo job — e um alarme
 * que sempre toca não é alarme.
 *
 * @param {string} cmd
 * @returns {string}
 */
export function instrumentKey(cmd) {
  const s = String(cmd ?? "").trim()
  const script = /scripts\/([\w.-]+\.(?:mjs|sh|ts|py))/.exec(s)
  if (script) return script[1].replace(/\.(mjs|sh|ts|py)$/, "")
  const entry = /\bbun\s+run\s+([\w:.-]+)/.exec(s)
  if (entry) {
    const e = entry[1]
    const [ns, ...rest] = e.split(":")
    if (rest.length === 0) return e
    const tail = rest[0]
    if (ns === "check" || ns === "validate" || ns === "audit") return `${ns}-${tail}`
    if (ns === "test" || ns.startsWith("test-mutation")) return `test-mutation-${tail}`
    return e
  }
  return s
}

/**
 * Índice do benchmark: instrumento → ms.
 *
 * O índice é por INSTRUMENTO (não por string de comando) para que a confrontação
 * funcione onde as invocações diferem de forma: o gate é o mesmo, e é ele que tem
 * uma duração.
 *
 * @param {object|null} bench
 * @returns {{byCmd: Map<string, number>, byScript: Map<string, number>, byForm: Map<string, object>, familyCommit: (family: string) => string|null, benchCommit: string|null}}
 */
export function benchIndex(bench) {
  const byCmd = new Map()
  const byScript = new Map()
  const byForm = new Map()
  const familias = bench?.meta?.families ?? {}
  // A PROCEDÊNCIA do número derivado: o commit que a FAMÍLIA descreve quando a
  // tabela `meta.families` existe (a mesma régua de origem que o resto do
  // repositório lê), e o commit do ARQUIVO quando ela não existe. Um passo ligado
  // ao benchmark sem o commit ao lado seria um número sem data — e é a data que
  // diz se ele descreve a árvore de agora.
  const familyCommit = (family) =>
    (typeof familias?.[family]?.commit === "string" ? familias[family].commit : null) ??
    // A âncora do registro é o PORTADOR (v7), resolvido pela história; o que o
    // modelo publica aqui é a PROCEDÊNCIA — o topo sobre o qual o ato rodou.
    (typeof bench?.meta?.parentCommit === "string"
      ? bench.meta.parentCommit
      : typeof bench?.meta?.commit === "string"
        ? bench.meta.commit
        : null)
  const add = (cmd, ms) => {
    if (typeof cmd !== "string" || typeof ms !== "number" || !Number.isFinite(ms)) return
    byCmd.set(instrumentKey(cmd), ms)
    const script = /scripts\/([\w.-]+\.mjs)/.exec(cmd)
    if (script) byScript.set(script[1], ms)
  }
  if (!bench) return { byCmd, byScript, byForm, familyCommit, benchCommit: null }
  for (const g of bench.guards ?? []) add(g.cmd, g.ms)
  if (bench.doctor) add(bench.doctor.cmd, bench.doctor.ms)
  for (const form of bench.lint?.forms ?? []) {
    if (form.role === "current") add(form.cmd, form.ms)
  }
  for (const ruler of Object.values(bench.rulers ?? {})) {
    for (const form of ruler.forms ?? []) {
      if (form.role === "current") add(form.cmd, form.ms)
    }
  }
  // O MASTER de mutação (o job mais caro do PR): o custo do passo vem da MEDIÇÃO
  // por sub-test que o próprio master reporta em `--json` (a família `mutations`
  // do benchmark, versionada na baseline sub-test a sub-test). O declarado
  // continua mandando e o derivado o confronta — mas a partir daqui o confronto é
  // uma MEDIÇÃO, e um sub-test novo move o derivado sem ninguém recontar a soma à
  // mão. O `cmd` gravado é o comando MEDIDO (com `--json`, que é o modo que dá o
  // dado); o `instrumentKey` casa com o passo do job, que roda o mesmo script.
  if (bench.mutations?.measured && Number.isFinite(bench.mutations?.deltas?.totalMs)) {
    add(bench.mutations.cmd, bench.mutations.deltas.totalMs)
  }
  // As FORMAS do master, uma a uma: cada sub-test é a MEDIÇÃO de UMA suíte, e é a
  // ela que um passo do modelo pode se LIGAR (`from: { family: "mutations",
  // form }`) em vez de repetir o número medido à parte. Dois números do mesmo
  // passo divergiriam sem ninguém ver — e foi assim que o passo do job do count
  // ficou 3870ms aqui contra 3897ms na baseline: CONTEXTOS diferentes, nenhum
  // deles derivado do outro. O `ms` da forma é o que a baseline PUBLICA (o
  // primeiro `runs[0]` fica de reserva para um arquivo que só traga execuções).
  for (const form of bench.mutations?.forms ?? []) {
    const key = form?.role ?? form?.label
    const ms = Number.isFinite(form?.ms) ? form.ms : (form?.runs?.[0]?.ms ?? null)
    if (typeof key !== "string" || !Number.isFinite(ms)) continue
    byForm.set(`mutations/${key}`, {
      family: "mutations",
      form: key,
      ms,
      exit: form.exit ?? null,
      ok: form.ok ?? null,
      runs: Array.isArray(form.runs) ? form.runs.length : 0,
    })
  }
  return {
    byCmd,
    byScript,
    byForm,
    familyCommit,
    benchCommit:
      typeof bench?.meta?.parentCommit === "string"
        ? bench.meta.parentCommit
        : typeof bench?.meta?.commit === "string"
          ? bench.meta.commit
          : null,
  }
}

/**
 * A duração derivada de um job: a soma do que o benchmark conhece dos seus passos.
 *
 * @param {{name: string, runLines: string[]}} job
 * @param {{byCmd: Map<string, number>, byScript: Map<string, number>}} index
 * @param {{overheadMs?: number}} [options]
 * @returns {{ms: number|null, matched: string[], unmatched: string[]}}
 */
export function deriveMs(job, index, { overheadMs = 0 } = {}) {
  let total = 0
  const matched = []
  const unmatched = []
  for (const line of job.runLines) {
    const cmd = line.replace(/["']?\$\{\{[^}]*\}\}["']?/g, "").trim()
    const script = /scripts\/([\w.-]+\.mjs)/.exec(cmd)
    const ms =
      index.byCmd.get(instrumentKey(cmd)) ?? (script ? index.byScript.get(script[1]) : undefined)
    if (typeof ms === "number") {
      total += ms
      matched.push(cmd)
    } else {
      unmatched.push(cmd)
    }
  }
  if (matched.length === 0) return { ms: null, matched, unmatched }
  return { ms: total + overheadMs, matched, unmatched }
}

/**
 * As FAMÍLIAS do benchmark que um passo do modelo pode referenciar (`from:`), e
 * como cada uma se resolve.
 *
 * Uma família FORA desta tabela é recusada com o motivo — nunca tratada como
 * "sem derivação": um nome escrito errado cairia como um passo declarado sem
 * `ms`, e o defeito apareceria como um passo de custo desconhecido em vez de um
 * `family` que ninguém leu.
 */
const FROM_FAMILIES = {
  mutations: (spec, index) => {
    const key = spec?.form ?? spec?.role ?? spec?.label
    if (typeof key !== "string") {
      return { error: "a família `mutations` exige `form` (o role da sub-test do master)" }
    }
    const hit = index.byForm?.get(`mutations/${key}`)
    if (!hit) return { error: `a forma \`${key}\` não está no benchmark versionado` }
    return {
      ms: hit.ms,
      commit: index.familyCommit("mutations"),
      label: `mutations/${key}`,
      source: `forma \`${key}\` da família \`mutations\` (a sub-test do master) em ${BENCH_PATH}`,
    }
  },
  guards: (spec, index) => {
    const key = instrumentKey(spec?.cmd ?? spec?.run ?? "")
    const ms = index.byCmd?.get(key)
    if (typeof ms !== "number") {
      return { error: `o guard \`${key}\` não está na família \`guards\` do benchmark` }
    }
    return {
      ms,
      commit: index.familyCommit("guards"),
      label: `guards/${key}`,
      source: `guard \`${key}\` em ${BENCH_PATH}`,
    }
  },
}

/**
 * Uma referência `from:` resolvida contra o índice do benchmark.
 *
 * A forma do retorno é ÚNICA (com `null` no que não se aplica) para o consumidor
 * não ter de adivinhar qual dos dois lados veio.
 *
 * @param {{family?: string, form?: string, cmd?: string}} spec
 * @param {object} index
 * @returns {{ms: number|null, commit: string|null, label: string|null, source: string|null, error: string|null}}
 */
export function resolveFrom(spec, index) {
  const family = spec?.family
  const resolver = typeof family === "string" ? FROM_FAMILIES[family] : null
  const res = resolver
    ? resolver(spec, index)
    : {
        error: `a família \`${family ?? "?"}\` não é resolvível pelo benchmark (declaradas: ${Object.keys(FROM_FAMILIES).join(", ")})`,
      }
  return {
    ms: res.ms ?? null,
    commit: res.commit ?? null,
    label: res.label ?? null,
    source: res.source ?? null,
    error: res.error ?? null,
  }
}

/**
 * O custo de um job DECLARADO POR PASSOS: um passo ou tem `ms` (medido aqui, com
 * fonte e data) ou tem `from` (o número é LIDO do benchmark versionado).
 *
 * POR QUE ISTO EXISTE — o defeito medido: um passo que repete à mão o número que
 * o benchmark já versiona cria DOIS números do mesmo passo. O do job do count
 * declarava 3870ms enquanto a forma `mutation-count` da baseline publicava
 * 3897ms — 27ms de diferença de CONTEXTO que ninguém veria até alguém comparar os
 * dois arquivos. Ligado à forma, o passo deixa de ter número próprio: se a suíte
 * mudar de custo (como as metades K/L/M a levaram de 447ms a 3897ms), o modelo
 * move junto, e divergir passa a exigir editar o arquivo errado.
 *
 * E o que NÃO pode acontecer é silêncio: a cobertura é EXATA. Todo `run:` da
 * pipeline tem de estar contado por UM passo declarado, e todo passo declarado
 * tem de existir na pipeline — um passo novo custaria ZERO na conta do PR, que é
 * o mesmo defeito do denominador que encolhe. Sem cobertura exata não há número:
 * `ms` sai `null` e a causa viaja nomeada.
 *
 * @param {{name: string, runLines: string[]}} job
 * @param {{steps: object[], ms?: number}} entry
 * @param {object} index
 * @returns {{ms: number|null, parts: object[], problems: string[]}}
 */
export function resolveSteps(job, entry, index) {
  const lines = job.runLines.map((l) => l.replace(/["']?\$\{\{[^}]*\}\}["']?/g, "").trim())
  const problems = []
  const parts = []
  const usados = new Set()
  const acha = (run) =>
    lines.findIndex(
      (l, i) => !usados.has(i) && (l === run || instrumentKey(l) === instrumentKey(run)),
    )

  for (const step of entry.steps) {
    const run = String(step?.run ?? "").trim()
    const idx = acha(run)
    if (idx === -1) {
      problems.push(`o passo declarado \`${run}\` não existe (mais) na pipeline`)
      continue
    }
    usados.add(idx)
    if (step.from !== undefined) {
      const res = resolveFrom(step.from, index)
      if (res.error) {
        problems.push(`o passo \`${run}\` deriva do benchmark e não resolveu: ${res.error}`)
        continue
      }
      parts.push({
        run,
        ms: res.ms,
        derived: true,
        label: res.label,
        commit: res.commit,
        source: res.source,
      })
      continue
    }
    if (Number.isFinite(step.ms)) {
      // A DATA É DO PRÓPRIO NÚMERO: sem ela a idade da declaração não se mede, e
      // a régua da idade (`bench-freshness.mjs`, que julga este passo como
      // `declared-number`) a lê daqui — o `meta.date` do arquivo é a data do ATO.
      if (!step.date) {
        problems.push(
          `o passo \`${run}\` declara \`ms\` SEM data própria — a idade da declaração não se mede (o \`meta.date\` do arquivo é a data do ATO, não a da medição)`,
        )
        continue
      }
      parts.push({
        run,
        ms: step.ms,
        derived: false,
        label: null,
        commit: null,
        source: step.source ?? null,
        date: step.date ?? null,
      })
      continue
    }
    problems.push(`o passo \`${run}\` não declara \`ms\` nem \`from\``)
  }

  for (let i = 0; i < lines.length; i++) {
    if (!usados.has(i)) {
      problems.push(
        `o passo \`${lines[i]}\` da pipeline NÃO está declarado no modelo — ele custaria zero na conta do PR`,
      )
    }
  }

  return {
    ms: problems.length === 0 ? parts.reduce((acc, p) => acc + p.ms, 0) : null,
    parts,
    problems,
  }
}

/**
 * Resolve a duração e a PROCEDÊNCIA de cada job de uma forja.
 *
 * Precedência: o declarado manda (é ele que carrega a fonte e a data), e o
 * derivado serve de CONFRONTAÇÃO. Quando os dois existem e discordam além da
 * tolerância, a divergência é NOMEADA — um número declarado que envelheceu vira
 * um fato visível, não uma verdade por decurso.
 *
 * A TERCEIRA forma é o job declarado por PASSOS (`steps`): aí o número não é
 * confrontado com o benchmark, ele é COMPOSTO dele — cada passo mede aqui (com
 * fonte e data) ou se liga a uma forma versionada. É o caminho para o passo cujo
 * número já vive na baseline: repeti-lo à mão seria a segunda fonte do mesmo
 * passo, e duas fontes do mesmo número divergem sem ninguém ver.
 *
 * @param {{name: string, runLines: string[]}[]} jobs
 * @param {object} model
 * @param {string} forge
 * @param {object} index
 * @returns {{byJob: Map<string, Duration>, missing: string[]}}
 */
export function resolveDurations(jobs, model, forge, index) {
  const declared = model?.jobs?.[forge] ?? {}
  const overheadMs = model?.overhead?.perJobMs ?? 0
  const byJob = new Map()
  const missing = []

  for (const job of jobs) {
    const entry = declared[job.name] ?? null
    const derived = deriveMs(job, index, { overheadMs })

    // O job DECLARADO POR PASSOS: o total é a soma dos passos, e o passo que já
    // tem número no benchmark versionado LÊ de lá (nunca o repete aqui). O `ms`
    // do entry é recusado junto: dois totais do mesmo job teriam de concordar, e
    // o que não se pode escolher não se declara.
    if (entry && Array.isArray(entry.steps)) {
      const res = resolveSteps(job, entry, index)
      const problemas = [
        ...res.problems,
        ...(typeof entry.ms === "number"
          ? [
              `o job declara \`ms\` E \`steps\`: o total deixaria de ser a soma dos passos (o \`ms\` viraria a segunda fonte do mesmo número)`,
            ]
          : []),
      ]
      const derivados = res.parts.filter((p) => p.derived)
      const commits = [...new Set(derivados.map((p) => p.commit).filter(Boolean))]
      const derivadoMs = derivados.reduce((acc, p) => acc + p.ms, 0)
      byJob.set(job.name, {
        ms: problemas.length === 0 ? res.ms : null,
        provenance: "declarado + derivado (benchmark)",
        source:
          [
            entry.source ?? null,
            derivados.length
              ? `${derivados.length} passo(s) LIGADO(s) ao benchmark versionado (${derivados.map((p) => p.label).join(", ")})${commits.length ? ` @ ${commits.join(", ")}` : ""} — o número do passo é LIDO do arquivo, não repetido aqui`
              : null,
          ]
            .filter(Boolean)
            .join(" · ") || null,
        date: entry.date ?? null,
        derivedMs: derivados.length ? derivadoMs : null,
        derivedUnmatched: problemas.length,
        diverges: false,
        steps: res.parts,
        stepProblems: problemas,
      })
      if (problemas.length > 0) missing.push(job.name)
      continue
    }

    // O teto (`ceiling`) fica FORA da regra: o número dele não é uma medição (é o
    // `timeout-minutes` da pipeline), e o dono já o confronta com a pipeline.
    if (entry && typeof entry.ms === "number" && entry.ceiling !== true && !entry.date) {
      // Um número declarado SEM a própria data: a régua da idade
      // (`bench-freshness.mjs`) não tem de onde medir a idade dele, e herdar o
      // `meta.date` do arquivo seria datar o número por decurso — o veredito
      // fica INDETERMINADO com a causa nomeada, como qualquer passo que não fecha.
      byJob.set(job.name, {
        ms: null,
        provenance: entry.provenance ?? null,
        source: entry.source ?? null,
        date: null,
        derivedMs: derived.ms,
        derivedUnmatched: derived.unmatched.length,
        diverges: false,
        stepProblems: [
          `o job declara \`ms\` SEM data própria — a idade da declaração não se mede (a régua declara o número como \`declared-number\` e lê a data DELE; o \`meta.date\` do arquivo é a data do ATO)`,
        ],
      })
      missing.push(job.name)
      continue
    }

    if (entry && typeof entry.ms === "number") {
      const diverges =
        typeof derived.ms === "number" &&
        Math.abs(derived.ms - entry.ms) / Math.max(derived.ms, entry.ms) > DIVERGENCE_TOLERANCE
      // Um TETO declarado é CONFRONTADO com o `timeout-minutes` da própria
      // pipeline: uma cópia que envelheceu (o job mudou o orçamento e o modelo
      // não) vira fato visível, como a divergência do derivado — nunca verdade
      // por decurso.
      const ceiling = entry.ceiling === true
      const pipelineTimeout =
        typeof job.timeoutMinutes === "number" ? job.timeoutMinutes * 60_000 : null
      byJob.set(job.name, {
        ms: entry.ms,
        provenance: entry.provenance ?? "declared",
        source: entry.source ?? null,
        date: entry.date ?? null,
        derivedMs: derived.ms,
        derivedUnmatched: derived.unmatched.length,
        diverges,
        ...(ceiling ? { ceiling: true, timeoutMinutes: job.timeoutMinutes } : {}),
        ...(ceiling && pipelineTimeout !== null && pipelineTimeout !== entry.ms
          ? { ceilingAged: { declaredMs: entry.ms, pipelineMs: pipelineTimeout } }
          : {}),
      })
      continue
    }
    if (typeof derived.ms === "number") {
      byJob.set(job.name, {
        ms: derived.ms,
        provenance: "derivado (benchmark)",
        source: `${BENCH_PATH} (${derived.matched.length} passo(s) conhecidos)`,
        date: model?.meta?.date ?? null,
        derivedMs: derived.ms,
        derivedUnmatched: derived.unmatched.length,
        diverges: false,
      })
      continue
    }
    // Última porta antes de "não sei": o TETO que a própria pipeline declara no
    // job. Ela existe porque há custo que não se mede fora do runner (baixar e
    // rodar `act`, serviço de PostGIS) — e um job desses tem `timeout-minutes`
    // justamente porque o orçamento é do runner. O número é um LIMITE SUPERIOR:
    // entra NOMEADO como teto (`ceiling`), nunca confundido com uma medição.
    if (typeof job.timeoutMinutes === "number" && job.timeoutMinutes > 0) {
      byJob.set(job.name, {
        ms: job.timeoutMinutes * 60_000,
        provenance: "declarado (TETO: timeout-minutes)",
        source: `${FORGES.find((f) => f.id === forge)?.file ?? "a pipeline"} — o próprio job declara timeout-minutes: ${job.timeoutMinutes}`,
        date: model?.meta?.date ?? null,
        derivedMs: derived.ms,
        derivedUnmatched: derived.unmatched.length,
        diverges: false,
        ceiling: true,
        timeoutMinutes: job.timeoutMinutes,
      })
      continue
    }
    missing.push(job.name)
    byJob.set(job.name, {
      ms: null,
      provenance: null,
      source: null,
      date: null,
      derivedMs: null,
      diverges: false,
      unmatchedSteps: derived.unmatched,
    })
  }
  return { byJob, missing }
}

// ── o grafo: caminho crítico e makespan ────────────────────────────────────

/**
 * A cadeia MAIS LONGA do grafo (por `needs`): quanto o PR esperaria se houvesse
 * runners ilimitados — mas só isso, porque o que ele espera de fato é o makespan.
 *
 * @param {{name: string, needs: string[]}[]} jobs
 * @param {Map<string, Duration>} durations
 * @returns {{ms: number, path: string[]}|null} `null` se alguma duração faltar
 */
export function criticalPath(jobs, durations) {
  const byName = new Map(jobs.map((j) => [j.name, j]))
  const memo = new Map()
  let unknown = false

  const longest = (name) => {
    if (memo.has(name)) return memo.get(name)
    const job = byName.get(name)
    const dur = durations.get(name)
    if (!job || !dur || typeof dur.ms !== "number") {
      unknown = true
      return null
    }
    let best = { ms: dur.ms, path: [name] }
    for (const need of job.needs) {
      const sub = longest(need)
      if (!sub) continue
      if (sub.ms + dur.ms > best.ms) best = { ms: sub.ms + dur.ms, path: [...sub.path, name] }
    }
    memo.set(name, best)
    return best
  }

  let best = null
  for (const job of jobs) {
    const candidate = longest(job.name)
    if (candidate && (!best || candidate.ms > best.ms)) best = candidate
  }
  if (unknown) return null
  return best
}

/**
 * O MAKESPAN: quanto o PR espera com `runners` jobs concorrentes.
 *
 * List-scheduling guloso na ordem topológica (empate resolvido pelo `needs`):
 * cada job vai para o runner que fica livre primeiro, respeitando as dependências.
 * Com `runners = 1` degenera na SOMA (a pipeline fica serial); com runners ≥ jobs,
 * no caminho crítico. É essa degradação que explica por que a soma engana.
 *
 * @param {{name: string, needs: string[]}[]} jobs
 * @param {Map<string, Duration>} durations
 * @param {number} runners
 * @returns {number|null} `null` se alguma duração faltar
 */
export function makespan(jobs, durations, runners) {
  const n = Math.max(1, Math.floor(runners) || 1)
  const pending = new Map(jobs.map((j) => [j.name, j]))
  const finished = new Map()
  const slots = new Array(n).fill(0)
  let remaining = jobs.length

  while (remaining > 0) {
    let progressed = false
    for (const [name, job] of [...pending]) {
      const dur = durations.get(name)
      if (!dur || typeof dur.ms !== "number") return null
      const ready = job.needs.every((need) => finished.has(need))
      if (!ready) continue
      // O runner livre mais cedo, e nunca antes de as dependências terminarem.
      const earliest = Math.max(...job.needs.map((need) => finished.get(need) ?? 0), 0)
      let slot = 0
      for (let s = 1; s < n; s++) if (slots[s] < slots[slot]) slot = s
      const start = Math.max(slots[slot], earliest)
      slots[slot] = start + dur.ms
      finished.set(name, slots[slot])
      pending.delete(name)
      remaining--
      progressed = true
    }
    if (!progressed) return null // ciclo em `needs:` — não é um grafo
  }
  return Math.max(...finished.values())
}

// ── o relatório ────────────────────────────────────────────────────────────

/**
 * Mede UMA forja: grafo, durações, latência (makespan), caminho crítico, soma e
 * os fatos que tornam o veredito pronto ou indeterminado.
 *
 * @param {{forge: {id: string, file: string, role: string}, content: string, model: object, bench: object|null, runners?: number|null}} args
 * @returns {ForgeReport}
 */
export function measureForge({ forge, content, model, bench, runners = null }) {
  const index = benchIndex(bench)
  const parsed = parseJobs(content)

  const overrides = model?.jobs?.[forge.id] ?? {}
  const jobs = []
  const unclassified = []
  const skipped = []
  for (const job of parsed) {
    const override = overrides[job.name]?.onPr
    const cls = classifyOnPr(job, typeof override === "boolean" ? override : null)
    if (cls.onPr === null) unclassified.push({ name: job.name, why: cls.why })
    if (cls.onPr === false) skipped.push({ name: job.name, why: cls.why })
    if (cls.onPr !== false) jobs.push({ ...job, whyOnPr: cls.why })
  }

  // As dependências que NÃO rodam no PR não podem segurar o caminho: o job
  // espera por elas, mas elas ou terminam antes (e são baratas) ou não existem.
  // Fica explícito no relatório em vez de sumir da conta.
  const names = new Set(jobs.map((j) => j.name))
  for (const job of jobs) job.needs = job.needs.filter((n) => names.has(n))

  const { byJob, missing } = resolveDurations(jobs, model, forge.id, index)
  // A CONCORRÊNCIA não se deriva da pipeline: `runs-on` diz onde o job roda, não
  // quantos rodam juntos. Sem ela declarada a latência tem DOIS limites — a soma
  // (1 runner) e o caminho crítico (runners de sobra) — e um número só seria uma
  // aposta entre os dois.
  const configured = model?.concurrency?.[forge.id]?.runners ?? null
  const declaredRunners = typeof configured === "number" && configured > 0
  const effectiveRunners = runners ?? (declaredRunners ? configured : 1)
  const sumOfGatesMs = jobs.reduce((acc, j) => acc + (byJob.get(j.name)?.ms ?? 0), 0)
  // A soma SEM os tetos: é o número que continua comparável com uma medição.
  // Sem ele, um job cujo custo só se conhece pelo orçamento do runner inflaria
  // a única linha publicada, e ela deixaria de dizer qualquer coisa.
  const sumWithoutCeilingsMs = jobs.reduce(
    (acc, j) => acc + (byJob.get(j.name)?.ceiling ? 0 : (byJob.get(j.name)?.ms ?? 0)),
    0,
  )
  const path = criticalPath(jobs, byJob)
  const latencyMs = makespan(jobs, byJob, effectiveRunners)

  const divergences = jobs
    .map((j) => ({ name: j.name, ...byJob.get(j.name) }))
    .filter((d) => d.diverges)
    .map((d) => ({
      name: d.name,
      declaredMs: d.ms,
      derivedMs: d.derivedMs,
      // O derivado é a soma SÓ dos passos que o benchmark conhece: um passo fora
      // dele (o install, o setup, um guard novo) faz do derivado um PISO. A frase
      // tem de dizer isso, senão acusa de velho o número que está apenas mais
      // completo — e um alarme que sempre toca não é alarme.
      derivedIsFloor: d.derivedUnmatched > 0,
      derivedUnmatched: d.derivedUnmatched,
      factor: Number((d.derivedMs / d.ms).toFixed(2)),
    }))

  // Os jobs que entraram por TETO: a pipeline declara o orçamento e não há
  // medição possível fora do runner. Eles NÃO indeterminam o veredito (o custo
  // está coberto por um limite), mas o fato viaja NOMEADO no relatório — senão
  // o número publicado pareceria medido por inteiro.
  const ceilings = jobs
    .map((j) => ({ name: j.name, ...byJob.get(j.name) }))
    .filter((d) => d.ceiling)
    .map((d) => ({
      name: d.name,
      ms: d.ms,
      timeoutMinutes: d.timeoutMinutes,
      ...(d.ceilingAged ? { aged: d.ceilingAged } : {}),
    }))

  const unknowns = []
  if (runners === null && !declaredRunners) {
    unknowns.push(
      `o nº de runners concorrentes desta forja não está declarado em ${MODEL_PATH} — a latência está calculada com 1 (pior caso); o MELHOR caso é o caminho crítico, e sem o número não dá para dizer qual dos dois vale`,
    )
  }
  for (const name of missing) {
    // O job declarado por PASSOS que não fecha tem a CAUSA nomeada: "sem duração"
    // sozinho mandaria procurar no lugar errado (o número existe — o que não
    // existe é a ligação dele, ou a cobertura de um passo).
    const entrada = byJob.get(name)
    const p = entrada?.stepProblems ?? []
    const porPassos = Array.isArray(entrada?.steps)
    unknowns.push(
      p.length
        ? `job '${name}' roda no PR e o modelo declara ${porPassos ? "os passos dele" : "o número dele"}, mas ${p.length} não fecha${p.length > 1 ? "m" : ""}: ${p.join("; ")}`
        : `job '${name}' roda no PR e NÃO tem duração (nem declarada em ${MODEL_PATH}, nem derivada do benchmark)`,
    )
  }
  for (const u of unclassified) {
    unknowns.push(
      `job '${u.name}' tem \`if:\` que não dá para classificar — ele PODE ou NÃO rodar no PR: ${u.why}`,
    )
  }
  // Uma soma parcial é um número que mente: se falta duração, o total declarado
  // também não vale — os dois viajam juntos no relatório.
  const sumComplete = missing.length === 0

  return {
    forge: forge.id,
    file: forge.file,
    role: forge.role,
    runners: effectiveRunners,
    runnersSource:
      runners !== null
        ? "sobreposto por --runners"
        : (model?.concurrency?.[forge.id]?.source ?? "default do modelo"),
    jobs: jobs.map((j) => ({
      name: j.name,
      needs: j.needs,
      ...byJob.get(j.name),
    })),
    skippedOnPr: skipped,
    unclassified,
    missing,
    divergences,
    ceilings,
    sumOfGatesMs,
    sumWithoutCeilingsMs,
    sumComplete,
    criticalPathMs: path?.ms ?? null,
    criticalPath: path?.path ?? null,
    latencyMs,
    // Com runners ilimitados o PR espera a cadeia mais longa; com 1 runner, a
    // soma. A diferença entre os dois é o que a tabela de gates não mostra.
    serialMs: sumComplete ? sumOfGatesMs : null,
    parallelismSavingMs:
      sumComplete && typeof latencyMs === "number" ? sumOfGatesMs - latencyMs : null,
    state: unknowns.length === 0 ? STATE.READY : STATE.UNKNOWN,
    unknowns,
  }
}

/**
 * O relatório completo: uma seção por forja, mais o veredito do dono do merge.
 *
 * @param {object} model
 * @param {{root?: string, forges?: {id: string, file: string, role: string}[], runners?: number|null, bench?: object|null}} [options]
 * @returns {Report}
 */
export function measure(
  model,
  { root = REPO_ROOT, forges = FORGES, runners = null, bench = null } = {},
) {
  const benchData = bench ?? readJson(join(root, BENCH_PATH))
  const sections = forges.map((forge) =>
    measureForge({
      forge,
      content: readFileSync(join(root, forge.file), "utf8"),
      model,
      bench: benchData,
      runners,
    }),
  )
  const owner = sections.find((s) => s.role === MERGE_OWNER_ROLE) ?? null
  return {
    modelPath: MODEL_PATH,
    benchPath: BENCH_PATH,
    benchCommit: benchData?.meta?.commit ?? null,
    sections,
    // O veredito CARREGA o do dono do merge à parte: ele é o que decide o
    // merge, e um consumidor não deve tê-lo de derivar do conjunto (o espelho
    // pode estar indeterminado sem que isso afete quem mergeia).
    mergeOwner: owner
      ? {
          forge: owner.forge,
          state: owner.state,
          latencyMs: owner.latencyMs,
          missing: owner.missing,
          unclassified: owner.unclassified.map((u) => u.name),
          ceilings: owner.ceilings.map((c) => c.name),
        }
      : null,
    state: sections.every((s) => s.state === STATE.READY) ? STATE.READY : STATE.UNKNOWN,
  }
}

function readJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null
}

const secs = (ms) => (ms === null || ms === undefined ? "?" : `${(ms / 1000).toFixed(1)}s`)

/**
 * O relatório em texto: a conta que o PR realmente paga.
 *
 * @param {Report} report
 * @param {{emit?: (s?: string) => void}} [options]
 * @returns {Report}
 */
export function renderReport(report, { emit = console.log } = {}) {
  const line = (s = "") => emit(s)
  line()
  line("  Latência de merge — o que o PR espera até ficar verde")
  line(
    `  modelo: ${report.modelPath} · benchmark: ${report.benchPath}${report.benchCommit ? ` @ ${report.benchCommit}` : ""}`,
  )
  line("  " + "─".repeat(68))

  for (const s of report.sections) {
    line()
    line(`  ${s.forge.toUpperCase()} (${s.role}) — ${s.file}`)
    line(
      `    runners concorrentes: ${s.runners} (${s.runnersSource}) · jobs no PR: ${s.jobs.length}` +
        (s.skippedOnPr.length ? ` · fora do PR: ${s.skippedOnPr.length}` : ""),
    )
    for (const job of s.jobs) {
      const dur = job.ms === null ? "NÃO MEDIDO" : secs(job.ms)
      const prov = job.provenance ? ` (${job.provenance})` : ""
      const flag = job.diverges ? `  ⚠ divergência: derivado ${secs(job.derivedMs)}` : ""
      const needs = job.needs.length ? ` ← ${job.needs.join(", ")}` : ""
      line(`      ${dur.padStart(9)}  ${job.name}${prov}${needs}${flag}`)
      // O passo que LEU o benchmark: o número dele não vive no modelo, e quem lê
      // a tabela precisa ver de ONDE ele veio e de QUAL commit — sem isso o
      // total declarado pareceria medido por inteiro aqui.
      const ligados = (job.steps ?? []).filter((p) => p.derived)
      if (ligados.length) {
        line(
          `                 ↳ do benchmark: ${ligados.map((p) => `${p.label} ${secs(p.ms)}${p.commit ? ` @ ${p.commit}` : ""}`).join(" · ")}`,
        )
      }
    }
    line()
    line(`    soma dos gates (o PR NÃO paga isso)   ${s.sumComplete ? secs(s.sumOfGatesMs) : "?"}`)
    line(
      `    caminho crítico (o grafo manda)       ${secs(s.criticalPathMs)}${s.criticalPath ? ` — ${s.criticalPath.join(" → ")}` : ""}`,
    )
    line(`    LATÊNCIA DE MERGE (fila incluída)     ${secs(s.latencyMs)}`)
    if (s.ceilings.length) {
      line(
        `    soma só dos MEDIDOS/declarados        ${secs(s.sumWithoutCeilingsMs)} (sem os ${s.ceilings.length} TETO(s))`,
      )
    }
    if (s.parallelismSavingMs !== null) {
      line(
        `    o que a concorrência economiza        ${secs(s.parallelismSavingMs)}` +
          (s.runners === 1 ? " (com 1 runner a pipeline é SERIAL: não há economia)" : ""),
      )
    }
    for (const d of s.divergences) {
      line(
        `    ⚠ '${d.name}': declarado ${secs(d.declaredMs)} × derivado do benchmark ${secs(d.derivedMs)} (${d.factor}×) — ` +
          (d.derivedIsFloor
            ? `os dois discordam além da tolerância; o derivado é PISO (${d.derivedUnmatched} passo(s) fora do benchmark), então o declarado só envelheceu se a diferença não couber no que falta`
            : "os dois cobrem os MESMOS passos e discordam: um dos dois envelheceu"),
      )
    }
    for (const u of s.unknowns) line(`    ⚠ ${u}`)
    for (const c of s.ceilings) {
      const onde =
        c.timeoutMinutes === null
          ? "o teto vem do workflow REUTILIZÁVEL que o job chama (o `uses:` deste job não declara `timeout-minutes`)"
          : `\`timeout-minutes: ${c.timeoutMinutes}\``
      line(
        `    ⚠ '${c.name}': TETO declarado pela pipeline (${onde} = ${secs(c.ms)}) — o job entra pelo LIMITE, não por medição`,
      )
      if (c.aged) {
        line(
          `      ↳ mas o teto declarado (${secs(c.aged.declaredMs)}) DIVERGIU do \`timeout-minutes\` da pipeline (${secs(c.aged.pipelineMs)}): a cópia envelheceu`,
        )
      }
    }
    line()
    line(
      `    → ${s.state === STATE.READY ? "PRONTA: a latência cobre todos os jobs do PR" : "INDETERMINADA: falta medir o que está nomeado acima (um job não medido não é instantâneo)"}` +
        (s.ceilings.length
          ? ` — ${s.ceilings.length} job(s) por TETO: a latência é um LIMITE SUPERIOR, não um ponto medido`
          : ""),
    )
  }

  const ready = report.state === STATE.READY
  // O escopo do veredito vai NOMEADO: com `--check` só o dono do merge é medido,
  // e dizer "as duas forjas" ali seria anunciar mais cobertura do que a medição.
  const so = report.sections.length === 1 ? report.sections[0] : null
  const alvo = so ? `a forja '${so.forge}' (${so.role})` : "as duas forjas"
  line()
  line("  " + "─".repeat(68))
  line(
    `  ${ready ? "PRONTA" : "INDETERMINADA"} — ${
      ready
        ? `${alvo}: a latência cobre todos os jobs do PR`
        : `${alvo}: há job do PR sem duração (ou com \`if:\` não classificável) — a latência NÃO está provada`
    }`,
  )
  line()
  return report
}

// ── CLI ────────────────────────────────────────────────────────────────────

export const USAGE = `merge-latency — o custo dos gates em latência de merge (o que o PR espera)

Usage:
  node scripts/merge-latency.mjs [opções]

Opções:
  --forge <gitea|github>  mede só uma forja (default: as duas)
  --runners <N>           sobrepõe o nº de runners concorrentes do modelo
  --check                 só o veredito do DONO DO MERGE (o gate do PR)
  --root <dir>            mede OUTRO checkout (fixture; default: a raiz do repo)
  --json                  saída estruturada
  -h, --help              esta ajuda

Exit codes: 0 PRONTA · 1 erro de uso · 2 INDETERMINADA (falta duração/classificação)`

/**
 * @param {string[]} argv
 * @returns {{forges: {id: string, file: string, role: string}[], runners: number|null, check: boolean, json: boolean, help: boolean, root: string}}
 */
export function parseArgs(argv) {
  const options = {
    forges: FORGES,
    runners: null,
    check: false,
    json: false,
    help: false,
    root: REPO_ROOT,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--forge") {
      const id = argv[++i]
      const found = FORGES.filter((f) => f.id === id)
      if (!found.length) throw new Error(`--forge deve ser gitea|github (recebi '${id}')`)
      options.forges = found
    } else if (arg === "--runners") {
      const n = Number(argv[++i])
      if (!Number.isFinite(n) || n < 1)
        throw new Error(`--runners espera um inteiro >= 1 (recebi '${argv[i]}')`)
      options.runners = n
    } else if (arg === "--check") options.check = true
    else if (arg === "--root") options.root = argv[++i]
    else if (arg === "--json") options.json = true
    else if (arg === "--help" || arg === "-h") options.help = true
    else throw new Error(`Argumento desconhecido: ${arg}`)
  }
  // `--check` já É um recorte (o dono do merge): pedir outro escopo junto seria
  // um comando que diz duas coisas — e o gate mediria a forja que ninguém pediu.
  if (options.check && options.forges.length !== FORGES.length) {
    throw new Error("--check e --forge são escopos concorrentes: --check julga o dono do merge")
  }
  return options
}

function main(argv) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    console.error(`merge-latency: ${error.message}`)
    console.error(USAGE)
    return 1
  }
  if (options.help) {
    console.log(USAGE)
    return 0
  }
  const model = readJson(join(options.root, MODEL_PATH))
  if (!model) {
    console.error(`merge-latency: modelo ausente ou ilegível em ${MODEL_PATH}`)
    return 1
  }
  const report = measure(model, {
    root: options.root,
    forges: options.check ? FORGES.filter((f) => f.role === MERGE_OWNER_ROLE) : options.forges,
    runners: options.runners,
  })
  if (options.json) console.log(JSON.stringify(report, null, 2))
  else renderReport(report)
  if (options.check) {
    // O veredito do GATE é o do dono do merge — o espelho não decide nada.
    const owner = report.mergeOwner
    if (!owner) {
      console.error(`merge-latency: nenhuma forja com o papel '${MERGE_OWNER_ROLE}' em FORGES`)
      return 1
    }
    return owner.state === STATE.READY ? 0 : 2
  }
  return report.state === STATE.READY ? 0 : 2
}

const isMain = !!process.argv[1] && process.argv[1].split(/[\\/]/).pop() === "merge-latency.mjs"
if (isMain) process.exit(main(process.argv.slice(2)))
