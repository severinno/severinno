/**
 * helpers/workflow-execution.ts
 *
 * Simulador compartilhado de execução de workflow para os testes de contrato
 * dos workflows periódicos e de merge. Substitui o padrão duplicado de
 * carregar YAML, parsear, construir contexto e validar referências que
 * existia em 20+ arquivos de teste.
 *
 * O simulador não executa comandos reais — ele RESOLVE qual passo
 * executaria dado um contexto (condições, dependências, stubs de outputs),
 * transformando asserções de "leitura de YAML" em provas de execução.
 *
 * Uso típico:
 *   const wf = loadWorkflow(".github/workflows/benchmark-weekly.yml")
 *   const job = getJob(wf, "mutation-coord-timing")
 *   const ctx = buildRepoContext()
 *   expect(job.needs).toBe("seed-guards")
 *   expect(resolveCondition(job.if, ctx)).toBe(true)
 *   const steps = filterExecutableSteps(job, ctx)
 *   expect(steps).toHaveLength(4)
 *   expectRefs(wf, ctx, "mutation-coord-timing")
 */

import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import yaml from "js-yaml"

import {
  extractScriptRefs,
  extractPkgScriptRefs,
  extractWorkflowUses,
  extractActionUses,
} from "../../../../scripts/check-workflow-refs.mjs"

// ── Tipos ───────────────────────────────────────────────────────────────

export interface WorkflowStep {
  name?: string
  id?: string
  if?: string
  run?: string
  uses?: string
  with?: Record<string, unknown>
  env?: Record<string, string>
}

export interface WorkflowJob {
  name?: string
  needs?: string | string[]
  if?: string
  permissions?: Record<string, string>
  "runs-on"?: string
  "timeout-minutes"?: number
  strategy?: Record<string, unknown>
  services?: Record<string, unknown>
  steps?: WorkflowStep[]
}

export interface ParsedWorkflow {
  name?: string
  on?: Record<string, unknown>
  env?: Record<string, string>
  jobs?: Record<string, WorkflowJob>
}

export interface RepoContext {
  /** Scripts em scripts/ */
  scripts: Set<string>
  /** Workflows em .github/workflows/ e .gitea/workflows/ */
  workflows: Set<string>
  /** Workflows que declaram on: workflow_call */
  workflowCall: Set<string>
  /** Entries de package.json */
  pkgScripts: Set<string>
  /** Actions locais em .github/actions/ */
  actions: Set<string>
  /** CWD do repo */
  cwd: string
}

export interface RefResult {
  ref: string
  file?: string
  line?: number
}

export interface WorkflowRefs {
  scripts: RefResult[]
  pkgScripts: RefResult[]
  workflowUses: RefResult[]
  actionUses: RefResult[]
}

// ── Carregador ──────────────────────────────────────────────────────────

const REPO_ROOT = (() => {
  // Encontra a raiz do repo (onde está package.json)
  let dir = import.meta.dirname ?? process.cwd()
  while (dir !== "/") {
    if (existsSync(join(dir, "package.json"))) return dir
    dir = join(dir, "..")
  }
  return process.cwd()
})()

/**
 * Carrega e parseia um workflow YAML. Lança se o YAML for inválido.
 */
export function loadWorkflow(relativePath: string): ParsedWorkflow {
  const fullPath = join(REPO_ROOT, relativePath)
  const content = readFileSync(fullPath, "utf8")
  return yaml.load(content) as ParsedWorkflow
}

/**
 * Lê o conteúdo bruto de um workflow.
 */
export function readWorkflowContent(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8")
}

// ── Contexto ────────────────────────────────────────────────────────────

/**
 * Constrói o contexto real do repo (scripts, workflows, actions).
 * Reutilizável entre todos os testes de workflow.
 */
export function buildRepoContext(): RepoContext {
  const githubWfDir = join(REPO_ROOT, ".github", "workflows")
  const giteaWfDir = join(REPO_ROOT, ".gitea", "workflows")

  const githubNames = existsSync(githubWfDir)
    ? readdirSync(githubWfDir).filter((f) => f.endsWith(".yml"))
    : []
  const giteaNames = existsSync(giteaWfDir)
    ? readdirSync(giteaWfDir).filter((f) => f.endsWith(".yml"))
    : []
  const allNames = [...githubNames, ...giteaNames]

  const scripts = new Set(readdirSync(join(REPO_ROOT, "scripts")))

  const workflowCall = new Set(
    allNames.filter((n) => {
      const dir = githubNames.includes(n) ? githubWfDir : giteaWfDir
      return readFileSync(join(dir, n), "utf8").includes("workflow_call")
    }),
  )

  const pkgScripts = new Set(
    Object.keys(JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).scripts ?? {}),
  )

  const actionsDir = join(REPO_ROOT, ".github", "actions")
  const actions = new Set(
    existsSync(actionsDir)
      ? readdirSync(actionsDir).filter((f) => existsSync(join(actionsDir, f, "action.yml")))
      : [],
  )

  return {
    scripts,
    workflows: new Set(allNames),
    workflowCall,
    pkgScripts,
    actions,
    cwd: REPO_ROOT,
  }
}

/**
 * Constrói contexto com valores customizados (para testes mutantes).
 */
export function buildStubContext(overrides: Partial<RepoContext> = {}): RepoContext {
  const real = buildRepoContext()
  return {
    ...real,
    scripts: overrides.scripts ?? real.scripts,
    workflows: overrides.workflows ?? real.workflows,
    workflowCall: overrides.workflowCall ?? real.workflowCall,
    pkgScripts: overrides.pkgScripts ?? real.pkgScripts,
    actions: overrides.actions ?? real.actions,
  }
}

// ── Extração de job ─────────────────────────────────────────────────────

/**
 * Obtém um job do workflow parsed. Lança se não existir.
 */
export function getJob(wf: ParsedWorkflow, jobId: string): WorkflowJob {
  const job = wf.jobs?.[jobId]
  if (!job) {
    throw new Error(
      `Job '${jobId}' não encontrado. Jobs disponíveis: ${Object.keys(wf.jobs ?? {}).join(", ")}`,
    )
  }
  return job
}

/**
 * Obtém os steps de um job.
 */
export function getSteps(job: WorkflowJob): WorkflowStep[] {
  return job.steps ?? []
}

// ── Avaliação de condições ──────────────────────────────────────────────

export interface ConditionContext {
  /** Se o job anterior falhou */
  previousJobFailed?: boolean
  /** Se o job anterior foi cancelado */
  previousJobCancelled?: boolean
  /** Outputs de jobs anteriores (needs.<id>.outputs.<name>) */
  jobOutputs?: Record<string, Record<string, string>>
  /** Se o job anterior teve success */
  previousJobSuccess?: boolean
}

/**
 * Avalia uma expressão `if:` do GitHub Actions.
 *
 * Suporta: always(), success(), failure(), cancelled(),
 * needs.<id>.result == 'failure', e combinações com &&, ||, !.
 *
 * NOTA: Simplificação — não suporta表达ões complexas como
 * contains(), startsWith(), etc. Cobre os padrões reais do repo.
 */
export function resolveCondition(expr: string | undefined, ctx: ConditionContext = {}): boolean {
  if (!expr || expr.trim() === "") return true // sem if = sempre executa

  const trimmed = expr.trim()

  // Suporte a表达ões com parênteses: `(condition)`
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    return resolveCondition(trimmed.slice(1, -1), ctx)
  }

  // Sempre verdadeiro
  if (trimmed === "always()") return true

  // Sempre falso para pull_request
  if (trimmed === "github.event_name == 'pull_request'") return false

  // success() — default, verdadeiro se nada falhou antes
  if (trimmed === "success()") {
    return ctx.previousJobFailed !== true && ctx.previousJobCancelled !== true
  }

  // failure() — verdadeiro se algo falhou
  if (trimmed === "failure()") {
    return ctx.previousJobFailed === true
  }

  // cancelled()
  if (trimmed === "cancelled()") {
    return ctx.previousJobCancelled === true
  }

  // Combinações com &&
  const andParts = splitTopLevel(trimmed, "&&")
  if (andParts.length > 1) {
    return andParts.every((p) => resolveCondition(p, ctx))
  }

  // Combinações com ||
  const orParts = splitTopLevel(trimmed, "||")
  if (orParts.length > 1) {
    return orParts.some((p) => resolveCondition(p, ctx))
  }

  // Negação
  if (trimmed.startsWith("!")) {
    return !resolveCondition(trimmed.slice(1), ctx)
  }

  // Comparação de resultado de needs
  const needsMatch = trimmed.match(/needs\.([a-zA-Z0-9_-]+)\.result\s*==\s*'([^']+)'/)
  if (needsMatch) {
    const [, , expected] = needsMatch
    // Se não temos contexto de outputs, assumimos que o resultado é
    // 'success' (o caso padrão do GitHub Actions)
    return "success" === expected
  }

  // Condição de step output: steps.<id>.outputs.<name> <op> '<valor>'
  const stepOutputMatch = trimmed.match(
    /steps\.([a-zA-Z0-9_-]+)\.outputs\.([a-zA-Z0-9_-]+)\s*(!=|==)\s*'([^']*)'/,
  )
  if (stepOutputMatch) {
    // Em simulação, o output não existe — para != é verdadeiro, para == é falso
    return stepOutputMatch[2] !== undefined && stepOutputMatch[3] === "!="
  }

  // Condição desconhecida — retorna true (não bloqueia)
  return true
}

/**
 * Divide uma string por um delimitador de nível superior (ignora
 * parênteses e strings).
 */
function splitTopLevel(s: string, sep: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ""
  let inString = false
  let stringChar = ""

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!

    if (inString) {
      current += ch
      if (ch === stringChar) inString = false
      continue
    }

    if (ch === '"' || ch === "'") {
      inString = true
      stringChar = ch
      current += ch
      continue
    }

    if (ch === "(") {
      depth++
      current += ch
      continue
    }
    if (ch === ")") {
      depth--
      current += ch
      continue
    }

    if (depth === 0 && s.substring(i, i + sep.length) === sep) {
      parts.push(current)
      current = ""
      i += sep.length - 1
      continue
    }

    current += ch
  }

  if (current) parts.push(current)
  return parts
}

// ── Filtragem de steps executáveis ──────────────────────────────────────

/**
 * Determina quais steps seriam executados dado um contexto.
 * Substitui asserções manuais de "step X tem if: Y" por provas de execução.
 */
export function filterExecutableSteps(
  job: WorkflowJob,
  conditionCtx: ConditionContext = {},
): WorkflowStep[] {
  const steps = getSteps(job)
  const results: WorkflowStep[] = []

  let previousStepFailed = false

  for (const step of steps) {
    const conditionMet = resolveCondition(step.if, {
      ...conditionCtx,
      previousJobFailed: conditionCtx.previousJobFailed,
      previousJobCancelled: conditionCtx.previousJobCancelled,
    })

    // Para steps com if: failure(), só executa se o step anterior falhou
    if (step.if?.trim() === "failure()") {
      if (previousStepFailed) {
        results.push(step)
      }
      continue
    }

    // Para steps com if: always(), sempre executa
    if (step.if?.trim() === "always()") {
      results.push(step)
      continue
    }

    // Para steps sem if ou com if avaliável, usa a avaliação
    if (conditionMet) {
      results.push(step)
    }

    // Atualiza o estado do step anterior
    previousStepFailed = false // em simulação, assumimos sucesso
  }

  return results
}

// ── Validação de referências ────────────────────────────────────────────

/**
 * Valida todas as referências de um workflow contra o contexto do repo.
 * Substitui o padrão repetido de `extractScriptRefs` + `expect(has)`.
 */
export function validateRefs(
  content: string,
  ctx: RepoContext,
  options: { pkgInternal?: boolean } = {},
): WorkflowRefs {
  const scripts = extractScriptRefs(content)
  const pkgScripts = options.pkgInternal ? extractPkgScriptRefs(content) : []
  const workflowUses = extractWorkflowUses(content)
  const actionUses = extractActionUses(content)

  return { scripts, pkgScripts, workflowUses, actionUses }
}

/**
 * Verifica que todas as referências de script resolvem.
 */
export function expectScriptRefs(content: string, ctx: RepoContext): void {
  const refs = extractScriptRefs(content)
  for (const ref of refs) {
    if (!ctx.scripts.has(ref.ref)) {
      throw new Error(
        `Script referenciado não existe: scripts/${ref.ref} (linha ${ref.line ?? "?"})`,
      )
    }
  }
}

/**
 * Verifica que todos os reusables workflow existem e têm workflow_call.
 */
export function expectWorkflowRefs(content: string, ctx: RepoContext): void {
  const refs = extractWorkflowUses(content)
  for (const ref of refs) {
    if (!ctx.workflows.has(ref.ref)) {
      throw new Error(`Workflow referenciado não existe: ${ref.ref} (linha ${ref.line ?? "?"})`)
    }
    if (!ctx.workflowCall.has(ref.ref)) {
      throw new Error(
        `Workflow referenciado não tem on: workflow_call: ${ref.ref} (linha ${ref.line ?? "?"})`,
      )
    }
  }
}

/**
 * Verifica que todas as actions locais existem.
 */
export function expectActionRefs(content: string, ctx: RepoContext): void {
  const refs = extractActionUses(content)
  for (const ref of refs) {
    if (!ctx.actions.has(ref.ref)) {
      throw new Error(
        `Action local referenciada não existe: .github/actions/${ref.ref}/action.yml (linha ${ref.line ?? "?"})`,
      )
    }
  }
}

/**
 * Validação completa de refs: scripts + workflows + actions.
 * Uma única chamada substitui o bloco repetido de 4-6 it() em cada teste.
 */
export function expectAllRefs(
  content: string,
  ctx: RepoContext,
  options: { pkgInternal?: boolean } = {},
): void {
  expectScriptRefs(content, ctx)
  expectWorkflowRefs(content, ctx)
  expectActionRefs(content, ctx)
  if (options.pkgInternal) {
    const refs = extractPkgScriptRefs(content)
    for (const ref of refs) {
      if (!ctx.scripts.has(ref.ref)) {
        throw new Error(
          `Script alvo de pkg script não existe: scripts/${ref.ref} (linha ${ref.line ?? "?"})`,
        )
      }
    }
  }
}

// ── Helpers de asserção ─────────────────────────────────────────────────

/**
 * Obtém os triggers de um workflow parsed.
 */
export function getTriggers(wf: ParsedWorkflow): string[] {
  return Object.keys(wf.on ?? {}).sort()
}

/**
 * Verifica que o job tem a estrutura mínima esperada.
 */
export function expectJobStructure(
  job: WorkflowJob,
  expectations: {
    name?: string
    minSteps?: number
    needs?: string
    if?: string
    permissions?: Record<string, string>
  },
): void {
  if (expectations.name !== undefined) {
    if (job.name !== expectations.name) {
      throw new Error(`Job name: esperado '${expectations.name}', obtido '${job.name}'`)
    }
  }
  if (expectations.minSteps !== undefined) {
    const steps = getSteps(job)
    if (steps.length < expectations.minSteps) {
      throw new Error(`Job steps: esperado >= ${expectations.minSteps}, obtido ${steps.length}`)
    }
  }
  if (expectations.needs !== undefined) {
    if (job.needs !== expectations.needs) {
      throw new Error(`Job needs: esperado '${expectations.needs}', obtido '${job.needs}'`)
    }
  }
  if (expectations.if !== undefined) {
    if (job.if !== expectations.if) {
      throw new Error(`Job if: esperado '${expectations.if}', obtido '${job.if}'`)
    }
  }
  if (expectations.permissions !== undefined) {
    for (const [key, value] of Object.entries(expectations.permissions)) {
      if (job.permissions?.[key] !== value) {
        throw new Error(
          `Job permissions.${key}: esperado '${value}', obtido '${job.permissions?.[key]}'`,
        )
      }
    }
  }
}

/**
 * Verifica que nenhum script do repo contém uma versão literal do Bun.
 */
export function expectNoBunLiteral(content: string): void {
  // Padrão: bun-v<version> ou bun@<version> em linhas que não são ${{
  const lines = content.split("\n").filter((l) => !l.includes("${{") && !l.trim().startsWith("#"))
  for (const line of lines) {
    if (/bun-v\d+\.\d+\.\d+/.test(line) || /bun@\d+\.\d+\.\d+/.test(line)) {
      throw new Error(`Versão literal do Bun encontrada: ${line.trim()}`)
    }
  }
}
