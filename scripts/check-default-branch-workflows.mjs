#!/usr/bin/env node

// =============================================================================
// check-default-branch-workflows.mjs
//
// Guard que valida que os workflows de MEDIÇÃO de CI (ex.: seed-guards.yml
// — a fonte do tempo real do step 'Run mutation test' que o job semanal
// mutation-coord-timing mede) EXISTEM na branch DEFAULT do repositório.
//
// MOTIVAÇÃO (o falso estado 'pendente de medição'):
//   O gh run list --workflow=seed-guards.yml responde 'HTTP 404: workflow
//   seed-guards.yml not found on the default branch' quando o workflow NÃO
//   foi mergeado — e isso PARECE 'nada para medir', deixando a célula
//   '~35-45s (est.)' da tabela de overhead do README 'pendente' para
//   sempre. O bloqueio REAL não é falta de run: é o workflow de medição
//   não estar na branch default. Este guard torna essa causa raiz um
//   ERRO EXPLÍCITO (exit 1) em vez de um silêncio ambíguo.
//
// Modos:
//   --repo OWNER/REPO       repo para a chamada gh (default: GITHUB_REPOSITORY)
//   --workflow FILE         workflow a validar (REPETÍVEL; default:
//                           seed-guards.yml — os alvos de medição)
//   --default-branch BR     override da branch default (default: gh api
//                           repos/X → .default_branch — evita a chamada
//                           quando o caller já sabe a branch)
//   --fixture-dir DIR       modo de TESTE: lê respostas de arquivos em vez
//                           de spawnar o gh (mesma classe do --jobs-file do
//                           measure-mutation-timing.mjs)
//   --json OUT              salva o relatório JSON em OUT (além do stdout)
//   --warn-only             em vez de FALHAR (exit 1) quando um workflow
//                           estiver ausente, emite ::warning:: e sai exit 0
//                           (alerta não-bloqueante para dispatch manual)
//   -h, --help              mostra esta ajuda
//
// Usage:
//   node scripts/check-default-branch-workflows.mjs --repo owner/repo
//   node scripts/check-default-branch-workflows.mjs --repo owner/repo --workflow seed-guards.yml --workflow e2e-cache.yml
//   node scripts/check-default-branch-workflows.mjs --repo owner/repo --default-branch main
//   node scripts/check-default-branch-workflows.mjs --fixture-dir DIR [--default-branch main]
//
// Exit codes:
//   0 — TODOS os workflows de medição existem na branch default
//       (ou --warn-only com ausentes — relatório no stdout)
//   1 — pelo menos um workflow AUSENTE (GATE: a medição não pode rodar —
//       o bloqueio real é o MERGE do branch que contém o workflow)
//   2 — falha de INFRA (gh indisponível / API falhou — o MECANISMO de
//       verificação quebrou) OU uso inválido
//
// Relatório JSON (stdout / --json):
//   {
//     repo, defaultBranch,
//     workflows: [{ file, exists }],
//     missing: [...], allPresent: bool
//   }
// Em erro: { repo, error: '<mensagem>', infra: true }
//
// Job semanal (benchmark-weekly.yml — default-branch-workflow-guard):
//   node scripts/check-default-branch-workflows.mjs --repo <owner/repo> --json /tmp/default-branch-guard.json
// =============================================================================

import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

// ── Contrato de medição: workflows que DEVEM estar na default branch ────
// seed-guards.yml é o alvo da medição semanal (mutation-coord-timing mede o
// step 'Run mutation test' DENTRO dele). Se não estiver na default, a
// medição fica 'pendente' para sempre. Adicionar um alvo de medição novo =
// passar --workflow <arquivo> (os testes de workflow travam a invocação).
export const DEFAULT_MEASUREMENT_WORKFLOWS = ["seed-guards.yml"]

/**
 * Extrai a branch default do payload de `gh api repos/X`.
 *
 * @param {unknown} payload resposta bruta da API
 * @returns {string | null} a branch default, ou null se ausente/inválida
 */
export function extractDefaultBranch(payload) {
  return typeof payload?.default_branch === "string" && payload.default_branch.length > 0
    ? payload.default_branch
    : null
}

/**
 * Classifica o resultado de `gh api repos/X/contents/.github/workflows/<f>?ref=<b>`.
 *
 * ASSUNÇÃO do 404: o caller resolve a branch default PRIMEIRO (gh api
 * repos/X) — se o repo/branch fosse inacessível, essa chamada falharia
 * (infra, exit 2) antes do contents. Então um 404 AQUI significa
 * 'workflow ausente na branch', não 'repo/branch inválido'. Com
 * --default-branch override (sem a chamada repos/X), um 404 poderia ser
 * repo inexistente → tratado como 'ausente' (exit 1 + mensagem de MERGE)
 * — aceitável no CI (o token tem acesso ao repo do próprio run).
 *
 * @param {number | null} status exit code do gh (null = spawnSync.error)
 * @param {string} stderr saída de erro do gh
 * @returns {{ exists: boolean } | { error: string }}
 *   exists:true → 200 (workflow presente); exists:false → 404 (ausente);
 *   { error } → qualquer outro status (infra do mecanismo).
 */
export function classifyExistenceCheck(status, stderr) {
  if (status === 0) return { exists: true }
  if (status === null) return { error: "gh indisponível (spawn falhou)" }
  if (status === 1 && /404/i.test(stderr ?? "")) return { exists: false }
  return { error: `gh api falhou (exit ${status}): ${(stderr ?? "").trim().slice(0, 300)}` }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function usage() {
  process.stdout.write(
    [
      "Uso:",
      "  node scripts/check-default-branch-workflows.mjs [--repo owner/repo] [--workflow FILE]... [--default-branch BR] [--json OUT] [--warn-only]",
      "  node scripts/check-default-branch-workflows.mjs --fixture-dir DIR [--default-branch BR] [--json OUT]",
      "",
      "Exit codes:",
      "  0 — todos os workflows de medição existem na branch default (ou --warn-only com ausentes)",
      "  1 — pelo menos um workflow ausente na branch default (gate: mergeie o branch que o contém)",
      "  2 — falha de infra (gh indisponível / API falhou) ou uso inválido",
    ].join("\n") + "\n",
  )
}

function parseArgs(argv) {
  const out = {
    repo: process.env.GITHUB_REPOSITORY ?? null,
    workflows: [],
    defaultBranch: null,
    fixtureDir: null,
    json: null,
    warnOnly: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--repo": {
        const v = argv[++i]
        if (v === undefined || !v.includes("/"))
          return { ...out, error: `--repo deve ser owner/repo (obtido: '${v}')` }
        out.repo = v
        break
      }
      case "--workflow": {
        const v = argv[++i]
        if (v === undefined || !v.endsWith(".yml"))
          return { ...out, error: `--workflow deve ser um arquivo .yml (obtido: '${v}')` }
        out.workflows.push(v)
        break
      }
      case "--default-branch": {
        const v = argv[++i]
        if (v === undefined || v.length === 0)
          return { ...out, error: "--default-branch exige um valor" }
        out.defaultBranch = v
        break
      }
      case "--fixture-dir": {
        const v = argv[++i]
        if (v === undefined) return { ...out, error: "--fixture-dir exige um diretório" }
        out.fixtureDir = v
        break
      }
      case "--json": {
        const v = argv[++i]
        if (v === undefined) return { ...out, error: "--json exige um caminho" }
        out.json = v
        break
      }
      case "--warn-only":
        out.warnOnly = true
        break
      case "-h":
      case "--help":
        out.help = true
        break
      default:
        return { ...out, error: `argumento desconhecido: ${argv[i]}` }
    }
  }
  if (out.help) return out
  // Sem --repo (ou GITHUB_REPOSITORY) E sem --fixture-dir, o script não tem
  // como saber o que verificar — exigir um dos dois evita spawnar gh contra
  // um repo inválido ('unknown/unknown') em runtime de teste.
  if (!out.repo && !out.fixtureDir)
    return { ...out, error: "exija --repo (ou GITHUB_REPOSITORY env) OU --fixture-dir" }
  if (out.workflows.length === 0) out.workflows = [...DEFAULT_MEASUREMENT_WORKFLOWS]
  return out
}

/** Busca a branch default via gh (GH_TOKEN do env — usado pelo Actions). */
function fetchDefaultBranchViaGh(repo) {
  const res = spawnSync("gh", ["api", `repos/${repo}`, "--jq", ".default_branch"], {
    encoding: "utf8",
    timeout: 60_000,
  })
  if (res.error) return { error: `gh indisponível: ${res.error.message}` }
  if (res.status !== 0)
    return {
      error: `gh api repos falhou (exit ${res.status}): ${(res.stderr ?? "").trim().slice(0, 300)}`,
    }
  const branch = res.stdout.trim()
  if (!branch) return { error: "gh api repos devolveu default_branch vazio" }
  return { branch }
}

/** Verifica a existência de um workflow na branch via gh. */
function checkWorkflowViaGh(repo, branch, file) {
  const res = spawnSync(
    "gh",
    ["api", `repos/${repo}/contents/.github/workflows/${file}?ref=${branch}`, "--jq", ".path"],
    { encoding: "utf8", timeout: 60_000 },
  )
  return classifyExistenceCheck(res.error ? null : res.status, res.stderr ?? "")
}

/** Modo fixture: lê default-branch.txt + <workflow>.json do diretório. */
function readFixture(fixtureDir, defaultBranch, workflows) {
  const result = { branch: defaultBranch, perFile: new Map() }
  if (!result.branch) {
    try {
      result.branch = readFileSync(`${fixtureDir}/default-branch.txt`, "utf8").trim()
    } catch (e) {
      return { error: `fixture 'default-branch.txt' ilegível: ${e.message}` }
    }
    if (!result.branch) return { error: "fixture 'default-branch.txt' está vazio" }
  }
  for (const file of workflows) {
    try {
      const raw = readFileSync(`${fixtureDir}/${file}.json`, "utf8")
      const parsed = JSON.parse(raw)
      if (typeof parsed?.exists !== "boolean")
        return { error: `fixture '${file}.json' deve ter { exists: bool }` }
      result.perFile.set(file, { exists: parsed.exists })
    } catch (e) {
      return { error: `fixture '${file}.json' ilegível: ${e.message}` }
    }
  }
  return result
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    usage()
    process.exit(0)
  }
  if (args.error) {
    process.stderr.write(`erro: ${args.error}\n`)
    usage()
    process.exit(2)
  }

  const repo = args.repo ?? "unknown/unknown"

  // ── Resolve a branch default (fixture | override | gh) ──────────────
  let branch = args.defaultBranch
  let perFile = null
  let infraError = null

  if (args.fixtureDir) {
    const fx = readFixture(args.fixtureDir, args.defaultBranch, args.workflows)
    if (fx.error) infraError = fx.error
    else {
      branch = fx.branch
      perFile = fx.perFile
    }
  } else {
    if (!branch) {
      const r = fetchDefaultBranchViaGh(repo)
      if (r.error) infraError = r.error
      else branch = r.branch
    }
  }

  if (infraError) {
    const report = { repo, error: infraError, infra: true }
    emit(report, args.json)
    process.stderr.write(`erro (infra): ${infraError}\n`)
    process.exit(2)
  }

  // ── Verifica cada workflow de medição ───────────────────────────────
  const workflows = []
  for (const file of args.workflows) {
    let check
    if (args.fixtureDir) check = perFile.get(file) ?? { exists: false }
    else check = checkWorkflowViaGh(repo, branch, file)
    if (check.error) {
      const report = { repo, error: check.error, infra: true }
      emit(report, args.json)
      process.stderr.write(`erro (infra): ${check.error}\n`)
      process.exit(2)
    }
    workflows.push({ file, exists: check.exists })
  }

  const missing = workflows.filter((w) => !w.exists).map((w) => w.file)
  const allPresent = missing.length === 0
  const report = {
    repo,
    defaultBranch: branch,
    workflows,
    missing,
    allPresent,
  }

  if (!allPresent) {
    const msg =
      `workflow(s) de medição AUSENTE(s) na branch default '${branch}': ` +
      `${missing.join(", ")} — o bloqueio real da medição é o MERGE do branch ` +
      `que contém o workflow, não a falta de run. Mergeie antes de medir ` +
      `(gh run list responde '404: workflow not found on the default branch').`
    if (args.warnOnly) {
      process.stdout.write(`::warning::${msg}\n`)
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
      emit(report, args.json)
      process.exit(0)
    }
    process.stdout.write(`::error::${msg}\n`)
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    emit(report, args.json)
    process.exit(1)
  }

  emit(report, args.json)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exit(0)
}

function emit(report, jsonPath) {
  const json = JSON.stringify(report, null, 2)
  if (jsonPath) {
    try {
      writeFileSync(jsonPath, json)
    } catch (e) {
      process.stderr.write(`aviso: não foi possível salvar --json '${jsonPath}': ${e.message}\n`)
    }
  }
}

// Guard de entry-point ESM: funções puras (extractDefaultBranch,
// classifyExistenceCheck) são importadas pelos testes — main() só roda quando
// o script é executado DIRETAMENTE (node scripts/...), nunca no import.
const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isEntryPoint) {
  main()
}
