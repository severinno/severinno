#!/usr/bin/env node

// =============================================================================
// check-no-setup-bun.mjs
//
// CI guard que impede o RETORNO de oven-sh/setup-bun@v2 nos workflows.
//
// Por que existe: oven-sh/setup-bun@v2 re-downloada o release LATEST do Bun
// em TODO job (~25-35s/job), mesmo quando o Bun já está instalado na imagem
// (ubuntu-24.04 GitHub-hosted e catthehacker/act). O projeto migrou TODOS os
// call sites dos workflows para o script scripts/setup-bun-ci.sh, chamado por
// `run:` (que NÃO passa pelo resolvedor de actions locais do runner), com 3
// camadas: pre-installed fast path → cache keyed na versão → download do
// release só em cache miss. Este guard falha o PR se alguém reintroduzir o
// action externo.
//
// Escopo: varre TODAS as forjas (scripts/forge-workflows.mjs) procurando
// `oven-sh/setup-bun` (qualquer versão/tag do action). Varreu só
// `.github/workflows` até 09/2026 — quando a forja Gitea/Forgejo virou dona do
// merge, esse escopo deixou a pipeline que decide o merge fora da cobertura, e
// ela reintroduziu o action externo em 3 call sites sem ninguém reclamar.
// Node puro, sem deps, <1s.
//
// Usage:
//   node scripts/check-no-setup-bun.mjs              # repo atual (cwd)
//   node scripts/check-no-setup-bun.mjs --root X     # fixture (mutation test)
//
// Exit codes:
//   0 — nenhuma ocorrência (pass)
//   1 — pelo menos uma ocorrência (fail)
//   2 — infra: --root sem valor / diretório inexistente (fail-closed)
// =============================================================================

import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { existingWorkflowDirs } from "./forge-workflows.mjs"

/** Identifica USOS de oven-sh/setup-bun em um conteúdo de workflow. */
export function findSetupBunRefs(content) {
  const refs = []
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Ignora comentários, mas detecta usages reais mesmo com prefixo ${{ }}
    if (line.trim() === "" || line.trim().startsWith("#")) continue
    // Casa APENAS a sintaxe `uses: oven-sh/setup-bun` (key `uses:` + o action
    // externo). Menções em prosa (ex.: nome de step, comentário inline sem a
    // key `uses:`) NÃO casam — evita falso positivo do próprio guard.
    const idx = line.search(/uses\s*:\s*oven-sh\/setup-bun/)
    if (idx !== -1) {
      refs.push({ line: i + 1, text: line.trim().slice(0, 80) })
    }
  }
  return refs
}

/** Varre todos os workflows de um diretório (retorna refs por arquivo). */
export function scanWorkflowDir(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".yml"))
  const results = []
  for (const f of files) {
    const content = readFileSync(join(dir, f), "utf8")
    const refs = findSetupBunRefs(content)
    if (refs.length > 0) results.push({ file: f, refs })
  }
  return results
}

/**
 * Varre TODAS as forjas. O rótulo do arquivo vem com o diretório da forja
 * (`<dir>/<arquivo>`) para que a violação diga em QUAL pipeline está — a
 * informação que faltava quando o guard só olhava o GitHub.
 *
 * @param {string} root
 * @returns {{ file: string, refs: { line: number, text: string }[] }[]}
 */
export function scanAllForges(root) {
  const results = []
  for (const dir of existingWorkflowDirs(root)) {
    for (const r of scanWorkflowDir(join(root, dir))) {
      results.push({ file: `${dir}/${r.file}`, refs: r.refs })
    }
  }
  return results
}

function main() {
  const argv = process.argv.slice(2)
  const rootIdx = argv.indexOf("--root")
  if (rootIdx !== -1 && !argv[rootIdx + 1]) {
    console.error("❌ --root exige um diretório (fail-closed)")
    process.exit(2)
  }
  const cwd = rootIdx !== -1 ? resolve(argv[rootIdx + 1]) : process.cwd()
  if (!existsSync(cwd)) {
    console.error(`❌ --root inexistente: ${cwd}`)
    process.exit(2)
  }
  const dirs = existingWorkflowDirs(cwd)
  const results = scanAllForges(cwd)

  if (results.length > 0) {
    console.error(`❌ oven-sh/setup-bun@v2 encontrado em ${results.length} workflow(s):\n`)
    for (const r of results) {
      for (const ref of r.refs) {
        console.error(`   - ${r.file}:${ref.line}  ${ref.text}`)
      }
    }
    console.error(
      `\n   Use o setup do repo — o par canônico 'actions/cache@v4 + run:` +
        `\n   bash scripts/setup-bun-ci.sh <versão>' — em vez do action externo, que` +
        `\n   re-downloada o release LATEST em todo job (~25-35s/job).`,
    )
    process.exit(1)
  }

  console.log(
    `✅ Nenhum workflow usa oven-sh/setup-bun em nenhuma forja (${dirs.join(", ")}) — migrados para scripts/setup-bun-ci.sh (chamado por run:).`,
  )
  process.exit(0)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
