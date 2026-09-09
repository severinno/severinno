#!/usr/bin/env node
/**
 * check-clock-bombs.mjs
 *
 * Guard anti-bomba-relógio: impede que um teste volte a depender do relógio
 * de parede (hora/dia/fuso) sem congelar o tempo. É o padrão check-* do repo:
 * funções puras exportadas (testáveis) + main() executada só em CLI.
 *
 * Exit codes:
 *   0 — nenhum teste com padrão de relógio sem controle (pass)
 *   1 — pelo menos um teste com padrão de relógio sem controle (fail)
 *
 * Usage:
 *   node scripts/check-clock-bombs.mjs
 *
 * Contexto real (08–09/2026):
 *   - geo-innovations.test.ts falhava no rush hour BRT (17:30–19:30) porque
 *     calculateTravelFee aplicava o multiplicador 1.25 de isRushHour() usando
 *     o relógio real — passava de tarde, falhava à noite.
 *   - format.test.ts falhava em dias de transição de DST (dia de 23h faz
 *     Date.now() - 86400000 cair 2 dias de calendário atrás → "há 2 dias" em
 *     vez de "ontem").
 *   - Testes de finance filtram por mês/ano corrente; not-found imprime o ano
 *     corrente; escrow compara expiresAt com Date.now() — todos flakies na
 *     virada de dia/ano/mês.
 *
 * O que o guard exige: TODO arquivo de teste que use os padrões abaixo DEVE
 * declarar controle de relógio (vi.useFakeTimers ou vi.setSystemTime) em
 * algum lugar do arquivo:
 *
 *   1. Ramificação de relógio de parede (qualquer chamada):
 *        isRushHour(
 *        .getDay(          — dia da semana (local)
 *        .getHours(        — hora local
 *        .getTimezoneOffset( — fuso local
 *        .getUTCDay(       — dia da semana (UTC)
 *        .getUTCHours(     — hora UTC
 *
 *   2. Asserção de janela temporal: new Date() ou Date.now() na MESMA linha
 *      de um expect(...) — ex.: expect(escrow.expiresAt).toBeGreaterThan(
 *      Date.now()). Fixtures relativos (createdAt: new Date() em assignments
 *      de mock) NÃO são flagados: são criados e consumidos na mesma execução.
 *      Limitação documentada: asserção MULTI-LINHA (expect( na linha N,
 *      Date.now() na linha N+1) escapa da heurística — a classe de risco
 *      primária (isRushHour/getDay/getHours — ramificação de parede) é
 *      capturada por padrões independentes de linha.
 *
 * Exceção documentada: chamadas com data EXPLÍCITA (ex.: isRushHour(date)
 * onde date = new Date("2026-09-08T11:15:00Z")) são deterministicas — mas o
 * guard é estrito de propósito: uma edição futura pode trocar a data explícita
 * por now sem intenção, e o custo de exigir clock control é trivial (congelar
 * num timestamp neutro, padrão já usado no geo-innovations).
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { pathToFileURL } from "node:url"

// ── Padrões de ramificação de relógio de parede ────────────────────────────

const TIME_BRANCH_PATTERNS = [
  { re: /isRushHour\s*\(/, label: "isRushHour()" },
  { re: /\.getDay\s*\(/, label: ".getDay()" },
  { re: /\.getHours\s*\(/, label: ".getHours()" },
  { re: /\.getTimezoneOffset\s*\(/, label: ".getTimezoneOffset()" },
  { re: /\.getUTCDay\s*\(/, label: ".getUTCDay()" },
  { re: /\.getUTCHours\s*\(/, label: ".getUTCHours()" },
]

// Asserção de janela temporal: expect(...) + relógio na MESMA linha.
const ASSERTION_OPEN = /expect\s*\(/
const ASSERTION_CLOCK = /\b(Date\.now\s*\(\)|new\s+Date\s*\(\s*\))/

/** Clock control declarado no arquivo (useFakeTimers ou setSystemTime). */
export function hasClockControl(content) {
  return /useFakeTimers|setSystemTime/.test(content)
}

/** É linha de comentário (// ou docblock) ou vazia? (heurística simples). */
function isCommentOrBlank(line) {
  return line === "" || line.startsWith("//") || line.startsWith("*")
}

/**
 * Varre `content` e retorna as violações de relógio sem clock control.
 * Cada violação: { line, pattern, text }.
 */
export function findClockViolations(content) {
  const violations = []
  const lines = content.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    const line = lines[i].trim()
    if (isCommentOrBlank(line)) continue

    for (const { re, label } of TIME_BRANCH_PATTERNS) {
      if (re.test(line)) {
        violations.push({ line: lineNo, pattern: label, text: line.slice(0, 120) })
      }
    }

    if (ASSERTION_OPEN.test(line) && ASSERTION_CLOCK.test(line)) {
      violations.push({
        line: lineNo,
        pattern: "Date.now()/new Date() em asserção",
        text: line.slice(0, 120),
      })
    }
  }
  return violations
}

/**
 * Caminha recursivamente `dir` (default: src/) atrás de *.test.{ts,tsx} e
 * retorna, por arquivo SEM clock control, as violações encontradas:
 *   [{ file, violations: [{ line, pattern, text }] }]
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
    } else if (/\.test\.(ts|tsx)$/.test(entry)) {
      const content = readFileSync(full, "utf8")
      if (hasClockControl(content)) continue
      const violations = findClockViolations(content)
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
    console.error("❌ BOMBA(S)-RELÓGIO DETECTADA(S) — teste(s) sem controle de relógio:")
    for (const r of results) {
      console.error(`\n  📄 ${r.file}`)
      for (const v of r.violations) {
        console.error(`     linha ${v.line}: ${v.pattern}`)
        console.error(`       ${v.text}`)
      }
    }
    console.error("\n  Como corrigir: adicione no arquivo:")
    console.error(
      '    beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-01-05T15:00:00.000Z")) })',
    )
    console.error("    afterEach(() => vi.useRealTimers())")
    console.error("  (toFake: ['Date'] congela SÓ Date — timers reais intactos p/ axe() e waits)")
    process.exit(1)
  }

  console.log("✅ Nenhum teste usa relógio de parede sem vi.useFakeTimers/vi.setSystemTime.")
  process.exit(0)
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
