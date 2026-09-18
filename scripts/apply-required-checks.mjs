#!/usr/bin/env node

// =============================================================================
// apply-required-checks.mjs
//
// Aplica `ci/required-checks.json` no branch protection de cada forja, para que
// o merge em `main` exija os checks declarados.
//
// Por que existe: sem isto, o gate de PII (e os demais) são "bloqueantes" só na
// intenção — o job roda, mas nada impede o merge com ele vermelho. A exigência
// do check mora no branch protection, que é estado da forja e ninguém revisa em
// PR. Declarar em arquivo + aplicar por script torna isso auditável e idempotente.
//
// NA FORJA (Gitea), REGISTRAR O CONTEXTO NÃO BASTA: `status_check_contexts`
// guarda a LISTA exigida, e `enable_status_check` é quem a transforma em
// bloqueio. Sem o booleano — que o default da API é `false` — a proteção fica
// com os contextos anotados e o merge passa com o gate vermelho. Foi medido
// contra um Gitea 1.22 real: com os contextos e `enable_status_check=false`, um
// PR com `Repo Guards=failure` mergeia (HTTP 200); com `true`, o merge é
// recusado com `not allowed to merge [reason: Not all required status checks
// successful]`. Por isso o applier ENVIA o booleano e o trata como parte do
// drift — é a diferença entre "bloqueante na intenção" e bloqueante.
//
// A DECLARAÇÃO DA REAPLICAÇÃO: `--apply` também escreve
// `ci/required-checks-applied.json` com os contextos que a forja passou a exigir.
// Sem essa declaração, a proteção (que é quem bloqueia o merge) fica FORA do
// repositório: um `name:` renomeado muda o contexto exigido e ninguém consegue
// distinguir "reaplicado" de "esquecido" — que é exatamente o estado em que a
// forja exige um check que já não existe. Quem cobra a declaração no PR é o
// `check-required-checks.mjs` (a outra metade do mesmo fato). O arquivo só é
// reescrito quando o CONTEXTO muda (o carimbo de data sozinho não gera churn).
//
// SEGURANÇA: o padrão é DRY-RUN (nenhuma requisição de escrita). Só `--apply`
// altera a forja, e mesmo então toca APENAS a lista de required status checks —
// não sobrescreve reviews obrigatórios, restrições de push ou outros ajustes de
// proteção que o repositório já tenha.
//
// Usage:
//   node scripts/apply-required-checks.mjs                  # planeja (offline)
//   node scripts/apply-required-checks.mjs --check           # lê a forja, reporta drift
//   node scripts/apply-required-checks.mjs --apply           # aplica
//   node scripts/apply-required-checks.mjs --forge github --apply
//
// Credenciais (por forja, lidas do ambiente — nunca do arquivo):
//   github: GITHUB_TOKEN | GH_TOKEN   + GITHUB_API_URL (default api.github.com)
//           repo: --repo owner/name   | GITHUB_REPOSITORY
//   gitea:  GITEA_TOKEN               + GITEA_URL (obrigatório)
//           repo: --repo owner/name   | GITEA_REPOSITORY
//
// Exit codes:
//   0 — aplicado / sem drift / plano impresso
//   1 — drift encontrado em --check, ou erro de configuração/rede
// =============================================================================

import { dirname, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import {
  APPLIED_PATH,
  MANIFEST_PATH,
  defaultIo,
  loadManifest,
  resolveManifestContexts,
  writeAppliedRecord,
} from "./check-required-checks.mjs"

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { apply: false, check: false, json: false, forge: "all", repo: null, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--apply") options.apply = true
    else if (arg === "--check") options.check = true
    else if (arg === "--json") options.json = true
    else if (arg === "--forge") options.forge = argv[++i]
    else if (arg === "--repo") options.repo = argv[++i]
    else if (arg === "--help" || arg === "-h") options.help = true
    else throw new Error(`Argumento desconhecido: ${arg}`)
  }
  if (options.apply && options.check) throw new Error("--apply e --check são mutuamente exclusivos")
  if (!["all", "github", "gitea"].includes(options.forge)) {
    throw new Error(`--forge deve ser all|github|gitea (recebido: ${options.forge})`)
  }
  return options
}

const USAGE = `
Aplica ci/required-checks.json no branch protection de cada forja.

  --forge <all|github|gitea>   forja alvo (default: all)
  --repo <owner/name>          repositório (default: env da forja)
  --check                      lê a forja e reporta drift (exit 1 se houver)
  --apply                      aplica as mudanças (default: dry-run) e escreve
                               ${APPLIED_PATH} (a DECLARAÇÃO da reaplicação —
                               commite junto da mudança)
  --json                       relatório JSON no stdout (humano vai p/ stderr)
  -h, --help                   esta ajuda
`.trim()

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

function githubConfig(options) {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
  const repo = options.repo ?? process.env.GITHUB_REPOSITORY
  const baseUrl = process.env.GITHUB_API_URL ?? "https://api.github.com"
  if (!token) throw new Error("GitHub: defina GITHUB_TOKEN (ou GH_TOKEN) no ambiente")
  if (!repo) throw new Error("GitHub: defina --repo owner/name ou GITHUB_REPOSITORY")
  return { token, repo, baseUrl }
}

async function githubRequest({ token, baseUrl }, method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (method === "GET" && response.status === 404) return { status: 404, data: null }
  if (!response.ok) {
    const hint =
      response.status === 403
        ? " — o token precisa de permissão de ADMINISTRAÇÃO no repo para ler o" +
          " branch protection (PAT clássico com scope `repo`, ou fine-grained com" +
          " 'Administration: read'). O GITHUB_TOKEN padrão NÃO tem esse escopo."
        : ""
    throw new Error(
      `GitHub ${method} ${path} → HTTP ${response.status}: ` +
        `${(await response.text()).slice(0, 300)}${hint}`,
    )
  }
  return { status: response.status, data: response.status === 204 ? null : await response.json() }
}

/**
 * Compara (e opcionalmente aplica) os required checks no GitHub.
 *
 * @returns {Promise<{ drift: boolean, branches: object[] }>}  relatório por branch
 *   — a MESMA estrutura vai para o `--json`, então o alerta agendado não
 *   reimplementa a comparação.
 */
async function planGithub({ config, branches, contexts, options, log }) {
  let drift = false
  const report = []

  for (const branch of branches) {
    const path = `/repos/${config.repo}/branches/${branch}/protection/required_status_checks`
    if (!options.check && !options.apply) {
      log(`github  ${branch}: exigiria ${contexts.length} check(s) [dry-run, sem rede]`)
      for (const c of contexts) log(`          • ${c}`)
      continue
    }

    const current = await githubRequest(config, "GET", path)
    const existing = current.data?.contexts ?? null
    const missing = contexts.filter((c) => !(existing ?? []).includes(c))
    const extra = existing === null ? [] : existing.filter((c) => !contexts.includes(c))

    if (missing.length === 0 && extra.length === 0) {
      log(`github  ${branch}: já em sincronia (${contexts.length} checks)`)
      report.push({ branch, configured: false, inSync: true, missing, extra, applied: false })
      continue
    }

    drift = true
    log(`github  ${branch}: drift detectado`)
    if (existing === null) log(`          (nenhum required check configurado hoje)`)
    for (const c of missing) log(`          + ${c}`)
    for (const c of extra) log(`          - ${c}`)

    let applied = false
    if (!options.apply) {
      log(`          (dry-run — use --apply para escrever)`)
    } else {
      await githubRequest(config, "PATCH", path, {
        // Preserva `strict` se já configurado; default estrito.
        strict: current.data?.strict ?? true,
        contexts,
      })
      applied = true
      log(`          → aplicado`)
    }

    report.push({
      branch,
      configured: existing !== null,
      inSync: false,
      missing,
      extra,
      applied,
    })
  }

  return { drift, branches: report }
}

// ---------------------------------------------------------------------------
// Gitea
// ---------------------------------------------------------------------------

function giteaConfig(options) {
  const token = process.env.GITEA_TOKEN
  const repo = options.repo ?? process.env.GITEA_REPOSITORY
  const baseUrl = process.env.GITEA_URL?.replace(/\/$/, "")
  if (!token) throw new Error("Gitea: defina GITEA_TOKEN no ambiente")
  if (!repo) throw new Error("Gitea: defina --repo owner/name ou GITEA_REPOSITORY")
  if (!baseUrl) throw new Error("Gitea: defina GITEA_URL (ex.: https://gitea.exemplo.com)")
  return { token, repo, baseUrl }
}

async function giteaRequest({ token, baseUrl }, method, path, body) {
  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `Gitea ${method} ${path} → HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`,
    )
  }
  return { status: response.status, data: response.status === 204 ? null : await response.json() }
}

/**
 * Compara (e opcionalmente aplica) os required checks no Gitea.
 *
 * Três coisas contam como drift, e a terceira é a que mais parece verde:
 *   1. contexto exigido que FALTA na proteção (o PR trava esperando um check que
 *      nunca vai chegar — ou pior, o job roda e não bloqueia nada);
 *   2. contexto a MAIS (régua velha: exige um check que o workflow já não tem,
 *      e o PR fica travado para sempre);
 *   3. `enable_status_check` DESLIGADO — os contextos estão anotados e nada
 *      bloqueia. É o estado que a API devolve por default e o modo silencioso
 *      que este applier existe para fechar.
 *
 * @returns {Promise<{ drift: boolean, branches: object[] }>}  relatório por branch
 */
async function planGitea({ config, branches, contexts, options, log }) {
  let drift = false
  const report = []
  const protections = await giteaRequest(config, "GET", `/repos/${config.repo}/branch_protections`)
  const list = Array.isArray(protections.data) ? protections.data : []

  for (const branch of branches) {
    const existing = list.find((p) => p.branch_name === branch) ?? null
    const currentContexts = existing?.status_check_contexts ?? null
    const missing = contexts.filter((c) => !(currentContexts ?? []).includes(c))
    const extra = (currentContexts ?? []).filter((c) => !contexts.includes(c))
    /** A exigência efetiva: `true` só quando a forja diz `true`. */
    const enforced = existing?.enable_status_check === true

    if (existing && enforced && missing.length === 0 && extra.length === 0) {
      log(`gitea   ${branch}: já em sincronia (${contexts.length} checks exigidos)`)
      report.push({
        branch,
        configured: true,
        inSync: true,
        enforceStatusChecks: true,
        missing,
        extra,
        applied: false,
      })
      continue
    }

    drift = true
    log(`gitea   ${branch}: ${existing ? "drift detectado" : "sem proteção de branch"}`)
    if (existing && !enforced) {
      log(
        `          ! enable_status_check=false — os contextos estão registrados e NÃO bloqueiam:` +
          ` o merge passa com o gate vermelho (medido contra Gitea 1.22)`,
      )
    }
    for (const c of missing) log(`          + ${c}`)
    for (const c of extra) log(`          - ${c}`)

    let applied = false
    if (!options.apply) {
      log(`          (dry-run — use --apply para escrever)`)
    } else if (existing) {
      await giteaRequest(config, "PATCH", `/repos/${config.repo}/branch_protections/${branch}`, {
        status_check_contexts: contexts,
        enable_status_check: true,
      })
      applied = true
      log(`          → aplicado (contextos + enable_status_check)`)
    } else {
      await giteaRequest(config, "POST", `/repos/${config.repo}/branch_protections`, {
        branch_name: branch,
        status_check_contexts: contexts,
        enable_status_check: true,
      })
      applied = true
      log(`          → aplicado (contextos + enable_status_check)`)
    }

    report.push({
      branch,
      configured: existing !== null,
      inSync: false,
      enforceStatusChecks: enforced,
      missing,
      extra,
      applied,
    })
  }

  return { drift, branches: report }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return 0
  }

  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  const manifest = loadManifest(root, defaultIo(root))
  const resolved = resolveManifestContexts(manifest, defaultIo(root))
  const mode = options.apply ? "APPLY" : options.check ? "CHECK" : "DRY-RUN"

  // Em --json o stdout é do RELATÓRIO — o texto humano vai para stderr, para
  // que `--json > report.json` continue dando um JSON parseável.
  const log = options.json ? (m) => console.error(m) : (m) => console.log(m)

  const report = {
    mode,
    manifest: MANIFEST_PATH,
    branches: manifest.branches ?? [],
    drift: false,
    forges: {},
    errors: [],
  }

  log(`═══ Required checks (${mode}) ═══`)
  log(
    options.apply
      ? "⚠️  Modo APPLY: a lista de required status checks de cada forja será sobrescrita."
      : options.check
        ? "ℹ️  Modo CHECK: lê a forja e reporta drift (não escreve)."
        : "ℹ️  Nada será escrito (dry-run). Use --apply para aplicar.",
  )

  // Em --check o objetivo é vigiar: qualquer divergência é falha.
  if (options.check) options.apply = false

  const targets = options.forge === "all" ? ["github", "gitea"] : [options.forge]

  // ── Dry-run (default): plano OFFLINE, sem credenciais e sem rede ────────
  if (!options.check && !options.apply) {
    for (const forge of targets) {
      const data = resolved[forge]
      if (!data) {
        log(`${forge}: ausente no manifesto — pulando`)
        continue
      }
      log(`${forge}  ${data.branches.join(", ")}: exigiria ${data.contexts.length} check(s)`)
      for (const { jobId, context } of data.contexts) log(`          • ${context}   (job ${jobId})`)
      report.forges[forge] = {
        workflow: data.workflow,
        desired: data.contexts.map((c) => c.context),
        branches: [],
      }
    }
    if (options.json) console.log(JSON.stringify(report, null, 2))
    return 0
  }

  for (const forge of targets) {
    const data = resolved[forge]
    if (!data) {
      log(`${forge}: ausente no manifesto — pulando`)
      continue
    }
    const contexts = data.contexts.map((c) => c.context)

    try {
      const result =
        forge === "github"
          ? await planGithub({
              config: githubConfig(options),
              branches: data.branches,
              contexts,
              options,
              log,
            })
          : await planGitea({
              config: giteaConfig(options),
              branches: data.branches,
              contexts,
              options,
              log,
            })
      report.forges[forge] = {
        workflow: data.workflow,
        desired: contexts,
        branches: result.branches,
      }
      report.drift = report.drift || result.drift
    } catch (error) {
      log(`❌ ${error.message}`)
      report.errors.push({ forge, message: error.message })
      if (options.json) console.log(JSON.stringify(report, null, 2))
      return 1
    }
  }

  // ── A DECLARAÇÃO da reaplicação ─────────────────────────────────────────
  // As forjas deste alvo foram LIDAS (e as que precisavam, aplicadas) contra o
  // manifesto: os contextos derivados são, comprovadamente, o que a forja exige
  // agora. É isso que o arquivo declara — e é o que o `check-required-checks`
  // compara no PR. Uma forja fora do alvo (`--forge gitea`) mantém a declaração
  // anterior: a proteção dela não foi tocada nem lida nesta rodada.
  if (options.apply) {
    const { escrito, path } = writeAppliedRecord(root, resolved, { forges: targets })
    log(
      escrito
        ? `📌 ${path}: declaração da reaplicação ATUALIZADA — commite junto da mudança que mexeu no contexto de status.`
        : `📌 ${path}: já declarava estes contextos (nada a commitar).`,
    )
    report.appliedRecord = { path, written: escrito }
  }

  if (options.check && report.drift) {
    log("❌ Drift: o branch protection não corresponde a ci/required-checks.json.")
    log("   Aplique com: node scripts/apply-required-checks.mjs --apply")
  }

  if (options.json) console.log(JSON.stringify(report, null, 2))
  return options.check && report.drift ? 1 : 0
}

let code = 1
try {
  code = await main()
} catch (error) {
  console.error(`❌ ${error.message}`)
  code = 1
}
process.exit(code)
