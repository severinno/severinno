/**
 * hook-simulator.mjs
 *
 * O SIMULADOR de hook do repositório, em node PURO: um repositório git
 * temporário de verdade, um DUBLÊ declarado dos binários (com o comando sob
 * teste liberado para o processo REAL) e as MEDIÇÕES lidas no banco do git.
 *
 * Ele mora em `scripts/` (e não em `src/lib/__tests__/helpers/`) porque tem DOIS
 * consumidores de naturezas diferentes: os testes dos hooks (que precisam das
 * duas formas de executar — somada e pelo git) e o `forge-doctor`, que roda com
 * `node` sem bundler e precisa EXECUTAR a mesma prova para publicá-la como fato.
 * Duas cópias desta máquina divergem no dia em que uma delas for ajustada — e a
 * divergência apareceria como uma prova que mede outra coisa.
 *
 * As duas formas de executar (o MESMO dublê nas duas):
 *
 *   - `runSourcedHook()` — o hook é SOMADO (`bash wrapper.sh`, com o hook real em
 *     `$HOOK_UNDER_TEST`), o que dá controle fino do ambiente e do stdin;
 *   - `writeHook()` — o hook é EXECUTADO PELO GIT (`core.hooksPath`), e aí o
 *     veredito é lido no OBJETO (`git cat-file`), não no stdout de ninguém.
 *
 * Contrato do dublê (declarado, nunca implícito):
 *
 *   - cada `StubSpec` vira UMA função de shell com o nome do binário;
 *   - `match` libera o processo REAL (`command <bin> "$@"`) quando algum
 *     argumento casa — é assim que o comando sob teste continua sendo o comando
 *     de verdade, e não uma segunda implementação dele;
 *   - sem casamento, a função devolve `code` (default 0): os irmãos de fase (que
 *     NÃO são o assunto da prova) não derrubam nem salvam o veredito;
 *   - `overrideVar` é o dublê da DIREÇÃO (usado quando o desfecho real depende de
 *     um terminal que o harness não tem);
 *   - `COMPLETOU` só é impresso se o hook ATRAVESSOU todas as fases — é o que
 *     separa "passou" de "parou antes do fim" no caminho somado.
 *
 * Usage:
 *   import { novoRepo, stage, runSourcedHook, cleanupFixtures } from "./hook-simulator.mjs"
 *
 *   const dir = novoRepo({ wrapper: wrapperSource(STUBS) })
 *   stage(dir, "src/foo.ts", "…")
 *   expect(runSourcedHook(dir, hookSource).status).toBe(0)
 *
 * Exit codes:
 *   (módulo — sem CLI próprio: as funções devolvem o RESULTADO, não um código de
 *   saída. O veredito de cada forma de executar o hook é o `status` de
 *   `RunResult`, e quem o traduz em exit code é o script que consome —
 *   `pre-commit-proof.mjs`, cujo `state` é a fonte única dos três desfechos)
 */

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { NO_PROMPT_ENV } from "./pre-commit-remedy.mjs"

/** A raiz do repositório (o diretório ACIMA de `scripts/`). */
export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

/**
 * O `node_modules` REAL do repositório, que o fixture linka por DENTRO. Não é
 * dublê: é o mesmo pacote, da mesma instalação — sem ele o que o fixture mede é
 * um "module not found" do fixture, não o veredito do hook.
 */
export const MODULES = join(REPO_ROOT, "node_modules")

/** O sentinela: só é impresso se o hook ATRAVESSOU todas as fases. */
export const COMPLETOU = "HOOK_COMPLETOU"

/** O nome do arquivo onde o hook real (ou mutado) fica dentro do fixture. */
export const HOOK_UNDER_TEST = "hook-under-test"

/** O dublê gravado em `<fixture>/wrapper.sh` — a forma somada o executa. */
export const WRAPPER_FILE = "wrapper.sh"

/**
 * Um dublê de binário: o nome que vira função de shell e o que ele faz.
 *
 * `match` ausente = o binário é SEMPRE dublado (nenhum processo real): é o caso
 * dos irmãos de fase, que precisam devolver 0 sem existir no fixture.
 *
 * @typedef {{
 *   tool: string, match?: string, overrideVar?: string, why?: string, code?: number,
 * }} StubSpec
 * @typedef {{ status: number|null, output: string }} RunResult
 * @typedef {{
 *   prefix?: string, closure?: string[], wrapper: string, dirs?: string[],
 * }} RepoOptions
 * @typedef {{ name: string, source: string, hooksPath: string }} HookFile
 */

/**
 * Gera o dublê. Uma função por binário, na ordem declarada; o `. "$HOOK_UNDER_TEST"`
 * no fim é o que soma o hook sob teste, e o `echo` do sentinela vem depois dele
 * (com `set -eu` herdado, um hook que morre no meio não chega a imprimi-lo).
 *
 * @param {StubSpec[]} stubs
 * @returns {string}
 */
export function wrapperSource(stubs) {
  const porFerramenta = new Map()
  for (const stub of stubs) {
    const lista = porFerramenta.get(stub.tool) ?? []
    lista.push(stub)
    porFerramenta.set(stub.tool, lista)
  }

  const linhas = ["set -eu", ""]
  for (const [tool, specs] of porFerramenta) {
    const reais = specs.filter((s) => s.match !== undefined)
    const padrao = specs.find((s) => s.match === undefined)?.code ?? 0
    linhas.push(`${tool}() {`)
    if (reais.length > 0) {
      linhas.push(`  for _a in "$@"; do`)
      linhas.push(`    case "$_a" in`)
      for (const spec of reais) {
        linhas.push(`      *${spec.match}*)`)
        for (const linha of (spec.why ?? "").split("\n")) {
          if (linha !== "") linhas.push(`        # ${linha}`)
        }
        if (spec.overrideVar !== undefined) {
          linhas.push(
            `        if [ -n "\${${spec.overrideVar}:-}" ]; then return "$${spec.overrideVar}"; fi`,
          )
        }
        linhas.push(`        command ${tool} "$@"; return $? ;;`)
      }
      linhas.push(`    esac`)
      linhas.push(`  done`)
    }
    linhas.push(`  return ${padrao}`)
    linhas.push(`}`)
  }
  linhas.push("")
  linhas.push(`. "$HOOK_UNDER_TEST"`)
  linhas.push(`echo "${COMPLETOU}"`)
  return `${linhas.join("\n")}\n`
}

/**
 * O `bash` do harness. No Windows o `bash` do PATH pode resolver para o WSL
 * (saída UTF-16, exit 1 sempre, ~30s de timeout por spawn), enquanto o hook roda
 * com o do Git Bash: por isso o do Git for Windows é preferido quando existe.
 * `HOOK_PROOF_BASH` sobrepõe (a mesma válvula dos outros guards do repositório).
 *
 * @returns {string}
 */
export function resolveBash() {
  if (process.env.HOOK_PROOF_BASH) return process.env.HOOK_PROOF_BASH
  if (process.platform === "win32") {
    const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe"
    if (existsSync(gitBash)) return gitBash
  }
  return "bash"
}

/**
 * O `bash` do harness também no PATH dos processos que o hook spawna: não muda a
 * linha de comando do hook — só faz o `bash` que ela resolve ser o mesmo dos
 * dois lados.
 *
 * @returns {string}
 */
export function harnessPath() {
  const bash = resolveBash()
  const base = process.env.PATH ?? ""
  if (bash === "bash") return base
  return `${dirname(bash)}${process.platform === "win32" ? ";" : ":"}${base}`
}

/**
 * O shebang do hook do fixture. `resolveBash()` devolve um caminho absoluto no
 * Windows e a PALAVRA `bash` (resolvida pelo PATH) no resto — e `#!bash` sem
 * barra não é um interpretador válido para o kernel, então o caminho relativo
 * vira `#!/usr/bin/env bash` (mesmo bash do harness).
 *
 * @returns {string}
 */
function shebang() {
  const bash = resolveBash()
  return bash.includes("/") || bash.includes("\\") ? `#!${bash}` : "#!/usr/bin/env bash"
}

const dirs = []

/**
 * Um diretório temporário vazio JÁ REGISTRADO no `cleanupFixtures()` — para o
 * que não é um repo de trabalho (um remoto, um diretório de hooks alternativo).
 *
 * @param {string} prefix
 * @returns {string}
 */
export function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

/**
 * Um REMOTO bare registrado: é para onde um `git push` de verdade manda (ou não
 * manda) os objetos, e é o único lugar onde "nada chegou" pode ser medido.
 *
 * @param {string} [prefix]
 * @returns {string}
 */
export function bareRemote(prefix = "hook-remote-") {
  const dir = tempDir(prefix)
  git(dir, ["init", "-q", "--bare"])
  return dir
}

/** Remove os fixtures temporários registrados por `novoRepo()`. */
export function cleanupFixtures() {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
}

function git(dir, args) {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" })
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} falhou (${r.status}): ${r.stderr ?? ""}`)
  }
}

/**
 * O `node_modules` do repositório DENTRO do fixture, pelo caminho NORMAL de
 * resolução (link, não `NODE_PATH`): um guard resolve o parser pelo diretório do
 * próprio arquivo (`createRequire(import.meta.url)`), então o link em
 * `<fixture>/node_modules` o alcança exatamente como no processo real.
 *
 * @param {string} dir
 */
function linkModules(dir) {
  symlinkSync(MODULES, join(dir, "node_modules"), process.platform === "win32" ? "junction" : "dir")
}

/**
 * Um repositório git de verdade, com o dublê declarado e (opcional) o fecho.
 * O `wrapper` é OBRIGATÓRIO: sem ele o hook rodaria os binários REAIS (o
 * não-zero viria do ambiente, e um verde poderia não ter nada a ver com o
 * comando sob teste) — o falso positivo que o simulador existe para evitar.
 *
 * @param {RepoOptions} opts
 * @returns {string}
 */
export function novoRepo(opts) {
  const dir = mkdtempSync(join(tmpdir(), opts.prefix ?? "hook-sim-"))
  dirs.push(dir)
  if (opts.closure !== undefined) mkdirSync(join(dir, "scripts"), { recursive: true })
  for (const extra of opts.dirs ?? []) mkdirSync(join(dir, extra), { recursive: true })
  linkModules(dir)
  for (const f of opts.closure ?? []) {
    const destino = join(dir, "scripts", f)
    // Um item da closure pode morar num SUBDIRETÓRIO (`remedy-classes/…`): o
    // diretório do destino é criado aqui, e não na mão em cada call site — um
    // fecho que atravessa uma pasta nova não pode depender de alguém lembrar de
    // declarar o `dirs` (sem isso o fixture morre com ENOENT na CÓPIA, que é um
    // não-zero do FIXTURE e não do defeito).
    mkdirSync(dirname(destino), { recursive: true })
    copyFileSync(join(REPO_ROOT, "scripts", f), destino)
  }
  writeFileSync(join(dir, WRAPPER_FILE), opts.wrapper, "utf8")
  git(dir, ["init", "-q"])
  git(dir, ["config", "user.email", "hook@test.local"])
  git(dir, ["config", "user.name", "hook test"])
  return dir
}

/**
 * Escreve no ÍNDICE — o que o commit vai gravar.
 *
 * @param {string} dir
 * @param {string} rel
 * @param {string} content
 */
export function stage(dir, rel, content) {
  writeFileSync(join(dir, rel), content, "utf8")
  git(dir, ["add", rel])
}

/**
 * Escreve só na ÁRVORE, deixando o índice como está.
 *
 * @param {string} dir
 * @param {string} rel
 * @param {string} content
 */
export function touch(dir, rel, content) {
  writeFileSync(join(dir, rel), content, "utf8")
}

/** O dublê que o `novoRepo` gravou — a MESMA régua nas duas formas. */
function wrapperText(dir) {
  return readFileSync(join(dir, WRAPPER_FILE), "utf8")
}

/**
 * O shell MUTADO faz parsing? Uma mutação de texto pode quebrar a sintaxe do
 * próprio hook — e aí o não-zero seria de PARSING, não do veredito que a mutação
 * existe para medir (o mesmo falso positivo que o CONTROLE desmente do outro
 * lado). Medido com o mesmo bash do harness.
 *
 * @param {string} source
 * @returns {boolean}
 */
export function shellParses(source) {
  const r = spawnSync(resolveBash(), ["-n"], { encoding: "utf8", input: source })
  return r.status === 0
}

/**
 * Roda o hook (real ou mutado) SOMADO pelo dublê, com o repo temporário como
 * CWD. O hook sob teste é escrito em `hook-under-test` (sem shebang: quem o
 * interpreta é o dublê que o soma).
 *
 * @param {string} dir
 * @param {string} hookSource
 * @param {Record<string, string>} [extraEnv]
 * @returns {RunResult}
 */
export function runSourcedHook(dir, hookSource, extraEnv = {}) {
  const hookPath = join(dir, HOOK_UNDER_TEST)
  writeFileSync(hookPath, hookSource, "utf8")
  const res = spawnSync(resolveBash(), [join(dir, WRAPPER_FILE)], {
    cwd: dir,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      PATH: harnessPath(),
      HOOK_UNDER_TEST: hookPath,
      // O ENSAIO NÃO TEM OPERADOR — e o processo do teste PODE ter um terminal
      // de controle (o do operador que roda a suíte): sem esta declaração o
      // remédio abriria o `/dev/tty` e a prova dependeria de alguém responder
      // (ou penduraria no prompt). É o mesmo dono do nome da variável
      // (`scripts/pre-commit-remedy.mjs`), importado e não copiado.
      [NO_PROMPT_ENV]: "1",
      ...extraEnv,
    },
  })
  return formatResult(res)
}

function formatResult(res) {
  return { status: res.status, output: `${res.stdout ?? ""}${res.stderr ?? ""}` }
}

// =============================================================================
// A CAMADA DO GIT — o hook invocado PELO GIT (`core.hooksPath`), não somado
// =============================================================================
//
// As duas diferenças que importam em relação ao `runSourcedHook` acima:
//
//   1. quem decide o desfecho é o GIT (exit code do hook), não o teste: dá para
//      medir o OBJETO (`git cat-file`) e o que chegou ao REMOTO;
//   2. o hook precisa ser um ARQUIVO EXECUTÁVEL no diretório do `hooksPath` —
//      git IGNORA em SILÊNCIO um hook sem o bit de execução (o commit/push
//      entra), e é o falso positivo mais perigoso desta camada.

/**
 * Um comando do git cujo NÃO-ZERO é veredito (push recusado) — sem `throw`.
 *
 * @param {string} dir
 * @param {string[]} args
 * @param {Record<string, string>} [extraEnv]
 * @returns {RunResult}
 */
export function runGit(dir, args, extraEnv = {}) {
  const res = spawnSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    timeout: 60_000,
    // stdin VAZIO (não herdado) E A PERGUNTA DESLIGADA: o hook não pode ler de um
    // terminal que o TESTE herdou do operador que rodou a suíte (o remédio abre o
    // `/dev/tty` quando o stdin não é um terminal). A prova mede o caminho SEM
    // operador — e quem mede o caminho COM terminal é o ensaio do pty
    // (`scripts/pty_answer.py`), que não desliga nada. Declarado.
    input: "",
    env: {
      ...process.env,
      PATH: harnessPath(),
      HOOK_UNDER_TEST: join(dir, HOOK_UNDER_TEST),
      [NO_PROMPT_ENV]: "1",
      ...extraEnv,
    },
  })
  return formatResult(res)
}

/**
 * Escreve o hook do fixture no `hooksPath` (o que o git procura) com o dublê e
 * o hook sob teste, e aponta `core.hooksPath` para lá. Devolve o caminho do
 * arquivo que o GIT vai executar.
 *
 * O `chmod` é obrigatório, não cosmético: um hook não-executável é ignorado por
 * git sem falhar (`hint: the '<hook>' hook was ignored`) — e o veredito entra
 * como se o hook tivesse passado.
 *
 * @param {string} dir
 * @param {HookFile} hook
 * @returns {string}
 */
export function writeHook(dir, hook) {
  writeFileSync(join(dir, HOOK_UNDER_TEST), hook.source, "utf8")
  const hooksDir = join(dir, hook.hooksPath)
  mkdirSync(hooksDir, { recursive: true })
  const caminho = join(hooksDir, hook.name)
  writeFileSync(caminho, `${shebang()}\n${wrapperText(dir)}`, "utf8")
  if (process.platform !== "win32") chmodSync(caminho, 0o755)
  git(dir, ["config", "core.hooksPath", hook.hooksPath])
  return caminho
}

/**
 * O valor efetivo de uma config do fixture (ex.: `core.hooksPath`).
 *
 * @param {string} dir
 * @param {string} key
 * @returns {string}
 */
export function gitConfig(dir, key) {
  return (
    spawnSync("git", ["config", "--get", key], { cwd: dir, encoding: "utf8" }).stdout ?? ""
  ).trim()
}

/**
 * Reescreve uma config do fixture (a mutação da premissa do `hooksPath`).
 *
 * @param {string} dir
 * @param {string} key
 * @param {string} value
 */
export function gitConfigSet(dir, key, value) {
  git(dir, ["config", key, value])
}

/**
 * Os REFS do repositório (num remoto, o que o push conseguiu atualizar).
 *
 * @param {string} dir
 * @returns {string[]}
 */
export function refsOf(dir) {
  const r = spawnSync("git", ["for-each-ref", "--format=%(refname)"], {
    cwd: dir,
    encoding: "utf8",
  })
  return (r.stdout ?? "").split("\n").filter(Boolean)
}

/**
 * Quantos OBJETOS de um tipo existem no banco. É a medida direta do que a prova
 * promete: um commit recusado pelo hook não pode deixar objeto nenhum.
 *
 * Conta só o tipo pedido — `git add`/`commit` locais já gravaram blobs e árvores
 * antes, e contá-los mediria o índice ou a árvore, não o commit.
 *
 * @param {string} dir
 * @param {string} [type]
 * @returns {number}
 */
export function countObjects(dir, type = "commit") {
  const r = spawnSync("git", ["cat-file", "--batch-all-objects", "--batch-check=%(objecttype)"], {
    cwd: dir,
    encoding: "utf8",
  })
  return (r.stdout ?? "").split("\n").filter((linha) => linha.trim() === type).length
}

/**
 * Quantos objetos de COMMIT existem no banco (o atalho do `countObjects`).
 *
 * @param {string} dir
 * @returns {number}
 */
export function commitObjects(dir) {
  return countObjects(dir, "commit")
}

/**
 * Existe um commit em HEAD? (`git rev-parse --verify HEAD`)
 *
 * @param {string} dir
 * @returns {boolean}
 */
export function headExists(dir) {
  return (
    spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: dir, encoding: "utf8" }).status === 0
  )
}

/**
 * O conteúdo de um arquivo NUM REF do repositório (`git show <ref>:<path>`) — a
 * prova de que o defeito ENTROU no objeto, não só de que "houve um commit". Com
 * um ref explícito (`refs/heads/main`) ele também mede o que o REMOTO recebeu,
 * sem depender do `HEAD` simbólico dele apontar para a mesma branch.
 *
 * @param {string} dir
 * @param {string} ref
 * @param {string} rel
 * @returns {string}
 */
export function contentAtRef(dir, ref, rel) {
  const r = spawnSync("git", ["show", `${ref}:${rel}`], { cwd: dir, encoding: "utf8" })
  if (r.status !== 0) throw new Error(`git show ${ref}:${rel} falhou: ${r.stderr ?? ""}`)
  return r.stdout ?? ""
}

/**
 * O conteúdo COMMITADO de um arquivo (`git show HEAD:<path>`).
 *
 * @param {string} dir
 * @param {string} rel
 * @returns {string}
 */
export function committedContent(dir, rel) {
  return contentAtRef(dir, "HEAD", rel)
}

/**
 * O que o ÍNDICE carrega agora — a prova de que o comando recusado não o mexeu.
 *
 * @param {string} dir
 * @returns {string[]}
 */
export function indexPaths(dir) {
  const r = spawnSync("git", ["diff", "--cached", "--name-only"], { cwd: dir, encoding: "utf8" })
  return (r.stdout ?? "").split("\n").filter(Boolean)
}

/**
 * O modo do arquivo (a checagem do bit de execução do hook).
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isExecutable(path) {
  if (!existsSync(path)) return false
  if (process.platform === "win32") return true
  return (statSync(path).mode & 0o111) !== 0
}
