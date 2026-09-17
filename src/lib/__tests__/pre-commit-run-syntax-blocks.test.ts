/**
 * pre-commit-run-syntax-blocks.test.ts
 *
 * Prova, EXECUTANDO o arquivo real do hook `.husky/pre-commit`, que um corpo
 * `run:` quebrado no ÍNDICE derruba o commit — em vez de medir isso por leitura
 * do hook (`.toContain("--staged")`), que é o que existia até aqui.
 *
 * O que a prova monta (e o que ela NÃO monta):
 *
 *   - o hook é o ARQUIVO REAL, somado (`. "$HOOK_UNDER_TEST"`), então a
 *     agregação (`wait_all`), a fase e a LINHA DE COMANDO são as de produção;
 *   - o repositório é um `git init` de verdade, com o defeito `git add`ado, e o
 *     guard roda com o `node` REAL: o recorte `--staged` lê o índice de verdade
 *     (`git diff --cached` + `git show :path`), o que um fixture em memória não
 *     reproduziria;
 *   - o FECHO TRANSITIVO real do guard (ele + o que ele importa) é copiado para
 *     o fixture — nenhum stub substitui o parser sob teste.
 *
 * O que é DUBLÊ, e por quê: um repositório temporário não tem `node_modules`
 * nem os outros guards, e um hook que falhasse por "script não encontrado"
 * provaria nada (não-zero pelo motivo errado — o falso positivo clássico). Os
 * irmãos de fase (que não são o assunto) e o `bun` (fases B e C) devolvem 0 por
 * FUNÇÃO no wrapper. Quem impede que o dublê esconda um falso positivo é o
 * CONTROLE: com o corpo válido o hook tem de sair 0 **e** imprimir a manchete do
 * guard no modo `--staged` — se o guard não rodasse de verdade, não haveria
 * manchete e o controle ficaria vermelho.
 *
 * O defeito medido era invisível porque o hook só era conferido por leitura: a
 * prova por leitura acha a linha, não prova que ela roda nem que o exit code sai
 * diferente de zero. As mutações abaixo mostram as duas metades que a leitura
 * não vê — o guard não ser chamado, e o recorte perder o `--staged`.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/pre-commit-run-syntax-blocks.test.ts
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { afterAll, describe, expect, it } from "vitest"
import { resolveBash } from "@/lib/__tests__/helpers/bash-resolver"
import { EXIT } from "../../../scripts/check-workflow-run-syntax.mjs"

const REPO_ROOT = process.cwd()
/**
 * O `node_modules` REAL do repositório. O fixture precisa dele para o guard
 * conseguir JULGAR: sem o parser de YAML, todo workflow vira "não julgável".
 */
const MODULES = join(REPO_ROOT, "node_modules")
const HOOK = join(REPO_ROOT, ".husky", "pre-commit")
const HOOK_SOURCE = readFileSync(HOOK, "utf8")

/** O sentinela: só é impresso se o hook ATRAVESSOU todas as fases. */
const COMPLETOU = "HOOK_COMPLETOU"

const GUARD = "check-workflow-run-syntax.mjs"
/** O REMÉDIO que o hook oferece quando o guard acima reprova (com confirmação). */
const REMEDY = "pre-commit-run-syntax-remedy.mjs"

/**
 * A linha do hook que torna o guard REAL no fixture. Se ela mudar, o fixture
 * deixa de tornar real o comando certo — e as mutações viram no-op silencioso.
 * Por isso ela é asserida, não presumida.
 */
const GUARD_COMMAND = `node scripts/${GUARD} --staged &`

/** A linha do hook que torna o REMÉDIO real no fixture (é ele que elege o veredito). */
const REMEDY_COMMAND = `node scripts/${REMEDY} && REMEDIO=0 || true`

/**
 * O fecho transitivo do guard (ele + os imports locais). É o que o fixture
 * copia: sem o fecho completo o guard morreria com "module not found" e o
 * não-zero do hook seria do fixture, não do defeito. O remédio entra aqui porque
 * ele IMPORTA o guard e SPAWNA o guard — as duas metades do veredito do hook.
 */
const GUARD_CLOSURE = [
  GUARD,
  REMEDY,
  "check-pipefail-sigpipe.mjs",
  "ensure-runner-image.mjs",
  "forge-workflows.mjs",
  "allowlist-review.mjs",
]

const WORKFLOW = ".github/workflows/ci.yml"
const SHELL_SCRIPT = "scripts/quebrado.sh"

/**
 * A cicatriz MECÂNICA no índice: bloco literal cujo corpo termina em operador
 * pendente. É o único defeito que o remédio SABE remendar — e é por isso que ele
 * separa "o hook bloqueia" de "o hook bloqueia e ainda oferece o caminho".
 */
const WORKFLOW_CICATRIZ =
  "name: CI\n" +
  "on: [push]\n" +
  "jobs:\n" +
  "  build:\n" +
  "    runs-on: ubuntu-latest\n" +
  "    steps:\n" +
  "      - run: |\n" +
  '          echo "um" &&\n'

/** `if` sem `fi` — a reescrita mecânica que trunca o corpo de um `run: |`. */
const WORKFLOW_QUEBRADO =
  "name: CI\n" +
  "on: [push]\n" +
  "jobs:\n" +
  "  build:\n" +
  "    runs-on: ubuntu-latest\n" +
  "    steps:\n" +
  "      - run: |\n" +
  "          if [ -f x ]; then\n" +
  "          echo oi\n"

/** O mesmo corpo, fechado. */
const WORKFLOW_VALIDO =
  "name: CI\n" +
  "on: [push]\n" +
  "jobs:\n" +
  "  build:\n" +
  "    runs-on: ubuntu-latest\n" +
  "    steps:\n" +
  "      - run: |\n" +
  "          if [ -f x ]; then\n" +
  "            echo oi\n" +
  "          fi\n"

/** `if` sem `fi` num arquivo de shell — a outra metade do mesmo guard. */
const SHELL_QUEBRADO = "#!/usr/bin/env bash\nset -eu\nif [ -f x ]; then\necho oi\n"

/**
 * Soma o hook real depois de trocar os binários por funções.
 *
 * `node` só é real para o GUARD sob teste; para os irmãos de fase ele devolve 0
 * (declarado — eles não são o assunto). `command node` atravessa a função, o
 * que mantém o interpretador verdadeiro (e não uma segunda implementação do
 * `node`) no caminho do guard.
 */
const WRAPPER = `set -eu

node() {
  for _a in "$@"; do
    case "$_a" in
      *${REMEDY}*)
        # \`REMEDY_STUB\` afirma o desfecho do REMÉDIO sem rodá-lo (é o único jeito
        # de exercitar a DIREÇÃO "o remédio saiu 0": no harness o stdin do hook é
        # um pipe e o remédio real nunca sai 0). Declarado, e usado por um teste.
        if [ -n "${"$"}{REMEDY_STUB:-}" ]; then return "$REMEDY_STUB"; fi
        command node "$@"; return $? ;;
      *${GUARD}*) command node "$@"; return $? ;;
    esac
  done
  return 0
}
bun() { return 0; }
bash() { return 0; }

. "$HOOK_UNDER_TEST"
echo "${COMPLETOU}"
`

const dirs: string[] = []

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

interface RunResult {
  status: number | null
  output: string
}

function git(dir: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" })
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} falhou (${r.status}): ${r.stderr ?? ""}`)
  }
}

/**
 * O `bash` do harness também no PATH dos processos que o GUARD spawna: no
 * Windows o `bash` do PATH pode resolver para o WSL (exit 1 sempre, timeout
 * longo), enquanto o hook roda com o do Git Bash. Não muda a linha de comando
 * do hook — só faz o `bash` que ela resolve ser o mesmo dos dois lados.
 */
function harnessPath(): string {
  const bash = resolveBash()
  const base = process.env.PATH ?? ""
  if (bash === "bash") return base
  return `${dirname(bash)}${process.platform === "win32" ? ";" : ":"}${base}`
}

/**
 * As dependências NÃO relativas do fecho (o que o fixture tem de RESOLVER).
 *
 * Um `import`/`require` de pacote é a outra metade do fecho que a lista acima
 * não vê: copiar só os `.mjs` deixa o guard sem o parser, e o não-zero que o
 * teste mediria seria do fixture. Aqui elas são LIDAS do fonte (não declaradas
 * à mão), então uma dependência nova aparece sozinha no probe abaixo.
 */
function naoRelativos(): string[] {
  const achados = new Set<string>()
  const formas = [
    /\bfrom\s+"([^"]+)"/g,
    /\brequire\(\s*"([^"]+)"\s*\)/g,
    /\bimport\(\s*"([^"]+)"\s*\)/g,
  ]
  for (const f of GUARD_CLOSURE) {
    // Comentário fora: prosa que CITA um pacote não é dependência dele.
    const fonte = readFileSync(join(REPO_ROOT, "scripts", f), "utf8")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
      .join("\n")
    for (const re of formas) {
      for (const m of fonte.matchAll(re)) {
        const spec = m[1]!
        if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:")) continue
        achados.add(spec)
      }
    }
  }
  return [...achados].sort()
}

/**
 * O `node_modules` do repositório DENTRO do fixture, pelo caminho NORMAL de
 * resolução (link, não `NODE_PATH`): o guard resolve o parser pelo diretório do
 * próprio arquivo (`createRequire(import.meta.url)`), então o link em
 * `<fixture>/node_modules` o alcança exatamente como no processo real.
 *
 * Sem ele o guard não carrega o `js-yaml` e passa a NÃO JULGAR todo workflow —
 * o exit vira `2` (não julgável) em vez de `1` (violação), e o teste mediria o
 * fixture, não o defeito. Não é dublê: é o mesmo pacote, da mesma instalação.
 */
function linkModules(dir: string): void {
  symlinkSync(MODULES, join(dir, "node_modules"), process.platform === "win32" ? "junction" : "dir")
}

/** Um repositório git de verdade com o fecho do guard e o wrapper. */
function novoRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "pre-commit-runsyntax-"))
  dirs.push(dir)
  mkdirSync(join(dir, "scripts"), { recursive: true })
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true })
  linkModules(dir)
  for (const f of GUARD_CLOSURE) {
    copyFileSync(join(REPO_ROOT, "scripts", f), join(dir, "scripts", f))
  }
  writeFileSync(join(dir, "wrapper.sh"), WRAPPER, "utf8")
  git(dir, ["init", "-q"])
  git(dir, ["config", "user.email", "hook@test.local"])
  git(dir, ["config", "user.name", "hook test"])
  return dir
}

/** Escreve no ÍNDICE — o que o commit vai gravar. */
function stage(dir: string, rel: string, content: string): void {
  writeFileSync(join(dir, rel), content, "utf8")
  git(dir, ["add", rel])
}

/** Escreve só na ÁRVORE, deixando o índice como está. */
function touch(dir: string, rel: string, content: string): void {
  writeFileSync(join(dir, rel), content, "utf8")
}

/**
 * O shell MUTADO faz parsing? Uma mutação de texto pode quebrar a sintaxe do
 * próprio hook — e aí o não-zero seria de PARSING, não do veredito que a mutação
 * existe para medir (o mesmo falso positivo que o CONTROLE desmente do outro
 * lado). Medido com o mesmo bash do harness.
 */
function shellParses(source: string): boolean {
  const r = spawnSync(resolveBash(), ["-n"], { encoding: "utf8", input: source })
  return r.status === 0
}

/** Roda o hook (real ou mutado) com o repo temporário como CWD. */
function runHook(
  dir: string,
  hookSource: string = HOOK_SOURCE,
  extraEnv: Record<string, string> = {},
): RunResult {
  const hookPath = join(dir, "hook-under-test")
  writeFileSync(hookPath, hookSource, "utf8")
  const res = spawnSync(resolveBash(), [join(dir, "wrapper.sh")], {
    cwd: dir,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, PATH: harnessPath(), HOOK_UNDER_TEST: hookPath, ...extraEnv },
  })
  return {
    status: res.status,
    output: `${res.stdout ?? ""}${res.stderr ?? ""}`,
  }
}

// ── premissa ─────────────────────────────────────────────────────────────

describe("a premissa do harness", () => {
  it("o hook chama o guard de sintaxe com --staged, e o fixture torna esse comando real", () => {
    expect(HOOK_SOURCE).toContain(GUARD_COMMAND)
    expect(existsSync(join(REPO_ROOT, "scripts", GUARD))).toBe(true)
  })

  it("o hook chama o REMÉDIO depois do guard, e o fixture torna esse comando real", () => {
    expect(HOOK_SOURCE).toContain(REMEDY_COMMAND)
    expect(HOOK_SOURCE.indexOf(REMEDY_COMMAND)).toBeGreaterThan(
      HOOK_SOURCE.indexOf(`${GUARD} --staged`),
    )
    expect(existsSync(join(REPO_ROOT, "scripts", REMEDY))).toBe(true)
  })

  it("o fecho copiado é COMPLETO: toda referência local (import E spawn) está nele", () => {
    // Sem o fecho completo o script morre com "module not found" (ou o spawn do
    // guard falha) e o não-zero do hook seria do fixture, não do defeito. Uma
    // referência nova — `from "./x.mjs"` OU `new URL("./x.mjs", ...)` — aparece
    // AQUI, nomeada, em vez de virar um controle verde por acidente.
    const faltando: string[] = []
    for (const f of GUARD_CLOSURE) {
      const src = readFileSync(join(REPO_ROOT, "scripts", f), "utf8")
      for (const re of [/from\s+"\.\/([^"]+\.mjs)"/g, /new URL\("\.\/([^"]+\.mjs)"/g]) {
        for (const m of src.matchAll(re)) {
          if (!GUARD_CLOSURE.includes(m[1]!)) faltando.push(`${f} → ${m[1]}`)
        }
      }
    }
    expect(faltando).toEqual([])
  })

  it("o fixture RESOLVE as dependências não relativas do fecho — senão o guard não JULGA nada", () => {
    // A premissa é MEDIDA, não presumida: o probe roda com o `node` real, no
    // diretório do fixture, e exige que cada especificador não relativo do
    // fecho resolva E que o parser de YAML de fato parseie. Sem isso o guard
    // sairia `2` ("não julgável") em TODO caso — inclusive no CONTROLE — e
    // todos os vereditos abaixo seriam do fixture, não do defeito.
    const pacotes = naoRelativos()
    // Declarado: hoje o fecho tem UM pacote (o parser). Se ele perder o parser,
    // esta linha cai antes de qualquer veredito — o mecanismo é load-bearing.
    expect(pacotes).toContain("js-yaml")
    expect(existsSync(MODULES)).toBe(true)

    const dir = novoRepo()
    const probe = [
      `const alvos = ${JSON.stringify(pacotes)}`,
      `for (const m of alvos) require.resolve(m)`,
      `const yaml = require("js-yaml")`,
      `if (typeof yaml.load !== "function") throw new Error("js-yaml sem load()")`,
      `if (yaml.load("a: 1") === null) throw new Error("js-yaml não parseia")`,
      `process.stdout.write("RESOLVEU")`,
    ].join("\n")
    const r = spawnSync(process.execPath, ["-e", probe], { cwd: dir, encoding: "utf8" })
    expect(`${r.status} ${r.stdout ?? ""}${r.stderr ?? ""}`).toContain("0 RESOLVEU")
  })
})

// ── o hook real ──────────────────────────────────────────────────────────

describe("o hook real bloqueia o commit pelo recorte --staged", () => {
  it("CONTROLE: corpo válido no índice ⇒ exit 0, o hook termina e o guard RODOU", () => {
    const dir = novoRepo()
    stage(dir, WORKFLOW, WORKFLOW_VALIDO)

    const res = runHook(dir)

    // As duas metades do controle: o hook atravessa tudo (0) E o guard real
    // executou no modo do índice. Sem a segunda, "0" poderia ser um hook que
    // nunca chamou o guard — que é justamente o defeito das mutações abaixo.
    expect(res.status).toBe(EXIT.OK)
    expect(res.output).toContain(COMPLETOU)
    expect(res.output).toContain("DO ÍNDICE")
    expect(res.output).toContain("1 workflow(s)")
  }, 60_000)

  it("corpo `run:` quebrado NO ÍNDICE ⇒ exit VIOLATIONS, nomeando arquivo e linha", () => {
    const dir = novoRepo()
    stage(dir, WORKFLOW, WORKFLOW_QUEBRADO)

    const res = runHook(dir)

    expect(res.status).toBe(EXIT.VIOLATIONS)
    expect(res.output).not.toContain(COMPLETOU)
    expect(res.output).toContain(`${WORKFLOW}:7`)
    expect(res.output).toContain("syntax error")
    // O veredito diz de onde veio a lista — o recorte é do commit.
    expect(res.output).toContain("recorte --staged")
  }, 60_000)

  it("o defeito que SÓ o commit carrega (índice quebrado, árvore consertada) bloqueia", () => {
    // É o caso que a árvore esconde: alguém conserta o arquivo e esquece de
    // re-adicionar. O commit leva o corpo quebrado; a árvore parece saudável.
    const dir = novoRepo()
    stage(dir, WORKFLOW, WORKFLOW_QUEBRADO)
    touch(dir, WORKFLOW, WORKFLOW_VALIDO)

    const res = runHook(dir)

    expect(res.status).toBe(EXIT.VIOLATIONS)
    expect(res.output).toContain(`${WORKFLOW}:7`)
  }, 60_000)

  it("o corpo quebrado que o commit NÃO carrega (só na árvore) passa — o recorte é o índice", () => {
    const dir = novoRepo()
    stage(dir, WORKFLOW, WORKFLOW_VALIDO)
    touch(dir, WORKFLOW, WORKFLOW_QUEBRADO)

    const res = runHook(dir)

    expect(res.status).toBe(EXIT.OK)
    expect(res.output).toContain(COMPLETOU)
  }, 60_000)

  it("a outra metade do guard também morde no hook: arquivo de shell quebrado no índice", () => {
    const dir = novoRepo()
    stage(dir, SHELL_SCRIPT, SHELL_QUEBRADO)

    const res = runHook(dir)

    expect(res.status).toBe(EXIT.VIOLATIONS)
    expect(res.output).not.toContain(COMPLETOU)
    expect(res.output).toContain(SHELL_SCRIPT)
    expect(res.output).toContain("arquivo(s) de shell")
  }, 60_000)
})

// ── o remédio dentro do hook ─────────────────────────────────────────────
//
// O hook não só reprova: quando a cicatriz é a MECÂNICA que o fixer do gate
// conhece, ele OFERECE o remendo. Aqui o stdin do hook é um PIPE (é o que o
// harness dá), então o remédio toma o caminho SEM TERMINAL — que é o que precisa
// ser provado neste nível: ele NÃO pergunta, NÃO trava e NÃO libera o commit.

describe("o hook oferece o remédio, e sem terminal o commit segue bloqueado", () => {
  it("o remédio que sai 0 LEVANTA a falha: o commit segue (a outra direção do veredito)", () => {
    // A direção que o harness NÃO alcança sozinho (stdin é pipe, então o remédio
    // real nunca sai 0): aqui o desfecho do remédio é AFIRMADO por dublê. O que
    // se mede é o fluxo do HOOK — quem levanta a falha do gate é o exit 0 dele, e
    // sem esta direção um `REMEDIO=1` que nunca virasse 0 passaria despercebido
    // (o commit continuaria bloqueado e os testes do outro lado ficariam verdes).
    const dir = novoRepo()
    stage(dir, WORKFLOW, WORKFLOW_CICATRIZ)

    const res = runHook(dir, HOOK_SOURCE, { REMEDY_STUB: "0" })

    expect(res.status).toBe(EXIT.OK)
    expect(res.output).toContain(COMPLETOU)
    expect(res.output).not.toContain("SEM TERMINAL")
  }, 60_000)

  it("cicatriz mecânica no índice, SEM terminal: exit 1, sem pergunta, com o caminho à mão", () => {
    const dir = novoRepo()
    stage(dir, WORKFLOW, WORKFLOW_CICATRIZ)

    const res = runHook(dir)

    expect(res.status).toBe(EXIT.VIOLATIONS)
    expect(res.output).not.toContain(COMPLETOU)
    // O remédio RODOU (o preview da cicatriz está no relatório) e NÃO perguntou.
    expect(res.output).toContain("operador pendente")
    expect(res.output).toContain("SEM TERMINAL")
    expect(res.output).toContain("git add")
    // E o arquivo do fixture continua com a cicatriz: nada foi remendado.
    expect(readFileSync(join(dir, WORKFLOW), "utf8")).toBe(WORKFLOW_CICATRIZ)
  }, 60_000)
})

// ── mutação ──────────────────────────────────────────────────────────────

describe("mutação: o remédio só LEVANTA a falha — o bloqueio é do hook", () => {
  const REMEDY_LINHA = REMEDY_COMMAND
  const BLOCO_DO_GATE = HOOK_SOURCE.slice(
    HOOK_SOURCE.indexOf(`if [ "$SINTAXE" -ne 0 ]; then`),
    HOOK_SOURCE.indexOf(`[ "$FASE_A" -eq 0 ] || exit "$FASE_A"`),
  )

  it("M3 — o hook deixa de CHAMAR o remédio: o commit continua BLOQUEADO (fail-closed)", () => {
    // `REMEDIO` nasce 1 ("não provou nada"): sem a chamada, ninguém levantou a
    // falha do gate e o veredito explícito bloqueia. O remédio é CONVENIÊNCIA,
    // não o único caminho para o bloqueio — apagá-lo não cria um bypass.
    const mutado = HOOK_SOURCE.replace(REMEDY_LINHA, "")
    expect(mutado).not.toBe(HOOK_SOURCE) // a mutação precisa aplicar de fato
    // ...e deixar um shell VÁLIDO: uma mutação que quebrasse a sintaxe do hook
    // sairia vermelha por erro de PARSING, não pelo veredito que ela mede.
    expect(shellParses(mutado)).toBe(true)

    const dir = novoRepo()
    stage(dir, WORKFLOW, WORKFLOW_CICATRIZ)

    const res = runHook(dir, mutado)

    expect(res.status).toBe(EXIT.VIOLATIONS)
    expect(res.output).not.toContain(COMPLETOU)
    expect(res.output).not.toContain("SEM TERMINAL") // o remédio não rodou
  }, 60_000)

  it("M4 — o hook perde o VEREDITO do gate: o commit com a cicatriz mecânica passa", () => {
    // É a metade que importa: sem este bloco nada reergue a falha do guard, e o
    // commit entra com um corpo `run:` que não faz parsing.
    expect(BLOCO_DO_GATE).toContain(REMEDY_LINHA)
    const mutado = HOOK_SOURCE.replace(BLOCO_DO_GATE, "")
    expect(mutado).not.toBe(HOOK_SOURCE)
    expect(shellParses(mutado)).toBe(true)

    const dir = novoRepo()
    stage(dir, WORKFLOW, WORKFLOW_CICATRIZ)

    const res = runHook(dir, mutado)

    expect(res.status).toBe(EXIT.OK)
    expect(res.output).toContain(COMPLETOU)
  }, 60_000)
})

// ── mutação ──────────────────────────────────────────────────────────────

describe("mutação: as duas metades que a leitura do hook não vê", () => {
  it("M1 — o hook deixa de CHAMAR o guard: o commit com o corpo quebrado passa", () => {
    const mutado = HOOK_SOURCE.replace(GUARD_COMMAND, "true &")
    expect(mutado).not.toBe(HOOK_SOURCE) // a mutação precisa aplicar de fato

    const dir = novoRepo()
    stage(dir, WORKFLOW, WORKFLOW_QUEBRADO)

    const res = runHook(dir, mutado)

    expect(res.status).toBe(EXIT.OK)
    expect(res.output).toContain(COMPLETOU)
  }, 60_000)

  it("M2 — o recorte perde o `--staged`: o defeito que só o índice carrega passa", () => {
    const mutado = HOOK_SOURCE.replace(
      `node scripts/${GUARD} --staged &`,
      `node scripts/${GUARD} &`,
    )
    expect(mutado).not.toBe(HOOK_SOURCE)

    const dir = novoRepo()
    stage(dir, WORKFLOW, WORKFLOW_QUEBRADO)
    touch(dir, WORKFLOW, WORKFLOW_VALIDO)

    // Sem o recorte o guard julga a ÁRVORE (saudável) e aprova o commit que
    // carrega o corpo quebrado — a flag não é decoração.
    const res = runHook(dir, mutado)

    expect(res.status).toBe(EXIT.OK)
    expect(res.output).toContain(COMPLETOU)
  }, 60_000)
})
