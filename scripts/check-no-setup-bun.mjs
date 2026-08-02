#!/usr/bin/env node

// =============================================================================
// check-no-setup-bun.mjs
//
// CI guard que impede o RETORNO de oven-sh/setup-bun@v2 nos workflows.
//
// Por que existe: oven-sh/setup-bun@v2 re-downloada o release LATEST do Bun
// em TODO job (~25-35s/job), mesmo quando o Bun já está instalado na imagem
// (ubuntu-24.04 GitHub-hosted e catthehacker/act). O projeto migrou os 32
// call sites dos 12 workflows para o composite action local
// ./.github/actions/setup-bun, que usa 3 camadas (pre-installed fast path →
// actions/cache keyed na versão → download direto do release só em cache
// miss). Este guard falha o PR se alguém reintroduzir o action externo.
//
// Escopo: varre .github/workflows/*.yml procurando `oven-sh/setup-bun`
// (qualquer versão/tag do action). Node puro, sem deps, <1s.
//
// Usage:
//   node scripts/check-no-setup-bun.mjs
//
// Exit codes:
//   0 — nenhuma ocorrência (pass)
//   1 — pelo menos uma ocorrência (fail)
// =============================================================================

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

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

function main() {
  const cwd = process.cwd()
  const wfDir = join(cwd, ".github", "workflows")
  const results = scanWorkflowDir(wfDir)

  if (results.length > 0) {
    console.error(`❌ oven-sh/setup-bun@v2 encontrado em ${results.length} workflow(s):\n`)
    for (const r of results) {
      for (const ref of r.refs) {
        console.error(`   - ${r.file}:${ref.line}  ${ref.text}`)
      }
    }
    console.error(
      `\n   Use o composite action local ./.github/actions/setup-bun (pre-installed fast` +
        `\n   path + actions/cache keyed na versão) em vez do action externo, que` +
        `\n   re-downloada o release LATEST em todo job (~25-35s/job).`,
    )
    process.exit(1)
  }

  console.log(
    "✅ Nenhum workflow usa oven-sh/setup-bun (migrados para ./.github/actions/setup-bun).",
  )
  process.exit(0)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar o scan.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
