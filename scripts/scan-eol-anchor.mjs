#!/usr/bin/env node
/**
 * scan-eol-anchor.mjs - guard do ACHADO da Prova 17 (gates-proofs.md sec
 * 8.14, 2026-08-10): ancoras de string com `\n` FALHAM SILENCIOSAMENTE em
 * arquivos CRLF.
 *
 * WHY THIS EXISTS (read before you skip it):
 *   No Windows, os gate files (.github/workflows/*.yml, .husky/*,
 *   package.json) sao CRLF no working tree (git autocrlf). Um
 *   `content.replace("...\n...", "...")` cru nao casa o `\r\n` e vira um
 *   no-op silencioso: a mutacao nao aplica, o teste passa falso, e o
 *   sinal da prova desaparece. A 1a tentativa da Prova 17 (a injecao da
 *   multi-violacao) falhou exatamente assim - o script normalizou para LF
 *   antes de substituir (o fix do momento). ESTE guard e o fix tornado
 *   permanente: o idioma cru (replace de string com ancora contendo a
 *   sequencia de escape nova-linha) na superficie de testes/mutacao
 *   reintroduz a classe e falha com o caminho exato.
 *
 * O CONTRATO (bidirecional, mesmo padrao do scan-curl-timeouts /
 * scan-timeouts):
 *   - NEGATIVO: um replace de string cuja PRIMEIRA ancora e um literal
 *     (aspas simples OU duplas) contendo a sequencia de escape nova-linha
 *     = falha com file:line. So literais de string contam.
 *   - FRONTEIRA (a MESMA classe, nao a forma segura): ancoras REGEX com a
 *     sequencia nao sao flagradas - flagrar regex false-positivaria no
 *     normalizeCrlf (/\r\n/g legitimo). Honestidade: `.*\n` regex tambem
 *     falha silenciosamente em CRLF (o `.` nao casa `\r`) e /\n/g em CRLF
 *     gera `\r\r\n` (CR duplo) - um replace regex com a sequencia e a
 *     mesma classe, documentada como segunda superficie nao-coberta (nao
 *     como idioma seguro). O replaceEolAgnostic cobre a ancora de STRING
 *     (search: string + includes); um script de mutacao com ancora REGEX
 *     deve chamar normalizeCrlf no conteudo ANTES do replace (o mesmo
 *     fix da Prova 17, aplicado a classe toda).
 *   - POSITIVO: a superficie escaneada NAO pode ser vazia - os arquivos
 *     de teste/mutacao (a derivacao viva dos testes que especificam
 *     conteudo de gate file): um teste novo que muta gate file com ancora
 *     crua entra automaticamente no scan, e um detector que nao casa nada
 *     seria um pass vacuo (o BASELINE companion pina files > 0).
 *
 * SUPERFICIE: scripts/ (tests .ts + scripts .mjs/.js) - onde a mutacao de
 * gate file e especificada. O idioma certo e o helper compartilhado
 * replaceEolAgnostic (golden-copy-utils.ts) - normaliza CRLF para LF E
 * THROWS no anchor-miss (a classe vira fail-loud, nao no-op). Este guard
 * e a rede de seguranca estatica: se o idioma cru voltar (um teste novo,
 * um script de mutacao commitado), o CI falha antes do no-op silencioso.
 *
 * MASKING (a precisao): COMENTARIOS (// de linha + blocos /asterisco
 * multi-linha) sao mascarados para espacos - a prosa dos docblocks que
 * apenas MENCIONA o padrao nao pode false-positivar. Strings NAO sao
 * mascaradas (a ancora vive dentro de um literal de string - mascarar
 * strings mataria a deteccao). Por isso os testes de mutacao montam a
 * ancora por CONCATENACAO de literais: a sequencia completa nunca existe
 * contigua no codigo-fonte do proprio teste.
 *
 * Fronteira fina conhecida do RAW_ANCHOR_RE (edge de matching, nao de
 * masking): o dot tempered para na aspa escapada (`\\"`) antes da
 * sequencia - `replace("foo\\"bar<NOVA>", "")` nao flagraria (edge
 * estreito; nenhum gate file do repo usa aspa escapada em ancora de
 * mutacao hoje).
 *
 * FRONTEIRA DO EVAL (sec 11.37, NAO-fronteira - MEDIDO): a classe 'token
 * em string avaliada depois' NEM ESCAPA aqui - strings passam
 * BYTE-IDENTICAL pelo maskComments (mascarar strings mataria a propria
 * deteccao), entao `eval('.replace("foo\nbar", "")')` continua com o
 * padrao de bytes visivel e E flagrado. A unica variante que escapa (a
 * aspa escapada, que muda o byte shape) e EXATAMENTE a fronteira fina
 * acima. Sem tripwire necessario; o curl-timeouts (bash, onde o comando
 * INTEIRO - incluindo o nome da ferramenta - vai pra variavel) e o unico
 * dos tres guards com idioma plausivel de uso acidental.
 *
 * Env override EOL_ANCHOR_SCAN_ROOT (repo sintetico p/ o vitest - espelha
 * o CURL_TIMEOUTS_SCAN_ROOT do scan-curl-timeouts). Saida ASCII pura (gate
 * file). Puro node, sem deps, <10ms. Flags: --ci (intent-only, espelho do
 * scan-timeouts) / flag desconhecida = exit 2 com usage.
 *
 * ENTRY-POINT GUARD (IS_MAIN, mirror scan-timeouts.mjs / scan-timeouts): o
 * CLI roda SO quando executado direto (node scripts/scan-eol-anchor.mjs).
 * Importar o modulo (unit tests de parsing, probes) NAO varre a superficie
 * nem seta exitCode - o ACHADO da sec 11.37 (o probe flagrou o proprio
 * arquivo ao importar) fechado por este guard.
 */
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const ROOT = path.resolve(process.env.EOL_ANCHOR_SCAN_ROOT || process.cwd())

/** Extensiones da superficie: testes TS + scripts .mjs/.js. */
const SCAN_EXTS = new Set([".ts", ".mjs", ".js"])

/** Dir a ignorar dentro da superficie (node_modules etc.). */
const SKIP_DIRS = new Set(["node_modules", ".next", ".git"])

/**
 * A classe: replace de string cuja primeira ancora e um literal (aspas
 * simples ou duplas) contendo a sequencia de escape nova-linha.
 * - O grupo de aspas garante que a ancora e um literal de string - isso
 *   ja exclui o proprio replaceEolAgnostic( (o parentese e seguido de um
 *   identificador, nao de uma aspa) e as chamadas com ancora de variavel.
 * - (?:(?!\1).)* + a sequencia exige o escape DENTRO do literal.
 * - SEM lookbehind: a classe e um metodo de objeto (`content.replace(`),
 *   entao o char antes do ponto E um word char - um lookbehind negativo
 *   mataria a deteccao real (bug pego pelo teste de mutacao).
 */
const RAW_ANCHOR_RE = /\.replace(?:All)?\(\s*(["'])(?:(?!\1).)*\\n/

/**
 * Mask JS comments (// line + /* block *\/, inclusive multi-linha) into
 * spaces, preserving newlines and string literals - so docblock prose
 * that merely MENTIONS the pattern cannot flag a line. Strings pass
 * through BYTE-IDENTICAL: o escape que o guard detecta (`\n`) vive DENTRO
 * do literal - consumir escapes mataria a deteccao (bug pego pelo teste
 * de mutacao). Apenas o fechamento da string encerra o modo.
 */
export function maskComments(src) {
  let out = ""
  let mode = null // '"' | "'" | "`" | "//" | "/*"
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    const next = src[i + 1]
    if (mode === '"' || mode === "'" || mode === "`") {
      if (ch === "\\") {
        // Escape: o char seguinte e parte do literal (pode ser a propria
        // aspa de fechamento) - copia AMBOS intactos e avanca 2.
        out += ch + (next ?? "")
        i++
        continue
      }
      if (ch === mode) {
        out += ch
        mode = null
        continue
      }
      out += ch
      continue
    }
    if (mode === "//") {
      if (ch === "\n") {
        out += ch
        mode = null
        continue
      }
      out += " "
      continue
    }
    if (mode === "/*") {
      if (ch === "*" && next === "/") {
        out += "  "
        i++
        mode = null
        continue
      }
      out += ch === "\n" ? ch : " "
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      out += ch
      mode = ch
      continue
    }
    if (ch === "/" && next === "/") {
      out += "  "
      i++
      mode = "//"
      continue
    }
    if (ch === "/" && next === "*") {
      out += "  "
      i++
      mode = "/*"
      continue
    }
    out += ch
  }
  return out
}

/**
 * Scan one file for the class. Returns `{ path, line }[]` violations
 * (1-based line numbers, first match per line to keep the report tight).
 * Comments are masked BEFORE the split so block comments spanning lines
 * are handled; line numbers stay aligned (masking preserves newlines).
 */
export function scanFileEolAnchor(filePath) {
  let masked
  try {
    masked = maskComments(fs.readFileSync(filePath, "utf8"))
  } catch {
    return []
  }
  const hits = []
  const lines = masked.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (RAW_ANCHOR_RE.test(lines[i])) {
      hits.push({ path: filePath, line: i + 1 })
    }
  }
  return hits
}

/** Collect the scan surface (tracked-style walk of the repo, no git needed). */
export function collectSurface(root = ROOT) {
  const files = []
  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (SCAN_EXTS.has(path.extname(e.name))) files.push(full)
    }
  }
  walk(root)
  return files
}

/** Aggregate all violations across the surface (sorted for stable output). */
export function scanEolAnchors(root = ROOT) {
  const files = collectSurface(root)
  const all = []
  for (const f of files) all.push(...scanFileEolAnchor(f))
  all.sort((a, b) => (a.path === b.path ? a.line - b.line : a.path.localeCompare(b.path)))
  return { files, violations: all }
}

/**
 * CLI entry. Violations -> stderr + exit 1 (mirror scan-timeouts). Clean ->
 * stdout + exit 0. Unknown flag -> usage on stderr + exit 2.
 */
export function main(argv = process.argv.slice(2)) {
  const args = argv.filter((a) => a.startsWith("--"))
  const unknown = args.filter((a) => a !== "--ci")
  if (unknown.length > 0) {
    process.stderr.write("eol-anchor: usage: node scripts/scan-eol-anchor.mjs [--ci]\n")
    return 2
  }
  const { files, violations } = scanEolAnchors()
  if (violations.length > 0) {
    for (const v of violations) {
      // Normaliza para / no output (Windows usa \\): os guards irmaos
      // (scan-guard-gates etc.) imprimem caminhos com / - a suite de
      // mutacao pina o file:line exato com /.
      const rel = path.relative(ROOT, v.path).split(path.sep).join("/")
      process.stderr.write(
        `eol-anchor: string anchor with newline escape in ${rel}:${v.line} (CRLF gate files silently no-op on newline anchors - Prova 17 ACHADO, sec 8.14; use replaceEolAgnostic from golden-copy-utils.ts)\n`,
      )
    }
    return 1
  }
  process.stdout.write(`eol-anchor: clean (${files.length} file(s) scanned, zero newline string anchors)\n`)
  return 0
}

// Entry-point guard (mirror scan-timeouts.mjs / scan-curl-timeouts.mjs -
// ACHADO da sec 11.37 fechado): o CLI roda SOMENTE quando executado
// direto. O 11.37 provou que um `process.exitCode = main()` cru varria a
// superficie INTEIRA a cada import (o probe flagrou o proprio arquivo de
// probe + setou o exitCode do processo). vitest importa o modulo para os
// testes de unidade (parsing) sem efeito colateral nenhum agora.
const IS_MAIN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_MAIN) {
  process.exitCode = main()
}
