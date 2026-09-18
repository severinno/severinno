// =============================================================================
// pre-commit-remedy-classes.test.ts
//
// Testes das CLASSES MECÂNICAS do remédio do pre-commit — as de ENCODING, que o
// hook mede na fase B (`run-encoding-guards.sh`): CR/CRLF no working tree dos
// `.sh`/`.bash`, CRLF/mixed no BLOB do índice e o byte 0x97 nos `.ts`/`.tsx` de
// `src/`. A classe da sintaxe (`run-syntax`) tem a prova própria em
// `pre-commit-remedy.test.ts` e o ensaio sob terminal em
// `pre-commit-remedy-pty.test.ts`.
//
// O que precisa ser provado (um remédio pode parecer certo e mentir):
//   1. a DETECÇÃO é a do guard DONO: o parse da lista de ofensores é pinado contra
//      a saída do guard real, rodado num fixture de verdade (se o formato mudar, o
//      teste fica vermelho em vez de o remédio estagiar o arquivo errado);
//   2. o remendo CHEGA ao ÍNDICE: o "sim" leva o conteúdo remendado ao commit (o
//      blob muda), não só ao disco;
//   3. o "não" não toca em NADA (nem árvore, nem índice);
//   4. as classes que se SOBREPÕEM (o CR do working tree suja também o blob) levam
//      o arquivo ao índice UMA vez e não o acusam de retido — a regressão que este
//      teste existe para não deixar voltar;
//   5. a classe que ESTAGIA POR CONTA PRÓPRIA se RETÉM quando o ofensor tem WIP
//      (o `git add --renormalize` dela levaria junto trabalho que não é do commit),
//      e o fixer dela NÃO roda;
//   6. a classe NÃO APLICÁVEL não roda o guard do repositório de quem executa: num
//      fixture sem os guards, a classe se declara inaplicável e o veredito é "nada
//      a remendar" (nunca uma violação medida em OUTRA árvore);
//   7. o que o fixer NÃO remenda não vira "nada remendável": um UTF-8 inválido que
//      não é o byte 0x97 mantém o commit bloqueado com o motivo, sem pergunta;
//   8. SEM TERMINAL nenhum o caminho à mão é o DA CLASSE (o `--fix` dela + o
//      `git add` que leva o remendo ao commit).
//
// Sem rede e sem dublê de guard: os fixtures são repositórios git de verdade, com
// os guards reais copiados (python3 node PATH, como no hook).
// =============================================================================

import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import { EXIT } from "../../../scripts/check-workflow-run-syntax.mjs"
import { cleanupFixtures, novoRepo, resolveBash, stage } from "../../../scripts/hook-simulator.mjs"
import { CLASSES, remedy } from "../../../scripts/pre-commit-remedy.mjs"

afterAll(() => {
  cleanupFixtures()
})

const ROOT = resolve(__dirname, "..", "..", "..")

/** O fecho dos guards de encoding — os MESMOS que a fase B executa. */
const FECHO_ENCODING = [
  "check-crlf.sh",
  "check_crlf.py",
  "check-blob-crlf.sh",
  "check_blob_crlf.py",
  "check-utf8.sh",
  "check_utf8.py",
]

/** O byte que NÃO é o 0x97: UTF-8 inválido que o fixer do guard recusa. */
const BYTE_INVALIDO = 0xff

/** Um fixture: repositório git de verdade com os guards de encoding dentro. */
function repo(closure: string[] = FECHO_ENCODING) {
  return novoRepo({ prefix: "remedy-classes-", closure, wrapper: "set -eu\n", dirs: ["src"] })
}

/** O git do FIXTURE (o `runGit` do simulador é o do hook: aquele soma o dublê). */
function git(dir: string, args: string[]) {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8", input: "" })
  return { status: r.status, out: String(r.stdout ?? "") }
}

/**
 * O CONTEÚDO DO ÍNDICE de um caminho — o que o commit gravaria. Em BYTES (não em
 * utf8): o defeito do byte 0x97 é justamente um byte que não decodifica, e um
 * `git show` lido como texto devolveria o caractere de substituição em vez do
 * byte — o teste mediria a decodificação de quem lê, não o blob do commit.
 *
 * @param {string} dir
 * @param {string} rel
 * @returns {Buffer}
 */
function indice(dir: string, rel: string) {
  const r = spawnSync("git", ["show", `:${rel}`], { cwd: dir, input: "" })
  if (r.status !== 0) throw new Error(`git show :${rel} falhou: ${String(r.stderr)}`)
  return r.stdout
}

/** O conteúdo da ÁRVORE (o disco). */
function naArvore(dir: string, rel: string) {
  return readFileSync(join(dir, rel), "utf8")
}

function comDefeito(dir: string, rel: string, conteudo: string | Buffer) {
  writeFileSync(join(dir, rel), conteudo)
  git(dir, ["add", rel])
}

/** O texto que o remédio escreveu (o relatório inteiro, para as asserções). */
function dito(): { log: (m: string) => void; linhas: string[] } {
  const linhas: string[] = []
  return { log: (m: string) => linhas.push(m), linhas }
}

const CRLF_SH = "#!/usr/bin/env bash\r\necho oi\r\n"
const LF_SH = "#!/usr/bin/env bash\necho oi\n"

/** Um `.ts` com o byte corrompido no meio — a assinatura do Windows-1252. */
function tsComByte(byte: number) {
  return Buffer.concat([Buffer.from('const a = "'), Buffer.from([byte]), Buffer.from('"\n')])
}

/** O "sim" injetado: o caminho INTERATIVO sem depender de um terminal. */
const SIM = { askFn: async () => "s" }

/**
 * O contexto que uma classe recebe na DETECÇÃO. Só a classe da sintaxe usa o
 * `bash` (para o `-n`); as de encoding ignoram — o que elas spawnam é o guard
 * dono, por caminho.
 */
const CTX = { bash: resolveBash() }

describe("a lista de classes (o que o remédio OFERECE)", () => {
  it("são as quatro classes mecânicas do commit, sem duplicata e sem sobra", () => {
    // A cobertura é o contrato: uma classe a mais aqui é um remendo que o
    // repositório passaria a oferecer; uma a menos, um defeito mecânico que volta
    // a ser corrigido à mão.
    expect(CLASSES.map((c) => c.id)).toEqual(["run-syntax", "crlf", "blob-crlf", "utf8"])
  })

  it("cada classe declara o fixer, o caminho à mão e a régua do veredito", () => {
    for (const c of CLASSES) {
      expect(c.fixer, `${c.id} sem fixer`).toBeTruthy()
      expect(c.sugere(["<arquivo>"]).length, `${c.id} sem caminho à mão`).toBeGreaterThan(0)
      expect(c.verde, `${c.id} sem frase de verde`).toBeTruthy()
      expect(c.vermelho, `${c.id} sem frase de vermelho`).toBeTruthy()
      expect(["add", "renormalize", "self"], `${c.id} com estágio desconhecido`).toContain(
        c.estagio,
      )
    }
  })

  it("o guard dono de cada classe EXISTE no repositório (o fixer cita um script real)", () => {
    for (const c of CLASSES) {
      if (c.id === "run-syntax") continue // o dono é o gate, importado e não spawnado
      // `.sh` (encoding) e `.mjs` (comandos dos hooks): o que NÃO pode é o fixer
      // citar um script que não existe — um caminho com erro de digitação no
      // remédio seria um passo que nunca roda, a mesma classe que o
      // `check-hook-commands` persegue nos hooks.
      const m = /scripts\/(\S+\.(?:sh|mjs))/.exec(c.fixer)
      expect(m, `${c.id} não cita um guard de scripts/`).not.toBeNull()
      // E o nome declarado na classe é o MESMO do comando (não há cópia divergente).
      expect(c.script).toBe(m?.[1])
      expect(readFileSync(join(ROOT, "scripts", m?.[1] ?? ""), "utf8")).toContain("--fix")
    }
  })
})

describe("`crlf` — CR/CRLF no working tree dos `.sh`/`.bash`", () => {
  it("DETECTA pelo guard dono e o parse da lista de ofensores é o dele", () => {
    const dir = repo()
    comDefeito(dir, "scripts/quebrado.sh", CRLF_SH)

    const classe = CLASSES.find((c) => c.id === "crlf")
    const d = classe?.detectar(dir, CTX)
    // O parse é PINADO contra a saída do guard real: a lista sai do `  - <path>`
    // que o `check-crlf.sh` imprime (um formato novo quebraria o teste, não o
    // remédio em silêncio).
    expect(d?.offenders).toEqual(["scripts/quebrado.sh"])
    expect(d?.relatorio).toContain("check-crlf: FAILED")
    expect(d?.violacoes).toBeGreaterThan(0)
  })

  it('o "sim" leva o conteúdo remendado ao ÍNDICE (não só ao disco)', () => {
    const dir = repo()
    comDefeito(dir, "scripts/quebrado.sh", CRLF_SH)
    expect(indice(dir, "scripts/quebrado.sh").includes(13)).toBe(true)

    const { log, linhas } = dito()
    return remedy(dir, { ...SIM, log }).then((r) => {
      expect(r.code).toBe(EXIT.OK)
      expect(r.restaged).toContain("scripts/quebrado.sh")
      expect(r.withheld).toEqual([])
      expect(indice(dir, "scripts/quebrado.sh").toString("utf8")).toBe(LF_SH)
      expect(naArvore(dir, "scripts/quebrado.sh")).toBe(LF_SH)
      expect(linhas.join("\n")).toContain("estão em LF")
    })
  })

  it('o "não" não toca em NADA — árvore e índice ficam byte a byte', () => {
    const dir = repo()
    comDefeito(dir, "scripts/quebrado.sh", CRLF_SH)

    return remedy(dir, { askFn: async () => "n", log: () => {} }).then((r) => {
      expect(r.code).toBe(EXIT.VIOLATIONS)
      expect(r.restaged).toEqual([])
      expect(indice(dir, "scripts/quebrado.sh")).toEqual(Buffer.from(CRLF_SH))
      expect(naArvore(dir, "scripts/quebrado.sh")).toBe(CRLF_SH)
    })
  })
})

describe("`blob-crlf` — CRLF/mixed no BLOB do ÍNDICE", () => {
  it("DETECTA o blob sujo mesmo com a árvore já em LF", () => {
    const dir = repo()
    comDefeito(dir, "scripts/quebrado.sh", CRLF_SH)
    // A árvore passa a LF sem estagiar: o defeito que sobra é do BLOB.
    writeFileSync(join(dir, "scripts/quebrado.sh"), LF_SH)

    const classe = CLASSES.find((c) => c.id === "blob-crlf")
    const d = classe?.detectar(dir, CTX)
    expect(d?.offenders).toEqual(["scripts/quebrado.sh"])
    expect(d?.relatorio).toContain("check-blob-crlf: FAILED")
  })

  it("a classe que ESTAGIA POR CONTA PRÓPRIA se RETÉM quando o ofensor tem WIP", () => {
    const dir = repo()
    comDefeito(dir, "scripts/quebrado.sh", CRLF_SH)
    writeFileSync(join(dir, "scripts/quebrado.sh"), LF_SH) // WIP não estagiado

    const { log, linhas } = dito()
    let perguntou = false
    return remedy(dir, {
      askFn: async () => {
        perguntou = true
        return "s"
      },
      log,
    }).then((r) => {
      // O `git add --renormalize` da classe levaria junto o WIP inteiro (ela não
      // estagia um subconjunto): o remédio se RETÉM e mantém o commit bloqueado.
      expect(perguntou).toBe(false)
      expect(r.code).toBe(EXIT.VIOLATIONS)
      expect(linhas.join("\n")).toContain("ESTAGIA POR CONTA PRÓPRIA")
      expect(linhas.join("\n")).toContain("WIP")
      // E o fixer dela NÃO rodou: o blob do índice continua com CRLF.
      expect(indice(dir, "scripts/quebrado.sh")).toEqual(Buffer.from(CRLF_SH))
      // O caminho à mão também é da classe (com o `--fix` dela).
      expect(linhas.join("\n")).toContain("bash scripts/check-blob-crlf.sh --fix")
    })
  })

  it("com as classes se SOBREPONDO, o arquivo vai ao índice UMA vez e não é 'retido'", () => {
    // A regressão: o CR do working tree suja também o blob, então `crlf` e
    // `blob-crlf` acusam o MESMO arquivo. A primeira que remenda o deixa limpo — e
    // um filtro que só olhasse "sujo agora" acusaria de RETIDO o arquivo que JÁ
    // está no commit (o operador estagiaria de novo o que já estava estagiado).
    const dir = repo()
    comDefeito(dir, "scripts/quebrado.sh", CRLF_SH)

    return remedy(dir, { ...SIM, log: () => {} }).then((r) => {
      expect(r.code).toBe(EXIT.OK)
      expect(r.withheld).toEqual([])
      expect(r.restaged).toEqual(["scripts/quebrado.sh"])
      expect(indice(dir, "scripts/quebrado.sh").toString("utf8")).toBe(LF_SH)
    })
  })
})

describe("`utf8` — byte 0x97 nos `.ts`/`.tsx` de `src/`", () => {
  it("DETECTA pelo dry-run do guard dono (o parse de `WOULD FIX:` é dele)", () => {
    const dir = repo()
    mkdirSync(join(dir, "src"), { recursive: true })
    comDefeito(dir, "src/com-defeito.ts", tsComByte(0x97))

    const classe = CLASSES.find((c) => c.id === "utf8")
    const d = classe?.detectar(dir, CTX)
    expect(d?.offenders).toEqual(["src/com-defeito.ts"])
    expect(d?.relatorio).toContain("WOULD FIX")
  })

  it('o "sim" troca o byte inválido pelo em dash NO ÍNDICE', () => {
    const dir = repo()
    mkdirSync(join(dir, "src"), { recursive: true })
    comDefeito(dir, "src/com-defeito.ts", tsComByte(0x97))

    return remedy(dir, { ...SIM, log: () => {} }).then((r) => {
      expect(r.code).toBe(EXIT.OK)
      expect(r.restaged).toContain("src/com-defeito.ts")
      // O em dash de verdade (UTF-8), no commit — não um byte solto.
      expect(indice(dir, "src/com-defeito.ts")).toEqual(Buffer.from('const a = "—"\n'))
      expect(indice(dir, "src/com-defeito.ts").includes(0x97)).toBe(false)
    })
  })

  it("UTF-8 inválido que o fixer NÃO remenda não vira 'nada remendável'", () => {
    const dir = repo()
    mkdirSync(join(dir, "src"), { recursive: true })
    // 0xFF não é o 0x97: o fixer do guard só troca o byte corrompido pelo Windows.
    comDefeito(dir, "src/outro.ts", tsComByte(BYTE_INVALIDO))

    const { log, linhas } = dito()
    let perguntou = false
    return remedy(dir, {
      askFn: async () => {
        perguntou = true
        return "s"
      },
      log,
    }).then((r) => {
      expect(perguntou).toBe(false)
      expect(r.code).toBe(EXIT.VIOLATIONS)
      expect(linhas.join("\n")).toContain("NÃO remenda")
      expect(indice(dir, "src/outro.ts")).toEqual(tsComByte(BYTE_INVALIDO))
    })
  })
})

describe("a classe NÃO APLICÁVEL não mede OUTRA árvore", () => {
  it("sem os guards no fixture, a classe se declara inaplicável e nada é remendado", () => {
    // Sem este contrato, um fixture (ou um checkout parcial) faria o remédio rodar
    // o guard do repositório de QUEM EXECUTA — que mede outra árvore, e cujo
    // "verde" não diz nada sobre o commit em jogo.
    const dir = repo([])
    comDefeito(dir, "scripts/quebrado.sh", CRLF_SH)

    const { log, linhas } = dito()
    return remedy(dir, { ...SIM, log }).then((r) => {
      expect(r.code).toBe(EXIT.OK)
      expect(r.restaged).toEqual([])
      expect(r.withheld).toEqual([])
      const texto = linhas.join("\n")
      expect(texto).toContain("não existe neste repositório")
      expect(texto).toContain("nada a remendar")
      // O arquivo continua com CRLF no índice: nenhum fixer de FORA tocou nele.
      expect(indice(dir, "scripts/quebrado.sh")).toEqual(Buffer.from(CRLF_SH))
    })
  })
})

describe("SEM TERMINAL: o caminho à mão é o DA CLASSE", () => {
  it("com a pergunta desligada, o remédio diz o `--fix` e o `git add` de cada classe", () => {
    const dir = repo()
    mkdirSync(join(dir, "src"), { recursive: true })
    comDefeito(dir, "scripts/quebrado.sh", CRLF_SH)
    comDefeito(dir, "src/com-defeito.ts", tsComByte(0x97))

    const { log, linhas } = dito()
    return remedy(dir, { noPrompt: true, isTTY: false, log }).then((r) => {
      expect(r.code).toBe(EXIT.VIOLATIONS)
      expect(r.restaged).toEqual([])
      const texto = linhas.join("\n")
      expect(texto).toContain("SEM TERMINAL")
      expect(texto).toContain("PRE_COMMIT_REMEDY_NO_PROMPT")
      // Uma classe por bloco, com os DOIS comandos (o `--fix` sozinho remenda a
      // árvore e não desbloqueia nada).
      expect(texto).toContain("bash scripts/check-crlf.sh --fix")
      expect(texto).toContain("git add --renormalize scripts/quebrado.sh")
      expect(texto).toContain("bash scripts/check-utf8.sh --fix src/")
      expect(texto).toContain("git add src/com-defeito.ts")
      // E nada foi tocado: nem árvore, nem índice.
      expect(naArvore(dir, "scripts/quebrado.sh")).toBe(CRLF_SH)
      expect(indice(dir, "src/com-defeito.ts")).toEqual(tsComByte(0x97))
    })
  })
})
