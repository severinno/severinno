#!/usr/bin/env node
/**
 * codemod-with-route.mjs — migra route handlers do padrão manual
 * (try/catch + handleError) para o wrapper composável withRoute/withParams.
 *
 * Padrão alvo (o que existe na maioria dos ~155 arquivos):
 *
 *   export async function GET(request: Request) {
 *     try {
 *       ...
 *     } catch (e) {
 *       return handleError(e)
 *     }
 *   }
 *
 * Resultado:
 *
 *   export const GET = withRoute("api.<path>.GET", async (request) => {
 *     ...
 *   })
 *
 * Variações suportadas:
 *   - handler com `ctx: { params: Promise<{...}> }` (rotas dinâmicas Next 16)
 *     → withParams<...>(..., async (request, { params }) => { const {...} = await params; ... })
 *     (o desestructuring `const { id } = params` interna é PRESERVADO como
 *      `const { id } = params` — params já vem resolvido)
 *   - `export async function` e `export function`
 *   - corpos com try/catch aninhado: converte SOMENTE o try externo cujo
 *     catch é exatamente `catch (e) { return handleError(e) }`
 *
 * NÃO converte (reportado como skipped, exige mão humana):
 *   - handlers cujo catch faz algo além de `return handleError(e)`
 *   - handlers sem try/catch
 *
 * Uso:
 *   node scripts/codemod-with-route.mjs               # dry-run (relatório)
 *   node scripts/codemod-with-route.mjs --write       # aplica
 *   node scripts/codemod-with-route.mjs --only src/app/api/health # subset
 *   node scripts/codemod-with-route.mjs --verbose     # mostra diffs no dry-run
 *
 * Usage:
 *   node scripts/codemod-with-route.mjs [--write] [--only <dir>] [--verbose]
 *   (dry-run por padrão; sem --write apenas relata, não altera arquivo)
 *
 * Exit code:
 *   0 — executou até o fim (relatório no stdout; com --write, arquivos alterados)
 *   1 — exceção não tratada (caminho inválido, I/O)
 *
 * Determinístico: mesmo input → mesmo output (sem timestamps/keys aleatórias).
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { execSync } from "node:child_process"

const args = process.argv.slice(2)
const WRITE = args.includes("--write")
const VERBOSE = args.includes("--verbose")
const onlyIdx = args.indexOf("--only")
const ONLY = onlyIdx !== -1 ? args[onlyIdx + 1] : null

const API_DIR = join(process.cwd(), "src", "app", "api")

// ── Descoberta de rotas ─────────────────────────────────────────────────

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, acc)
    else if (entry === "route.ts") acc.push(full)
  }
  return acc
}

/** Nome de span "api.<relpath sem route.ts>.<METHOD>" — espelha a convenção existente. */
function spanNameFor(file, method) {
  const rel = relative(API_DIR, file).split(sep).join("/")
  const path = rel.replace(/\/route\.ts$/, "").replace(/\/\[(\w+)\]/g, "/:$1")
  const segments = path.split("/").filter(Boolean)
  return `api.${segments.join(".")}.${method}`
}

/** Extrai o tipo de params de uma assinatura de handler. */
function extractParamsType(sig) {
  // ctx: { params: Promise<{ id: string; itemId: string }> }
  const m = sig.match(/params\s*:\s*Promise<([\s\S]*?)>\s*\}/)
  if (m) return m[1].trim()
  // Type alias local — DUAS formas encontradas nas rotas:
  //   (request, ctx: Params)          → alias inteiro
  //   (request, { params }: Params)   → desestruturação com alias no tipo
  if (/\b(ctx|_ctx)\s*:\s*(Params|RouteParams|RouteContext)\b/.test(sig)) return "__ALIAS__"
  if (/\{\s*params\s*\}\s*:\s*(Params|RouteParams|RouteContext)\b/.test(sig)) return "__ALIAS__"
  return null
}

/** Resolve o tipo do alias `type Params = { params: Promise<...> }` no arquivo. */
function resolveAliasType(src) {
  const m = src.match(
    /type\s+(?:Params|RouteParams|RouteContext)\s*=\s*\{\s*params\s*:\s*Promise<([\s\S]*?)>\s*\}/,
  )
  return m ? m[1].trim() : null
}

// ── Transformação por arquivo ───────────────────────────────────────────

const HANDLER_RE =
  /export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(([\s\S]*?)\)\s*(?::\s*[^{]+)?\{\n/

function transformFile(file) {
  const src = readFileSync(file, "utf8")
  const original = src
  let out = src
  const converted = []
  const skipped = []
  const aliasResolved = resolveAliasType(src)

  // Loop em handlers: processa o primeiro match por vez. A cada iteração
  // OU substituímos (o texto muda) OU registramos skip e AVANÇAMOS a busca
  // (senão o mesmo match seria re-avaliado infinitamente).
  let searchFrom = 0
  for (;;) {
    const scan = out.slice(searchFrom)
    const m = scan.match(HANDLER_RE)
    if (!m) break
    m.index += searchFrom

    const [fullSig, , method, paramsSrc] = m
    const sigStart = m.index
    const bodyStart = sigStart + fullSig.length

    // ── Encontrar o fechamento do corpo do handler (chaves balanceadas) ──
    // O scanner precisa ignorar CONTEÚDO de comentários // — apóstrofos em
    // prosa ("client hasn't reviewed") abririam uma falsa string e o corpo
    // desalinha (bug encontrado no POST de reviews/route.ts). Regex literais
    // e template ${} interpolations não são suportados: rotas com regex
    // literal caem no report de skip manual (sem conversão — seguro).
    let depth = 1
    let i = bodyStart
    let inStr = null // ' " `
    while (i < out.length && depth > 0) {
      const ch = out[i]
      const prev = out[i - 1]
      if (inStr) {
        if (ch === inStr && prev !== "\\") inStr = null
      } else if (ch === "/" && out[i + 1] === "/") {
        // comentário de linha: pula até o \n (sem interpretar aspas)
        const nl = out.indexOf("\n", i)
        i = nl === -1 ? out.length : nl
      } else if (ch === "'" || ch === '"' || ch === "`") {
        inStr = ch
      } else if (ch === "{") depth++
      else if (ch === "}") depth--
      i++
    }
    if (depth !== 0) break // chave desbalanceada — não tocar
    const bodyEnd = i - 1
    const body = out.slice(bodyStart, bodyEnd)

    // ── Detectar o try/catch padrão ──
    // O corpo deve começar (após whitespace) com `try {` e terminar com
    // `} catch (e) {\n    return handleError(e)\n    }` (variações de indent).
    const bodyTrimmed = body.trim()
    if (!bodyTrimmed.startsWith("try {")) {
      skipped.push({ method, reason: "sem try { externo" })
      searchFrom = bodyEnd + 1
      continue
    }

    // Procura o ÚLTIMO `} catch (e) {` que fecha o try externo: navega do fim
    // do corpo procurando o catch-final com handleError(e) como única instrução.
    const catchRe = /\}\s*catch\s*\(\s*(\w+)\s*\)\s*\{\s*return handleError\(\s*\1\s*\)\s*\}\s*$/s
    const catchMatch = bodyTrimmed.match(catchRe)
    if (!catchMatch) {
      skipped.push({ method, reason: "catch não é `return handleError(e)` puro" })
      searchFrom = bodyEnd + 1
      continue
    }

    // Extrai o interior do try (entre `try {` e o catch final).
    const innerRaw = bodyTrimmed.slice("try {".length, bodyTrimmed.length - catchMatch[0].length)
    const inner = innerRaw.replace(/^\n/, "").replace(/\n[ \t]*$/, "")

    // ── Montar o novo handler ──
    const hasParams =
      /params\s*:\s*Promise</.test(paramsSrc) ||
      /\b(ctx|_ctx)\s*:\s*(Params|RouteParams|RouteContext)\b/.test(paramsSrc) ||
      /\{\s*params\s*\}\s*:\s*(Params|RouteParams|RouteContext)\b/.test(paramsSrc)
    let paramsType = hasParams ? extractParamsType(paramsSrc) : null
    if (paramsType === "__ALIAS__") {
      if (!aliasResolved) {
        skipped.push({ method, reason: "params via alias não resolvido no arquivo" })
        searchFrom = bodyEnd + 1
        continue
      }
      paramsType = aliasResolved
    }

    // Nome do 1º argumento (request|req|_request...)
    const reqName = (paramsSrc.split(",")[0] ?? "request").trim().split(":")[0].trim() || "request"

    let replacement
    if (hasParams && paramsType) {
      // const { id } = params → o handler recebe { params } já resolvido.
      replacement =
        `export const ${method} = withParams<${paramsType}>(\n` +
        `  "${spanNameFor(file, method)}",\n` +
        `  async (${reqName}, { params }) => {\n` +
        inner +
        `\n  },\n` +
        `)`
    } else {
      replacement =
        `export const ${method} = withRoute(\n` +
        `  "${spanNameFor(file, method)}",\n` +
        `  async (${reqName}) => {\n` +
        inner +
        `\n  },\n` +
        `)`
    }

    out = out.slice(0, sigStart) + replacement + out.slice(bodyEnd + 1)
    // Após substituir, re-escaneia do início do replacement (não há match
    // dentro dele — handlers novos não têm try/catch).
    searchFrom = sigStart + replacement.length
    converted.push({ method, dynamic: hasParams })
  }

  if (converted.length > 0) {
    // ── Imports: adiciona withRoute/withParams, remove handleError se órfão ──
    const needsWithParams = converted.some((c) => c.dynamic)
    const importNames = needsWithParams ? "withRoute, withParams" : "withRoute"

    // Já importa de api-route?
    if (/import\s*\{[^}]*\}\s*from\s*"@\/lib\/api-route"/.test(out)) {
      out = out.replace(/import\s*\{([^}]*)\}\s*from\s*"@\/lib\/api-route"/, (_s, names) => {
        const set = new Set(
          names
            .split(",")
            .map((n) => n.trim())
            .filter(Boolean),
        )
        set.add("withRoute")
        if (needsWithParams) set.add("withParams")
        return `import { ${Array.from(set).sort().join(", ")} } from "@/lib/api-route"`
      })
    } else {
      // Insere depois do último import existente.
      const importRe = /^import[\s\S]*?from\s+"[^"]+"\n/gm
      let lastImportEnd = 0
      let im
      while ((im = importRe.exec(out)) !== null) lastImportEnd = im.index + im[0].length
      const importLine = `import { ${importNames} } from "@/lib/api-route"\n`
      out =
        out.slice(0, lastImportEnd) +
        (lastImportEnd ? "\n" : "") +
        importLine +
        out.slice(lastImportEnd)
    }

    // handleError virou órfão? (nenhuma outra ocorrência além do import)
    const handleErrorUses = (out.match(/handleError/g) ?? []).length
    const importOccurrences = (out.match(/import[^\n]*handleError[^\n]*/g) ?? []).length
    if (handleErrorUses <= importOccurrences) {
      // Remove handleError da lista de imports de api-server (ou a linha inteira se ficar vazia)
      out = out.replace(/import\s*\{([^}]*)\}\s*from\s*"@\/lib\/api-server"/, (_s, names) => {
        const kept = names
          .split(",")
          .map((n) => n.trim())
          .filter((n) => n && n !== "handleError")
        if (kept.length === 0) return ""
        return `import { ${kept.join(", ")} } from "@/lib/api-server"`
      })
    }

    // `export const dynamic` e outros exports de config permanecem intactos.
  }

  return { converted, skipped, output: out, changed: out !== original }
}

// ── Execução ────────────────────────────────────────────────────────────

const files = walk(API_DIR).filter((f) => (ONLY ? f.includes(ONLY) : true))

let totalConverted = 0
let totalSkipped = 0
let filesChanged = 0
const skipReport = []

for (const file of files) {
  const rel = relative(process.cwd(), file)
  let result
  try {
    result = transformFile(file)
  } catch (err) {
    skipReport.push({ file: rel, reasons: [{ method: "?", reason: `ERRO: ${err.message}` }] })
    totalSkipped++
    continue
  }

  if (result.skipped.length > 0) {
    skipReport.push({ file: rel, reasons: result.skipped })
    totalSkipped += result.skipped.length
  }

  if (result.changed) {
    filesChanged++
    totalConverted += result.converted.length
    console.log(
      `${WRITE ? "✏️ " : "🔍"} ${rel}: ${result.converted
        .map((c) => `${c.method}${c.dynamic ? "(dyn)" : ""}`)
        .join(", ")}`,
    )
    if (VERBOSE && !WRITE) {
      const before = readFileSync(file, "utf8")
      console.log("--- diff ---")
      try {
        const tmpBefore = `/tmp/codemod-before-${process.pid}.ts`
        const tmpAfter = `/tmp/codemod-after-${process.pid}.ts`
        writeFileSync(tmpBefore, before)
        writeFileSync(tmpAfter, result.output)
        console.log(execSync(`diff -u ${tmpBefore} ${tmpAfter} | head -60`, { encoding: "utf8" }))
      } catch {
        /* diff exit 1 é normal */
      }
    }
    if (WRITE) writeFileSync(file, result.output)
  }
}

console.log(`\n── Resumo ${WRITE ? "(ESCRITO)" : "(dry-run — use --write para aplicar)"} ──`)
console.log(`arquivos varridos:  ${files.length}`)
console.log(`arquivos alterados: ${filesChanged}`)
console.log(`handlers convertidos: ${totalConverted}`)
console.log(`handlers pulados:     ${totalSkipped}`)
if (skipReport.length > 0) {
  console.log(`\n── Requer conversão manual (${skipReport.length} arquivos) ──`)
  for (const r of skipReport) {
    console.log(`  ${r.file}`)
    for (const reason of r.reasons) console.log(`    - ${reason.method}: ${reason.reason}`)
  }
}
