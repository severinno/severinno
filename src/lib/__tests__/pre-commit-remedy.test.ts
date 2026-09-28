// =============================================================================
// pre-commit-remedy.test.ts
//
// Testes do scripts/pre-commit-remedy.mjs — o REMÉDIO que o pre-commit oferece
// quando um gate do hook reprova o commit por um defeito MECÂNICO (a cicatriz de
// `run:` do gate de sintaxe, e as classes de encoding da fase B): o remendo com
// confirmação explícita.
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
//   6. SEM TERMINAL NENHUM (sessão sem terminal de controle: é o caso do CI) o
//      remédio NÃO pergunta — diz o caminho à mão e mantém o commit BLOQUEADO.
//      Com um terminal de CONTROLE mas sem stdin-terminal (o caso MEDIDO do `git
//      commit`, em que o git liga o fd 0 em /dev/null) a pergunta é feita pelo
//      `/dev/tty`, e não pelo stdin;
//   7. a pergunta pelo `/dev/tty` tem TETO: sem resposta no teto o remédio assume
//      NÃO e diz que o operador NÃO respondeu — um hook que pergunta a um terminal
//      vazio não pode pendurar o commit para sempre;
//   8. o caminho INTERATIVO é exercitado pela função (deps injetadas), porque
//      num subprocesso o stdin nunca é um terminal.
//
// Sem rede: os fixtures são repositórios git de verdade (o índice é do git, não
// um dublê) e o bash que julga é o de verdade.
// =============================================================================

import { spawnSync } from "node:child_process"
import type { SpawnSyncOptionsWithStringEncoding } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { Readable, Writable } from "node:stream"

import { afterAll, describe, expect, it } from "vitest"

import { EXIT } from "../../../scripts/check-workflow-run-syntax.mjs"
// O `if` da oferta tem UM dono (o mesmo que o benchmark ancora): a premissa da
// ORDEM abaixo não pode ser uma cópia do texto, que passaria a medir outro hook.
import { OFERTA_INICIO } from "../../../scripts/bench-guard-timing.mjs"
import {
  NO_PROMPT_ENV,
  OFFER_MARKER,
  ask,
  dirtyPaths,
  isAffirmative,
  noPromptEnv,
  remedy,
} from "../../../scripts/pre-commit-remedy.mjs"

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
  openTty?: () => { input: unknown; output: unknown } | null
  noPrompt?: boolean
  ttyWaitMs?: number
  log?: (msg: string) => void
  write?: (txt: string) => void
  rerun?: (root: string) => { status: number | null; stdout?: string; stderr?: string }
}

const remedyFit = (root: string, deps: Deps = {}) => remedy(root, deps) as Promise<Resultado>

const ROOT = resolve(__dirname, "..", "..", "..")
const SCRIPT = join(ROOT, "scripts", "pre-commit-remedy.mjs")
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
  { stdin = "", detached = false }: { stdin?: string; detached?: boolean } = {},
): { code: number; out: string; err: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    input: stdin,
    // `detached` = sessão própria (`setsid`), SEM terminal de controle: é assim
    // que se mede o caminho "não há a quem perguntar" mesmo na máquina de um
    // operador que está num terminal (onde o `/dev/tty` abriria). O cast é
    // declarado: o runtime honra `detached`, e o `@types/node` 26 o declara só em
    // `SpawnOptions`, não em `SpawnSyncOptions`.
    detached,
    // E a variável de desligamento vai VAZIA (o default): o que se mede aqui é o
    // desfecho do `/dev/tty` AUSENTE, não o da pergunta desligada por ambiente.
    env: { ...process.env, [NO_PROMPT_ENV]: "" },
  } as SpawnSyncOptionsWithStringEncoding)
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

describe("noPromptEnv — o desligamento da pergunta só liga na forma afirmativa", () => {
  it("aceita 1/true/yes/sim/on (com espaços, maiúscula ou minúscula)", () => {
    for (const ligado of ["1", "true", "TRUE", "yes", "sim", "on", " 1 "]) {
      expect(noPromptEnv({ [NO_PROMPT_ENV]: ligado }), `\`${ligado}\` devia desligar`).toBe(true)
    }
  })

  it("o default é a pergunta ACONTECER: vazio, 0, false e ausente não desligam", () => {
    for (const desligado of ["", " ", "0", "false", "no", "nao", "off", undefined]) {
      expect(
        noPromptEnv({ [NO_PROMPT_ENV]: desligado }),
        `\`${String(desligado)}\` NÃO devia desligar`,
      ).toBe(false)
    }
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

// ── de ONDE a resposta vem (o terminal de controle) ───────────────────────
//
// O stdin do hook NÃO é um terminal dentro de um `git commit` (medido: o git
// liga o fd 0 em /dev/null) — então a oferta interativa só existe se o remédio
// abrir o /dev/tty. Aqui o terminal é injetado: o que se prova é a DECISÃO
// (quem pergunta, a quem, e o que acontece quando não há ninguém), não o
// dispositivo — esse é medido sob um pty de verdade no teste irmão.

describe("remedy — a pergunta pelo TERMINAL DE CONTROLE", () => {
  /** Um terminal injetado: o que o operador "digitou" e o que apareceu nele. */
  const terminalFalso = (
    entrada: string,
  ): { saida: string[]; abrir: () => { input: unknown; output: unknown } } => {
    const saida: string[] = []
    return {
      saida,
      abrir: () => ({
        input: Readable.from([`${entrada}\n`]),
        output: new Writable({
          write(chunk, _e, cb) {
            saida.push(String(chunk))
            cb()
          },
        }),
      }),
    }
  }

  it("stdin não-terminal + /dev/tty: a pergunta é feita ALI, e o 'sim' remenda e re-estagia", async () => {
    const dir = repo()
    const tty = terminalFalso("s")
    const r = await remedyFit(dir, {
      isTTY: false,
      openTty: tty.abrir,
      log: () => {},
      write: () => {},
    })

    expect(r.code).toBe(EXIT.OK)
    expect(r.answer).toBe("s")
    expect(r.restaged).toEqual([WORKFLOW])
    // A pergunta foi escrita NO TERMINAL (não no stderr do pipe) e o índice ficou
    // com o remendo — sem o `git add` do remédio o commit carregaria o defeito.
    expect(tty.saida.join("")).toContain(OFFER_MARKER)
    expect(indice(dir)).not.toContain("&&")
  })

  it("o terminal não abre: NÃO pergunta, diz que não há a quem perguntar e mantém o bloqueio", async () => {
    // (O outro desligamento — a variável `NO_PROMPT_ENV` — é um caminho próprio,
    // provado logo abaixo.)
    const dir = repo()
    const antes = arvore(dir)
    const dito: string[] = []
    let abriu = 0
    const r = await remedyFit(dir, {
      isTTY: false,
      openTty: () => {
        abriu += 1
        return null
      },
      log: (m) => dito.push(m),
    })

    expect(abriu).toBe(1)
    expect(r.code).toBe(EXIT.VIOLATIONS)
    expect(r.answer).toBeNull()
    expect(dito.join("\n")).toContain("SEM TERMINAL")
    expect(dito.join("\n")).toContain("node scripts/check-workflow-run-syntax.mjs --fix")
    expect(arvore(dir)).toBe(antes)
  })

  it("SEM RESPOSTA no teto: assume NÃO (o default), nada é remendado e o motivo é dito", async () => {
    // O teto existe porque o `/dev/tty` não tem fim de arquivo: sem ele, um hook
    // que pergunta a um terminal onde ninguém está penduraria o commit.
    const dir = repo()
    const antes = arvore(dir)
    const dito: string[] = []
    const r = await remedyFit(dir, {
      isTTY: false,
      openTty: () => ({
        input: new Readable({ read() {} }),
        output: new Writable({
          write(_c, _e, cb) {
            cb()
          },
        }),
      }),
      ttyWaitMs: 40,
      log: (m) => dito.push(m),
      write: () => {},
    })

    expect(r.code).toBe(EXIT.VIOLATIONS)
    expect(r.answer).toBeNull()
    expect(r.restaged).toEqual([])
    expect(dito.join("\n")).toContain("SEM RESPOSTA")
    expect(dito.join("\n")).toContain("assume NÃO")
    expect(arvore(dir)).toBe(antes)
  })

  it("a pergunta DESLIGADA por variável: não abre o /dev/tty, não pergunta e mantém o bloqueio", async () => {
    // É o desligamento DECLARADO de quem tem terminal mas não tem operador (um
    // `git commit` dentro de um script): o remédio não pode ficar esperando
    // resposta de ninguém — e não pode fingir que remendou.
    const dir = repo()
    const antes = arvore(dir)
    const dito: string[] = []
    let abriu = 0
    const r = await remedyFit(dir, {
      isTTY: false,
      noPrompt: true,
      openTty: () => {
        abriu += 1
        return null
      },
      log: (m) => dito.push(m),
    })

    expect(abriu).toBe(0)
    expect(r.code).toBe(EXIT.VIOLATIONS)
    expect(r.answer).toBeNull()
    expect(dito.join("\n")).toContain(NO_PROMPT_ENV)
    expect(dito.join("\n")).toContain("DESLIGADA")
    expect(arvore(dir)).toBe(antes)
  })

  it("o stdin TERMINAL tem precedência: o /dev/tty nem é aberto", async () => {
    const dir = repo()
    let abriu = 0
    const r = await remedyFit(dir, {
      isTTY: true,
      openTty: () => {
        abriu += 1
        return null
      },
      askFn: async () => "s",
      log: () => {},
      write: () => {},
    })

    expect(abriu).toBe(0)
    expect(r.code).toBe(EXIT.OK)
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

  it("SEM TERMINAL DE CONTROLE: não pergunta, mantém o commit bloqueado e diz o caminho à mão", () => {
    // O processo roda em sessão PRÓPRIA (`detached`), sem terminal de controle —
    // o caso do CI. O stdin é um pipe E o `/dev/tty` não abre: não há de onde ler
    // a resposta, e perguntar mesmo assim (ou ler o pipe) travaria o commit.
    const dir = repo()
    const antes = arvore(dir)
    const r = cli(["--root", dir], { detached: true })

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
    // como distinguir "o remédio aplicou e revalidou" de "a chamada sumiu".
    expect(hook).toContain("node scripts/pre-commit-remedy.mjs && REMEDIO=0 || true")
  })

  it("a ORDEM: as fases medem antes da pergunta, e a fase volta a rodar depois", () => {
    const hook = readFileSync(HOOK, "utf8")
    const iGate = hook.indexOf("check-workflow-run-syntax.mjs --staged")
    const iFaseB = hook.indexOf("fase_b || FASE_B=$?")
    const iRemedio = hook.indexOf("pre-commit-remedy.mjs")
    // A pergunta vem DEPOIS das fases que RODAM: um prompt competindo com guards
    // escrevendo é um prompt que ninguém lê — e `run-encoding-guards.sh` morre no
    // PRIMEIRO guard que falha, então só depois dele se sabe qual classe morder.
    // (A fase B só roda com a fase A verde; quando ela não roda, o fim do bloco do
    // remédio a mede — nenhuma fase fica sem veredito.)
    expect(iGate).toBeGreaterThan(-1)
    expect(iFaseB).toBeGreaterThan(iGate)
    expect(iRemedio).toBeGreaterThan(iFaseB)
    // ... e o gate e a FASE voltam a rodar DEPOIS do remédio: o remédio só levanta
    // a falha que ele mediu; quem declara verde é a fase, com o remendo no índice.
    // Sem as duas linhas abaixo a pergunta não teria veredito e o commit seguiria
    // com qualquer outro gate da fase B vermelho.
    expect(hook.lastIndexOf("check-workflow-run-syntax.mjs --staged")).toBeGreaterThan(iRemedio)
    expect(hook).toContain('if [ "$FASE_B" -ne 0 ]; then\n    fase_b\n  fi')
  })

  it("a fase B é UMA função com a fase INTEIRA dentro (é o que a reexecução mede)", () => {
    const hook = readFileSync(HOOK, "utf8")
    expect(hook).toContain("fase_b() {")
    // O corpo entre a declaração e o disparo: se um guard ficar FORA dele, a
    // reexecução mediria outra fase — e o veredito do remédio verde cobriria um
    // gate que nunca voltou a rodar.
    const corpo = hook.slice(hook.indexOf("fase_b() {"), hook.indexOf("FASE_B=0"))
    for (const cmd of [
      "bash scripts/run-encoding-guards.sh &",
      "bun run barrel-lint &",
      "bun run check:pii-allowlist &",
      "bun run check:registry-source &",
      "bun run check:forge-parity &",
      "bun run check:forge-workflow-scope &",
      "node scripts/check-hook-ci-parity.mjs &",
      "node scripts/check-hook-commands.mjs &",
      "node scripts/check-pipefail-sigpipe.mjs &",
      "node scripts/check-artefatos-do-hook.mjs &",
      "bun x prettier --check --ignore-unknown $STAGED_FORMAT",
      "wait_all $PID_ENCODING $PID_BARREL $PID_PRETTIER $PID_PII $PID_REGISTRY $PID_FORGE $PID_SCOPE $PID_HOOKPARITY $PID_HOOKCMD $PID_PIPEFAIL $PID_ARQUIVO $PID_TLA $PID_DOCHASH $PID_RUNNERTAG $PID_ARTEFATOS",
    ]) {
      expect(corpo, `${cmd} ficou fora da função fase_b`).toContain(cmd)
    }
  })

  it("a fase A é UMA função com a fase INTEIRA dentro (é o que a reexecução mede)", () => {
    const hook = readFileSync(HOOK, "utf8")
    expect(hook).toContain("fase_a() {")
    // O corpo da fase A vai da declaração até o BLOCO DA FASE B. Se um guard ficar
    // FORA dele, a reexecução mediria outra fase — e o veredito de uma fase verde
    // cobriria um guard do índice que nunca voltou a rodar. (A promessa inversa, a
    // da fase B, é medida logo acima: as duas fases vivem em função pelo MESMO
    // motivo, e uma reexecução que cobrisse só metade da fase é pior que nenhuma.)
    //
    // A âncora do FIM era o literal `PID_RUNSYNTAX=$!`, que NÃO existe mais no hook
    // (a captura do PID virou defensiva, `${!:-}`) — e `indexOf` devolvendo -1 faz
    // um `slice` ir até o FIM do arquivo: o corpo medido passava a incluir a fase B
    // inteira e as asserções de `toContain` continuavam verdes sobre ele. Uma âncora
    // que SOME não pode alargar o que se mede em silêncio, então ela é conferida.
    const inicio = hook.indexOf("fase_a() {")
    const marcadorB = "# ── Phase B: Global guards"
    const fim = hook.indexOf(marcadorB)
    expect(
      fim,
      `o marcador da fase B ('${marcadorB}') saiu do hook: a fase A ficou sem fim declarado`,
    ).toBeGreaterThan(inicio)
    const corpo = hook.slice(inicio, fim)
    expect(corpo, "a fase A não pode engolir a fase B (o corpo medido é o dela)").not.toContain(
      "fase_b() {",
    )
    for (const cmd of [
      "node scripts/check-bun-mirror.mjs --staged &",
      "node scripts/check-mutation-jobs.mjs --staged &",
      "node scripts/check-unused-deps.mjs --staged &",
      "node scripts/check-mutation-timing-contract.mjs --staged &",
      "node scripts/check-required-checks.mjs --staged &",
      "node scripts/check-mutation-count.mjs --staged &",
      "node scripts/check-lint-scope.mjs --staged &",
    ]) {
      expect(corpo, `${cmd} ficou fora da função fase_a`).toContain(cmd)
    }
    // A espera da fase A, comparada por LISTA (não por substring): os PIDs da
    // linha do `wait_all` têm de ser EXATAMENTE os sete guards lançados acima —
    // nem um a mais, nem um a menos. Um guard novo na fase A que não entre na
    // espera não decide o veredito dela (e a reexecução depois do remédio mediria
    // um commit mais permissivo que o da primeira rodada).
    const pids = [...corpo.matchAll(/^\s*wait_all (.+)$/gm)].map((m) => m[1].trim())
    expect(pids, "a fase A tem de ter UMA única espera").toHaveLength(1)
    expect(pids[0].split(/\s+/)).toEqual([
      "$PID_BUN",
      "$PID_MUT",
      "$PID_DEPS",
      "$PID_TIMING",
      "$PID_REQCHECKS",
      "$PID_COUNT",
      "$PID_LINTSCOPE",
    ])
  })

  it("a fase A reprovada NÃO encerra o hook antes da oferta (o `if` do remédio a carrega)", () => {
    const hook = readFileSync(HOOK, "utf8")
    // O contrato, na forma que este arquivo mede (ORDEM): o veredito da fase A sai
    // DEPOIS de o remédio ter rodado. Antes disto o hook encerrava com
    // `[ "$FASE_A" -eq 0 ] || exit "$FASE_A"` aqui em cima — e o gate SEM FIXER
    // custava ao operador a oferta das classes que o MESMO índice carregava.
    expect(hook).toContain(OFERTA_INICIO) // o `if` da oferta carrega a fase A
    const iRemedio = hook.indexOf("pre-commit-remedy.mjs")
    const iVereditoA = hook.indexOf('exit "$FASE_A"')
    expect(iVereditoA).toBeGreaterThan(iRemedio)
    // E a fase vermelha é REEXECUTADA: o remédio só levanta a falha que ele mediu.
    expect(hook).toContain('if [ "$FASE_A" -ne 0 ]; then\n    fase_a\n  fi')
  })

  it("o script existe e documenta Usage e Exit code no cabeçalho (o contrato da casa)", () => {
    const src = readFileSync(SCRIPT, "utf8")
    const bloco = src.split("\n").filter((l) => l.trim() === "" || l.trim().startsWith("//"))
    expect(bloco.join("\n")).toContain("Usage:")
    expect(bloco.join("\n")).toContain("Exit codes")
  })
})
