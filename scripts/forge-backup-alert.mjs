#!/usr/bin/env node
// forge-backup-alert.mjs — o ALERTA da falha de backup.
//
// Usage:
//   node scripts/forge-backup-alert.mjs                    # julga o dia de hoje
//   node scripts/forge-backup-alert.mjs --dia 2026-09-29   # julga um dia específico
//   node scripts/forge-backup-alert.mjs --backend gitea --repo owner/name
//   (o backend gitea lê GITEA_URL/GITEA_TOKEN/GITEA_REPOSITORY do ambiente)
//
// Exit codes:
//   0 — o alerta CUMPRIU o ciclo (publicou, comentou ou reconciliou — qualquer
//       que seja o fato medido; um backup falhado PUBLICADO é um alerta de pé)
//   1 — o alerta não conseguiu cumprir (backend de issues falhou, uso errado)
//
// O BACKUP sem alerta é a esperança de novo: um cron que morre na madrugada
// e ninguém vê até o dia do desastre é o defeito que o backup existia para
// cobrir. O gatilho é o MANIFEST do último run — o fato escrito por
// `forge-backup.sh` — e não uma re-execução do backup (o alerta mede o
// resultado do backup, não se re-medir a si mesmo).
//
// O CICLO (o mesmo do `issue-publish.mjs`, contrato de lifecycle do 1f9ac5ee):
//   · backup OK (ou ausente por desenho)  → FECHA as issues que este
//     publicador abriu (a dívida do backup resolvida, com a prova no comentário);
//   · backup FALHOU/ausente               → ABRE (ou comenta) UMA issue com o
//     marcador e a causa nomeada.
//
// O GATILHO, fail-closed por desenho:
//   exit 0  — o manifest do dia existe e diz "FIM OK"
//   exit 1  — causa nomeada:
//             · sem manifest do dia (o cron não rodou ou morreu cedo)
//             · manifest sem a linha "FIM OK"
//             · artefato citado no sha256sums.txt ausente no disco
//
// Uso:
//   node scripts/forge-backup-alert.mjs                 # julga o dia de hoje
//   node scripts/forge-backup-alert.mjs --root <dir>    # outro root de backups
//   VPS-side: node scripts/forge-backup-alert.mjs --backend gitea \
//               --repo severinno/severinno \
//               (GITEA_URL/GITEA_TOKEN/GITEA_REPOSITORY do env da forja)
//
// Exit codes:
//   0 — o alerta CUMPRIU o ciclo (publicou, comentou ou reconciliou — qualquer
//       que seja o fato medido; um backup falhado PUBLICADO é um alerta de pé)
//   1 — o alerta não conseguiu cumprir (backend de issues falhou, uso errado)
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { issueHasAnyMarker, markerOf } from "./issue-publish.mjs"

const ISSUES = {
  label: "forge-backup",
  color: "#8B0000",
  description: "Falha do backup da forja (gitea dump / bundles)",
  title: "BACKUP DA FORJA FALHOU — {{data}}",
  markerId: "forge-backup-alert",
}

const USO = `uso: node scripts/forge-backup-alert.mjs [--root ~/backups-forja] [--dia AAAA-MM-DD] [--backend gitea|github] [--repo owner/name] [--dry-run] [-h]`

function parseArgs(argv) {
  const o = {
    // ~/backups-forja é o layout nos DOIS lados (local: /home/<user>, VPS: /root)
    root: process.env.FORGE_BACKUP_ROOT || join(homedir(), "backups-forja"),
    dia: new Date().toLocaleDateString("sv-SE"), // YYYY-MM-DD local
    backend: "github",
    repo: null,
    dryRun: false,
    error: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--root") o.root = argv[++i] ?? ""
    else if (a === "--dia") o.dia = argv[++i] ?? ""
    else if (a === "--backend") o.backend = argv[++i] ?? ""
    if (a === "--repo") o.repo = argv[++i] ?? ""
    else if (a === "--dry-run") o.dryRun = true
    else if (a === "-h" || a === "--help") {
      console.log(USO)
      process.exit(0)
    } else if (!a.startsWith("--")) o.dia = a
    else if (!["--root", "--dia", "--backend", "--repo", "--dry-run"].includes(a))
      o.error = `flag desconhecida: ${a}`
  }
  return o
}

// ── O FATO: o manifest do dia DIZ o que aconteceu ─────────────────────────
export function julgaManifest({
  root,
  dia,
  ler = (p) => readFileSync(p, "utf8"),
  existe = existsSync,
}) {
  const dir = join(root, dia)
  const manifest = join(dir, "manifest.txt")
  const sums = join(dir, "sha256sums.txt")
  if (!existe(manifest)) {
    return {
      ok: false,
      causa: `sem manifest do dia ${dia} em ${root} — o cron não rodou ou morreu antes de escrever`,
    }
  }
  const texto = ler(manifest)
  if (!texto.includes("FIM OK")) {
    return {
      ok: false,
      causa: `o manifest do dia ${dia} não tem "FIM OK" — o backup morreu no meio (última linha: "${texto.trim().split("\n").pop()?.slice(0, 120)}")`,
    }
  }
  if (existe(sums)) {
    for (const linha of texto.split("\n")) {
      const m = linha.match(/checksums: (\d+) artefato/)
      if (m && Number(m[1]) === 0) {
        return { ok: false, causa: `o manifest do dia ${dia} diz 0 artefatos com checksum` }
      }
    }
    for (const l of ler(sums).split("\n").filter(Boolean)) {
      const [, ...resto] = l.split(/ {2}/)
      const artefato = resto.join(" ").trim()
      if (artefato && !existe(join(dir, artefato))) {
        return {
          ok: false,
          causa: `artefato citado no sha256sums ausente no disco: ${artefato}`,
        }
      }
    }
  }
  return { ok: true, causa: null }
}

// ── O CORPO DA ISSUE ──────────────────────────────────────────────────────
function corpoIssue({ dia, causa, root, assinatura }) {
  return [
    markerOf(ISSUES.markerId, assinatura),
    `## ❌ O backup da forja FALHOU em ${dia}`,
    "",
    `**Causa (nomeada pelo manifest):** ${causa}`,
    "",
    `**Root dos backups:** \`${root}\``,
    "",
    `### O que fazer (RUNBOOK §3.3)`,
    `1. Rodar à mão: \`bash /root/forge-backup.sh\` e ler o manifest do dia`,
    `2. Se o dump falhou: \`docker ps\` (gitea de pé?) e \`docker exec gitea su git -c "gitea dump -f /tmp/x.zip --tempdir /tmp"\` para ver o erro cru`,
    `3. Re-rodar o pull off-site depois do conserto: \`bash scripts/forge-backup-pull.sh ${dia}\``,
    `4. O OFF-SITE segue com a última cópia boa — a janela de risco é o intervalo entre a última cópia boa e o conserto`,
  ].join("\n")
}

// ── MAIN ──────────────────────────────────────────────────────────────────
async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.error) {
    console.error(`❌ ${options.error}\n${USO}`)
    process.exit(1)
  }

  const fato = julgaManifest({ root: options.root, dia: options.dia })
  const assinatura = `forge-backup ${options.dia}`
  const titulo = ISSUES.title.replace("{{data}}", options.dia)

  if (fato.ok) {
    console.log(
      `✅ backup do dia ${options.dia}: FIM OK — nada a publicar (a reconciliação fecha o que ficou aberto)`,
    )
    if (options.dryRun) return
    // A reconciliação: fecha as issues QUE ESTE publicador abriu (o marcador é o dono).
    if (!options.dryRun) {
      const { selectIssueBackend, reconcileDebt } = await import("./issue-publish.mjs")
      const backend = selectIssueBackend(options, process.env, ISSUES)
      const existing = await backend.openIssues()
      await reconcileDebt({
        backend,
        existing,
        isOurs: (issue) => issueHasAnyMarker(issue, ISSUES.markerId),
        isExpired: () => true, // o backup do dia está OK: toda dívida deste publicador caducou
        resolutionBody: (issue) =>
          `✅ **Backup do dia ${options.dia} com FIM OK** (manifest: \`${options.root}/${options.dia}/manifest.txt\`) — a dívida deste alerta foi resolvida; issue fechada pela reconciliação. (aberta como #${issue.number})`,
        reason: "o backup do dia voltou ao OK",
      })
    }
    return
  }

  console.log(`❌ backup do dia ${options.dia} FALHOU: ${fato.causa}`)
  const body = corpoIssue({ dia: options.dia, causa: fato.causa, root: options.root, assinatura })

  if (options.dryRun) {
    console.log("(dry-run: nenhuma chamada ao backend de issues)")
    console.log(`título: ${titulo}`)
    console.log(body)
    return
  }

  const { selectIssueBackend, decidePublication } = await import("./issue-publish.mjs")
  const backend = selectIssueBackend(options, process.env, ISSUES)
  await backend.ensureLabel()
  const existing = await backend.openIssues()
  const decision = decidePublication({
    existing,
    title: titulo,
    signature: assinatura,
    markerId: ISSUES.markerId,
  })

  if (decision.action === "create") {
    const resultado = await backend.create(titulo, body)
    console.log(`🆕 issue criada: ${resultado}`)
  } else if (decision.action === "comment") {
    await backend.comment(decision.issue.number, body)
    console.log(`💬 comentário na issue #${decision.issue.number} (o problema mudou e continua)`)
  } else {
    console.log(`✅ issue #${decision.issue.number} já carrega esta assinatura — nada a publicar`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)))
  main().catch((error) => {
    console.error(`❌ ${error.message}`)
    process.exit(1)
  })
