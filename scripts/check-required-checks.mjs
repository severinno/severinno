#!/usr/bin/env node

// =============================================================================
// check-required-checks.mjs
//
// Guard que mantém `ci/required-checks.json` HONESTO em relação aos workflows.
//
// Por que existe: um required status check que não corresponde a nenhum job
// real não falha — ele ESPERA. O PR fica travado para sempre num check que
// nunca vai rodar, e o diagnóstico (do lado da forja) não diz o porquê. O
// inverso também dói: um job obrigatório que seja CONDICIONAL (`if:`) pode
// pular num PR, e um check que não roda não protege nada.
//
// Este guard falha o PR, cedo e barato (node puro, sem deps), quando o
// manifesto:
//   1. aponta para workflow inexistente;
//   2. lista um job que não existe naquele workflow;
//   3. lista um job com `if:` (obrigatório não pode ser condicional);
//   4. produz dois checks com o MESMO contexto (contexto é a chave do
//      branch protection — duplicata deixa um deles órfão);
//
// Os itens do manifesto são IDs DE JOB (não nomes exibidos): renomear o
// `name:` de um job não deve mexer no que está protegido.
//
// NOTA: parser de YAML deliberadamente caseiro (indentação de 2 níveis).
// Este job do CI NÃO instala node_modules, então `node scripts/...` não pode
// importar `yaml`. A fidelidade do parser é verificada por
// `src/lib/__tests__/required-checks-manifest.test.ts`, que compara o
// resultado com o do parser real nas MESMAS duas workflows.
//
// Usage:
//   node scripts/check-required-checks.mjs
// Exit codes:
//   0 — manifesto consistente com os workflows (pass)
//   1 — divergência encontrada (fail)
// =============================================================================

import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

export const MANIFEST_PATH = "ci/required-checks.json"
const SUPPORTED_VERSION = 1

// ---------------------------------------------------------------------------
// Parser mínimo de `jobs:` (sem deps)
// ---------------------------------------------------------------------------

/** Remove aspas de um escalar YAML simples (`"x"`, `'x'`, `x`). */
function scalar(value) {
  const trimmed = String(value ?? "").trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/**
 * Extrai os jobs de um workflow: `Map<jobId, { name: string|null, if: string|null }>`.
 *
 * Assume a indentação convencional destes workflows (jobs em 2 espaços,
 * propriedades do job em 4). Um job sem `name:` tem contexto = jobId na forja,
 * e é assim que o applier o resolve.
 */
export function parseWorkflowJobs(content) {
  const jobs = new Map()
  let inJobs = false
  let current = null

  for (const line of content.split(/\r?\n/)) {
    if (!inJobs) {
      if (/^jobs:\s*$/.test(line)) inJobs = true
      continue
    }
    if (line.trim() === "" || /^\s*#/.test(line)) continue

    // Voltou ao nível 0 (outra chave raiz do documento) → fim do bloco jobs.
    if (/^\S/.test(line)) {
      inJobs = false
      current = null
      continue
    }

    const jobId = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (jobId) {
      current = jobId[1]
      jobs.set(current, { name: null, if: null })
      continue
    }

    if (current === null) continue

    const name = /^ {4}name:\s*(.+)$/.exec(line)
    if (name) {
      jobs.get(current).name = scalar(name[1])
      continue
    }

    // `if:` do JOB (4 espaços). O `if:` de um step vive em 8 — ignorado.
    const condition = /^ {4}if:\s*(.+)$/.exec(line)
    if (condition) jobs.get(current).if = scalar(condition[1])
  }

  return jobs
}

/** Contexto de status que a forja usa para um job: o `name:` ou, sem ele, o id. */
export function contextFor(jobId, job) {
  return job.name && job.name.length > 0 ? job.name : jobId
}

// ---------------------------------------------------------------------------
// Validação do manifesto
// ---------------------------------------------------------------------------

/**
 * Valida o manifesto contra os workflows reais.
 *
 * @param {any} manifest           conteúdo de `ci/required-checks.json`
 * @param {{ readFile: (p: string) => string|null }} io  leitor (injável p/ teste)
 * @returns {{ forge: string, problem: string }[]} violações (vazio = ok)
 */
export function validateManifest(manifest, io) {
  const violations = []
  const fail = (forge, problem) => violations.push({ forge, problem })

  if (manifest?.version !== SUPPORTED_VERSION) {
    fail("-", `version deve ser ${SUPPORTED_VERSION} (encontrado: ${manifest?.version})`)
  }

  const branches = manifest?.branches
  if (!Array.isArray(branches) || branches.length === 0) {
    fail("-", "branches deve ser uma lista não-vazia")
  }

  const forges = manifest?.forges
  if (!forges || typeof forges !== "object" || Object.keys(forges).length === 0) {
    fail("-", "forges deve declarar ao menos uma forja")
    return violations
  }

  for (const [forge, config] of Object.entries(forges)) {
    if (typeof config?.workflow !== "string" || config.workflow.length === 0) {
      fail(forge, "workflow ausente")
      continue
    }
    const content = io.readFile(config.workflow)
    if (content === null) {
      fail(forge, `workflow "${config.workflow}" não existe`)
      continue
    }
    if (!Array.isArray(config.jobs) || config.jobs.length === 0) {
      fail(forge, "jobs deve ser uma lista não-vazia")
      continue
    }

    const workflowJobs = parseWorkflowJobs(content)
    const seenContexts = new Map()

    for (const jobId of config.jobs) {
      const job = workflowJobs.get(jobId)
      if (!job) {
        fail(
          forge,
          `job "${jobId}" não existe em ${config.workflow} — ` +
            `um required check inexistente FARIA o PR esperar para sempre`,
        )
        continue
      }
      if (job.if) {
        fail(
          forge,
          `job "${jobId}" é condicional (\`if: ${job.if}\`) — ` +
            `um check obrigatório que pode pular não protege nada`,
        )
      }
      const context = contextFor(jobId, job)
      if (seenContexts.has(context)) {
        fail(
          forge,
          `contexto duplicado "${context}" (jobs "${seenContexts.get(context)}" e "${jobId}")`,
        )
      } else {
        seenContexts.set(context, jobId)
      }
    }
  }

  return violations
}

/** Resolve os contextos de status por forja a partir do manifesto. */
export function resolveManifestContexts(manifest, io) {
  const resolved = {}
  for (const [forge, config] of Object.entries(manifest?.forges ?? {})) {
    const content = io.readFile(config.workflow)
    if (content === null) continue
    const workflowJobs = parseWorkflowJobs(content)
    resolved[forge] = {
      workflow: config.workflow,
      branches: manifest.branches ?? [],
      contexts: (config.jobs ?? [])
        .map((jobId) => {
          const job = workflowJobs.get(jobId)
          return job ? { jobId, context: contextFor(jobId, job) } : null
        })
        .filter(Boolean),
    }
  }
  return resolved
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function defaultIo(root) {
  return {
    readFile: (relativePath) => {
      const absolute = join(root, relativePath)
      return existsSync(absolute) ? readFileSync(absolute, "utf8") : null
    },
  }
}

export function loadManifest(root, io) {
  const raw = io.readFile(MANIFEST_PATH)
  if (raw === null) throw new Error(`${MANIFEST_PATH} não encontrado`)
  return JSON.parse(raw)
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  const io = defaultIo(root)

  let manifest
  try {
    manifest = loadManifest(root, io)
  } catch (error) {
    console.error(`❌ ${error.message}`)
    process.exit(1)
  }

  const violations = validateManifest(manifest, io)

  if (violations.length > 0) {
    console.error(`❌ ci/required-checks.json divergiu dos workflows:\n`)
    for (const v of violations) console.error(`   - [${v.forge}] ${v.problem}`)
    console.error(
      `\n   Ação: corrija o manifesto OU restaure/renomeie o job. ` +
        `Fonte dos contextos: os IDs de job — não os \`name:\` exibidos.`,
    )
    process.exit(1)
  }

  const resolved = resolveManifestContexts(manifest, io)
  console.log(`✅ Required checks consistentes com os workflows:`)
  for (const [forge, data] of Object.entries(resolved)) {
    console.log(`   ${forge} (${data.workflow}) — branch: ${data.branches.join(", ")}`)
    for (const { context } of data.contexts) console.log(`     • ${context}`)
  }
  process.exit(0)
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
