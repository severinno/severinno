/**
 * check-doc-hashes-remedy.test.ts
 *
 * O REMÉDIO da citação órfã — o `--fix` do guard dono (`check-doc-hashes.mjs`), o
 * preview que vira COMENTÁRIO no PR e a oferta do pre-commit. O que esta suíte
 * prende, e por quê:
 *
 *   1. o patch do preview APLICA com `git apply` de verdade e a prosa resultante é
 *      BYTE A BYTE o que o `--fix` grava — é a promessa do comentário do PR
 *      (“copiar o bloco e colar aplica o remendo”), e a troca é do IDENTIFICADOR,
 *      não da prosa em volta dele;
 *   2. o preview NÃO grava nada e o STDOUT carrega SÓ o patch (o `| git apply`
 *      depende disso), e o MÓDULO devolve o mesmo patch que a CLI imprime — o
 *      publicador do CI não parseia texto;
 *   3. a CONFIRMAÇÃO é load-bearing: sem `--yes` e sem terminal NADA é gravado
 *      (exit 1 com o caminho à mão), e `--yes` — a confirmação DECLARADA — grava,
 *      re-estagia e REVALIDA com a mesma régua;
 *   4. o órfão SEM commit de mesmo assunto não desaparece: ele não é remendado, sai
 *      nomeado como recusado, a classe sai em `semRemendo` e o guard segue vermelho;
 *   5. a CLASSE do pre-commit (a oferta) e o CANAL do PR são as duas pontas do
 *      mesmo remédio: a oferta diz o que o `--fix` faria, o comentário publica o
 *      patch — e a classe se declara INAPLICÁVEL (não “não consegui medir”) numa
 *      árvore sem história, que é onde a régua dela não existe.
 *
 * O FIXTURE é compartilhado (`helpers/doc-hashes-fixture.ts`): um repositório git
 * de verdade onde a prosa cita um nome que a dobra deixou morto.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-doc-hashes-remedy.test.ts
 */

import { execFileSync, spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { EXIT, remedyPatch, trocarTokens } from "../../../scripts/check-doc-hashes.mjs"
import {
  DEFAULT_FIXER,
  FIXERS,
  FORMA_DO_RESULTADO,
  corpoDoFixer,
  fixerOf,
} from "../../../scripts/pr-remedy-comment.mjs"
import { oferta } from "../../../scripts/pre-commit-remedy.mjs"
import {
  limparTmpDirs,
  repoComCitacaoOrfaa,
  repoComCitacaoSemCandidato,
  repoLimpo,
  repoSemHistoria,
} from "./helpers/doc-hashes-fixture"

const GATE = join(process.cwd(), "scripts", "check-doc-hashes.mjs")

afterEach(() => {
  limparTmpDirs()
})

function runCli(
  args: string[],
  env: Record<string, string> = {},
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [GATE, ...args], {
    encoding: "utf8",
    // A PERGUNTA DESLIGADA por ambiente: o caminho medido aqui é o de um processo
    // sem operador (o `git commit` entrega o fd 0 em `/dev/null`), e um teste que
    // deixasse o `/dev/tty` abrir esperaria o teto de 120s da pergunta.
    env: { ...process.env, PRE_COMMIT_REMEDY_NO_PROMPT: "1", ...env },
  })
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

describe("o preview é o MESMO remédio que a gravação", () => {
  it("o patch APLICA com `git apply` e a prosa fica byte a byte igual à do `--fix`", () => {
    const viaPreview = repoComCitacaoOrfaa({ conteudo: (h) => `o ato foi no \`${h}\` e nada mais` })
    const viaFix = repoComCitacaoOrfaa({ conteudo: (h) => `o ato foi no \`${h}\` e nada mais` })

    // O patch pelo MÓDULO (é dele que o publicador do PR publica) …
    const patch = remedyPatch(viaPreview.dir).patch
    expect(patch).toContain("--- a/README.md")
    execFileSync("git", ["apply", "-"], { cwd: viaPreview.dir, input: patch })

    // … e a gravação pela CLI, no mesmo estado de partida.
    const fix = runCli(["--root", viaFix.dir, "--fix", "--yes"])
    expect(fix.status).toBe(EXIT.OK)

    const doPreview = readFileSync(join(viaPreview.dir, "README.md"), "utf8")
    expect(doPreview).toBe(readFileSync(join(viaFix.dir, "README.md"), "utf8"))
    expect(doPreview).toContain(`\`${viaPreview.vivo}\``)
    expect(doPreview).not.toContain(`\`${viaPreview.orfao}\``)
    // A PROSA em volta do identificador não é tocada pelo remendo.
    expect(doPreview).toContain("e nada mais")
  })

  it("a troca é do IDENTIFICADOR: duas citações na MESMA linha viram a mesma troca", () => {
    const { dir, orfao, vivo } = repoComCitacaoOrfaa({
      conteudo: (h) => `o ato \`${h}\` e de novo \`${h}\` — a linha inteira fica igual`,
    })

    const patch = remedyPatch(dir).patch
    execFileSync("git", ["apply", "-"], { cwd: dir, input: patch })

    const depois = readFileSync(join(dir, "README.md"), "utf8")
    expect(depois).toBe(`o ato \`${vivo}\` e de novo \`${vivo}\` — a linha inteira fica igual\n`)
    // UMA linha trocada: o patch não ganha um segundo hunk por causa da segunda citação.
    expect(patch.split("\n").filter((l) => l.startsWith("@@"))).toHaveLength(1)
    expect(orfao).not.toBe(vivo)
  })

  it("`trocarTokens` é a régua da troca: só o token muda (a prosa é do autor)", () => {
    expect(
      trocarTokens("no `abc1234` e no `abc1234x`", [{ token: "abc1234", candidato: "def5678" }]),
    ).toBe("no `def5678` e no `def5678x`")
  })

  it("NADA é gravado pelo preview, e o STDOUT carrega SÓ o patch", () => {
    const { dir } = repoComCitacaoOrfaa()
    const path = join(dir, "README.md")
    const antes = readFileSync(path, "utf8")

    const dry = runCli(["--root", dir, "--fix", "--dry-run"])

    expect(dry.status).toBe(EXIT.OK)
    expect(readFileSync(path, "utf8")).toBe(antes)
    expect(dry.stdout.trimEnd().split("\n")[0]).toBe("--- a/README.md")
    expect(dry.stdout).not.toContain("✅")
    expect(dry.stderr).toContain("NADA foi gravado")
  })

  it("o módulo publica o mesmo patch que a CLI imprime (o consumidor do CI não parseia texto)", () => {
    const { dir } = repoComCitacaoOrfaa()
    const dry = runCli(["--root", dir, "--fix", "--dry-run"])
    expect(remedyPatch(dir).patch).toBe(dry.stdout)
  })

  it("`--dry-run` e `--yes` sem `--fix` são uso inválido (o preview descreve o remédio)", () => {
    const dir = repoLimpo()
    for (const flag of ["--dry-run", "--yes"]) {
      const r = runCli(["--root", dir, flag])
      expect(r.status, `${flag} sem --fix devia ser uso inválido`).toBe(EXIT.USO)
    }
  })
})

describe("a CONFIRMAÇÃO explícita do remédio", () => {
  it("sem `--yes` e sem terminal NADA é gravado (exit 1 com o caminho à mão)", () => {
    const { dir, orfao } = repoComCitacaoOrfaa()
    const path = join(dir, "README.md")

    const r = runCli(["--root", dir, "--fix"])

    expect(r.status).toBe(EXIT.VIOLACAO)
    expect(readFileSync(path, "utf8")).toBe(`o ato foi no \`${orfao}\`\n`)
    expect(r.stderr).toContain("SEM TERMINAL")
    // O caminho à mão é dito com o comando que produz o MESMO remendo.
    expect(r.stderr).toContain("--fix --dry-run | git apply")
  })

  it("`--yes` é a confirmação DECLARADA: grava, re-esta para o ÍNDICE e revalida", () => {
    const { dir, vivo } = repoComCitacaoOrfaa()

    const r = runCli(["--root", dir, "--fix", "--yes"])

    expect(r.status).toBe(EXIT.OK)
    expect(readFileSync(join(dir, "README.md"), "utf8")).toContain(`\`${vivo}\``)
    // A revalidação é a MESMA régua: o guard caiu para zero violação.
    expect(r.stderr).toContain("o guard caiu para 0 violação(ões)")
    expect(r.stderr).toContain("git add README.md")
    // E o veredito do guard, rodado de novo, é verde.
    expect(runCli(["--root", dir]).status).toBe(EXIT.OK)
  })

  it("o órfão SEM commit de mesmo assunto NÃO é remendado — e não desaparece", () => {
    const { dir, orfao } = repoComCitacaoSemCandidato()
    const path = join(dir, "README.md")

    const r = runCli(["--root", dir, "--fix", "--yes"])

    expect(r.status).toBe(EXIT.VIOLACAO)
    expect(readFileSync(path, "utf8")).toBe(`o ato foi no \`${orfao}\`\n`)
    expect(r.stderr).toContain("NENHUMA tem remédio mecânico")
    expect(remedyPatch(dir).patch).toBe("")
    expect(remedyPatch(dir).refused.map((x) => x.file)).toEqual(["README.md"])
  })

  it("em árvore sem órfão o patch é VAZIO e o veredito é 0 (nada a publicar)", () => {
    const dir = repoLimpo()
    const dry = runCli(["--root", dir, "--fix", "--dry-run"])
    expect(dry.status).toBe(EXIT.OK)
    expect(dry.stdout).toBe("")
    expect(remedyPatch(dir).patch).toBe("")
  })
})

describe("a FORMA do resultado — o contrato entre o fixer e o publicador", () => {
  it("o resultado do `doc-hashes` traz todos os campos que o publicador confere", () => {
    const r = remedyPatch(process.cwd())
    for (const campo of FORMA_DO_RESULTADO) expect(Object.keys(r)).toContain(campo)
    expect(Array.isArray(r.fixed)).toBe(true)
    expect(Array.isArray(r.refused)).toBe(true)
    expect(Array.isArray(r.unread)).toBe(true)
    expect(typeof r.patch).toBe("string")
  })

  it("o repositório real mede e NÃO tem nada a remendar (o piso)", () => {
    const r = remedyPatch(process.cwd())
    expect(r.indisponivel).toBeNull()
    expect(r.unread).toEqual([])
    expect(r.patch).toBe("")
    expect(r.fixed).toEqual([])
  })
})

describe("a CLASSE do pre-commit (a oferta do remédio)", () => {
  it("a oferta traz a classe `doc-hashes` com o antes/depois da linha", () => {
    const { dir, orfao, vivo } = repoComCitacaoOrfaa()

    const of = oferta(dir)
    const classe = of.classes.find((c) => c.id === "doc-hashes")

    expect(of.code).toBe(EXIT.OK)
    expect(classe, "a classe não foi oferecida").toBeTruthy()
    expect(classe?.fixer).toBe("node scripts/check-doc-hashes.mjs --fix")
    expect(classe?.offenders).toEqual(["README.md"])
    expect(classe?.relatorio).toContain(`antes:  \`${orfao}\``)
    expect(classe?.relatorio).toContain(`depois: \`${vivo}\``)
    // O órfão sem candidato é a OUTRA metade: ele não é oferecido como remendo.
    expect(of.semRemendo.find((x) => x.id === "doc-hashes")).toBeUndefined()
  })

  it("com o órfão SEM candidato a classe sai em `semRemendo` (nomeada, nunca sumida)", () => {
    const { dir } = repoComCitacaoSemCandidato()

    const of = oferta(dir)

    expect(of.classes.some((c) => c.id === "doc-hashes")).toBe(false)
    const recusada = of.semRemendo.find((x) => x.id === "doc-hashes")
    expect(recusada, "a classe desapareceu em vez de sair nomeada").toBeTruthy()
    expect(recusada?.reason).toContain("NÃO remendável")
  })

  it("sem HISTÓRIA a classe é INAPLICÁVEL — e não 'não consegui medir'", () => {
    // A régua desta classe é o grafo do repositório: numa árvore sem commit em
    // `HEAD` não há citação a julgar (o guard dono responde fail-closed, exit 2).
    // Declarar UNMEASURED ali faria a rodada inteira sair `infra` por um estado em
    // que o veredito do dono é conhecido — “não medí” não é o nome de “não há”.
    const of = oferta(repoSemHistoria())

    const fora = of.notApplicable.find((x) => x.id === "doc-hashes")
    expect(fora, "a classe não se declarou inaplicável").toBeTruthy()
    expect(fora?.reason).toContain("não tem commit nenhum em HEAD")
    expect(of.unmeasured.find((x) => x.id === "doc-hashes")).toBeUndefined()
    expect(of.classes.some((c) => c.id === "doc-hashes")).toBe(false)
  })
})

describe("o CANAL do PR (o comentário que o autor aplica com um clique)", () => {
  it("o corpo carrega o marcador, o gate, o comando do fixer e o patch que APLICA", () => {
    const { dir, vivo } = repoComCitacaoOrfaa()

    const patch = remedyPatch(dir).patch
    const corpo = corpoDoFixer("doc-hashes", remedyPatch(dir)) ?? ""

    expect(corpo).toContain(FIXERS["doc-hashes"].marker)
    expect(corpo).toContain("Doc commit citations (história do HEAD)")
    expect(corpo).toContain("node scripts/check-doc-hashes.mjs --fix")
    expect(corpo).toContain("git apply - <<'REMEDY_PATCH'")
    expect(corpo).toContain(patch.trimEnd())
    // E o patch DO CORPO aplica no fixture de verdade: copiar → colar remenda.
    execFileSync("git", ["apply", "-"], { cwd: dir, input: patch })
    expect(readFileSync(join(dir, "README.md"), "utf8")).toContain(`\`${vivo}\``)
    // Sem remendo não há corpo — `null` é o sinal de RETIRAR o comentário.
    expect(corpoDoFixer("doc-hashes", remedyPatch(repoLimpo()))).toBeNull()
  })

  it("o id é do canal dele: marcador próprio, gate próprio e o default intacto", () => {
    expect(Object.keys(FIXERS)).toContain("doc-hashes")
    expect(fixerOf("doc-hashes").gateJob).toBe("Doc commit citations (história do HEAD)")
    // O default continua sendo o do `bash -n`: um segundo `default: true` faria a
    // descoberta RECUSAR a rodada (e um comentário no gate errado é pior que nenhum).
    expect(DEFAULT_FIXER).toBe("run-syntax")
    const marcadores = Object.values(FIXERS).map((f) => f.marker)
    expect(new Set(marcadores).size).toBe(marcadores.length)
  })
})
