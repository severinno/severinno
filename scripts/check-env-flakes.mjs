#!/usr/bin/env node
/**
 * check-env-flakes.mjs
 *
 * Guard irmão do check-clock-bombs.mjs: fecha a família de flakies AMBIENTAIS
 * (além do relógio) que tornam um teste dependente da máquina/CI em que roda.
 *
 * Padrões flagados (em arquivos de teste sem controle explícito):
 *
 *   1. toLocaleString()/toLocaleDateString()/toLocaleTimeString() SEM locale
 *      explícito como primeiro argumento — usa o locale do SISTEMA (a saída
 *      varia entre CI em pt-BR, en-US, etc.). Chamada com locale literal
 *      (ex.: toLocaleString("pt-BR", {...})) é determinística → segura.
 *
 *   2. new Intl.*Format dependente do ambiente:
 *        · DateTimeFormat SEM opção `timeZone:` na linha — formata a partir
 *          do fuso do sistema (com `timeZone: "America/Sao_Paulo"` → segura);
 *        · NumberFormat/RelativeTimeFormat/PluralRules SEM locale literal
 *          como 1º argumento — dependem do locale do sistema (com locale
 *          explícito → seguros; esses formatadores NÃO aceitam timeZone).
 *      Limitação documentada (mesmo padrão do check-clock-bombs): opções em
 *      MULTI-LINHA são heurísticas — toLocale*(\n "pt-BR") é eximido (\s* casa
 *      \n), mas new Intl.DateTimeFormat("pt-BR", { na linha N com timeZone na
 *      N+1 é flagado como falso positivo. Se incomodar, um window de 2–3
 *      linhas à frente resolveria.
 *
 *   3. Math.random() na MESMA linha de um expect(...) — assertar um valor
 *      aleatório é não-determinístico. Math.random() em fixtures/IDs
 *      (ex.: inv-${Math.random().toString(36)}) NÃO é flagado: é criado e
 *      consumido na mesma execução. Controle: vi.spyOn(Math, "random") ou
 *      vi.stubGlobal("Math", ...) no arquivo exime.
 *
 *   4. process.env.TZ mutado (process.env.TZ = "X") — vaza para os OUTROS
 *      testes do mesmo worker (mudança global não restaurada). O mecanismo
 *      correto é vi.stubEnv("TZ", "X") (auto-restaurado pelo vitest).
 *
 * Controle reconhecido (exime Math.random): vi.spyOn(Math / stubGlobal("Math".
 * Controle reconhecido (exime TZ): vi.stubEnv("TZ".
 *
 * Exit codes:
 *   0 — nenhum teste com padrão de ambiente sem controle (pass)
 *   1 — pelo menos um teste com padrão de ambiente sem controle (fail)
 *
 * Usage:
 *   node scripts/check-env-flakes.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { pathToFileURL } from "node:url"

// ── Padrões ────────────────────────────────────────────────────────────────

// toLocale* sem locale literal como 1º argumento (system-locale dependent).
// (?!["'`]) = o próximo char NÃO é aspas/template — exime toLocaleString("pt-BR"),
// toLocaleString('pt-BR'), toLocaleString(`pt-BR`) e multi-linha (\s* casa \n).
const TOLOCALE_NO_LOCALE = /\.toLocale(?:String|DateString|TimeString)\s*\(\s*(?!["'`])/

// Intl.DateTimeFormat sem timeZone explícito na mesma linha (system-TZ).
const INTL_DATETIME_NO_TIMEZONE = /new\s+Intl\.DateTimeFormat\s*\(/

// NumberFormat/RelativeTimeFormat/PluralRules sem locale literal (system-locale).
const INTL_NUMBER_NO_LOCALE =
  /new\s+Intl\.(?:NumberFormat|RelativeTimeFormat|PluralRules)\s*\(\s*(?!["'`])/

// Math.random() na mesma linha de um expect(...) (asserção não-determinística).
const ASSERTION_OPEN = /expect\s*\(/
const MATH_RANDOM = /Math\.random\s*\(/

// Mutação global de TZ.
const ENV_TZ_WRITE = /process\.env\.TZ\s*=/

// ── Controles de arquivo ───────────────────────────────────────────────────

/** vi.spyOn(Math, "random") ou vi.stubGlobal("Math", ...) exime Math.random. */
export function hasMathControl(content) {
  return /vi\.spyOn\(\s*Math|stubGlobal\(\s*["']Math/.test(content)
}

/** vi.stubEnv("TZ", ...) exime mutações de process.env.TZ (auto-restaura). */
export function hasTzControl(content) {
  return /vi\.stubEnv\s*\(\s*["']TZ/.test(content)
}

/** É linha de comentário (// ou docblock) ou vazia? (heurística simples). */
function isCommentOrBlank(line) {
  return line === "" || line.startsWith("//") || line.startsWith("*")
}

/**
 * Varre `content` e retorna as violações de dependência ambiental sem
 * controle. Cada violação: { line, pattern, text }.
 */
export function findEnvViolations(content) {
  const violations = []
  const mathControlled = hasMathControl(content)
  const tzControlled = hasTzControl(content)
  const lines = content.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    const line = lines[i].trim()
    if (isCommentOrBlank(line)) continue

    if (TOLOCALE_NO_LOCALE.test(line)) {
      violations.push({
        line: lineNo,
        pattern: "toLocale*() sem locale explícito",
        text: line.slice(0, 120),
      })
    }

    if (INTL_DATETIME_NO_TIMEZONE.test(line) && !/timeZone\s*:/.test(line)) {
      violations.push({
        line: lineNo,
        pattern: "Intl.DateTimeFormat sem timeZone explícito",
        text: line.slice(0, 120),
      })
    }

    if (INTL_NUMBER_NO_LOCALE.test(line)) {
      violations.push({
        line: lineNo,
        pattern: "Intl.*Format sem locale explícito",
        text: line.slice(0, 120),
      })
    }

    if (ASSERTION_OPEN.test(line) && MATH_RANDOM.test(line) && !mathControlled) {
      violations.push({
        line: lineNo,
        pattern: "Math.random() em asserção",
        text: line.slice(0, 120),
      })
    }

    if (ENV_TZ_WRITE.test(line) && !tzControlled) {
      violations.push({
        line: lineNo,
        pattern: "process.env.TZ mutado (use vi.stubEnv)",
        text: line.slice(0, 120),
      })
    }
  }
  return violations
}

/**
 * Caminha recursivamente `dir` atrás de *.test.{ts,tsx} e retorna, por
 * arquivo, as violações encontradas: [{ file, violations }].
 */
export function scanTestDir(dir) {
  const results = []
  const entries = readdirSync(dir)
  for (const entry of entries) {
    const full = join(dir, entry)
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue

    const st = statSync(full)
    if (st.isDirectory()) {
      results.push(...scanTestDir(full))
    } else if (/^check-.*\.test\.(ts|tsx)$/.test(entry)) {
      // Exime os testes dos PRÓPRIOS guards (check-*.test.ts): eles contêm os
      // padrões como FIXTURES em strings literais (ex.: a chamada
      // findEnvViolations(`expect(Math.random()).toBe(0.5)`)) — são a
      // especificação do guard, não testes de app. Sem a exceção o guard se
      // auto-acusa.
      continue
    } else if (/\.test\.(ts|tsx)$/.test(entry)) {
      const content = readFileSync(full, "utf8")
      const violations = findEnvViolations(content)
      if (violations.length > 0) {
        results.push({ file: relative(process.cwd(), full), violations })
      }
    }
  }
  return results
}

// ── CLI ────────────────────────────────────────────────────────────────────

function main() {
  const root = join(process.cwd(), "src")
  const results = scanTestDir(root)

  if (results.length > 0) {
    console.error("❌ FLAKIES AMBIENTAIS DETECTADOS — teste(s) dependente(s) do ambiente:")
    for (const r of results) {
      console.error(`\n  📄 ${r.file}`)
      for (const v of r.violations) {
        console.error(`     linha ${v.line}: ${v.pattern}`)
        console.error(`       ${v.text}`)
      }
    }
    console.error("\n  Como corrigir:")
    console.error('    · toLocale*: passe locale explícito — ex.: toLocaleString("pt-BR", {...})')
    console.error(
      '    · Intl.DateTimeFormat: adicione timeZone explícita — ex.: { timeZone: "America/Sao_Paulo" }',
    )
    console.error(
      '    · Intl.NumberFormat/etc: passe locale literal — ex.: new Intl.NumberFormat("pt-BR", ...)',
    )
    console.error('    · Math.random em expect: vi.spyOn(Math, "random").mockReturnValue(0.5)')
    console.error(
      '    · TZ: use vi.stubEnv("TZ", "America/Sao_Paulo") (auto-restaura) — NÃO process.env.TZ =',
    )
    process.exit(1)
  }

  console.log("✅ Nenhum teste depende de locale/TZ/Math.random do ambiente sem controle.")
  process.exit(0)
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
