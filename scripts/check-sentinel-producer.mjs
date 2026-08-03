#!/usr/bin/env node

// =============================================================================
// check-sentinel-producer.mjs
//
// CI guard GENERALIZADO da consistência produtor↔job de SENTINELS:
// verifica que TODO `grep -Fq '<sentinel>' <file>` nos workflows tem o
// sentinel correspondente emitido pelo PRODUTOR do <file> (script .sh/.mjs/
// .ts/.py — com chase de delegação .sh→.py) OU inline no próprio workflow.
//
// Por que existe: o job periódico blob-crlf-all-text-alert do
// benchmark-weekly.yml grepa o sentinel 'com CRLF' no output do produtor
// (audit-blob-crlf-history.sh → audit_blob_crlf_history.py). Antes, a
// consistência produtor↔job era travada por UM teste unitário específico
// ('com CRLF' — benchmark-weekly-all-text-crlf-workflow.test.ts). Se um
// futuro sentinel for adicionado a um workflow SEM o produtor emitir a
// string, o grep fica CEGO (found_crlf nunca acende) e o CI passa em
// silêncio — o mesmo drift que o teste específico bloqueia, agora para
// QUALQUER sentinel, sem depender de teste novo por sentinel.
//
// Contrato verificado para cada `grep -Fq '<S>' <FILE>`:
//   1. Resolve o produtor de <FILE>: linhas do mesmo workflow que produzem
//      o arquivo (via `> FILE`, `>> FILE`, `| tee FILE`, `2> FILE`) e extrai
//      as refs de script dessas linhas (bash|node|bun|python3 scripts/X).
//      Suporta também `bun run <entry>` (resolve a entry de package.json
//      para a ref de script do comando).
//   2. Chase de delegação: se a ref é um wrapper .sh que referencia outro
//      script no mesmo dir (ex.: "$SCRIPT_DIR/audit_blob_crlf_history.py"),
//      a cadeia é resolvida (BFS, visited-set) — o sentinel pode viver no
//      script DELEGADO, não no wrapper.
//   3. Veredicto:
//        - produtor(s) resolvido(s): sentinel deve ser substring LITERAL de
//          PELO MENOS um arquivo do produtor (includes — grep -Fq é literal)
//          OU emitido inline em linha produtora SEM ref de script (ex.:
//          `bash foo.sh > file` + `echo "S" >> file` — o echo satisfaz)
//        - NENHUM produtor de script: sentinel deve aparecer em OUTRA linha
//          do workflow (produtor inline, ex.: echo "S" > file) — senão FAIL
//          (produtor não resolvível: o grep não tem como acender)
//
// Escopo: .github/workflows/*.yml + .github/actions/*/action.yml (o guard é
// CI-only — espelha o workflow-refs-guard, não entra nos hooks). Node puro,
// sem deps, <1s.
//
// Usage:
//   node scripts/check-sentinel-producer.mjs
//
// Exit codes:
//   0 — todos os sentinels grep -Fq têm produtor emitindo o sentinel
//   1 — pelo menos um sentinel sem produtor correspondente (guarda cega)
// =============================================================================

import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join, dirname, basename } from "node:path"
import { pathToFileURL } from "node:url"

const WF_DIR = ".github/workflows"
const ACTIONS_DIR = ".github/actions"

// ── Helpers puros (exportados para testes) ────────────────────────────────

/**
 * Extrai sentinels `grep -Fq '<sentinel>' <file>` (e variantes -qF/-F) de um
 * conteúdo de workflow. Ignora linhas de comentário (#). Retorna
 * [{ line, sentinel, target }] — target é o arquivo grepeado (token limpo:
 * sem aspas/$ — ex.: `all-text-report.txt` ou `$REPORT_FILE` → `REPORT_FILE`).
 */
export function extractSentinelGreps(content) {
  const greps = []
  const lines = content.split(/\r?\n/)
  const re = /grep\s+-[a-zA-Z]*F[a-zA-Z]*\s+['"]([^'"]+)['"]\s+(\S+)/g
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === "" || line.trim().startsWith("#")) continue
    for (const m of line.matchAll(re)) {
      greps.push({
        line: i + 1,
        sentinel: m[1],
        // `\S+` engole pontuação shell adjacente (ex.: `if grep -Fq 'x'
        // file; then` captura `file;`) — strip de `;|&` finais ANTES da
        // normalização (senão o producer-detection nunca casa `tee file`).
        target: normalizeTargetToken(m[2].replace(/[;|&]+$/, "")),
      })
    }
  }
  return greps
}

/** Normaliza um token de arquivo (ex.: `"$REPORT_FILE"` → `REPORT_FILE`). */
export function normalizeTargetToken(token) {
  return token.replace(/^["']?[$]?/, "").replace(/["']$/, "")
}

/**
 * Dado um token de arquivo (normalizado), retorna true se a linha o produz
 * (via `>`, `>>`, `2>`, `| tee`, `tee`). Suporta aspas simples/duplas e $.
 */
export function lineProducesTarget(line, token) {
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(`(?:>>?|2>>?|tee)\\s*["']?\\$?${esc}`)
  return re.test(line)
}

/**
 * Extrai refs de script (`scripts/X.sh|.mjs|.ts|.py`) de um conteúdo de run,
 * além de `bun run <entry>` / `npm run <entry>` / `pnpm run <entry>`
 * (retornados como { kind: 'script'|'pkg', ref }). Prefixo `./` é normalizado.
 */
export function extractScriptRefsFromRun(runContent) {
  const refs = []
  const scriptRe =
    /(?:\b(?:bash|sh|node|bun|bunx|python3?|python|npx)\s+)?(?:\.\/)?(scripts\/[A-Za-z0-9_.\-/]+)/g
  for (const m of runContent.matchAll(scriptRe)) {
    refs.push({ kind: "script", ref: m[1] })
  }
  const pkgRe = /(?:\bbun|\bnpm|\bpnpm)\s+run\s+([A-Za-z0-9_.:-]+)/g
  for (const m of runContent.matchAll(pkgRe)) {
    refs.push({ kind: "pkg", ref: m[1] })
  }
  // dedupe por kind+ref
  const seen = new Set()
  return refs.filter((r) => {
    const k = `${r.kind}:${r.ref}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * Resolve a ref de script de uma entry de package.json (`bun run <entry>`):
 * retorna as refs `scripts/X` do COMANDO da entry (ou [] se a entry não
 * existir ou não invocar um script do repo).
 */
export function resolvePkgEntryRefs(pkgJson, entry) {
  const scripts = (pkgJson && pkgJson.scripts) || {}
  const cmd = scripts[entry]
  if (!cmd) return []
  return extractScriptRefsFromRun(cmd)
    .filter((r) => r.kind === "script")
    .map((r) => r.ref)
}

/**
 * Extrai refs de script DELEGADOS de um wrapper .sh: nomes de arquivo
 * `nome.ext` (.py/.mjs/.ts/.sh) referenciados no conteúdo (ex.:
 * `PY_SCRIPT="$SCRIPT_DIR/audit_blob_crlf_history.py"` ou
 * `"$(dirname "$0")/helper.mjs"`). Retorna os nomes únicos — a resolução
 * para o dir do wrapper acontece em resolveProducerChain.
 *
 * Classe de char PRECEDENTE: aspas, whitespace, `/`, `=`, `$` — o basename
 * pode vir depois de `$SCRIPT_DIR/`, `$(dirname "$0")/` ou `VAR=`. Sem o
 * `/`, o chase .sh→.py NUNCA casa (a string real é `"$SCRIPT_DIR/x.py"`).
 */
export function extractDelegatedScripts(shContent) {
  const deps = []
  const re = /["'\s/=$]([A-Za-z0-9_-]+\.(?:py|mjs|ts|sh))/g
  for (const m of shContent.matchAll(re)) deps.push(m[1])
  return [...new Set(deps)]
}

/** Verifica se o sentinel é substring literal de pelo menos um conteúdo. */
export function sentinelInProducer(producerContents, sentinel) {
  return producerContents.some((c) => c.includes(sentinel))
}

/**
 * Chaceia a cadeia de delegação de uma ref de script: começa em
 * <root>/<ref>, e se o arquivo é um wrapper .sh que referencia outros
 * scripts no mesmo dir (py/mjs/ts/sh), adiciona-os à fila (BFS, visited).
 * Retorna os paths absolutos EXISTENTES da cadeia (incluindo o inicial).
 */
export function resolveProducerChain(ref, root, exists = existsSync, read = readFileSync) {
  const start = join(root, ref)
  if (!exists(start)) return []
  const visited = new Set()
  const queue = [start]
  const files = []
  while (queue.length > 0) {
    const abs = queue.shift()
    if (visited.has(abs)) continue
    visited.add(abs)
    files.push(abs)
    if (abs.endsWith(".sh")) {
      for (const dep of extractDelegatedScripts(read(abs, "utf8"))) {
        const depAbs = join(dirname(abs), dep)
        if (exists(depAbs)) queue.push(depAbs)
      }
    }
  }
  return files
}

// ── Varredura principal ───────────────────────────────────────────────────

/** Lista { path, content } dos arquivos de workflow/action do root. */
export function scanWorkflowFiles(root) {
  const files = []
  for (const dir of [WF_DIR, ACTIONS_DIR]) {
    const absDir = join(root, dir)
    if (!existsSync(absDir)) continue
    const isActions = dir === ACTIONS_DIR
    for (const name of readdirSync(absDir)) {
      const p = isActions ? join(absDir, name, "action.yml") : join(absDir, name)
      if (!existsSync(p)) continue
      try {
        files.push({
          path: `${dir}/${isActions ? `${name}/action.yml` : name}`,
          content: readFileSync(p, "utf8"),
        })
      } catch {
        // arquivo ilegível — pula (não é o contrato deste guard)
      }
    }
  }
  return files
}

/**
 * Encontra violações do contrato produtor↔sentinel em um repo. Retorna
 * [{ file, line, sentinel, target, producer, reason }]. Node-puro — root é
 * o diretório do repo (process.cwd() na CLI).
 *
 * Options: pkgJson (para resolver `bun run <entry>` → scripts/X) e wfFiles
 * (arquivos de workflow já escaneados — main() passa o scan único para
 * evitar varredura dupla; quando ausente, faz o scan interno).
 */
export function findSentinelViolations(root, options = {}) {
  const { pkgJson, wfFiles } = options
  const violations = []
  // wfFiles injetável (main() já escaneou; testes podem passar fixture próprio)
  const files = wfFiles ?? scanWorkflowFiles(root)
  for (const wf of files) {
    const lines = wf.content.split(/\r?\n/)
    for (const g of extractSentinelGreps(wf.content)) {
      // 1. linhas do workflow que PRODUZEM o target (ignora comentários)
      const producerLines = lines
        .map((l, i) => ({ line: i + 1, text: l }))
        .filter(
          ({ line, text }) =>
            line !== g.line && !text.trim().startsWith("#") && lineProducesTarget(text, g.target),
        )

      // 2. refs de script dessas linhas (incl. bun run <entry> → scripts/X)
      const scriptRefs = new Set()
      for (const pl of producerLines) {
        for (const r of extractScriptRefsFromRun(pl.text)) {
          if (r.kind === "script") scriptRefs.add(r.ref)
          else if (r.kind === "pkg" && pkgJson) {
            for (const ref of resolvePkgEntryRefs(pkgJson, r.ref)) scriptRefs.add(ref)
          }
        }
      }

      if (scriptRefs.size > 0) {
        // 3a. produtor de script — chaceia delegação e verifica o sentinel.
        // MAS o script não é a única fonte possível: se OUTRA linha
        // produtora SEM ref de script emite o sentinel inline (ex.:
        // `bash foo.sh > file` + `echo 'achado' > file`), o grep pode
        // acender por ela — não é guard cega. Só linhas SEM ref de script
        // contam: uma linha com `bash foo.sh 'S' > file` passa o sentinel
        // como ARGUMENTO (não o emite) — contaria como falso-positivo.
        const inlineProducer = producerLines.some(
          (pl) => extractScriptRefsFromRun(pl.text).length === 0 && pl.text.includes(g.sentinel),
        )
        const chain = [...scriptRefs].flatMap((ref) => resolveProducerChain(ref, root))
        const uniqueChain = [...new Set(chain)]
        if (uniqueChain.length === 0 && !inlineProducer) {
          violations.push({
            file: wf.path,
            line: g.line,
            sentinel: g.sentinel,
            target: g.target,
            producer: "[refs não resolvem para arquivos existentes]",
            reason: "produtor não resolve",
          })
        } else if (
          !inlineProducer &&
          !sentinelInProducer(
            uniqueChain.map((p) => readFileSync(p, "utf8")),
            g.sentinel,
          )
        ) {
          violations.push({
            file: wf.path,
            line: g.line,
            sentinel: g.sentinel,
            target: g.target,
            producer: uniqueChain.map((p) => basename(p)).join(", "),
            reason: "sentinel ausente do produtor",
          })
        }
        continue
      }

      // 3b. sem produtor de script — exige produtor INLINE (outra linha do
      // workflow com o sentinel literal, ex.: echo "S" > file). Se o
      // sentinel só existe na linha do grep, o grep não tem como acender.
      const inlineProducer = lines.some(
        (l, i) =>
          i + 1 !== g.line &&
          !l.trim().startsWith("#") &&
          l.includes(g.sentinel) &&
          lineProducesTarget(l, g.target),
      )
      if (!inlineProducer) {
        violations.push({
          file: wf.path,
          line: g.line,
          sentinel: g.sentinel,
          target: g.target,
          producer: "[nenhum]",
          reason: "produtor não resolvível (script) nem inline",
        })
      }
    }
  }
  return violations
}

// ── CLI ───────────────────────────────────────────────────────────────────

function main() {
  const root = process.cwd()
  let pkgJson = null
  const pkgPath = join(root, "package.json")
  if (existsSync(pkgPath)) {
    try {
      pkgJson = JSON.parse(readFileSync(pkgPath, "utf8"))
    } catch {
      pkgJson = null
    }
  }

  // scan único — usado pelo veredicto E pelo count (evita varredura dupla)
  const wfFiles = scanWorkflowFiles(root)
  const violations = findSentinelViolations(root, { pkgJson, wfFiles })

  if (violations.length > 0) {
    console.error(
      `❌ check-sentinel-producer: ${violations.length} sentinel(s) sem produtor correspondente:`,
    )
    for (const v of violations) {
      console.error(
        `   ${v.file}:${v.line}: sentinel '${v.sentinel}' (grep de ${v.target}) — ${v.reason}`,
      )
      console.error(`     produtor: ${v.producer}`)
    }
    console.error("")
    console.error("   Um grep -Fq que o produtor nunca emite é uma GUARDA CEGA — o estado")
    console.error("   'não achou' vira falso positivo de 'limpo'. Ajuste o produtor para emitir")
    console.error("   o sentinel no caminho de achados, ou remova/alinhe o grep do workflow.")
    process.exit(1)
  }

  const total = extractSentinelGreps(wfFiles.map((f) => f.content).join("\n")).length
  console.log(
    `✅ check-sentinel-producer: ${total} sentinel(s) grep -Fq com produtor correspondente.`,
  )
  process.exit(0)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
