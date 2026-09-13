#!/usr/bin/env node

// =============================================================================
// check-script-headers.mjs
//
// Usage:
//   node scripts/check-script-headers.mjs            # varre scripts/ (default)
//   node scripts/check-script-headers.mjs --json     # saida estruturada
//   node scripts/check-script-headers.mjs --list     # so os arquivos varridos
//   node scripts/check-script-headers.mjs --dir <p>  # outro diretorio
//
// Exit codes:
//   0 — todo script varrido documenta Usage e Exit code no cabecalho
//   1 — pelo menos um script sem a documentacao (com o remedio por arquivo)
//   2 — infra: diretorio inexistente
//   3 — uso invalido
//
// O CONTRATO (o que “cabeçalho documentado” significa aqui)
//
// O guard anterior checava as PRIMEIRAS 50 LINHAS do arquivo. Isso media uma
// coisa que ninguem prometeu: a POSICAO do bloco. Neste repo, onde o cabecalho
// costuma carregar o “por que existe” inteiro (com as decisoes, os defeitos
// cometidos e os numeros medidos), um preamble honesto de 80 linhas reprovava —
// e o remendo obvio (mover a doc para cima) piora a doc para agradar o gate.
// Medir posicao faz o gate brigar com o texto em vez de proteger o contrato.
//
// O contrato de verdade e outro, e ele nao depende de posicao:
//
//   1. o arquivo tem um BLOCO DE DOCUMENTACAO LIDER — as linhas do topo que sao
//      comentario (ou vazio) ate a primeira linha de CODIGO. Shebang nao conta
//      como codigo. O bloco pode ter 5 ou 500 linhas; o que importa e ele ser o
//      que o arquivo diz de si MESMO, antes de executar qualquer coisa;
//   2. dentro DESSE bloco aparecem uma secao `Usage:` e uma secao `Exit code`.
//
// As duas metades juntas sao mais rigorosas que as 50 linhas, nao mais frouxas:
// um `Usage:` enterrado no corpo do arquivo (dentro de uma funcao, num
// comentario solto) NAO conta, mesmo que esteja na linha 3 — porque a regra
// olha a REGIAO (antes do codigo), nao a distancia do topo.
//
// POR QUE ELE EXISTE (o defeito que ele fecha)
//
// O contrato vivia SÓ dentro do `barrel-lint`, cujo exit 3 era tratado como
// AVISO no CI (`quality-gate.yml`: “non-blocking (fix in progress)”) e cujo peso
// no pre-commit era nulo (o `wait` de varios PIDs devolve o status do ULTIMO).
// Resultado: um contrato de documentacao que nenhuma forja aplicava — o mesmo
// desenho de “gate que parece gate” que o `check:forge-parity` persegue.
//
// E, por estar embutido no `barrel-lint`, ele tambem era INVISIVEL ao guard de
// paridade: o nome `barrel-lint` nao casa o prefixo `check-`, entao o gate nao
// era descoberto e nao precisava de classificacao. Extraido para este arquivo,
// ele passa a ser um gate como os outros: descoberto, classificado e exigido
// (CORE) nas DUAS pipelines.
//
// A LISTA DE IGNORADOS E UMA SO
//
// `.barrel-lint-ignore` continua sendo o arquivo (nome legado), lido por este
// modulo e reaproveitado pelo `barrel-lint` — dois leitores, uma lista.
// =============================================================================

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"

/** Exit codes — o contrato da CLI. */
export const EXIT = {
  OK: 0,
  VIOLATIONS: 1,
  UNAVAILABLE: 2,
  USAGE: 3,
}

/** Onde os scripts moram (default) e o arquivo da lista de ignorados. */
export const DEFAULT_DIR = "scripts"
export const IGNORE_FILE = ".barrel-lint-ignore"

/** Extensoes com contrato de cabecalho. */
export const HEADER_EXTENSIONS = [".mjs", ".ts", ".sh", ".py", ".ps1"]

/**
 * A ignorados BUILT-IN: helpers internos (prefixo `_`), o gerador de cobertura e
 * um arquivo de fixture. Nao e uma allowlist de conveniencia — sao arquivos que
 * nao sao ponto de entrada executavel, e o nome diz isso.
 */
export const BUILTIN_IGNORES = [
  "_coverage_analysis.py", // underscore = helper interno
  "_update_workflows.py", // underscore = helper interno
]

/**
 * A sintaxe de comentario de cada extensao.
 *
 * `line` casa uma linha inteiramente de comentario; `blocks` sao os pares
 * abre/fecha de bloco. `.py` entra com as triple-quotes porque um docstring
 * module-level E a documentacao do arquivo — recusa-lo obrigaria o script Python
 * a duplicar a doc em comentario.
 */
const SYNTAX = {
  ".mjs": {
    line: /^\/\//,
    blocks: [
      ["/*", "*/"],
      ["<!--", "-->"],
    ],
    star: /^\*/,
  },
  ".ts": {
    line: /^\/\//,
    blocks: [
      ["/*", "*/"],
      ["<!--", "-->"],
    ],
    star: /^\*/,
  },
  ".sh": { line: /^#/, blocks: [] },
  ".py": {
    line: /^#/,
    blocks: [
      ['"""', '"""'],
      ["'''", "'''"],
    ],
  },
  ".ps1": { line: /^#/, blocks: [["<#", "#>"]] },
}

/**
 * O CONTEUDO de comentario de uma linha: delimitadores das pontas fora.
 *
 * Os marcadores sao procurados no TEXTO da documentacao, nao na linha crua —
 * senao um bloco C-style de uma linha (`Usage:` dentro dele) e um `# Usage:` de
 * shell precisariam de regras diferentes para dizer a mesma coisa. Depois deste
 * strip, o marcador no comeco e o marcador no comeco, em qualquer sintaxe.
 *
 * @param {string} line
 * @returns {string}
 */
export function commentText(line) {
  return String(line)
    .trim()
    .replace(/^(?:\/\/+|#+|\/\*+|\*+|<!--|"""|''')/, "")
    .replace(/(?:\*\/|-->|"""|''')$/, "")
    .trim()
}

/** Secao de uso — o marcador e literal de proposito (nao casa “Usages” nem “inusage”). */
const USAGE_RE = /^Usage:/

/** Secao de codigos de saida (`Exit code` e `Exit codes` valem). */
const EXIT_RE = /^Exit code/

/**
 * O BLOCO DE DOCUMENTACAO LIDER do arquivo.
 *
 * Shebang (`#!...`) nao e documentacao nem codigo: e pulado. Depois dele, o
 * bloco vai ate a primeira linha que nao seja comentario nem linha vazia — e
 * bloco aberto (C-style, PowerShell, docstring) mantem a regiao viva ate fechar,
 * porque as linhas de dentro nao carregam marcador proprio.
 *
 * @param {string} content
 * @param {string} [ext]
 * @returns {{line: number, text: string}[]} as linhas do cabecalho, com o numero 1-based
 */
export function headerRegion(content, ext = ".mjs") {
  const syntax = SYNTAX[ext] ?? SYNTAX[".mjs"]
  const lines = String(content ?? "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)

  let i = 0
  if (/^#!/.test(lines[0] ?? "")) i = 1

  /** @type {{line: number, text: string}[]} */
  const region = []
  /** Terminador do bloco aberto, ou null. */
  let open = null

  for (; i < lines.length; i++) {
    const raw = lines[i]
    const trimmed = raw.trim()

    if (open !== null) {
      region.push({ line: i + 1, text: raw })
      if (trimmed.includes(open)) open = null
      continue
    }
    if (trimmed === "") {
      region.push({ line: i + 1, text: raw })
      continue
    }
    if (syntax.line.test(trimmed) || syntax.star?.test(trimmed) === true) {
      region.push({ line: i + 1, text: raw })
      continue
    }
    const block = syntax.blocks.find(([start]) => trimmed.startsWith(start))
    if (block) {
      region.push({ line: i + 1, text: raw })
      const [start, end] = block
      const sameLine = trimmed.slice(start.length).includes(end)
      if (!sameLine) open = end
      continue
    }
    break
  }
  return region
}

/**
 * O veredito de UM arquivo.
 *
 * @param {string} content
 * @param {string} ext
 * @returns {{ok: boolean, missing: string[], headerLines: number, codeLine: number|null}}
 */
export function documentedHeader(content, ext = ".mjs") {
  const region = headerRegion(content, ext)
  const missing = []
  if (!region.some((l) => USAGE_RE.test(commentText(l.text)))) missing.push("Usage:")
  if (!region.some((l) => EXIT_RE.test(commentText(l.text)))) missing.push("Exit code")
  return {
    ok: missing.length === 0,
    missing,
    headerLines: region.filter((l) => l.text.trim() !== "").length,
    codeLine: firstCodeLine(content, ext),
  }
}

/**
 * A primeira linha de CODIGO (1-based), ou null quando o arquivo e so cabecalho.
 *
 * Usada so para o relatorio: e ela que transforma "falta Usage:" em "falta
 * Usage: na regiao que termina aqui" — sem isso, o remedio seria generico.
 *
 * @param {string} content
 * @param {string} [ext]
 * @returns {number|null}
 */
export function firstCodeLine(content, ext = ".mjs") {
  const lines = String(content ?? "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
  // O `split` de um arquivo terminado em newline cria um elemento vazio final
  // que NAO e uma linha do arquivo — contar com ele inventaria uma linha de codigo.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()

  const region = headerRegion(content, ext)
  const afterShebang = /^#!/.test(lines[0] ?? "") ? 1 : 0
  const end = region.length > 0 ? region[region.length - 1].line : afterShebang
  const candidate = end + 1
  return candidate > lines.length ? null : candidate
}

/** O arquivo tem extensao com contrato de cabecalho? */
export function isHeaderCheckable(fileName) {
  return HEADER_EXTENSIONS.some((e) => fileName.endsWith(e))
}

/**
 * A lista de ignorados: os built-in mais o `.barrel-lint-ignore` do repositorio.
 *
 * @param {string} root
 * @param {{readFile?: (p: string) => string, exists?: (p: string) => boolean}} [io]
 * @returns {string[]}
 */
export function ignoreList(root, { readFile = readFileSync, exists = existsSync } = {}) {
  const path = join(root, IGNORE_FILE)
  if (!exists(path)) return [...BUILTIN_IGNORES]
  try {
    const entries = readFile(path, "utf-8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"))
    return [...BUILTIN_IGNORES, ...entries]
  } catch {
    // Um ignore ilegivel nao pode virar "tudo ignorado": segue so com os built-in.
    return [...BUILTIN_IGNORES]
  }
}

/**
 * Varre um diretorio e devolve o que falta em cada arquivo.
 *
 * Um arquivo IGNORADO nao e varrido, e o relatorio diz quantos foram — a
 * diferenca entre "documentado" e "nao olhado" precisa aparecer no numero.
 *
 * @param {{dir?: string, root?: string, readDir?: Function, readFile?: Function, exists?: Function}} [args]
 * @returns {{ok: boolean, dir: string, checked: string[], ignored: string[], violations: {name: string, missing: string[], codeLine: number|null, headerLines: number}[], error?: string}}
 */
export function scanHeaders({
  dir = DEFAULT_DIR,
  root = process.cwd(),
  readDir = readdirSync,
  readFile = readFileSync,
  exists = existsSync,
} = {}) {
  const abs = join(root, dir)
  if (!exists(abs)) {
    return {
      ok: false,
      dir,
      checked: [],
      ignored: [],
      violations: [],
      error: `diretorio inexistente: ${dir}`,
    }
  }
  const ignore = ignoreList(root, { readFile, exists })
  const checked = []
  const ignored = []
  const violations = []

  for (const entry of readDir(abs, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    if (!isHeaderCheckable(entry.name)) continue
    if (ignore.includes(entry.name)) {
      ignored.push(entry.name)
      continue
    }
    const ext = entry.name.slice(entry.name.lastIndexOf("."))
    const content = readFile(join(abs, entry.name), "utf-8")
    const verdict = documentedHeader(content, ext)
    checked.push(entry.name)
    if (!verdict.ok) {
      violations.push({
        name: entry.name,
        missing: verdict.missing,
        codeLine: verdict.codeLine,
        headerLines: verdict.headerLines,
      })
    }
  }

  checked.sort()
  ignored.sort()
  violations.sort((a, b) => a.name.localeCompare(b.name))
  return { ok: violations.length === 0, dir, checked, ignored, violations }
}

/** O exit code de um resultado. */
export function exitCodeFor(result) {
  if (result.error) return EXIT.UNAVAILABLE
  return result.ok ? EXIT.OK : EXIT.VIOLATIONS
}

/** O remedio de UM arquivo, derivado do que falta (nao e texto generico). */
export function remedyFor(violation) {
  const fixes = violation.missing.map((m) =>
    m === "Usage:" ? "uma secao `Usage:`" : "uma secao `Exit code`",
  )
  const where =
    violation.codeLine === null
      ? "no cabecalho do arquivo"
      : `no bloco de documentacao lider (o codigo comeca na linha ${violation.codeLine})`
  return `acrescente ${fixes.join(" e ")} ${where}`
}

/**
 * O relatorio.
 *
 * @param {ReturnType<typeof scanHeaders>} result
 * @param {{emit?: (s?: string) => void, list?: boolean}} [opts]
 */
export function renderReport(result, { emit = console.log, list = false } = {}) {
  const line = (s = "") => emit(s)
  if (result.error) {
    line(`check-script-headers: ${result.error}`)
    return
  }
  if (list) {
    for (const name of result.checked) line(`${result.dir}/${name}`)
    return
  }
  if (result.ok) {
    line(
      `check-script-headers: ✅ ${result.checked.length} script(s) com cabecalho documentado (Usage + Exit code) em ${result.dir}/`,
    )
    // O número de ignorados aparece SEMPRE que existe: a diferença entre
    // "documentado" e "não olhado" não pode ficar só no --json.
    if (result.ignored.length > 0) {
      line(
        `  · ${result.ignored.length} ignorado(s) por ${IGNORE_FILE} — fora do contrato, não cobertos (--json lista)`,
      )
    }
    return
  }
  line("")
  line("  ═══════════════════════════════════════════════════════════════════════")
  line("   📄 CABEÇALHO DE SCRIPT — o arquivo não diz como se usa nem o que devolve")
  line("  ═══════════════════════════════════════════════════════════════════════")
  line("")
  line(`  ${result.violations.length} de ${result.checked.length} script(s) em ${result.dir}/:`)
  line("")
  for (const v of result.violations) {
    line(`  ❌ ${result.dir}/${v.name} — falta ${v.missing.join(" e ")}`)
    line(`     → ${remedyFor(v)}`)
  }
  line("")
  line("  O contrato é o BLOCO DE DOCUMENTAÇÃO LÍDER (as linhas de comentário do")
  line("  topo, até a primeira linha de código) — a posição dentro dele não importa.")
  if (result.ignored.length > 0) {
    line(`  ${result.ignored.length} arquivo(s) ficam fora do contrato por ${IGNORE_FILE}.`)
  }
  line("")
}

export const USAGE = `check-script-headers — exige Usage: e Exit code no cabeçalho de cada script

Usage:
  node scripts/check-script-headers.mjs [opções]

Opções:
  --dir <path>   diretório a varrer (default: ${DEFAULT_DIR})
  --list         lista os arquivos varridos (sem veredito)
  --json         saída estruturada
  -h, --help     esta ajuda

O contrato é o BLOCO DE DOCUMENTAÇÃO LÍDER do arquivo (as linhas de comentário do
topo, até a primeira linha de código; shebang não conta), e não "as primeiras N
linhas": um \`Usage:\` citado no meio do corpo não conta, e um cabeçalho de 80
linhas passa. Quem não é varrido está em ${IGNORE_FILE} (ou é helper interno).

Exit codes:
  0 — todo script varrido está documentado
  1 — pelo menos um script sem a documentação
  2 — infra: diretório inexistente
  3 — uso inválido`

/**
 * @param {string[]} argv
 * @returns {{dir: string, list: boolean, json: boolean, help: boolean, error?: string}}
 */
export function parseArgs(argv) {
  const opts = { dir: DEFAULT_DIR, list: false, json: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--list") opts.list = true
    else if (arg === "--json") opts.json = true
    else if (arg === "-h" || arg === "--help") opts.help = true
    else if (arg === "--dir") {
      const next = argv[++i]
      if (next === undefined || next.startsWith("--"))
        return { ...opts, error: "--dir exige um caminho" }
      opts.dir = next
    } else if (arg.startsWith("-")) return { ...opts, error: `argumento desconhecido: ${arg}` }
  }
  return opts
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.error) {
    console.error(`check-script-headers: ${opts.error}`)
    console.error(USAGE)
    process.exit(EXIT.USAGE)
  }
  if (opts.help) {
    console.log(USAGE)
    process.exit(EXIT.OK)
  }
  const result = scanHeaders({ dir: opts.dir })
  if (opts.json) {
    console.log(JSON.stringify({ ...result, exitCode: exitCodeFor(result) }, null, 2))
  } else {
    renderReport(result, { list: opts.list })
  }
  process.exit(exitCodeFor(result))
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (IS_DIRECT_RUN) main()
