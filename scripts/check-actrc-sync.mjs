#!/usr/bin/env node

// =============================================================================
// check-actrc-sync.mjs
//
// Guard PERIÓDICO (semanal) do espelho LOCAL do act (.actrc) vs a repository
// variable BUN_VERSION do GitHub.
//
// O guard estático scripts/check-bun-mirror.mjs valida que o .actrc DEFINE
// BUN_VERSION (existe a linha `--var BUN_VERSION=...`), mas NÃO pode conferir
// se o VALOR bate com a variável do GitHub — isso é impossível estaticamente
// (a variável remota só existe em runtime no Actions). Este script compara os
// DOIS: o job semanal `actrc-sync` do benchmark-scheduled.yml passa o valor real
// de vars.BUN_VERSION via `--expected` e o script lê o .actrc do working tree.
//
// POR QUE: o .actrc é o espelho LOCAL do act (o act não lê as variables do
// repositório sem --var — ver header do .actrc). Se um dev trocar a repository
// variable no GitHub (Settings → Secrets and variables → Actions) e esquecer
// de atualizar o .actrc, o act local passa a testar uma versão DIFERENTE da
// produção — e o guard estático não pega (a versão mudou só na variável
// remota). Este aviso semanal fecha o loop com `::warning::` (NÃO-bloqueante:
// é desalinhamento de dev experience, não um bug de CI).
//
// Exit codes:
//   0 — .actrc em sincronia com --expected; OU divergência/variável ausente
//       reportada como ::warning:: sem falhar (modo aviso — o job semanal não
//       quebra; a ausência da variável é drift de config, não bug de CI)
//   1 — (modo --fail) divergência OU variável ausente — para validação
//       local/CI estrito (a ausência é o drift mais grave)
//   2 — uso inválido (--expected ausente / .actrc ilegível)
//
// Usage:
//   node scripts/check-actrc-sync.mjs --expected 1.3.14
//   node scripts/check-actrc-sync.mjs --expected "${{ vars.BUN_VERSION }}" --fail
//   node scripts/check-actrc-sync.mjs --expected 1.3.14 --actrc /tmp/.actrc
//
// Escopo: lê .actrc (cwd por padrão, ou --actrc). Node puro, sem deps, <1s.
// =============================================================================

import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

/**
 * Extrai o valor de BUN_VERSION de um .actrc (ex.: `--var BUN_VERSION=1.3.14`
 * → '1.3.14'). Tolera aspas e descarta comentário inline. Retorna null se o
 * .actrc não definir BUN_VERSION.
 *
 * A regex é ANCOORADA ao início da linha e linhas de comentário (`#`) são
 * descartadas ANTES do match — um comentário como `# --var BUN_VERSION=2.0`
 * NÃO pode gerar falso divergência (o primeiro match ganharia e extrairia o
 * valor errado).
 *
 * @param {string} content  conteúdo do .actrc
 * @returns {string|null}
 */
export function extractActrcBunVersion(content) {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === "" || trimmed.startsWith("#")) continue
    const m = trimmed.match(/^--var\s+BUN_VERSION\s*=\s*"?([^"\s#]+)"?/)
    if (m) return m[1]
  }
  return null
}

/**
 * Compara o valor do .actrc (espelho local do act) com o valor REAL da
 * repository variable (passado via --expected, resolvido de vars.BUN_VERSION
 * no workflow). Retorna a lista de avisos (vazia = em sincronia).
 *
 * @param {string|null} actrcVersion  valor do .actrc (null = não definido)
 * @param {string} expected           valor da repository variable (--expected)
 * @returns {string[]}
 */
export function actrcSyncWarnings(actrcVersion, expected) {
  const warnings = []
  if (actrcVersion === null) {
    warnings.push(
      `.actrc NÃO define BUN_VERSION — adicione '--var BUN_VERSION=<versão>' em sincronia com a repository variable (vars.BUN_VERSION='${expected}'); sem ele o act local roda com a variável vazia e o setup-bun falha em runtime`,
    )
  } else if (actrcVersion !== expected) {
    warnings.push(
      `.actrc define BUN_VERSION='${actrcVersion}' mas a repository variable do GitHub é vars.BUN_VERSION='${expected}' — atualize o .actrc (Settings → Secrets and variables → Actions deve bater com o espelho local do act; o guard estático check-bun-mirror só valida a EXISTÊNCIA da linha, não o valor)`,
    )
  }
  return warnings
}

// ── modo CLI (consumido pelo benchmark-scheduled.yml) ─────────────────────────
// Só executa quando invocado diretamente (não quando importado pelo teste).
const isMain = !!process.argv[1] && process.argv[1].split(/[\\/]/).pop() === "check-actrc-sync.mjs"

if (isMain) {
  const args = process.argv.slice(2)
  let expected = ""
  let actrcPath = join(process.cwd(), ".actrc")
  let failMode = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--expected") expected = args[i + 1] || ""
    if (args[i] === "--actrc") actrcPath = args[i + 1] || actrcPath
    if (args[i] === "--fail") failMode = true
  }

  if (args.indexOf("--expected") === -1) {
    console.error("check-actrc-sync: uso inválido — falta --expected <versão>")
    console.error(
      "  Uso: node scripts/check-actrc-sync.mjs --expected <versão> [--fail] [--actrc <path>]",
    )
    process.exit(2)
  }
  if (!existsSync(actrcPath)) {
    console.error(`check-actrc-sync: .actrc não encontrado: ${actrcPath}`)
    process.exit(2)
  }

  // Variável AUSENTE no repositório (ex.: `${{ vars.BUN_VERSION }}` vazio —
  // GitHub renderiza expressão não definida como string vazia). NÃO é erro de
  // uso do script — é drift de config do repositório (a variável nem existe).
  // Emitir ::warning:: e exit 0 (modo aviso): o propósito do guard é AVISAR
  // sobre o estado do .actrc vs a variável; a ausência é o caso mais grave do
  // mesmo drift, não um bloqueio de CI. (O repo histórico rodou sem a variável
  // criada.) NO modo --fail (validação estrita) a ausência TAMBÉM falha — é o
  // drift mais grave, então exit 1 é o comportamento simétrico à divergência.
  if (!expected) {
    console.log(
      "::warning::check-actrc-sync: repository variable vars.BUN_VERSION NÃO configurada no repositório (Settings → Secrets and variables → Actions) — o setup-bun falharia em runtime; crie a variável e mantenha o .actrc em sincronia com ela",
    )
    process.exit(failMode ? 1 : 0)
  }

  const content = readFileSync(actrcPath, "utf8")
  const actrcVersion = extractActrcBunVersion(content)
  const warnings = actrcSyncWarnings(actrcVersion, expected)

  if (warnings.length === 0) {
    console.log(`check-actrc-sync: ✅ .actrc em sincronia com vars.BUN_VERSION='${expected}'.`)
    process.exit(0)
  }

  // Aviso NÃO-bloqueante (modo padrão): o job semanal sinaliza o drift sem
  // quebrar o CI — o desalinhamento afeta só a dev experience local do act.
  for (const w of warnings) {
    console.log(`::warning::check-actrc-sync: ${w}`)
  }
  if (failMode) process.exit(1)
  process.exit(0)
}
