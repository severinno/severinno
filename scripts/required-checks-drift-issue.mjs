#!/usr/bin/env node

// =============================================================================
// required-checks-drift-issue.mjs
//
// Transforma o drift do branch protection (detectado por
// `apply-required-checks.mjs --check`) em uma ISSUE ACIONÁVEL. O precedente
// deste repo (readme-reverse-issue.mjs) vale aqui pelo mesmo motivo: "o job
// semanal falhou" é um alerta MUDO — ninguém abre o log de um cron vermelho.
//
// POR QUE DRIFT IMPORTA: os gates existem como jobs, mas quem BLOQUEIA o merge
// é o branch protection, que é estado da forja e não aparece em review. Se
// alguém renomear o `name:` de um job (o contexto de status muda junto), o
// check exigido passa a ser um que NUNCA roda — e o PR trava esperando para
// sempre, com diagnóstico opaco. O `--check` detecta isso; esta issue diz o que
// fazer.
//
// Fluxo:
//   1. lê um relatório de drift — de arquivo (--report) ou gerando agora
//      (spawna `apply-required-checks.mjs --check --json`);
//   2. se não há drift nem erro, sai 0 silenciosamente;
//   3. calcula uma ASSINATURA estável do drift (por forja+branch+itens) e
//      deduplica: se uma issue aberta com o label já carrega esse marcador,
//      não comenta de novo (cron semanal não deve virar ruído);
//   4. caso contrário, cria a issue (ou comenta numa aberta) com a tabela do
//      drift e o comando de correção.
//
// Usage:
//   node scripts/required-checks-drift-issue.mjs --report /tmp/drift.json
//   node scripts/required-checks-drift-issue.mjs --forge github
//   node scripts/required-checks-drift-issue.mjs --report /tmp/drift.json --dry-run
//
// Exit codes:
//   0 — sem drift, ou issue criada/comentada, ou já reportada (ou dry-run)
//   1 — erro real: relatório ausente/inválido, ou falha do `gh`, ou o próprio
//       `--check` falhou por infra (token sem permissão) — um drift que não
//       pode ser medido é tão grave quanto o drift
// =============================================================================

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

/** Label de triagem das issues de drift (dedup + filtro no board). */
export const ISSUE_LABEL = "required-checks-drift"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const APPLIER_PATH = resolve(REPO_ROOT, "scripts", "apply-required-checks.mjs")

// ---------------------------------------------------------------------------
// Funções puras (exportadas para teste unitário — sem rede, sem gh)
// ---------------------------------------------------------------------------

/** Título ESTÁVEL entre runs — não inclui branch nem itens (isso vai no corpo). */
export function driftTitle() {
  return "Required checks drift: branch protection ≠ ci/required-checks.json"
}

/**
 * Assinatura estável do drift: só o que importa (forja, branch, itens faltando
 * e sobrando), ordenado. Sem timestamp e sem a ordem de retorno da API — duas
 * runs com o MESMO drift precisam produzir a MESMA assinatura, senão o dedup
 * não funciona e a issue vira ruído semanal.
 */
export function signatureOf(report) {
  const parts = []
  for (const forge of Object.keys(report?.forges ?? {}).sort()) {
    for (const branch of report.forges[forge]?.branches ?? []) {
      if (branch.inSync) continue
      const missing = [...(branch.missing ?? [])].sort().join(" | ")
      const extra = [...(branch.extra ?? [])].sort().join(" | ")
      parts.push(`${forge}:${branch.branch}:-[${missing}]:+[${extra}]`)
    }
  }
  for (const error of report?.errors ?? []) parts.push(`error:${error.forge}:${error.message}`)
  return parts.join("\n")
}

/** Marcador HTML invisível que carrega a assinatura dentro do corpo da issue. */
export function markerOf(signature) {
  // A assinatura pode ter quebras de linha; o marcador é uma linha só.
  return `<!-- required-checks-drift:${Buffer.from(signature).toString("base64")} -->`
}

/** `true` se `body` já carrega o marcador desta assinatura. */
export function hasSignature(body, signature) {
  return typeof body === "string" && body.includes(markerOf(signature))
}

/**
 * Corpo da issue em markdown: o que divergiu, por forja/branch, e o comando
 * que resolve. Sem isso a issue só diz "tem drift" e transfere o trabalho de
 * investigação para quem lê.
 */
export function driftBody(report) {
  const lines = []
  lines.push("O branch protection não corresponde a `ci/required-checks.json`.")
  lines.push("")
  lines.push(
    "Os gates rodam como jobs, mas quem **bloqueia o merge** é a lista de required" +
      " status checks — estado da forja, fora do review. Um contexto renomeado (o" +
      " `name:` de um job muda o contexto) ou removido deixa o PR esperando para" +
      " sempre por um check que nunca vai rodar.",
  )
  lines.push("")

  for (const [forge, data] of Object.entries(report?.forges ?? {})) {
    lines.push(`### ${forge} — \`${data.workflow ?? "-"}\``)
    lines.push("")
    for (const branch of data.branches ?? []) {
      if (branch.inSync) {
        lines.push(`- \`${branch.branch}\`: em sincronia`)
        continue
      }
      lines.push(`- \`${branch.branch}\`${branch.configured ? "" : " (sem proteção configurada)"}:`)
      for (const item of branch.missing ?? []) lines.push(`  - ➕ falta exigir: \`${item}\``)
      for (const item of branch.extra ?? []) lines.push(`  - ➖ exige a mais: \`${item}\``)
    }
    lines.push("")
  }

  if ((report?.errors ?? []).length > 0) {
    lines.push("### Erros de verificação")
    lines.push("")
    for (const error of report.errors) lines.push(`- \`${error.forge}\`: ${error.message}`)
    lines.push("")
    lines.push(
      "> Um drift que **não pôde ser medido** é tão grave quanto o drift: a" +
        " proteção pode estar furada e ninguém sabe. Corrija o token antes de" +
        " fechar esta issue.",
    )
    lines.push("")
  }

  lines.push("### Corrigir")
  lines.push("")
  lines.push("```bash")
  lines.push("bun run check:required-checks        # o manifesto ainda aponta para jobs reais?")
  lines.push("bun run ci:required-checks -- --check   # reexibe este drift")
  lines.push("bun run ci:required-checks -- --apply   # aplica o manifesto na forja")
  lines.push("```")
  lines.push("")
  lines.push(
    "Se a causa foi um **rename de job**, prefira atualizar o manifesto/workflow a" +
      " aplicar: exigir um contexto que não existe é pior que não exigir nada.",
  )
  lines.push("")
  lines.push(markerOf(signatureOf(report)))
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// gh CLI
// ---------------------------------------------------------------------------

function gh(args, { input } = {}) {
  return spawnSync("gh", args, { encoding: "utf8", input, env: process.env })
}

function openIssuesWithLabel() {
  const res = gh([
    "issue",
    "list",
    "--label",
    ISSUE_LABEL,
    "--state",
    "open",
    "--limit",
    "100",
    "--json",
    "number,title,body",
  ])
  if (res.status !== 0) {
    throw new Error(
      `gh issue list falhou (exit ${res.status}): ${(res.stderr ?? "").slice(0, 400)}`,
    )
  }
  return JSON.parse(res.stdout || "[]")
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { report: null, forge: "all", dryRun: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--report") options.report = argv[++i]
    else if (arg === "--forge") options.forge = argv[++i]
    else if (arg === "--dry-run") options.dryRun = true
    else if (arg === "--help" || arg === "-h") options.help = true
    else throw new Error(`Argumento desconhecido: ${arg}`)
  }
  return options
}

function loadReport(options) {
  if (options.report) {
    if (!existsSync(options.report))
      throw new Error(`--report: arquivo não existe: ${options.report}`)
    return JSON.parse(readFileSync(options.report, "utf8"))
  }

  const res = spawnSync(
    process.execPath,
    [APPLIER_PATH, "--check", "--json", "--forge", options.forge],
    { encoding: "utf8", env: process.env },
  )
  // Exit 1 é ESPERADO quando há drift — o JSON vem no stdout de qualquer forma.
  const stdout = (res.stdout ?? "").trim()
  if (!stdout) {
    throw new Error(
      `\`apply-required-checks.mjs --check --json\` não produziu relatório` +
        ` (exit ${res.status}): ${(res.stderr ?? "").slice(0, 400)}`,
    )
  }
  return JSON.parse(stdout)
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(
      "Uso: node scripts/required-checks-drift-issue.mjs [--report FILE] [--forge all|github|gitea] [--dry-run]",
    )
    return 0
  }

  const report = loadReport(options)
  const signature = signatureOf(report)

  if (signature === "") {
    console.log("✅ Sem drift: o branch protection corresponde ao manifesto.")
    return 0
  }

  console.log("⚠️  Drift detectado — publicando issue acionável.")
  if (options.dryRun) {
    console.log(driftBody(report))
    console.log("\n(dry-run: nenhuma chamada ao gh)")
    return 0
  }

  // `--force` torna a criação do label idempotente (não falha se já existir).
  gh([
    "label",
    "create",
    ISSUE_LABEL,
    "--force",
    "--color",
    "BFD4F2",
    "--description",
    "Branch protection divergente de ci/required-checks.json",
  ])

  const existing = openIssuesWithLabel()
  const alreadyReported = existing.find((issue) => hasSignature(issue.body, signature))
  if (alreadyReported) {
    console.log(`ℹ️  Drift idêntico já reportado na issue #${alreadyReported.number} — sem ruído.`)
    return 0
  }

  const title = driftTitle()
  const body = driftBody(report)
  const openWithTitle = existing.find((issue) => issue.title === title)

  if (openWithTitle) {
    const res = gh(["issue", "comment", String(openWithTitle.number), "--body", body])
    if (res.status !== 0) {
      throw new Error(`gh issue comment falhou: ${(res.stderr ?? "").slice(0, 400)}`)
    }
    console.log(`✅ Comentário adicionado à issue #${openWithTitle.number} (drift novo).`)
    return 0
  }

  const res = gh(["issue", "create", "--title", title, "--body", body, "--label", ISSUE_LABEL])
  if (res.status !== 0) {
    throw new Error(`gh issue create falhou: ${(res.stderr ?? "").slice(0, 400)}`)
  }
  console.log(`✅ Issue criada: ${(res.stdout ?? "").trim()}`)
  return 0
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) {
  try {
    process.exit(main())
  } catch (error) {
    console.error(`❌ ${error.message}`)
    process.exit(1)
  }
}
