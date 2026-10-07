#!/usr/bin/env node
/**
 * codemod-with-route-tests.mjs — adapta testes de rotas ao contrato withRoute.
 *
 * Handlers exportados via withRoute/withParams são `(request, ctx) => ...`.
 * Contrato final: em rotas ESTÁTICAS o ctx é opcional no call site; em rotas
 * DINÂMICAS (withParams) o 2º argumento é obrigatório e carrega `params`.
 * Este codemod cobre a fase intermediária da migração, quando o 2º argumento
 * ainda era exigido de todo handler convertido:
 *
 *   1. Coleta erros "Expected 2 arguments, but got 1" do tsc por arquivo;
 *   2. Em cada chamada `GET(req)` do teste, adiciona o 2º argumento:
 *        - rota com [param] no caminho do import  → { params: Promise.resolve({ id: "<id>" }) }
 *          (nomes dos params derivados do caminho da rota importada)
 *        - rota estática                          → { params: Promise.resolve({}) }
 *
 * Uso:
 *   node scripts/codemod-with-route-tests.mjs            # dry-run
 *   node scripts/codemod-with-route-tests.mjs --write    # aplica
 *
 * Usage:
 *   node scripts/codemod-with-route-tests.mjs [--write]
 *   (dry-run por padrão; sem --write apenas relata, não altera arquivo)
 *
 * Exit code:
 *   0 — executou até o fim (relatório no stdout; com --write, arquivos alterados)
 *   1 — exceção não tratada (caminho inválido, I/O, falha do tsc interno)
 *
 * Só altera linhas com padrão `await <METHOD>(...)` de 1 argumento variável —
 * nunca toca em chamadas literais com 2 args nem em outros códigos.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { execSync } from "node:child_process"

const WRITE = process.argv.includes("--write")

// 1. Rodar tsc e coletar erros "Expected 2 arguments"
let tscOut
try {
  execSync("NODE_OPTIONS=--max-old-space-size=4096 bunx tsc --noEmit", {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  })
  tscOut = ""
} catch (err) {
  tscOut = `${err.stdout ?? ""}${err.stderr ?? ""}`
}

const errorsByFile = new Map()
for (const line of tscOut.split("\n")) {
  if (!line.includes("error TS2554: Expected 2 arguments")) continue
  // Formato tsc: arquivo(LINHA,COLUNA) — a LINHA é o 1º número.
  const m = line.match(/^(.+?\.(?:ts|tsx))\((\d+),(\d+)\)/)
  if (!m) continue
  const [, file, lineStr] = m
  if (!errorsByFile.has(file)) errorsByFile.set(file, [])
  errorsByFile.get(file).push(Number(lineStr))
}

console.log(`arquivos com erros TS2554: ${errorsByFile.size}`)

// 2. Nome dos params a partir do caminho da rota importada
function paramsNamesForImport(importPath) {
  // "@/app/api/bookings/[id]/route" ou "../../bookings/[id]/route" → ["id"]
  const names = []
  const re = /\[(\w+)\]/g
  let m
  while ((m = re.exec(importPath)) !== null) names.push(m[1])
  return names
}

/** Import da rota associada a um handler alias (GETCoverage → ../coverage/route). */
function resolveAliasParams(src, handlerName) {
  const re = new RegExp(
    `import\\s*\\{[^}]*\\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\\s+as\\s+${handlerName}\\b[^}]*\\}\\s*from\\s*"([^"]+)"`,
  )
  const m = src.match(re)
  return m ? paramsNamesForImport(m[1]) : null
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]

let totalFixed = 0

for (const [file, cols] of errorsByFile) {
  const src = readFileSync(file, "utf8")

  // Params por handler: importa explícito (arquivos multi-rota usam `GET as X`)
  // ou o import @/app/api genérico. Alias sem match → params genérico {}.
  function paramsFor(handlerName) {
    const fromAlias = resolveAliasParams(src, handlerName)
    if (fromAlias && fromAlias.length > 0) return fromAlias
    const direct = src.match(
      new RegExp(`import\\s*\\{[^}]*\\b${handlerName}\\b[^}]*\\}\\s*from\\s*"([^"]*api/[^"]+)"`),
    )
    if (direct) {
      const names = paramsNamesForImport(direct[1])
      if (names.length > 0) return names
    }
    return []
  }

  function ctxExprFor(handlerName) {
    const names = paramsFor(handlerName)
    if (names.length === 0) return "{ params: Promise.resolve({}) }"
    const obj = `{ ${names.map((n) => `${n}: "test-${n}"`).join(", ")} }`
    return `{ params: Promise.resolve(${obj}) }`
  }

  // Substitui chamadas `await GET(req)` → `await GET(req, { params: ... })`
  // apenas quando o handler foi convertido (linha tem exatamente 1 argumento).
  const lines = src.split("\n")
  let changed = 0
  const doneLines = new Set()
  for (const errLine of cols) {
    // O erro TS2554 aponta a LINHA da chamada (1-based → 0-based).
    const li = Math.max(0, errLine - 1)
    if (doneLines.has(li)) continue
    const line = lines[li] ?? ""
    // Casa GET(req), GET(), GETCoverage(new Request(...)) — argumentos com um
    // nível de parênteses aninhados (new Request("url")).
    const callRe = new RegExp(
      `await\\s+((?:${METHODS.join("|")})(?:\\w*))\\(((?:[^()]|\\([^()]*\\))*)\\)\\s*$`,
    )
    const callM = line.match(callRe)
    if (callM) {
      const ctxExpr = ctxExprFor(callM[1])
      lines[li] = line.replace(callRe, `await $1($2, ${ctxExpr})`)
      doneLines.add(li)
      changed++
    }
  }

  if (changed > 0) {
    totalFixed += changed
    console.log(`${WRITE ? "✏️ " : "🔍"} ${file}: ${changed} chamadas adaptadas`)
    if (WRITE) writeFileSync(file, lines.join("\n"))
  }
}

console.log(`\n${WRITE ? "escritas" : "detectadas (dry-run)"}: ${totalFixed} chamadas`)
if (!WRITE) console.log("use --write para aplicar")
