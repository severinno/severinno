#!/usr/bin/env node

// =============================================================================
// check-periodic-alerts.mjs
//
// Garante que TODO job de workflow AGENDADO tenha um CANAL acionável declarado —
// `fail` (o run fica vermelho no sinal), `issue` (publica/comenta uma issue) ou
// `comment` — e que a EVIDÊNCIA desse canal exista no workflow.
//
// POR QUE EXISTE (auditoria dos jobs periódicos): um job de cron que termina
// VERDE por desenho e só emite `::warning::` é um alerta MUDO — ninguém abre o
// log de um run que passou. O repositório já trata isso como defeito em seis
// lugares (`actrc-sync-issue.mjs`, `readme-reverse-issue.mjs`,
// `required-checks-drift-issue.mjs`, `forge-doctor-issue.mjs`,
// `mutation-trend-issue.mjs`, `blob-crlf-scope-issue.mjs`), mas a regra vivia só
// na cabeça de quem escreveu cada job: um `continue-on-error` novo, ou um guard
// que "só avisa", voltava a abrir a mesma lacuna em silêncio. Aqui a decisão é
// ESCRITA e verificável.
//
// A DECISÃO É ESCRITA (como no `ci/required-checks.json`): o manifesto
// `ci/periodic-alerts.json` lista cada job agendado com o SEU canal e uma
// EVIDÊNCIA (um literal que precisa existir no bloco do job — o step que falha,
// o publicador de issue, o step de comentário). O guard exige COBERTURA: um job
// agendado sem entrada no manifesto FALHA, então nenhum cron novo entra sem
// alguém decidir qual é o canal dele. Um `via` permite declarar que o canal de
// um job vive em OUTRO job do mesmo workflow (ex.: dois medidores cujo alerta é
// publicado por um job de alerta que lê os dois relatórios) — e aí a evidência é
// procurada no bloco do `via`.
//
// O QUE ELE NÃO PROVA: que o canal FUNCIONA (isso é dos testes de cada
// publicador, que exercitam o ciclo contra um backend dublê). Ele prova que a
// decisão existe, que o canal é um dos três aceitos e que a evidência
// declarada está de fato no workflow — o suficiente para nenhum job novo pular
// a forja em silêncio.
//
// FONTE ÚNICA DAS PASTAS: a lista de diretórios de workflow vem de
// `scripts/forge-workflows.mjs` (a mesma que a paridade e o escopo usam) — uma
// forja nova entra na varredura sozinha.
//
// Usage:
//   node scripts/check-periodic-alerts.mjs            # audita o repositório
//   node scripts/check-periodic-alerts.mjs --json     # relatório JSON
//   node scripts/check-periodic-alerts.mjs --help
//
// Exit codes:
//   0 — todo job agendado classificado e com evidência presente
//   1 — violação (job sem entrada, canal inválido, evidência ausente, `via`
//       inexistente, entrada para job/workflow que não existe)
//   2 — uso inválido ou infra (manifesto ausente/inválido)
// =============================================================================

import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

import { parseWorkflowJobs } from "./check-required-checks.mjs"
import { allWorkflowFiles } from "./forge-workflows.mjs"

/** O manifesto da auditoria (única fonte das decisões). */
export const MANIFEST_PATH = "ci/periodic-alerts.json"

/** Os canais aceitos. Um job agendado TEM de ter um deles. */
export const ALLOWED_CHANNELS = ["fail", "issue", "comment"]

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

/**
 * `true` se o workflow roda sozinho (cron). Ignora `workflow_dispatch` puro: o
 * problema do alerta mudo é do job que roda SEM ninguém olhando.
 *
 * @param {string} content
 */
export function isScheduledWorkflow(content) {
  return /^\s*schedule:\s*$/m.test(content)
}

/**
 * O BLOCO de um job: da linha `  <jobId>:` até a próxima chave no mesmo nível
 * (ou o fim do bloco `jobs`). É o recorte onde a evidência do canal precisa
 * estar — procurar no arquivo inteiro aceitaria a evidência de OUTRO job.
 *
 * @param {string} content
 * @param {string} jobId
 * @returns {string|null}
 */
export function jobBlock(content, jobId) {
  const lines = content.split(/\r?\n/)
  const startRe = new RegExp(`^ {2}${jobId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*$`)
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (startRe.test(lines[i])) {
      start = i
      break
    }
  }
  if (start === -1) return null
  const nextRe = /^ {2}[A-Za-z0-9_-]+:\s*$/
  for (let i = start + 1; i < lines.length; i++) {
    // Voltou ao nível 0 (fim do bloco jobs) ou outra chave de job → fim.
    if (/^\S/.test(lines[i]) || nextRe.test(lines[i])) {
      return lines.slice(start, i).join("\n")
    }
  }
  return lines.slice(start).join("\n")
}

/**
 * Os jobs de TODOS os workflows agendados das forjas.
 *
 * @param {{ listWorkflows: () => { path: string }[], readFile: (p: string) => string|null }} io
 * @returns {{ path: string, job: string, block: string }[]}
 */
export function scheduledJobBlocks(io) {
  const out = []
  for (const file of io.listWorkflows()) {
    const content = io.readFile(file.path)
    if (content === null || !isScheduledWorkflow(content)) continue
    for (const jobId of parseWorkflowJobs(content).keys()) {
      const block = jobBlock(content, jobId)
      if (block !== null) out.push({ path: file.path, job: jobId, block })
    }
  }
  return out
}

/**
 * Valida o manifesto contra os workflows REAIS (nos dois sentidos: cobertura e
 * entradas que apontam para o vazio).
 *
 * @param {any} manifest
 * @param {{ listWorkflows: () => { path: string }[], readFile: (p: string) => string|null }} io
 * @returns {{ problem: string, workflow?: string, job?: string }[]}
 */
export function validatePeriodicAlerts(manifest, io) {
  const violations = []
  const push = (problem, entry = {}) =>
    violations.push({ problem, workflow: entry.workflow, job: entry.job })

  const entries = []
  for (const [forge, list] of Object.entries(manifest?.forges ?? {})) {
    if (!Array.isArray(list)) {
      push(`forges.${forge} deve ser uma lista`)
      continue
    }
    for (const entry of list) entries.push({ ...entry, forge })
  }

  if (entries.length === 0) push("o manifesto não classifica nenhum job")

  // (1) Cada entrada precisa apontar para um job REAL de um workflow AGENDADO.
  const seen = new Set()
  for (const entry of entries) {
    const key = `${entry.workflow}::${entry.job}`
    if (seen.has(key)) {
      push(`entrada duplicada para ${key}`, entry)
      continue
    }
    seen.add(key)

    if (typeof entry.workflow !== "string" || typeof entry.job !== "string") {
      push("entrada sem workflow/job", entry)
      continue
    }
    if (!ALLOWED_CHANNELS.includes(entry.channel)) {
      push(`canal '${entry.channel}' não é aceito (use ${ALLOWED_CHANNELS.join("|")})`, entry)
      continue
    }
    const content = io.readFile(entry.workflow)
    if (content === null) {
      push("workflow não existe", entry)
      continue
    }
    if (!isScheduledWorkflow(content)) {
      push("workflow não é agendado (não é job periódico)", entry)
      continue
    }
    if (!parseWorkflowJobs(content).has(entry.job)) {
      push("job não existe no workflow", entry)
      continue
    }
    // A evidência vive no bloco do job — ou no do `via`, quando o canal é de
    // outro job do mesmo workflow.
    const targetJob = entry.via ?? entry.job
    if (entry.via !== undefined && !parseWorkflowJobs(content).has(entry.via)) {
      push(`via '${entry.via}' não existe no workflow`, entry)
      continue
    }
    const block = jobBlock(content, targetJob)
    if (block === null || typeof entry.evidence !== "string" || !block.includes(entry.evidence)) {
      push(
        `evidência do canal ausente no bloco de '${targetJob}': ${JSON.stringify(entry.evidence)}`,
        entry,
      )
    }
  }

  // (2) COBERTURA: nenhum job agendado pode ficar sem classificação.
  for (const { path, job } of scheduledJobBlocks(io)) {
    if (!seen.has(`${path}::${job}`)) {
      push("job agendado SEM classificação no manifesto", { workflow: path, job })
    }
  }

  return violations
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * O `io` real do repositório. `readFile` devolve `null` para arquivo ausente
 * (mesmo contrato dos outros guards) — o guard decide o que fazer com isso.
 */
export function defaultIo(root = REPO_ROOT) {
  return {
    listWorkflows: () => allWorkflowFiles(root),
    readFile: (path) => {
      const full = join(root, path)
      return existsSync(full) ? readFileSync(full, "utf8") : null
    },
  }
}

function loadManifest(root) {
  const full = join(root, MANIFEST_PATH)
  if (!existsSync(full)) {
    console.error(`❌ manifesto ausente: ${MANIFEST_PATH}`)
    process.exit(2)
  }
  try {
    return JSON.parse(readFileSync(full, "utf8"))
  } catch (e) {
    console.error(`❌ manifesto inválido (${MANIFEST_PATH}): ${e.message}`)
    process.exit(2)
  }
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Uso: node scripts/check-periodic-alerts.mjs [--json]\n" +
        "  Audita TODO job de workflow agendado contra o manifesto\n" +
        `  ${MANIFEST_PATH}: exige canal (${ALLOWED_CHANNELS.join("|")}) e evidência no bloco do job.`,
    )
    return 0
  }
  const json = args.includes("--json")
  const unknown = args.filter((a) => !["--json", "--help", "-h"].includes(a))
  if (unknown.length > 0) {
    console.error(`❌ argumento desconhecido: ${unknown.join(" ")}`)
    return 2
  }

  const io = defaultIo()
  const manifest = loadManifest(REPO_ROOT)
  const violations = validatePeriodicAlerts(manifest, io)
  const jobs = scheduledJobBlocks(io)

  if (json) {
    console.log(JSON.stringify({ jobs, violations }, null, 2))
  } else {
    console.log(`🗓️  Jobs periódicos auditados: ${jobs.length}`)
    for (const [forge, list] of Object.entries(manifest.forges ?? {})) {
      console.log(`\n  ${forge}:`)
      for (const entry of list) {
        const via = entry.via ? ` (via ${entry.via})` : ""
        console.log(`    ${entry.channel.padEnd(7)} ${entry.workflow} :: ${entry.job}${via}`)
      }
    }
    if (violations.length === 0) {
      console.log(
        `\n✅ Todo job agendado tem canal declarado (${ALLOWED_CHANNELS.join("/")}) com a evidência presente.`,
      )
    } else {
      console.error(`\n❌ ${violations.length} violação(ões):`)
      for (const v of violations) {
        const where = v.workflow ? ` [${v.workflow}${v.job ? `::${v.job}` : ""}]` : ""
        console.error(`   • ${v.problem}${where}`)
      }
    }
  }

  return violations.length === 0 ? 0 : 1
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) {
  process.exit(main())
}
