#!/usr/bin/env node

// =============================================================================
// check-prove-docs.mjs
//
// Usage:
//   node scripts/check-prove-docs.mjs            # varre docs/ + README.md
//   node scripts/check-prove-docs.mjs --root X   # fixture (testes)
//   node scripts/check-prove-docs.mjs --json     # mesmo relatório, formato plano
//
// Exit codes:
//   0 — todo comando da família tem bloco documentado E a saída REAL bateu com
//       ele (exit declarado + linhas exigidas)
//   1 — violação: comando sem bloco, bloco órfão/duplicado, campo inválido, exit
//       real fora do declarado, linha exigida ausente da saída real
//   2 — infra: package.json ilegível, nenhuma fonte de documentação encontrada
//
// POR QUE EXISTE (o buraco entre "está documentado" e "a documentação está certa")
//
// A família `prove-*`/`doctor` só vale pelo que ela PROMETE: "a forja pode
// confiar o merge a este gate?". Cada comando dessa família devolve um tri-estado
// (provado / violado / indeterminado) e um texto que é lido por quem opera a
// forja. Duas coisas dão errado em silêncio:
//
//   1. COBERTURA — um comando novo da família entra sem resultado esperado
//      documentado. Quem lê a doc não sabe o que ele imprime, nem o que significa
//      cada desfecho, e o comando passa a se explicar só para quem o roda;
//   2. FIDELIDADE — a doc continua descrevendo a saída de ANTES. Um marcador
//      renomeado, um `--json` que trocou de shape, um veredito que passou a sair
//      por outro caminho: a doc passa a MENTIR com aparência de rigor, e é pior
//      que a ausência dela (quem confia no bloco documentado confia em nada).
//
// O CONTRATO (o bloco documentado): em qualquer Markdown de `docs/` (ou no
// README), imediatamente ANTES da cerca de saída:
//
//   <!-- prove-doc: <nome do comando em package.json>
//        run: <argumentos acrescentados ao comando>
//        exit: <n>|<n>...            desfechos aceitos (o comando documenta os seus)
//        cenario: ambiente|docker-ausente
//        desfecho: provado|indeterminado
//   -->
//
//   ```text
//   <linha que tem de aparecer na saída REAL>
//   ```
//
// O bloco NÃO é decorativo: é a asserção. O guard EXECUTA o comando (com os
// argumentos e o cenário declarados) e compara — exit real ∈ `exit:` e cada linha
// exigida presente na saída (substring, com espaços normalizados, para o
// pretty-print não virar falso negativo). Divergir é exit 1, com o diff dito.
//
// A FAMÍLIA É DERIVADA, não listada: os comandos de package.json que invocam uma
// prova (`scripts/prove-*.mjs`), o `--prove` do `ensure-runner-image.mjs` (a
// prova do bloqueio da imagem) ou o `forge-doctor.mjs`. Um comando novo entra
// sozinho — e falha até alguém escrever o bloco dele. O inverso também fecha: um
// bloco que aponta para comando FORA da família é violação (doc descrevendo o
// que não existe).
//
// POR QUE `cenario: docker-ausente` EXISTE: SEIS provas da família (runtime,
// smoke-render, merge-gate, image-contract, forge-smoke e gitea-registry)
// exigem docker, imagem do runner ou um Gitea
// efêmero — não são reproduzíveis num runner de PR. O guard não finge que são:
// ele EXECUTA essas provas com o `docker` AUSENTE de propósito (shim no PATH) e
// exige o desfecho `indeterminado` que elas DOCUMENTAM ter nesse cenário. Isso
// não é cerimônia: a invariante verificada é justamente a que este repositório
// mais trata como regra — ausência de prova NUNCA vira sucesso. Um comando que
// passe a sair 0 sem ter provado nada é pego AQUI, de forma hermética e em ~1s.
// O caminho PROVADO dessas seis exige docker e é do operador (a doc diz onde).
// O conjunto é DERIVADO dos blocos: um cenário novo num bloco muda a conta, e a
// doc (§18 do GUARDS.md) declara o mesmo número — os dois lados dizem SEIS.
// (Era SETE: o `pre-commit-in-runner:prove` saiu do cenário em 30/09/2026 — na
// forja ele roda DENTRO da imagem do runner e PROVA de verdade; o bloco dele
// declara os dois desfechos medidos na lista do `exit:`.)
//
// O desfecho observado é REPORTADO, nunca presumido: um bloco
// `desfecho: indeterminado` que casa conta como "indeterminado (declarado)" e
// NÃO como "a prova passou" — o relatório separa as duas coisas, porque a única
// mentira que este guard não pode cometer é a que ele existe para impedir.
//
// RECURSÃO DITA: o guard executa `doctor --ci`, e o doctor (perfil `--ci`)
// PULA a bateria de guards — é a mesma razão do `--no-guards` do perfil, e por
// isso este gate não se chama a si mesmo.
// =============================================================================

import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join, relative, sep } from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

/** Onde os blocos documentados podem viver (o guard varre estas raízes). */
export const DOC_ROOTS = ["docs", "README.md"]

/** O nome do marcador do bloco. */
export const DOC_MARKER = "prove-doc"

/** Os valores aceitos em `cenario:`. */
export const CENARIOS = ["ambiente", "docker-ausente"]

/** Os valores aceitos em `desfecho:`. */
export const DESFECHOS = ["provado", "indeterminado"]

/** Os campos obrigatórios do marcador (o nome do comando vem antes deles). */
export const REQUIRED_FIELDS = ["run", "exit", "cenario", "desfecho"]

/**
 * A FAMÍLIA, derivada: o valor de um script de package.json que invoca uma prova
 * (`scripts/prove-*.mjs`), o `--prove` do ensure (que delega para a prova do
 * bloqueio da imagem) ou o próprio doctor. O `forge-doctor-issue.mjs` fica FORA
 * de propósito: ele PUBLICA o veredito, não o mede — não há saída de prova nele.
 *
 * @type {RegExp}
 */
export const FAMILY_RE = /(?:^|[\s"'/])prove-[a-z0-9-]+\.mjs|--prove(?=[\s"']|$)|forge-doctor\.mjs/

/** Metacaractere de shell: o guard executa por LISTA de argumentos, não por shell. */
const SHELL_META_RE = /["'`$|&;<>()\\*?\n]/

/** O tempo máximo por execução — um comando que trava não vira "provado". */
export const DEFAULT_TIMEOUT_MS = 180000

/**
 * A família de comandos, derivada dos scripts de package.json.
 *
 * @param {Record<string, string>} pkgScripts
 * @returns {{name: string, value: string, argv: string[], error: string|null}[]}
 */
export function discoverFamily(pkgScripts = {}) {
  const family = []
  for (const [name, raw] of Object.entries(pkgScripts)) {
    if (typeof raw !== "string" || !FAMILY_RE.test(raw)) continue
    const value = raw.trim()
    const shell = SHELL_META_RE.test(value)
    family.push({
      name,
      value,
      argv: shell ? [] : value.split(/\s+/).filter(Boolean),
      // Um valor com metacaractere de shell não pode ser tokenizado em
      // silêncio: o guard executa por LISTA de argumentos, nunca por shell —
      // `a; b` executaria outra coisa (mesmo racional do `gateCommand` do doctor).
      error: shell
        ? `o comando '${name}' tem metacaractere de shell no valor (${JSON.stringify(value)}): o guard executa por lista de argumentos, nunca por shell`
        : null,
    })
  }
  return family.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Lista os Markdown que podem conter blocos — `docs/**` (recursivo) e o README.
 *
 * @param {string} root
 * @returns {string[]} caminhos absolutos
 */
export function docSources(root) {
  const out = []
  for (const entry of DOC_ROOTS) {
    const p = join(root, entry)
    if (!existsSync(p)) continue
    const st = statSync(p)
    if (st.isDirectory()) {
      for (const f of readdirSync(p, { recursive: true })) {
        const rel = String(f)
        if (/\.md$/i.test(rel)) out.push(join(p, rel))
      }
    } else if (/\.md$/i.test(entry)) {
      out.push(p)
    }
  }
  return out.sort()
}

/**
 * Quebra o conteúdo de um bloco (as linhas entre `<!-- prove-doc:` e `-->`) nos
 * campos. A primeira linha é o NOME do comando; as demais são `campo: valor`.
 *
 * @param {string[]} head
 * @returns {{command: string, fields: Record<string,string>, errors: string[]}}
 */
export function parseMarkerHead(head) {
  const errors = []
  const command = (head[0] ?? "").replace(/-->\s*$/, "").trim()
  const fields = {}
  if (!command) errors.push("o marcador não nomeia o comando (`<!-- prove-doc: <nome>`)")
  for (const raw of head.slice(1)) {
    const line = raw.replace(/-->\s*$/, "").trim()
    if (line === "") continue
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/)
    if (!m) {
      errors.push(`linha do marcador não é 'campo: valor': ${JSON.stringify(raw.trim())}`)
      continue
    }
    if (Object.hasOwn(fields, m[1])) errors.push(`campo repetido: '${m[1]}'`)
    fields[m[1]] = m[2].trim()
  }
  return { command, fields, errors }
}

/**
 * Valida os campos de um bloco e devolve as violações (com o `desfecho` já
 * normalizado em `fields`).
 *
 * @param {string} where  identificação legível (arquivo:linha)
 * @param {Record<string,string>} fields
 * @returns {string[]}
 */
export function validateFields(where, fields) {
  const errors = []
  for (const key of REQUIRED_FIELDS) {
    if (!Object.hasOwn(fields, key)) errors.push(`${where}: campo obrigatório ausente: '${key}'`)
  }
  const known = new Set(REQUIRED_FIELDS)
  for (const key of Object.keys(fields)) {
    if (!known.has(key)) errors.push(`${where}: campo desconhecido: '${key}'`)
  }
  if (Object.hasOwn(fields, "exit")) {
    const codes = fields.exit.split("|").map((s) => s.trim())
    if (codes.length === 0 || codes.some((c) => !/^\d+$/.test(c))) {
      errors.push(
        `${where}: 'exit' tem de ser códigos separados por '|' (ex.: '0' ou '1|2'): ${JSON.stringify(fields.exit)}`,
      )
    }
  }
  for (const [key, allowed] of [
    ["cenario", CENARIOS],
    ["desfecho", DESFECHOS],
  ]) {
    if (Object.hasOwn(fields, key) && !allowed.includes(fields[key])) {
      errors.push(
        `${where}: '${key}' tem de ser ${allowed.map((a) => `'${a}'`).join(" ou ")}: ${JSON.stringify(fields[key])}`,
      )
    }
  }
  return errors
}

/**
 * Extrai os blocos de um Markdown: o marcador (com os campos) MAIS a cerca de
 * saída esperada logo depois. Um marcador sem cerca é violação própria — o
 * bloco sem asserção não prova nada (e é o defeito que este guard existe para
 * não deixar passar).
 *
 * @typedef {object} ProveDocBlock
 * @property {string} command
 * @property {string} run
 * @property {string} exit
 * @property {string} cenario
 * @property {string} desfecho
 * @property {string[]} expected
 * @property {string} source
 * @property {number} line
 * @property {string} where
 * @property {boolean} malformed
 *
 * @param {string} markdown
 * @param {string} source  caminho relativo (para a mensagem)
 * @returns {{blocks: ProveDocBlock[], errors: string[]}}
 */
export function parseDocBlocks(markdown, source = "<mem>") {
  const lines = markdown.split(/\r?\n/)
  const blocks = []
  const errors = []
  const marker = new RegExp(`^\\s*<!--\\s*${DOC_MARKER}:\\s*(.*)$`)
  // Um marcador DENTRO de uma cerca é EXEMPLO (a seção que documenta o formato
  // não pode virar, ela própria, um bloco — e um bloco fantasma seria "órfão").
  // Por isso a varredura pula regiões cercadas; o bloco de verdade é lido fora
  // delas, e o salto até a cerca de saída mantém o balanço do estado.
  //
  // A cerca é contada pelo COMPRIMENTO das aspas reversas: um exemplo dentro de
  // uma cerca de quatro crases contém cercas de trás — tratá-las como fim do
  // bloco exporia o exemplo (e o marcador dele) à varredura.
  let fenceLen = 0

  for (let i = 0; i < lines.length; i++) {
    const fence = lines[i].match(/^\s*(`{3,})/)
    if (fence) {
      if (fenceLen === 0) fenceLen = fence[1].length
      else if (fence[1].length >= fenceLen) fenceLen = 0
      continue
    }
    if (fenceLen > 0) continue
    const m = lines[i].match(marker)
    if (!m) continue
    const at = `${source}:${i + 1}`

    // ── o marcador: da linha do `prove-doc:` até a que fecha o comentário ──
    const head = [m[1]]
    let j = i + 1
    let closed = /-->/.test(m[1])
    while (!closed && j < lines.length) {
      head.push(lines[j])
      if (/-->/.test(lines[j])) closed = true
      j += 1
    }
    if (!closed) {
      errors.push(`${at}: o comentário do bloco não fecha com '-->'`)
      break
    }
    const { command, fields, errors: headErrors } = parseMarkerHead(head)
    for (const e of headErrors) errors.push(`${at}: ${e}`)

    // ── a cerca de saída esperada (a ASSERÇÃO) ──
    let k = j
    while (k < lines.length && lines[k].trim() === "") k += 1
    const fenceOpen = lines[k]?.match(/^\s*```(\w*)\s*$/)
    if (!fenceOpen) {
      errors.push(
        `${at}: o bloco de '${command || "?"}' não tem a cerca com a SAÍDA ESPERADA logo depois do marcador — um bloco sem asserção não prova nada`,
      )
      i = j
      continue
    }
    const expected = []
    let l = k + 1
    let fenceClosed = false
    for (; l < lines.length; l++) {
      if (/^\s*```\s*$/.test(lines[l])) {
        fenceClosed = true
        break
      }
      if (lines[l].trim() !== "") expected.push(lines[l])
    }
    if (!fenceClosed) {
      errors.push(`${at}: a cerca da saída esperada não fecha`)
      break
    }
    if (expected.length === 0) {
      errors.push(
        `${at}: a cerca da saída esperada está VAZIA — sem linha exigida não há o que comparar`,
      )
    }

    const where = `${at} ('${command || "?"}')`
    const fieldErrors = validateFields(where, fields)
    for (const e of fieldErrors) errors.push(e)

    blocks.push({
      command,
      run: fields.run ?? "",
      exit: fields.exit ?? "",
      cenario: fields.cenario,
      desfecho: fields.desfecho,
      expected,
      source,
      line: i + 1,
      where,
      // Bloco com erro de FORMA não é executado: medir a saída de um bloco
      // malformado mediria outra coisa (a violação de forma já basta).
      malformed: fieldErrors.length > 0,
    })
    i = l
  }
  return { blocks, errors }
}

/**
 * Os nomes dos comandos descobertos, para o relatório e para os testes.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function familyNames(root = REPO_ROOT) {
  return discoverFamily(loadPkgScripts(root)).map((c) => c.name)
}

/**
 * Cobertura nos DOIS sentidos: todo comando da família tem UM bloco, e todo
 * bloco aponta para um comando da família. Um comando novo sem bloco falha; um
 * bloco descrevendo um comando que não existe (renomeado/removido) também.
 *
 * @param {{name: string, value?: string, argv?: string[]}[]} family
 * @param {{command: string, where: string}[]} blocks
 * @returns {string[]}
 */
export function checkCoverage(family, blocks) {
  const errors = []
  const names = new Set(family.map((c) => c.name))
  const byCommand = new Map()
  for (const b of blocks) {
    if (!byCommand.has(b.command)) byCommand.set(b.command, [])
    byCommand.get(b.command).push(b)
  }
  for (const c of family) {
    const found = byCommand.get(c.name) ?? []
    if (found.length === 0) {
      errors.push(
        `comando '${c.name}' (${c.value ?? c.argv.join(" ")}) não documenta o RESULTADO ESPERADO — escreva o bloco '<!-- ${DOC_MARKER}: ${c.name} -->' com a cerca da saída (exit + linhas exigidas)`,
      )
    } else if (found.length > 1) {
      errors.push(
        `comando '${c.name}' tem ${found.length} blocos documentados (${found.map((b) => b.where).join(", ")}) — a fonte da asserção tem de ser ÚNICA`,
      )
    }
  }
  for (const [command, found] of byCommand) {
    if (!names.has(command)) {
      errors.push(
        `bloco órfão em ${found[0].where}: '${command}' NÃO é um comando da família ${DOC_MARKER} (renomeado ou removido?) — os comandos da família são derivados de package.json`,
      )
    }
  }
  return errors
}

/** Colapsa espaços/quebras para que o pretty-print não vire falso negativo. */
export function normalizeOutput(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * As linhas exigidas que NÃO aparecem na saída real (comparação por substring,
 * com espaços normalizados).
 *
 * @param {string} output
 * @param {string[]} expected
 * @returns {string[]}
 */
export function missingLines(output, expected) {
  const hay = normalizeOutput(output)
  return expected.filter((line) => !hay.includes(normalizeOutput(line)))
}

/** As primeiras linhas da saída real, para a mensagem de divergência. */
function tailOf(output, n = 14) {
  return String(output ?? "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .slice(0, n)
    .map((l) => `       │ ${l}`)
    .join("\n")
}

/**
 * Executa um bloco e devolve o desfecho observado.
 *
 * `cenario: docker-ausente` monta um `docker` de mentira (exit 127) no começo do
 * PATH: a prova roda de verdade e responde o que ela DOCUMENTA responder quando
 * não há docker para provar nada. O cenário é criado de propósito — é o que
 * torna o desfecho determinístico (e independe de a máquina ter imagem, socket
 * ou rede).
 *
 * @param {{name: string, argv: string[]}} command
 * @param {object} block
 * @param {{root?: string, timeoutMs?: number, spawn?: Function, shimRoot?: string}} [deps]
 * @returns {{ok: boolean, code: number|null, signal: string|null, output: string, divergences: string[]}}
 */
export function runBlock(command, block, deps = {}) {
  const { root = REPO_ROOT, timeoutMs = DEFAULT_TIMEOUT_MS, spawn = spawnSync, shimRoot } = deps
  const argv = [...command.argv, ...block.run.split(/\s+/).filter(Boolean)]
  const divergences = []

  let env = process.env
  let shimDir = null
  if (block.cenario === "docker-ausente") {
    shimDir = mkdtempSync(join(shimRoot ?? tmpdir(), "prove-docs-shim-"))
    writeFileSync(join(shimDir, "docker"), "#!/bin/sh\nexit 127\n", { mode: 0o755 })
    env = { ...process.env, PATH: `${shimDir}${delimiter}${process.env.PATH ?? ""}` }
  }

  try {
    const res = spawn(argv[0], argv.slice(1), {
      cwd: root,
      encoding: "utf8",
      timeout: timeoutMs,
      env,
    })
    const output = `${res.stdout ?? ""}\n${res.stderr ?? ""}`
    const code = typeof res.status === "number" ? res.status : null

    if (res.error && res.error.code === "ETIMEDOUT") {
      // O `timeout` do spawnSync mata o filho e chega como ETIMEDOUT: é o caso
      // "não terminou", não "não foi possível executar" — e um comando que
      // trava NÃO pode virar prova.
      divergences.push(
        `não terminou em ${Math.round(timeoutMs / 1000)}s (timeout) — trate como NÃO verificado`,
      )
    } else if (res.error) {
      divergences.push(`não foi possível executar (${res.error.message})`)
    } else if (code === null) {
      divergences.push(
        `não terminou em ${Math.round(timeoutMs / 1000)}s (timeout/sinal) — trate como NÃO verificado`,
      )
    } else {
      const allowed = block.exit.split("|").map((s) => Number(s.trim()))
      if (!allowed.includes(code)) {
        divergences.push(
          `exit ${code} — o bloco documenta ${allowed.join(" ou ")}; o desfecho declarado ('${block.desfecho}') não é o que o comando produziu`,
        )
      }
    }
    const missing = missingLines(output, block.expected)
    for (const line of missing) {
      // Aspas simples reversas: a linha vem da DOC (pode ter espaços/aspas) e
      // precisa ser citada como está — `JSON.stringify` escaparia as aspas e o
      // operador leria a mensagem errada.
      divergences.push(`linha exigida AUSENTE na saída real: \`${line}\``)
    }
    return { ok: divergences.length === 0, code, signal: res.signal ?? null, output, divergences }
  } finally {
    if (shimDir) rmSync(shimDir, { recursive: true, force: true })
  }
}

/** Guarda o relatório em texto, com o desfecho de cada comando NOMEADO. */
export function renderReport(report, { emit = console.log } = {}) {
  const line = (s = "") => emit(s)
  line()
  line("  ═════════════════════════════════════════════════════════════════")
  line("   📄 CONTRATO DE DOCUMENTAÇÃO DAS PROVAS — check:prove-docs")
  line("  ═════════════════════════════════════════════════════════════════")
  line()
  for (const r of report.results) {
    const where = `${r.source}:${r.line}`
    if (r.ok) {
      const label = r.desfecho === "provado" ? "provado" : "indeterminado (declarado)"
      line(`  ✅ ${r.command.padEnd(22)} ${label.padEnd(26)} exit ${r.code} · ${where}`)
    } else {
      line(`  ❌ ${r.command.padEnd(22)} DIVERGENTE — ${where}`)
      for (const d of r.divergences) line(`       · ${d}`)
      if (r.output) line(tailOf(r.output))
    }
  }
  line()
  if (report.violations.length > 0) {
    line(`  ❌ ${report.violations.length} violação(ões) do contrato de documentação:`)
    for (const v of report.violations) line(`       · ${v}`)
    line()
    line("  VEREDITO: ❌ a documentação das provas NÃO bate com a saída real")
  } else {
    const provados = report.results.filter((r) => r.ok && r.desfecho === "provado").length
    const indet = report.results.filter((r) => r.ok && r.desfecho === "indeterminado").length
    line(
      `  VEREDITO: ✅ ${report.results.length} comando(s) da família com bloco documentado e saída conferida`,
    )
    line(
      `             ${provados} provado(s) AQUI · ${indet} indeterminado(s) DECLARADO(s) (o caminho provado desses é do operador, com docker)`,
    )
  }
  line()
}

/** Carrega os scripts de package.json (exit 2 se ilegível). */
function loadPkgScripts(root) {
  const p = join(root, "package.json")
  if (!existsSync(p)) {
    console.error(`❌ package.json ausente: ${p}`)
    process.exit(2)
  }
  try {
    return JSON.parse(readFileSync(p, "utf8")).scripts ?? {}
  } catch (err) {
    console.error(`❌ package.json ilegível: ${err?.message ?? String(err)}`)
    process.exit(2)
  }
}

/**
 * O veredito completo: descobre a família, lê os blocos das fontes, cobra a
 * cobertura e CONFRONTA cada bloco com a saída real.
 *
 * @param {{root?: string, spawn?: Function, timeoutMs?: number, shimRoot?: string}} [args]
 */
export function audit({ root = REPO_ROOT, spawn, timeoutMs, shimRoot } = {}) {
  const family = discoverFamily(loadPkgScripts(root))
  // Sem NENHUMA fonte de documentação a cobertura acusa TODOS os comandos — que
  // é o diagnóstico certo (falta o bloco), e não um erro de infraestrutura.
  const sources = docSources(root)

  const violations = []
  for (const c of family) if (c.error) violations.push(c.error)
  const blocks = []
  for (const source of sources) {
    const rel = relative(root, source).split(sep).join("/")
    const { blocks: found, errors } = parseDocBlocks(readFileSync(source, "utf8"), rel)
    violations.push(...errors)
    blocks.push(...found)
  }
  violations.push(...checkCoverage(family, blocks))

  // ── o confronto com a saída REAL (só para blocos bem formados) ──
  const results = []
  for (const block of blocks) {
    const command = family.find((c) => c.name === block.command)
    if (!command || command.error) {
      results.push({
        command: block.command,
        source: block.source,
        line: block.line,
        desfecho: block.desfecho,
        ok: false,
        code: null,
        output: "",
        divergences: [
          command
            ? `o comando não pode ser executado: ${command.error}`
            : "comando fora da família — nada a executar",
        ],
      })
      continue
    }
    const where = `${block.source}:${block.line}`
    if (block.malformed) {
      results.push({
        command: block.command,
        source: block.source,
        line: block.line,
        desfecho: block.desfecho,
        ok: false,
        code: null,
        output: "",
        divergences: ["bloco malformado (ver as violações de forma acima)"],
      })
      continue
    }
    const run = runBlock(command, block, { root, spawn, timeoutMs, shimRoot })
    results.push({
      command: block.command,
      source: block.source,
      line: block.line,
      desfecho: block.desfecho,
      ok: run.ok,
      code: run.code,
      output: run.output,
      divergences: run.divergences,
    })
    if (!run.ok) {
      for (const d of run.divergences)
        violations.push(`'${block.command}' diverge do bloco documentado (${where}): ${d}`)
    }
  }

  return { family, blocks, results, violations }
}

function parseArgs(argv) {
  const opts = { root: REPO_ROOT, json: false, error: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--json") opts.json = true
    else if (a === "--root") opts.root = argv[++i]
    else opts.error = `argumento desconhecido: ${a}`
  }
  if (!opts.root) opts.error = "--root exige um caminho"
  return opts
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.error) {
    console.error(`check-prove-docs: ${opts.error}`)
    console.error("  Uso: node scripts/check-prove-docs.mjs [--root <dir>] [--json]")
    process.exit(2)
  }
  const report = audit({ root: opts.root })
  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          ok: report.violations.length === 0,
          family: report.family.map((c) => c.name),
          results: report.results.map((r) => ({
            command: r.command,
            source: r.source,
            line: r.line,
            desfecho: r.desfecho,
            ok: r.ok,
            exit: r.code,
            divergences: r.divergences,
          })),
          violations: report.violations,
        },
        null,
        2,
      ),
    )
  } else {
    renderReport(report)
  }
  process.exit(report.violations.length === 0 ? 0 : 1)
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar a varredura.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()
