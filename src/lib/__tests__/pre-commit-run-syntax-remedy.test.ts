// =============================================================================
// pre-commit-run-syntax-remedy.test.ts
//
// Testes do scripts/pre-commit-run-syntax-remedy.mjs — o REMÉDIO que o
// pre-commit oferece quando o recorte `--staged` do gate de sintaxe reprova o
// commit: o remendo da cicatriz MECÂNICA, com confirmação explícita.
//
// O que precisa ser provado (um remédio pode parecer certo e mentir):
//   1. com "sim" e arquivo LIMPO: remenda a árvore, RE-ESTAGIA e revalida o
//      ÍNDICE — o commit volta a poder seguir (exit 0), com o índice remendado;
//   2. com "não": NADA é remendado (e a pergunta foi feita, nomeando os três
//      efeitos do "sim");
//   3. SEM cicatriz remendável o remédio NÃO pergunta — uma pergunta cuja
//      resposta não muda nada ensina o operador a responder sem ler;
//   4. WIP: o `git add` NÃO pode levar para o commit trabalho que não é dele. A
//      prova mede o índice (o WIP não subiu) e a árvore (o remendo está lá);
//   5. a árvore DIVERGENTE faz o fixer recusar sozinho (a linha do arquivo não é
//      a do corpo) — o remédio não grava na linha errada nem quando o índice e a
//      árvore se deslocaram;
//   6. SEM TERMINAL o remédio NÃO pergunta (um prompt num stdin que é pipe trava
//      o commit ou consome entrada que não é dele) e mantém o commit BLOQUEADO,
//      dizendo o caminho à mão;
//   7. o caminho INTERATIVO é exercitado pela função (deps injetadas), porque
//      num subprocesso o stdin nunca é um terminal.
//
// Sem rede: os fixtures são repositórios git de verdade (o índice é do git, não
// um dublê) e o bash que julga é o de verdade.
// =============================================================================

import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { Readable, Writable } from "node:stream"

import { afterAll, describe, expect, it } from "vitest"

import { EXIT } from "../../../scripts/check-workflow-run-syntax.mjs"
import {
  ask,
  dirtyPaths,
  isAffirmative,
  remedy,
} from "../../../scripts/pre-commit-run-syntax-remedy.mjs"

/** O módulo é .mjs: o teste tipa só o que consome (o resto é o runtime). */
type Recusado = { file: string; line?: number; reason?: string }
type Resultado = {
  code: number
  fixed: unknown[]
  refused: Recusado[]
  restaged: string[]
  withheld: string[]
  answer: string | null
}

type Deps = {
  bash?: string
  isTTY?: boolean
  askFn?: (q: string) => Promise<string>
  log?: (msg: string) => void
  write?: (txt: string) => void
  rerun?: (root: string) => { status: number | null; stdout?: string; stderr?: string }
}

const remedyFit = (root: string, deps: Deps = {}) => remedy(root, deps) as Promise<Resultado>

const ROOT = resolve(__dirname, "..", "..", "..")
const SCRIPT = join(ROOT, "scripts", "pre-commit-run-syntax-remedy.mjs")
const HOOK = join(ROOT, ".husky", "pre-commit")

const WORKFLOW = ".github/workflows/ci.yml"

/** A cicatriz MECÂNICA: bloco literal cujo corpo termina em operador pendente. */
const CICATRIZ = [
  "name: CI",
  "on: [push]",
  "jobs:",
  "  build:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: |",
  '          echo "um" &&',
  "",
].join("\n")

/** O mesmo corpo: válido, e o fixer não tem o que remendar. */
const VALIDO = CICATRIZ.replace('          echo "um" &&\n', '          echo "um"\n')

/** A recusa que NÃO é cicatriz: `if` sem `fi` (a intenção não é reconstruível dali). */
const SEM_CICATRIZ = [
  "name: CI",
  "on: [push]",
  "jobs:",
  "  build:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: |",
  "          if [ -f x ]; then",
  "            echo oi",
  "",
].join("\n")

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "run-syntax-remedy-"))
  tmpDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function git(dir: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} falhou: ${r.stderr ?? ""}`)
  return r.stdout ?? ""
}

/** Um repositório git de verdade com o conteúdo JÁ NO ÍNDICE. */
function repo(conteudo = CICATRIZ): string {
  const dir = makeDir()
  mkdirSync(join(dir, dirname(WORKFLOW)), { recursive: true })
  writeFileSync(join(dir, WORKFLOW), conteudo)
  git(dir, ["init", "-q"])
  git(dir, ["config", "user.email", "remedy@test.local"])
  git(dir, ["config", "user.name", "remedy test"])
  git(dir, ["add", "-A"])
  return dir
}

/** O conteúdo que o COMMIT carrega (o índice), não o da árvore. */
const indice = (dir: string, rel = WORKFLOW): string => git(dir, ["show", `:${rel}`])
/** O conteúdo da ÁRVORE. */
const arvore = (dir: string, rel = WORKFLOW): string => readFileSync(join(dir, rel), "utf8")
/** Os caminhos com modificação NÃO estagiada. */
const sujos = (dir: string): string[] =>
  git(dir, ["diff", "--name-only"]).split("\n").filter(Boolean)

/** A CLI, com o exit code do processo (o contrato que o hook consome). */
function cli(
  args: string[],
  { stdin = "" }: { stdin?: string } = {},
): { code: number; out: string; err: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    input: stdin,
    cwd: ROOT,
  })
  return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" }
}

// ── as funções puras ──────────────────────────────────────────────────────

describe("isAffirmative — o 'sim' é explícito, e o default é o NÃO", () => {
  it("aceita as quatro formas do sim (maiúscula ou minúscula)", () => {
    for (const ok of ["s", "S", "sim", "SIM", "y", "Y", "yes", "YES", " sim "]) {
      expect(isAffirmative(ok), `\`${ok}\` devia ser sim`).toBe(true)
    }
  })

  it("recusa o vazio, o não e qualquer outra coisa", () => {
    for (const nao of ["", " ", "n", "N", "nao", "não", "no", "1", "siiim", "yep"]) {
      expect(isAffirmative(nao), `\`${nao}\` NÃO devia ser sim`).toBe(false)
    }
  })

  it("aceita `undefined`/`null` como NÃO (nunca como sim)", () => {
    expect(isAffirmative(undefined)).toBe(false)
    expect(isAffirmative(null)).toBe(false)
  })
})

describe("ask — a pergunta no terminal e a resposta do stdin", () => {
  it("lê UMA linha, escreve a pergunta na saída de diagnóstico e FECHA o readline", async () => {
    const saida: string[] = []
    const output = new Writable({
      write(chunk, _enc, cb) {
        saida.push(String(chunk))
        cb()
      },
    })
    const resposta = await ask("Aplicar? ", { input: Readable.from(["sim\n"]), output })
    expect(resposta).toBe("sim")
    expect(saida.join("")).toContain("Aplicar?")
  })

  it("o FIM do stdin (Ctrl-D) resolve como NÃO — não pendura o commit", async () => {
    const resposta = await ask("Aplicar? ", {
      input: Readable.from([]),
      output: new Writable({
        write(_c, _e, cb) {
          cb()
        },
      }),
    })
    expect(resposta).toBe("")
    expect(isAffirmative(resposta)).toBe(false)
  })
})

describe("dirtyPaths — fail-closed: sem medir não há 'nada sujo'", () => {
  it("num repositório de verdade devolve o que está fora do índice", () => {
    const dir = repo()
    expect(dirtyPaths(dir)).toEqual(new Set())
    writeFileSync(join(dir, WORKFLOW), `${CICATRIZ}# WIP\n`)
    expect(dirtyPaths(dir)).toEqual(new Set([WORKFLOW]))
  })

  it("fora de um repositório LANÇA em vez de devolver um conjunto vazio", () => {
    // Um conjunto vazio aqui autorizaria o `git add` que ele existe para impedir.
    expect(() => dirtyPaths(makeDir())).toThrow(/indisponível/)
  })
})

// ── o caminho INTERATIVO (deps injetadas) ─────────────────────────────────

describe("remedy — o custo e o efeito de cada resposta", () => {
  it("SIM com arquivo LIMPO: remenda a árvore, RE-ESTAGIA e revalida o índice (exit 0)", async () => {
    const dir = repo()
    const perguntas: string[] = []
    const r = await remedyFit(dir, {
      isTTY: true,
      askFn: async (q) => {
        perguntas.push(q)
        return "s"
      },
      log: () => {},
      write: () => {},
    })

    expect(r.code).toBe(EXIT.OK)
    expect(r.restaged).toEqual([WORKFLOW])
    expect(r.withheld).toEqual([])
    expect(r.answer).toBe("s")
    // Os TRÊS efeitos do "sim" estão ditos ANTES da resposta: o operador
    // confirma o que vai acontecer, não um "aplicar?" genérico.
    const pergunta = perguntas.join("")
    expect(pergunta).toContain("remenda a ÁRVORE")
    expect(pergunta).toContain("git add")
    expect(pergunta).toContain("REVALIDA")
    expect(pergunta).toContain("NÃO reconstrói a linha")
    // E o efeito: o ÍNDICE (o que o commit grava) ficou remendado e igual à árvore.
    expect(indice(dir)).toContain('echo "um"\n')
    expect(indice(dir)).not.toContain("&&")
    expect(sujos(dir)).toEqual([])
  })

  it("NÃO: nada é remendado — e a árvore e o índice ficam byte a byte como estavam", async () => {
    const dir = repo()
    const antesArvore = arvore(dir)
    const antesIndice = indice(dir)
    const r = await remedyFit(dir, {
      isTTY: true,
      askFn: async () => "n",
      log: () => {},
      write: () => {},
    })

    expect(r.code).toBe(EXIT.VIOLATIONS)
    expect(r.fixed).toEqual([])
    expect(r.restaged).toEqual([])
    expect(r.answer).toBe("n")
    expect(arvore(dir)).toBe(antesArvore)
    expect(indice(dir)).toBe(antesIndice)
  })

  it("a resposta VAZIA (só ENTER) equivale ao NÃO — o default não remenda", async () => {
    const dir = repo()
    const antes = arvore(dir)
    const r = await remedyFit(dir, { isTTY: true, askFn: async () => "", log: () => {} })
    expect(r.code).toBe(EXIT.VIOLATIONS)
    expect(arvore(dir)).toBe(antes)
  })

  it("índice VERDE: não há o que remendar, e o remédio diz isso em vez de 'não remendei'", async () => {
    const dir = repo(VALIDO)
    let perguntou = false
    const r = await remedyFit(dir, {
      isTTY: true,
      askFn: async () => {
        perguntou = true
        return "s"
      },
      log: () => {},
    })
    expect(perguntou).toBe(false)
    expect(r.code).toBe(EXIT.OK)
    expect(r.fixed).toEqual([])
    expect(r.refused).toEqual([])
  })

  it("SEM cicatriz remendável NÃO pergunta (a resposta não mudaria nada)", async () => {
    const dir = repo(SEM_CICATRIZ)
    let perguntou = false
    const dito: string[] = []
    const r = await remedyFit(dir, {
      isTTY: true,
      askFn: async () => {
        perguntou = true
        return "s"
      },
      log: (m) => dito.push(m),
    })

    expect(perguntou).toBe(false)
    expect(r.code).toBe(EXIT.VIOLATIONS)
    expect(r.fixed).toEqual([])
    expect(r.refused).toHaveLength(1)
    expect(r.refused[0]?.reason).toContain("OPERADOR PENDENTE")
    expect(dito.join("\n")).toContain("não há cicatriz MECÂNICA")
  })

  it("WIP na árvore: o `git add` NÃO leva para o commit trabalho que não é dele", async () => {
    // O WIP é uma edição in-place (mesma contagem de linhas), que é o caso em que
    // a âncora do fixer continua casando e a proteção tem de vir do `git add`.
    const dir = repo()
    writeFileSync(join(dir, WORKFLOW), CICATRIZ.replace("name: CI", "name: CI-WIP"))
    const r = await remedyFit(dir, { isTTY: true, askFn: async () => "sim", log: () => {} })

    expect(r.code).toBe(EXIT.VIOLATIONS)
    expect(r.restaged).toEqual([])
    expect(r.withheld).toEqual([WORKFLOW])
    // O remendo ESTÁ na árvore (é ela que o fixer remenda)...
    expect(arvore(dir)).toContain('echo "um"\n')
    expect(arvore(dir)).not.toContain("&&")
    // ...e o COMMIT não ganhou nem o WIP nem um índice remendado pela metade.
    expect(indice(dir)).toContain("name: CI\n")
    expect(indice(dir)).toContain('echo "um" &&\n')
    expect(sujos(dir)).toEqual([WORKFLOW])
  })

  it("a árvore DESLOCADA faz o fixer recusar sozinho (nunca grava na linha errada)", async () => {
    const dir = repo()
    // WIP depois do corpo: a linha do arquivo deixa de ser a última linha do corpo.
    writeFileSync(join(dir, WORKFLOW), `${CICATRIZ}      - run: echo wip\n`)
    let perguntou = false
    const r = await remedyFit(dir, {
      isTTY: true,
      askFn: async () => {
        perguntou = true
        return "s"
      },
      log: () => {},
    })

    expect(perguntou).toBe(false)
    expect(r.code).toBe(EXIT.VIOLATIONS)
    expect(r.fixed).toEqual([])
    expect(r.refused[0]?.reason).toContain("não corresponde à última linha do corpo")
    // A árvore ficou intocada — a recusa é ANTES da gravação.
    expect(arvore(dir)).toContain("echo wip")
    expect(arvore(dir)).toContain('echo "um" &&\n')
  })

  it("o veredito final é o do GUARD: um índice que continua vermelho não vira 'sim'", async () => {
    // Dublê do guard revalidando VERMELHO: o remédio não pode cunhar o veredito
    // por conta própria — o exit dele é o que decide.
    const dir = repo()
    const r = await remedyFit(dir, {
      isTTY: true,
      askFn: async () => "s",
      log: () => {},
      rerun: () => ({ status: EXIT.VIOLATIONS, stdout: "", stderr: "" }),
    })
    expect(r.code).toBe(EXIT.VIOLATIONS)
    expect(r.restaged).toEqual([WORKFLOW])
  })

  it("infra: um `bash` que não executa não vira 'nada a remendar' (exit 2)", async () => {
    const dir = repo()
    const r = await remedyFit(dir, {
      bash: "/bin/definitely-not-a-shell",
      isTTY: true,
      log: () => {},
    })
    expect(r.code).toBe(EXIT.UNAVAILABLE)
  })
})

// ── a CLI (o contrato do hook) ────────────────────────────────────────────

describe("CLI — o contrato do exit code, e o caminho SEM terminal", () => {
  it("--help sai OK", () => {
    const r = cli(["--help"])
    expect(r.code).toBe(EXIT.OK)
    expect(r.out).toContain("Exit codes")
  })

  it("--root sem valor é uso inválido (exit 3) e não toca em arquivo nenhum", () => {
    const r = cli(["--root"])
    expect(r.code).toBe(EXIT.USAGE)
    expect(r.err).toContain("--root exige um valor")
  })

  it("--root inexistente é infra (exit 2)", () => {
    const r = cli(["--root", join(tmpdir(), "nao-existe-remedy-xyz")])
    expect(r.code).toBe(EXIT.UNAVAILABLE)
  })

  it("SEM TERMINAL: não pergunta, mantém o commit bloqueado e diz o caminho à mão", () => {
    // O stdin aqui é um PIPE (é o que `spawnSync` dá): exatamente o caso em que
    // perguntar travaria o commit ou leria entrada que não é deste comando.
    const dir = repo()
    const antes = arvore(dir)
    const r = cli(["--root", dir])

    expect(r.code).toBe(EXIT.VIOLATIONS)
    expect(r.err).toContain("SEM TERMINAL")
    expect(r.err).toContain("BLOQUEADO")
    // O caminho à mão: o `--fix` (que remenda a ÁRVORE) e o `git add` que leva o
    // remendo ao COMMIT — os dois, porque um sem o outro não desbloqueia nada.
    expect(r.err).toContain("node scripts/check-workflow-run-syntax.mjs --fix")
    expect(r.err).toContain(`git add ${WORKFLOW}`)
    expect(arvore(dir)).toBe(antes)
    expect(indice(dir)).toContain("&&")
  })

  it("o fixture da CLI está REALMENTE no índice (senão o teste acima mediria nada)", () => {
    const dir = repo()
    expect(indice(dir)).toContain('echo "um" &&')
  })
})

// ── a premissa do hook ────────────────────────────────────────────────────

describe("a premissa: o hook chama o remédio, e de dentro do bloco do gate", () => {
  it("a linha exata do hook existe (é ela que o fixture do hook torna real)", () => {
    const hook = readFileSync(HOOK, "utf8")
    // A linha é o comando CRU (o guard de paridade extrai o comando do hook e o
    // declara LOCAL): o `&& REMEDIO=0` é o CAPTURA do sucesso — sem ele não há
    // como distinguir "o remédio revalidou o índice" de "a chamada sumiu".
    expect(hook).toContain("node scripts/pre-commit-run-syntax-remedy.mjs && REMEDIO=0 || true")
    // E ela está DEPOIS do gate de sintaxe e ANTES do veredito da fase A: fora
    // dessa ordem o remédio ou não vê o defeito ou é atropelado pelo `set -e`.
    const iGate = hook.indexOf("check-workflow-run-syntax.mjs --staged")
    const iRemedio = hook.indexOf("pre-commit-run-syntax-remedy.mjs")
    const iVeredito = hook.indexOf('[ "$FASE_A" -eq 0 ] || exit "$FASE_A"')
    expect(iGate).toBeGreaterThan(-1)
    expect(iRemedio).toBeGreaterThan(iGate)
    expect(iVeredito).toBeGreaterThan(iRemedio)
  })

  it("o script existe e documenta Usage e Exit code no cabeçalho (o contrato da casa)", () => {
    const src = readFileSync(SCRIPT, "utf8")
    const bloco = src.split("\n").filter((l) => l.trim() === "" || l.trim().startsWith("//"))
    expect(bloco.join("\n")).toContain("Usage:")
    expect(bloco.join("\n")).toContain("Exit codes")
  })
})
