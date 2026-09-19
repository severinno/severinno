/**
 * check-workflow-run-syntax-dry-run.test.ts
 *
 * Teste de INTEGRAÇÃO do `--fix --dry-run` do guard
 * scripts/check-workflow-run-syntax.mjs — o PREVIEW do remendo, pelo mesmo
 * caminho de decisão do `--fix` (`fixAll` com `dry`).
 *
 * O QUE ESTE TESTE PROVA (e é o motivo de o modo existir): o `--fix` REMENDA a
 * cicatriz mecânica que a reescrita em massa deixa num bloco `run: |` (um
 * operador pendente no fim) — mas ele só existe onde há terminal e operador, e
 * é LOCAL. O preview leva a mesma decisão até onde o operador NÃO está: imprime
 * o PATCH exato (o que será publicado como comentário no PR por
 * `scripts/pr-remedy-comment.mjs`) sem gravar nada.
 *
 * As três propriedades que fazem o patch valer como remendo — e cada uma
 * mediria o vazio se fosse asserida por leitura de código:
 *
 *   1. ELE É APLICÁVEL: `git apply` de verdade, num repo de verdade, consome o
 *      patch que saiu em STDOUT e o arquivo passa a fazer `bash -n`. O patch é
 *      montado com a linha do ARQUIVO (com a indentação do YAML) e não com a do
 *      corpo — um diff montado com a linha errada não acharia o texto;
 *   2. ELE É O QUE O `--fix` GRAVARIA, byte a byte: o patch do preview é aplicado
 *      num fixture e o `--fix` roda em outro fixture idêntico; os dois arquivos
 *      têm de terminar IGUAIS. É a afirmação "uma régua, dois consumidores"
 *      medida, e não prometida;
 *   3. ELE NÃO GRAVA NADA e não polui o STDOUT: o arquivo fica byte-idêntico
 *      depois do preview, o STDOUT carrega SÓ o patch (o `| git apply` depende
 *      disso) e o relatório inteiro sai em STDERR.
 *
 * HONESTIDADE DO PREVIEW: o veredito do `--dry-run` é o MESMO do `--fix` (a
 * recusa continua recusa), e é isso que o último caso mede — um preview que
 * dissesse "✓ tudo remendado" sobre um corpo que a gravação recusaria seria pior
 * que nenhum preview.
 *
 * ATENÇÃO (esbuild): `${{` e `${...}` do GitHub Actions precisam de escape
 * (`\${{`, `\${...}`) dentro de template literals — senão o esbuild lê `${` como
 * interpolação e o arquivo nem compila. Aqui as fixtures não usam expressão.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-workflow-run-syntax-dry-run.test.ts
 */

import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { EXIT, remedyPatch } from "../../../scripts/check-workflow-run-syntax.mjs"

const SCRIPT = resolve(process.cwd(), "scripts/check-workflow-run-syntax.mjs")
const WORKFLOW = ".github/workflows/ci.yml"
const tmpDirs: string[] = []

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Cria um repo git REAL temporário (o `git apply` do teste roda nele). */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "crs-dry-run-"))
  tmpDirs.push(dir)
  execFileSync("git", ["init", "-q"], { cwd: dir })
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true })
  return dir
}

function writeWorkflow(dir: string, linhas: string[]): string {
  const path = join(dir, WORKFLOW)
  writeFileSync(path, linhas.join("\n") + "\n", "utf8")
  return path
}

/** O corpo do passo com a cicatriz: `echo hello &&` — o bash sai com erro. */
const CICATRIZ = [
  "name: Fixture",
  "on: [push]",
  "jobs:",
  "  x:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - name: passo com cicatriz",
  "        run: |",
  "          echo hello &&",
]

/**
 * A MESMA cicatriz, mais um corpo que o fixer RECUSA: o heredoc SEM terminador
 * é AVISO para o bash (que sai 0) — o gate conta aviso como violação —, e o
 * texto do heredoc é DADO, então o fixer recusa em vez de inventar conteúdo.
 */
const CICATRIZ_E_RECUSA = [
  ...CICATRIZ,
  "      - name: heredoc sem terminador (não remendável)",
  "        run: |",
  "          cat <<EOF",
  "          linha",
]

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" })
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

describe("--fix --dry-run: o patch é o remendo, e ele APLICA", () => {
  it("o patch aplica com `git apply` e o arquivo passa a fazer `bash -n`", () => {
    const dir = makeRepo()
    const path = writeWorkflow(dir, CICATRIZ)

    const dry = runCli(["--fix", "--dry-run", "--root", dir])
    expect(dry.status).toBe(EXIT.OK)
    expect(dry.stdout).toMatch(/^--- a\/\.github\/workflows\/ci\.yml\n/)
    // O hunk carrega CONTEXTO (e não só a linha trocada): sem ele o `git apply`
    // recusa o patch — menos quando a cicatriz cai na ÚLTIMA linha do arquivo,
    // que era exatamente o caso deste fixture (ver o caso do meio do arquivo).
    expect(dry.stdout).toMatch(/^@@ -\d+,\d+ \+\d+,\d+ @@$/m)
    expect(dry.stdout).toContain(" steps:")
    expect(dry.stdout).toContain("-          echo hello &&")
    expect(dry.stdout).toContain("+          echo hello")

    execFileSync("git", ["apply", "-"], { cwd: dir, input: dry.stdout })
    expect(readFileSync(path, "utf8")).toContain("          echo hello\n")
    expect(readFileSync(path, "utf8")).not.toContain("&&")

    const gate = runCli(["--root", dir])
    expect(gate.status).toBe(EXIT.OK)
  })

  it("o patch aplica mesmo com a cicatriz no MEIO do arquivo (com passos depois dela)", () => {
    // O DEFEITO QUE ESTE CASO FIXA: um hunk SEM contexto é recusado pelo
    // `git apply`, e a única exceção é o hunk ancorado no FIM do arquivo. Um
    // passo quebrado no meio — o caso comum, com passos DEPOIS dele — gerava um
    // patch que o operador colava no terminal e o `git apply` recusava: o
    // remendo publicado no PR não era um remendo. O contexto é o que o torna um.
    const dir = makeRepo()
    const path = writeWorkflow(dir, [
      ...CICATRIZ,
      "      - name: passo DEPOIS da cicatriz",
      "        run: echo ok",
    ])

    const dry = runCli(["--fix", "--dry-run", "--root", dir])
    expect(dry.status).toBe(EXIT.OK)

    execFileSync("git", ["apply", "-"], { cwd: dir, input: dry.stdout })
    const depois = readFileSync(path, "utf8")
    expect(depois).toContain("          echo hello\n")
    expect(depois).toContain("      - name: passo DEPOIS da cicatriz\n")
    expect(depois).not.toContain("&&")

    const gate = runCli(["--root", dir])
    expect(gate.status).toBe(EXIT.OK)
  })

  it("o patch é BYTE A BYTE o que o `--fix` gravaria (uma régua, dois consumidores)", () => {
    const viaPreview = makeRepo()
    const viaFix = makeRepo()
    writeWorkflow(viaPreview, CICATRIZ)
    const pathFix = writeWorkflow(viaFix, CICATRIZ)

    const dry = runCli(["--fix", "--dry-run", "--root", viaPreview])
    execFileSync("git", ["apply", "-"], { cwd: viaPreview, input: dry.stdout })

    const aplicado = runCli(["--fix", "--root", viaFix])
    expect(aplicado.status).toBe(EXIT.OK)

    expect(readFileSync(join(viaPreview, WORKFLOW), "utf8")).toBe(readFileSync(pathFix, "utf8"))
  })

  it("NADA é gravado e o STDOUT carrega SÓ o patch (o relatório vai para STDERR)", () => {
    const dir = makeRepo()
    const path = writeWorkflow(dir, CICATRIZ)
    const antes = readFileSync(path, "utf8")

    const dry = runCli(["--fix", "--dry-run", "--root", dir])

    expect(readFileSync(path, "utf8")).toBe(antes)
    // O `| git apply` depende de o STDOUT ser só o patch: nada de "✅"/"◦"/prosa.
    expect(dry.stdout.trimEnd().split("\n")[0]).toBe(`--- a/${WORKFLOW}`)
    expect(dry.stdout).not.toContain("✅")
    expect(dry.stdout).not.toContain("pré-visualizado")
    expect(dry.stderr).toContain("NADA foi gravado")
    expect(dry.stderr).toContain("pré-visualizado")
  })

  it("o módulo publica o mesmo patch que a CLI imprime (o consumidor do CI não parseia texto)", () => {
    const dir = makeRepo()
    writeWorkflow(dir, CICATRIZ)
    const dry = runCli(["--fix", "--dry-run", "--root", dir])
    expect(remedyPatch(dir).patch).toBe(dry.stdout)
  })

  it("em árvore limpa o STDOUT é VAZIO (nada a publicar) e o veredito é 0", () => {
    const dir = makeRepo()
    writeWorkflow(dir, [
      "name: Fixture",
      "on: [push]",
      "jobs:",
      "  x:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: echo ok",
    ])
    const dry = runCli(["--fix", "--dry-run", "--root", dir])
    expect(dry.status).toBe(EXIT.OK)
    expect(dry.stdout).toBe("")
    expect(dry.stderr).toContain("nenhum corpo reprovado")
  })

  it("a recusa continua RECUSA no preview: o patch cobre o remendável e o motivo sai dito", () => {
    const dir = makeRepo()
    writeWorkflow(dir, CICATRIZ_E_RECUSA)
    const dry = runCli(["--fix", "--dry-run", "--root", dir])

    // Exit 1 é o MESMO veredito do `--fix` com uma recusa — e o patch que sai
    // cobre só a metade remendável.
    expect(dry.status).toBe(EXIT.VIOLATIONS)
    expect(dry.stdout).toContain("echo hello &&")
    expect(dry.stderr).toContain("NÃO remendado")
    expect(dry.stderr).toContain("heredoc")
  })

  it("`--dry-run` sem `--fix` é uso inválido: o preview descreve o que o `--fix` gravaria", () => {
    const dry = runCli(["--dry-run"])
    expect(dry.status).toBe(EXIT.USAGE)
    expect(dry.stderr).toContain("--dry-run sem --fix")
  })
})
