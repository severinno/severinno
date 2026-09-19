/**
 * check-pipefail-sigpipe-remedy.test.ts
 *
 * O PREVIEW do remédio do gate SIGPIPE — o patch que o `--fix` GRAVARIA — e o
 * contrato que o publicador (`pr-remedy-comment.mjs`) consome dele.
 *
 * O QUE ESTA PROVA FIXA
 *
 *   1. o patch APLICA com `git apply` de verdade e o arquivo resultante é BYTE A
 *      BYTE o que o `--fix` grava (uma régua, dois consumidores). É a promessa do
 *      comentário do PR: “copiar o bloco e colar no terminal aplica o remendo”;
 *   2. ele aplica mesmo com o defeito NO MEIO do arquivo — um hunk sem CONTEXTO
 *      é recusado pelo `git apply`, e a única exceção é o hunk ancorado no fim do
 *      arquivo (medido nesta máquina, git 2.43). Sem o contexto, o patch do
 *      comentário só funcionava para o último defeito do arquivo;
 *   3. o preview NÃO grava nada e o STDOUT carrega SÓ o patch (o `| git apply`
 *      depende disso);
 *   4. o resultado declara a FORMA que o publicador confere antes de anunciar que
 *      mediu (`FORMA_DO_RESULTADO`) — nos DOIS fixers, porque a forma é o
 *      contrato entre eles;
 *   5. as recusas e o não-lido são a metade honesta: um arquivo que não abre não
 *      vira “nada a remendar”.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-pipefail-sigpipe-remedy.test.ts
 */

import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { EXIT, fixSource, remedyPatch } from "../../../scripts/check-pipefail-sigpipe.mjs"
import { remedyPatch as runSyntaxPatch } from "../../../scripts/check-workflow-run-syntax.mjs"
import { FORMA_DO_RESULTADO } from "../../../scripts/pr-remedy-comment.mjs"
import { linhasDe, unifiedPatch } from "../../../scripts/unified-patch.mjs"

const GATE = join(process.cwd(), "scripts", "check-pipefail-sigpipe.mjs")
const tmpDirs: string[] = []

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Um repo git REAL temporário (o `git apply` do teste roda nele). */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "sigpipe-remedy-"))
  tmpDirs.push(dir)
  execFileSync("git", ["init", "-q"], { cwd: dir })
  return dir
}

function escreve(dir: string, rel: string, conteudo: string): string {
  const path = join(dir, rel)
  writeFileSync(path, conteudo, "utf8")
  return path
}

/**
 * Um script com o padrão em TRÊS posições: no começo, no MEIO (com linhas
 * depois) e no fim — é o primeiro e o do meio que um hunk sem contexto não
 * aplicaria.
 */
const CASO = [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  "",
  'OUT="$(echo alfa)"',
  'echo "$OUT" | grep -Fq alfa',
  "",
  "if curl -sS https://exemplo | grep -q ok; then echo vivo; fi",
  "",
  'MULTI="$(echo beta)"',
  'echo "$MULTI" \\',
  "  | grep -q beta",
  "",
  "echo fim",
  "",
].join("\n")

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [GATE, ...args], { encoding: "utf8" })
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
}

describe("o preview é o MESMO remédio que a gravação", () => {
  it("o patch APLICA com `git apply` e o arquivo fica byte a byte igual ao do `--fix`", () => {
    const viaPreview = makeRepo()
    const viaFix = makeRepo()
    const pathPreview = escreve(viaPreview, "caso.sh", CASO)
    const pathFix = escreve(viaFix, "caso.sh", CASO)

    // O patch pelo MÓDULO (é dele que o publicador do PR publica) …
    const patch = remedyPatch(viaPreview).patch
    expect(patch).toContain("--- a/caso.sh")
    execFileSync("git", ["apply", "-"], { cwd: viaPreview, input: patch })

    // … e a gravação pela CLI, no mesmo fixture.
    const fix = runCli(["--root", viaFix, "--fix"])
    expect(fix.status).toBe(EXIT.OK)

    expect(readFileSync(pathPreview, "utf8")).toBe(readFileSync(pathFix, "utf8"))
    expect(readFileSync(pathPreview, "utf8")).not.toContain("| grep -q")
  })

  it("aplica mesmo com o defeito no MEIO do arquivo (com linhas depois dele)", () => {
    const dir = makeRepo()
    const path = escreve(dir, "caso.sh", CASO)

    execFileSync("git", ["apply", "-"], { cwd: dir, input: remedyPatch(dir).patch })

    const depois = readFileSync(path, "utf8")
    expect(depois).toContain('grep -Fq alfa <<< "$OUT"')
    expect(depois).toContain("echo fim\n")
    expect(depois).not.toContain("| grep -q")
  })

  it("NADA é gravado pelo preview, e o STDOUT da CLI carrega SÓ o patch", () => {
    const dir = makeRepo()
    const path = escreve(dir, "caso.sh", CASO)
    const antes = readFileSync(path, "utf8")

    const dry = runCli(["--root", dir, "--fix", "--dry-run"])

    expect(dry.status).toBe(EXIT.OK)
    expect(readFileSync(path, "utf8")).toBe(antes)
    expect(dry.stdout.trimEnd().split("\n")[0]).toBe("--- a/caso.sh")
    expect(dry.stdout).not.toContain("✅")
    expect(dry.stderr).toContain("NADA foi gravado")
  })

  it("o módulo publica o mesmo patch que a CLI imprime (o consumidor do CI não parseia texto)", () => {
    const dir = makeRepo()
    escreve(dir, "caso.sh", CASO)
    const dry = runCli(["--root", dir, "--fix", "--dry-run"])
    expect(remedyPatch(dir).patch).toBe(dry.stdout)
  })

  it("em árvore limpa o patch é VAZIO e o veredito é 0 (nada a publicar)", () => {
    const dir = makeRepo()
    escreve(dir, "caso.sh", "#!/usr/bin/env bash\nset -euo pipefail\n")

    const dry = runCli(["--root", dir, "--fix", "--dry-run"])
    expect(dry.status).toBe(EXIT.OK)
    expect(dry.stdout).toBe("")
    expect(remedyPatch(dir).patch).toBe("")
  })

  it("`--dry-run` sem `--fix` é uso inválido (o preview descreve o remédio)", () => {
    const dir = makeRepo()
    const r = runCli(["--root", dir, "--dry-run"])
    expect(r.status).toBe(EXIT.USAGE)
  })

  it("o `--fix --dry-run --json` é a forma para outro consumidor (patch + linhas + recusas)", () => {
    const dir = makeRepo()
    escreve(dir, "caso.sh", CASO)
    const r = runCli(["--root", dir, "--fix", "--dry-run", "--json"])
    const dados = JSON.parse(r.stdout)
    expect(dados.dryRun).toBe(true)
    expect(dados.patch).toContain("@@ ")
    expect(dados.fixed.length).toBeGreaterThan(0)
    expect(dados.fixed[0]).toMatchObject({ file: "caso.sh", line: 5 })
    expect(Array.isArray(dados.refused)).toBe(true)
  })

  it("o `--fix --dry-run` no REPOSITÓRIO real não propõe nada (a dívida foi aposentada)", () => {
    const r = runCli(["--fix", "--dry-run"])
    expect(r.status).toBe(EXIT.OK)
    expect(r.stdout).toBe("")
  })
})

describe("a FORMA do resultado — o contrato entre o fixer e o publicador", () => {
  it("os DOIS fixers devolvem todos os campos que o publicador confere antes de medir", () => {
    // Sem esta conferência, um fixer que esquecesse `unread`/`yamlInvalido`
    // declararia \"mediu\" sobre um campo que ninguém preencheu — e o erro seria
    // invisível (um campo ausente não estoura nada).
    for (const r of [remedyPatch(process.cwd()), runSyntaxPatch(process.cwd())]) {
      for (const campo of FORMA_DO_RESULTADO) {
        expect(Object.keys(r)).toContain(campo)
      }
      expect(Array.isArray(r.fixed)).toBe(true)
      expect(Array.isArray(r.refused)).toBe(true)
      expect(Array.isArray(r.unread)).toBe(true)
      expect(typeof r.patch).toBe("string")
    }
  })

  it("o repositório real mede e NÃO tem nada a remendar (o piso)", () => {
    const r = remedyPatch(process.cwd())
    expect(r.indisponivel).toBeNull()
    expect(r.unread).toEqual([])
    expect(r.patch).toBe("")
    expect(r.fixed).toEqual([])
  })
})

describe("o que o preview NÃO cobre", () => {
  it("um arquivo que a varredura NÃO conseguiu ler sai NOMEADO (não vira 'nada a remendar')", () => {
    const dir = makeRepo()
    escreve(dir, "ok.sh", CASO)
    // Um `.sh` que não é UTF-8 válido: está na lista (o gate o enumera) e não
    // pode ser lido. O que não pode acontecer é ele SUMIR do veredito — o patch
    // sairia sem ele e quem aplicasse o comentário acharia que cobriu tudo.
    writeFileSync(
      join(dir, "binario.sh"),
      Buffer.from([
        0x23, 0x21, 0x2f, 0x62, 0x69, 0x6e, 0x2f, 0x62, 0x61, 0x73, 0x68, 0x0a, 0xff, 0xfe, 0x0a,
      ]),
    )

    const r = remedyPatch(dir)
    expect(r.fixed.length).toBeGreaterThan(0) // o arquivo bom continua remendado
    expect(r.patch).toContain("--- a/ok.sh")
    expect(r.patch).not.toContain("binario.sh")
    expect(r.unread.map((u) => u.path)).toContain("binario.sh")
    // …e o público do `--fix --dry-run` também não engole o não-lido: ele PARA
    // (exit 2) nomeando o arquivo, em vez de imprimir um patch que parece cobrir
    // tudo. O veredito de "não julguei" é o mesmo do gate, em qualquer modo.
    const dry = runCli(["--root", dir, "--fix", "--dry-run", "--json"])
    expect(dry.status).toBe(EXIT.UNAVAILABLE)
    expect(dry.stderr).toContain("binario.sh")
  })
})

describe("unifiedPatch — a construção do diff", () => {
  const linhas = linhasDe("a\nb\nc\nd\ne\nf\ng\nh\ni\n")

  it("o hunk carrega CONTEXTO (3 linhas de cada lado) e a contagem bate", () => {
    const patch = unifiedPatch(linhas, [{ line: 5, linhasAntes: ["e"], linhaDepois: "E" }], {
      file: "f.sh",
    })
    expect(patch).toBe(
      [
        "--- a/f.sh",
        "+++ b/f.sh",
        "@@ -2,7 +2,7 @@",
        " b",
        " c",
        " d",
        "-e",
        "+E",
        " f",
        " g",
        " h",
        "",
      ].join("\n"),
    )
  })

  it("uma reescrita que COMPRIME linhas tira N e põe uma, e a seguinte usa o deslocamento", () => {
    // 14 linhas, remendos LONGE um do outro (as janelas de contexto não podem se
    // tocar, senão viram um hunk só — o que também é uma regra, coberta abaixo).
    const longo = linhasDe(Array.from({ length: 14 }, (_, i) => `l${i + 1}`).join("\n") + "\n")
    const patch = unifiedPatch(
      longo,
      [
        { line: 2, linhasAntes: ["l2", "l3"], linhaDepois: "L2" },
        { line: 11, linhasAntes: ["l11"], linhaDepois: "L11" },
      ],
      { file: "f.sh" },
    )
    // O primeiro hunk tira DUAS linhas e põe UMA (7 de contexto + 2 = 6 de
    // origem contra 5 de destino); o segundo já aponta para a numeração do
    // arquivo NOVO, deslocada pelo que o primeiro encolheu (8 → 7).
    expect(patch).toContain("@@ -1,6 +1,5 @@")
    expect(patch).toContain("@@ -8,7 +7,7 @@")
    expect(patch.match(/^@@ /gm)?.length).toBe(2)
  })

  it("janelas vizinhas viram UM hunk (dois hunks divididos seriam inválidos)", () => {
    const patch = unifiedPatch(
      linhas,
      [
        { line: 3, linhasAntes: ["c"], linhaDepois: "C" },
        { line: 5, linhasAntes: ["e"], linhaDepois: "E" },
      ],
      { file: "f.sh" },
    )
    expect(patch.match(/^@@ /gm)?.length).toBe(1)
  })

  it("sem reescrita não há patch (nem cabeçalho de arquivo)", () => {
    expect(unifiedPatch(linhas, [], { file: "f.sh" })).toBe("")
  })

  it("`linhasDe` não cria uma linha vazia falsa com o `\\n` final", () => {
    expect(linhasDe("a\nb\n")).toEqual(["a", "b"])
    expect(linhasDe("a\nb")).toEqual(["a", "b"])
    expect(linhasDe("")).toEqual([])
  })

  it("o `\\r` não entra no patch (um diff com CR dentro não aplica)", () => {
    const { fixadas } = fixSource('set -o pipefail\r\necho "$x" | grep -q y\r\n')
    expect(fixadas).toHaveLength(1)
    expect(fixadas[0].linhasAntes.join("")).not.toContain("\r")
    expect(fixadas[0].linhaDepois).not.toContain("\r")
  })
})
