#!/usr/bin/env node

// =============================================================================
// check-lint-scope.mjs
//
// Guard de ESCOPO do lint: todo DIRETORIO versionado cujo arquivo o PRETTIER
// JULGA tem de estar coberto pelos globs do script `lint` do package.json — ou
// declarado fora, com o motivo escrito.
//
// POR QUE ELE EXISTE (o defeito medido)
//
// O lint tem duas pernas: `prettier --check --ignore-unknown <globs>` e
// `eslint . --max-warnings 0`. A segunda e do repo INTEIRO; a primeira era uma
// LISTA A MAO de 10 globs. O hook local (`pre-commit`, lint-staged) julga
// QUALQUER arquivo estagiado — entao a lista do lint e o unico lugar onde um
// commit pode passar no hook e o MESMO arquivo nao ser julgado por ninguem no
// merge. Medido nesta arvore (2048 arquivos versionados, 26 diretorios de topo):
//
//   - 13 diretorios com arquivo que o prettier julga ficavam FORA da lista:
//     `.gitea/` (as workflows da forja DONA DO MERGE!), `ci/`, `deploy/`,
//     `e2e/`, `monitoring/`, `loadtest/`, `agent-ctx/`, `types/`, `config/`,
//     `examples/`, `k6/`, `mini-services/`, `public/`, `secrets/`;
//   - e as extensoes de raiz `*.cjs`/`*.js` (`ecosystem.config.cjs`).
//
// O caso que expoe a classe nao e hipotetico: `ci/unproven.json` (arquivo
// versionado de um diretorio fora da lista) estava fora do padrao, o
// `bun run lint` saiu VERDE, e quem o recusou foi a perna do hook — porque o
// hook julga o estagiado e o lint julhava uma lista. O remedio nao e acrescentar
// o diretorio que faltou hoje: e derivar a pergunta de modo que o proximo
// diretorio tambem a responda.
//
// A DERIVACAO (tres fontes, nenhuma lista a mao)
//
//   1. OS GLOBS: o script `lint` do package.json — o MESMO comando que as duas
//      pipelines rodam (`bun run lint`). Os globs sao LIDOS do comando, entao
//      mover a regua para outro lugar nao deixa este guard medindo um fantasma.
//   2. OS ARQUIVOS: `git ls-files` (a arvore versionada) ou, com `--staged`, o
//      INDICE (`--diff-filter=ACMR`) — o mesmo recorte do hook.
//   3. O QUE O PRETTIER JULGA: o ORACULO e o proprio prettier
//      (`getFileInfo` → `inferredParser`), e ele e consultado SO para os
//      arquivos que nenhum glob cobre. No estado sao nao ha candidato, entao o
//      oraculo nao e chamado: o custo do caminho comum e o do `git ls-files`.
//
// A ISENCAO E DECLARADA. Um diretorio que o prettier julga e que fica fora do
// lint de proposito entra em `EXEMPT` com o MOTIVO escrito (o mesmo desenho do
// `check-forge-workflow-scope`): a tabela e conferida nas DUAS direcoes — um
// diretorio fora da lista sem isencao e violacao, e uma isencao que nao casa com
// diretorio nenhum e stale (a declaracao que ninguem revisa). Isencao sem motivo
// nao entra.
//
// A DECLARACAO DE IGNORADOS TAMBEM E CONFERIDA. O `.prettierignore` e a outra
// metade do escopo (e o instrumento certo para o artefato GERADO). Ele estava em
// UTF-16LE — BOM `ff fe` + NUL entre os bytes —, o prettier o le como UTF-8 e
// TODO padrao virava lixo: tres ignores declarados e nenhum valendo. Um guard de
// escopo que aceitasse isso estaria medindo contra uma declaracao que nao
// declara nada, entao o arquivo ilegivel e violacao.
//
// Usage:
//   node scripts/check-lint-scope.mjs            # a arvore versionada inteira
//   node scripts/check-lint-scope.mjs --staged   # so o INDICE (o recorte do hook)
//   node scripts/check-lint-scope.mjs --json     # saida estruturada
//   node scripts/check-lint-scope.mjs --help
//
// Exit codes:
//   0 — todo diretorio com arquivo que o prettier julga esta coberto (ou isento)
//   1 — diretorio fora dos globs do lint (ou declaracao de escopo ilegivel)
//   2 — infra: package.json sem o script `lint`, comando sem globo de prettier,
//       `.prettierignore` ausente/ilegivel ou git indisponivel
//   3 — uso invalido
// =============================================================================

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"

/** Exit codes — o contrato da CLI. */
export const EXIT = { OK: 0, VIOLATIONS: 1, UNAVAILABLE: 2, USAGE: 3 }

/** A fonte dos globs: o script `lint` do package.json (o comando do CI). */
export const PKG = "package.json"
export const LINT_SCRIPT = "lint"

/** A outra metade do escopo: a declaracao de quem o prettier NAO formata. */
export const IGNORE_FILE = ".prettierignore"

/** O instrumento da perna medida — o mesmo binario que o CI roda. */
export const PRETTIER_CMD = "prettier"

/**
 * Isencoes DECLARADAS: diretorio (topo, sem barra) → o MOTIVO escrito.
 *
 * Vazio de proposito: hoje o lint cobre tudo o que o hook julga. A tabela
 * existe porque a proxima decisao ("este diretorio fica fora, e por isso")
 * precisa de um lugar LEGIVEL — e porque uma entrada aqui e conferida nos dois
 * sentidos (isencao orfa e violacao, como no `check-forge-workflow-scope`).
 *
 * @type {Map<string, string>}
 */
export const EXEMPT = new Map([])

/**
 * Os globs do prettier declarados no comando do lint.
 *
 * O comando tem duas pernas separadas por `&&`; a medida e a PRIMEIRA. Dentro
 * dela, o instrumento e o binario `prettier` e todo token que NAO comeca com `-`
 * depois de `--ignore-unknown` e um caminho/globo (as aspas simples do script
 * sao removidas pelo shell, nao pelo parser — por isso sao toleradas aqui).
 *
 * @param {string} command  o script `lint` (ex.: `prettier --check ... && eslint .`)
 * @returns {{globs: string[], error: string|null}}
 */
export function prettierGlobsOf(command) {
  if (typeof command !== "string" || command.trim() === "") {
    return { globs: [], error: "o script `lint` esta vazio" }
  }
  const perna = command.split("&&")[0]
  const tokens = perna
    .split(/\s+/)
    .map((t) => t.replace(/^['"]|['"]$/g, ""))
    .filter((t) => t !== "")
  if (!tokens.includes(PRETTIER_CMD)) {
    return { globs: [], error: "a primeira perna do `lint` nao invoca o prettier" }
  }
  const globs = tokens.filter((t) => !t.startsWith("-") && t !== PRETTIER_CMD)
  if (globs.length === 0) {
    return { globs: [], error: "o comando do prettier nao declara NENHUM globo (mediria nada)" }
  }
  return { globs, error: null }
}

/**
 * O padrao do globo como expressao sobre o caminho RELATIVO a raiz do repo.
 *
 * `**` cruza diretorio (`dir/**` alcanca `dir/a` e `dir/a/b`), `*` e `?` nao.
 * A forma `*.json` (sem barra) casa SO a raiz — a mesma semantica do
 * fast-glob que o prettier usa, e a que torna `-` os globs de raiz do `lint`.
 *
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegExp(glob) {
  let out = ""
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === "*") {
      if (glob[i + 1] === "*") {
        out += ".*"
        i++
      } else {
        out += "[^/]*"
      }
    } else if (c === "?") {
      out += "[^/]"
    } else if ("\\^$.|+()[]{}".includes(c)) {
      out += `\\${c}`
    } else {
      out += c
    }
  }
  return new RegExp(`^${out}$`)
}

/**
 * O caminho e coberto por ALGUM dos globs?
 *
 * @param {string[]} globs
 * @param {string} path  caminho relativo a raiz, com `/`
 * @returns {boolean}
 */
export function coveredBy(globs, path) {
  return globs.some((g) => globToRegExp(g).test(path))
}

/**
 * O diretorio de TOPO de um caminho (`a/b/c.ts` → `a`; `x.ts` → `(raiz)`).
 *
 * @param {string} path
 * @returns {string}
 */
export function topDirOf(path) {
  return path.includes("/") ? path.split("/")[0] : "(raiz)"
}

/**
 * A declaracao de escopo e LEGIVEL pelo prettier?
 *
 * O prettier le este arquivo como UTF-8. Uma declaracao em UTF-16 (BOM `ff fe` /
 * `fe ff`), ou com NUL no meio (o byte que o UTF-16LE insere entre os
 * caracteres), decodifica para lixo: os padroes viram binario, nenhum ignore
 * vale, e o arquivo passa a mentir sem que ninguem veja. Ausente = sem
 * declaracao (e um estado legitimo: o escopo fica integralmente nos globs).
 *
 * @param {string} rel
 * @param {Buffer} buf
 * @returns {{ok: boolean, why: string|null}}
 */
export function ignoreDeclaration(rel, buf) {
  if (
    buf.length >= 2 &&
    ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))
  ) {
    const enc = buf[0] === 0xff ? "UTF-16LE" : "UTF-16BE"
    return {
      ok: false,
      why:
        `${rel} esta em ${enc} (BOM ${buf[0].toString(16)} ${buf[1].toString(16)}) e o prettier o le ` +
        `como UTF-8: os padroes viram binario e NENHUM ignore vale — a declaracao de escopo nao declara nada`,
    }
  }
  if (buf.includes(0)) {
    return {
      ok: false,
      why: `${rel} contem byte NUL (nao e texto UTF-8): o prettier decodifica os padroes como lixo`,
    }
  }
  return { ok: true, why: null }
}

/**
 * O conteudo versionado de um arquivo, lido do INDICE (`git show :path`).
 *
 * No recorte do commit a fonte e o CONTEUDO DO COMMIT, nao o working tree: o
 * `package.json` e a DECLARACAO do escopo, e ler a versao que a arvore tem
 * enquanto o indice carrega outra mede o commit errado (a mesma licao do
 * `check-required-checks --staged` e do `check-mutation-count --staged`).
 *
 * @param {{cwd: string, path: string}} o
 * @returns {{buf: Buffer|null, error: string|null}}
 */
export function fromIndex({ cwd, path }) {
  try {
    return {
      // stderr SILENCIADO: um arquivo que nao esta no indice nao e um erro para
      // quem chama (o `.prettierignore` pode simplesmente nao existir) — e o
      // `fatal:` do git no meio do relatorio de um veredito verde seria ruido.
      buf: execFileSync("git", ["show", `:${path}`], {
        cwd,
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      }),
      error: null,
    }
  } catch (err) {
    return {
      buf: null,
      error: `${path} nao esta no indice (git show :${path}): ${err.message.split("\n")[0]}`,
    }
  }
}

/**
 * Os arquivos que o escopo mede.
 *
 * `staged` le o INDICE (`--diff-filter=ACMR`: o que o commit ACRESCENTA ou
 * reescreve — um arquivo REMOVIDO nao abre buraco de escopo). A arvore vem do
 * `git ls-files` versionado.
 *
 * @param {{cwd: string, staged: boolean}} o
 * @returns {{files: string[], error: string|null}}
 */
export function scopeFiles({ cwd, staged }) {
  const args = staged ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR"] : ["ls-files"]
  try {
    const out = execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    return {
      files: out
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l !== ""),
      error: null,
    }
  } catch (err) {
    return { files: [], error: `git ${args.join(" ")} falhou: ${err.message.split("\n")[0]}` }
  }
}

/**
 * Os candidatos: os arquivos que NENHUM globo cobre (o oraculo decide se o
 * prettier os julga). Isencao declarada remove o diretorio inteiro do
 * julgamento — e a isencao orfa (que nao casa com arquivo nenhum) volta como
 * fato, para nao virar uma tabela que ninguem revisa.
 *
 * @param {{globs: string[], files: string[], exempt: Map<string, string>}} o
 * @returns {{candidates: string[], usedExempt: Set<string>}}
 */
export function candidatesOf({ globs, files, exempt }) {
  const candidates = []
  const usedExempt = new Set()
  for (const f of files) {
    if (coveredBy(globs, f)) continue
    const dir = topDirOf(f)
    if (exempt.has(dir)) {
      usedExempt.add(dir)
      continue
    }
    candidates.push(f)
  }
  return { candidates, usedExempt }
}

/**
 * O ORACULO: o prettier julga este arquivo?
 *
 * `getFileInfo` responde pelo proprio prettier — `inferredParser !== null` e o
 * julgamento (e `ignored: true` quando o `.prettierignore` o declara fora, o que
 * e uma DECISAO e nao uma ausencia).
 *
 * O CAMINHO E ABSOLUTO, e o ignore tambem: o prettier resolve os dois contra o
 * `process.cwd()` do NODE, nao contra o `cwd` que o veredito julga — com o
 * caminho relativo, um `analyze({cwd})` sobre outro diretorio perguntaria pelo
 * arquivo do repositorio de onde o guard foi lancado. Medido: com o par
 * absoluto o ignore casa (e um ignorePath inexistente nao e erro).
 *
 * @param {string} file  caminho relativo a raiz julgada
 * @param {string} cwd   a raiz julgada
 * @returns {{judged: boolean, ignored: boolean}}
 */
async function prettierJudges(file, cwd) {
  const prettier = (await import("prettier")).default
  const info = await prettier.getFileInfo(join(cwd, file), { ignorePath: join(cwd, IGNORE_FILE) })
  return {
    judged: info.inferredParser !== null && info.inferredParser !== undefined,
    ignored: info.ignored === true,
  }
}

/**
 * O veredito completo, medido a partir de `cwd`.
 *
 * @param {{cwd?: string, staged?: boolean, exempt?: Map<string, string>}} [o]
 * @returns {Promise<{exit: number, violations: string[], globs: string[], files: number,
 *   candidates: number, judged: string[], dirs: string[], staged: boolean, scope: string,
 *   error: string|null}>}
 */
export async function analyze({ cwd = process.cwd(), staged = false, exempt = EXEMPT } = {}) {
  const base = {
    exit: EXIT.OK,
    violations: [],
    globs: [],
    files: 0,
    candidates: 0,
    judged: [],
    dirs: [],
    staged,
    scope: "arvore",
    error: null,
  }

  let command
  if (staged) {
    const { buf, error } = fromIndex({ cwd, path: PKG })
    if (error) return { ...base, exit: EXIT.UNAVAILABLE, error }
    try {
      command = JSON.parse(buf.toString("utf8")).scripts?.[LINT_SCRIPT]
    } catch (err) {
      return { ...base, exit: EXIT.UNAVAILABLE, error: `${PKG} do indice ilegivel: ${err.message}` }
    }
  } else {
    const pkgPath = join(cwd, PKG)
    if (!existsSync(pkgPath))
      return { ...base, exit: EXIT.UNAVAILABLE, error: `${PKG} ausente em ${cwd}` }
    try {
      command = JSON.parse(readFileSync(pkgPath, "utf8")).scripts?.[LINT_SCRIPT]
    } catch (err) {
      return { ...base, exit: EXIT.UNAVAILABLE, error: `${PKG} ilegivel: ${err.message}` }
    }
  }
  const { globs, error: globError } = prettierGlobsOf(command)
  if (globError) return { ...base, exit: EXIT.UNAVAILABLE, error: globError }
  base.globs = globs

  const { files, error: gitError } = scopeFiles({ cwd, staged })
  if (gitError) return { ...base, exit: EXIT.UNAVAILABLE, error: gitError }

  // O RECORTE POR RELEVANCIA: mexer na DECLARACAO do escopo (o `package.json` do
  // comando, o `.prettierignore` dos ignores) nao abre buraco num arquivo do
  // commit — abre em TODO o repositorio. Um globo removido nao aparece em
  // arquivo estagiado nenhum (o que foi removido e a linha da declaracao), entao
  // o recorte do commit tem de julgar a ARVORE quando e a declaracao que ele
  // move. E o mesmo desenho do `check-required-checks --staged` ("o recorte e da
  // RELEVANCIA do commit, nao do escopo da comparacao").
  const tocaDeclaracao = staged && files.some((f) => f === PKG || f === IGNORE_FILE)
  let alvo = files
  if (tocaDeclaracao) {
    const arvore = scopeFiles({ cwd, staged: false })
    if (arvore.error) return { ...base, exit: EXIT.UNAVAILABLE, error: arvore.error }
    alvo = arvore.files
    base.scope = "arvore (a declaracao do escopo esta no commit)"
  } else {
    base.scope = staged ? "indice (recorte do hook)" : "arvore"
  }
  base.files = alvo.length

  const { candidates, usedExempt } = candidatesOf({ globs, files: alvo, exempt })
  base.candidates = candidates.length

  for (const dir of exempt.keys()) {
    if (!usedExempt.has(dir)) {
      base.violations.push(
        `isencao DECLARADA sem efeito: '${dir}' nao casa com arquivo nenhum fora dos globs — ` +
          `a tabela EXEMPT deste guard tem uma entrada stale`,
      )
    }
  }

  for (const f of candidates) {
    let verdict
    try {
      verdict = await prettierJudges(f, cwd)
    } catch (err) {
      return {
        ...base,
        exit: EXIT.UNAVAILABLE,
        error: `o oraculo (prettier) nao pode julgar ${f}: ${err.message}`,
      }
    }
    if (!verdict.judged || verdict.ignored) continue
    base.judged.push(f)
    base.violations.push(
      `'${f}' (diretorio '${topDirOf(f)}/') esta fora dos globs do lint e o prettier o JULGA: ` +
        `o hook recusa esse arquivo estagiado e o merge o aceita. ${remedyFor(f)} ` +
        `(ou declare o diretorio em EXEMPT, com o motivo)`,
    )
  }
  base.dirs = [...new Set(base.judged.map(topDirOf))].sort()

  // A declaracao de ignorados: no recorte, a do INDICE (o conteudo do commit).
  const ignoreBuf = staged
    ? fromIndex({ cwd, path: IGNORE_FILE }).buf
    : existsSync(join(cwd, IGNORE_FILE))
      ? readFileSync(join(cwd, IGNORE_FILE))
      : null
  if (ignoreBuf !== null) {
    const verdict = ignoreDeclaration(IGNORE_FILE, ignoreBuf)
    if (!verdict.ok) base.violations.push(verdict.why)
  }

  base.exit = base.violations.length > 0 ? EXIT.VIOLATIONS : EXIT.OK
  return base
}

/**
 * O REMEDIO por arquivo: onde aquele arquivo entra no comando do lint.
 *
 * Um arquivo de RAIZ nao tem `dir/**` — o que o cobre e o caminho literal (ou o
 * globo de extensao). A distincao importa: mandar acrescentar `(raiz)/**` seria
 * um remendo que nao existe.
 *
 * @param {string} f
 * @returns {string}
 */
export function remedyFor(f) {
  if (!f.includes("/")) return `Acrescente o caminho literal '${f}' ao script \`lint\` do ${PKG}`
  return `Acrescente '${topDirOf(f)}/**' ao script \`lint\` do ${PKG}`
}

const USAGE = `
 Uso: node scripts/check-lint-scope.mjs [--staged] [--json] [--help]

   --staged   julga so o INDICE (o recorte do hook), nao a arvore versionada
   --json     saida estruturada
   --help     esta ajuda

 O FATO: todo diretorio versionado cujo arquivo o PRETTIER JULGA esta coberto
 pelos globs do script \`lint\` do package.json — ou isento com o motivo escrito.
`

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE)
    process.exit(EXIT.OK)
  }
  const desconhecido = argv.find((a) => !["--staged", "--json"].includes(a))
  if (desconhecido !== undefined) {
    console.error(`❌ argumento invalido: ${desconhecido}\n${USAGE}`)
    process.exit(EXIT.USAGE)
  }
  const staged = argv.includes("--staged")
  const json = argv.includes("--json")

  analyze({ staged }).then((report) => {
    if (json) {
      console.log(JSON.stringify(report, null, 2))
      process.exit(report.exit)
    }
    if (report.exit === EXIT.UNAVAILABLE) {
      console.error(`❌ INFRA: ${report.error}`)
      process.exit(report.exit)
    }
    if (report.exit === EXIT.VIOLATIONS) {
      console.error(`❌ Escopo do lint VIOLADO (${report.violations.length}):\n`)
      for (const v of report.violations) console.error(`   - ${v}`)
      console.error(
        `\n   O escopo do lint tem de ser o MESMO do hook: ele julga todo arquivo ` +
          `estagiado e o lint julga uma lista. Um diretorio fora da lista e um ` +
          `commit que o hook recusa e o merge aceita.`,
      )
      process.exit(report.exit)
    }
    const escopo = staged ? "indice (recorte do hook)" : "arvore versionada"
    console.log(
      `✅ Escopo do lint cobre o que o hook julga: ${report.globs.length} globo(s) sobre ` +
        `${report.files} arquivo(s) do ${escopo} — 0 diretorio(s) fora (candidatos nao cobertos: ` +
        `${report.candidates}, julgados pelo prettier: ${report.judged.length}).`,
    )
    process.exit(report.exit)
  })
}

// True apenas quando executado diretamente (node ...) — permite importar as
// funções puras em testes unitários sem disparar a varredura.
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) main()

export { prettierJudges }
