/**
 * forge-workflows-ruler.test.ts
 *
 * A RÉGUA ÚNICA de leitura de YAML de workflow — e a prova de que ela é uma só.
 *
 * POR QUE: a pergunta "esta linha de YAML EXECUTA algo?" (comentário de linha,
 * comentário de FIM DE LINHA, expressão do runner, corpo de bloco, declaração
 * de `defaults:`) era respondida por QUATRO réguas de passo e CINCO cópias da
 * regra de comentário espalhadas pelos guards. Duas consequências medidas:
 *
 *   1. o MESMO arquivo dava dois vereditos no `check-forge-parity`: a régua de
 *      RÓTULO (`discoverGates`) lia o corpo do `run: |` e a de COMANDO
 *      (`runCommands`) não — um gate invocado só dentro de um bloco saía como
 *      invariante AUSENTE (violação falsa) com o rótulo dele já classificado;
 *   2. a correção do comentário de fim de linha teve de ser aplicada DUAS vezes
 *      (o `check-workflow-refs` ficou validando referência de comentário
 *      enquanto o `check-forge-parity` já a ignorava).
 *
 * O teste trava as duas metades: a LEITURA (um fixture por constructo, com o
 * veredito de cada guard concordando) e a FONTE (cada guard importa a régua, e
 * nenhum guard guarda uma segunda implementação do mesmo regex).
 *
 * Execução focada:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/forge-workflows-ruler.test.ts
 */

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  DYNAMIC_EXPR_RE,
  codeLine,
  executableLine,
  executableLines,
  isCommentLine,
  stripSlashComment,
  stripTrailingComment,
  workflowRunBodies,
} from "../../../scripts/forge-workflows.mjs"
import {
  discoverGates,
  executedCommands,
  runCommands,
} from "../../../scripts/check-forge-parity.mjs"
import { extractScriptRefs } from "../../../scripts/check-workflow-refs.mjs"
import { workflowRunSteps } from "../../../scripts/check-pipefail-sigpipe.mjs"
import { extractWorkflowRunRefs } from "../../../scripts/check-mutation-jobs.mjs"
import { extractSentinelGreps } from "../../../scripts/check-sentinel-producer.mjs"

const ROOT = join(import.meta.dirname, "../../..")

/** O fixture com TODOS os constructos que já divergiram entre os guards. */
const FIXTURE = [
  "name: fixture",
  "defaults:",
  "  run:",
  "    shell: bash", // DECLARACAO (arquivo): nao e passo
  "on: push",
  "jobs:",
  "  gates:",
  "    runs-on: ubuntu-latest",
  "    defaults:",
  "      run:",
  "        shell: bash", // DECLARACAO (job): nao e passo
  "    steps:",
  "      - uses: actions/checkout@v4",
  "      - name: escalar com comentario de FIM DE LINHA",
  "        run: bun run typecheck # node scripts/ghost-comentario.mjs",
  "      - name: bloco literal",
  "        run: |",
  "          # comentario inteiro",
  "          node scripts/check-registry-source.mjs",
  "          grep -Fq 'sentinel-real' /tmp/report.txt",
  "          echo ok # grep -Fq 'sentinel-de-comentario' /tmp/outro.txt",
  "      - name: bloco DOBRADO",
  "        run: >",
  "          bash scripts/test-mutation-guards.sh",
  "      - run: node scripts/check-required-checks.mjs",
  "      - name: shell python3",
  "        shell: python3",
  "        run: print(1)",
  "      - name: expressao dinamica",
  "        run: node ${{ matrix.script }}",
  "",
].join("\n")

/**
 * Todos os `*.mjs` de `scripts/` (recursivo, sem `node_modules` nem dot-dirs).
 * A varredura é ESTRUTURAL: o que se mede é onde um regex vive, não o que um
 * guard específico faz — por isso ela não depende de nenhuma lista à mão que
 * envelheceria quando um guard novo nascesse com a cópia. O diretório `scripts/`
 * é a fonte única de onde vivem os guards (o mesmo lugar que os jobs rodam).
 */
function guardsDoRepo(root: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(root, "scripts"), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".mjs")) continue
    out.push(`scripts/${entry.name}`)
  }
  return out
}

/** O conteúdo de um caminho relativo ao root do repo. */
const fonte = (rel: string) => readFileSync(join(ROOT, rel), "utf8")

describe("a régua de LINHA — comentário, expressão, coluna", () => {
  it("linha de comentário inteira não executa (as duas sintaxes declaradas)", () => {
    expect(executableLine("          # comentario inteiro")).toBe("")
    expect(executableLine("  # .github/workflows")).toBe("")
    expect(executableLine("   ")).toBe("")
    expect(isCommentLine("  // x", { slash: true })).toBe(true)
    expect(isCommentLine("   * doc", { slash: true })).toBe(true)
    expect(isCommentLine("  /* doc", { slash: true })).toBe(true)
    expect(isCommentLine("  # x", { slash: true })).toBe(true)
    // A SINTAXE é declarada: quem varre YAML/shell/Python não trata `*` (alias
    // de YAML) nem `//` como comentário — era a diferença ACIDENTAL entre as
    // cópias (uma sem `/*`, outra sem `//`), agora visível no call site.
    expect(isCommentLine("   * anchor")).toBe(false)
    expect(isCommentLine("  // x")).toBe(false)
    expect(isCommentLine('const dir = ".github/workflows"')).toBe(false)
  })

  it("comentário de FIM DE LINHA sai, e o `#` entre aspas fica (não há espaço antes)", () => {
    expect(stripTrailingComment("        run: cmd # prosa")).toBe("        run: cmd")
    expect(stripTrailingComment('        run: echo "a#b"')).toBe('        run: echo "a#b"')
    expect(executableLine("        run: cmd # node scripts/ghost.mjs")).toBe("        run: cmd")
  })

  it("`stripSlashComment` é a irmã de JS: corta `//` e `/* */` e RESPEITA strings", () => {
    // A mesma pergunta do `#`, com a sintaxe da outra linguagem: quem varre
    // `.mjs` com a régua do `#` lê PROSA como código (o guard do registry acusava
    // o header que ENSINA o resolvedor como se fosse um default embutido).
    expect(stripSlashComment("  const x = 1 // prosa")).toBe("  const x = 1")
    expect(stripSlashComment("  import x /* em linha */ ")).toBe("  import x")
    expect(stripSlashComment('  const u = "https://x/y" // prosa')).toBe(
      '  const u = "https://x/y"',
    )
    // O falso NEGATIVO é a classe proibida: cortar no `//` de uma URL esconderia
    // o código que vem DEPOIS dela (um default depois de uma URL passaria em
    // silêncio — justamente o que o guard não pode ter).
    expect(stripSlashComment('  const u = "https://x" + a')).toBe('  const u = "https://x" + a')
    expect(stripSlashComment('  const u = "a//b"')).toBe('  const u = "a//b"')
    expect(stripSlashComment("  const s = `a//b`")).toBe("  const s = `a//b`")
    expect(stripSlashComment("  const q = 'it\\'s' // prosa")).toBe("  const q = 'it\\'s'")
    // Sem comentário, a linha volta INTEIRA (só o `trimEnd` da régua).
    expect(stripSlashComment("  const y = 2")).toBe("  const y = 2")
  })

  it("a expressão do runner é mascarada — e uma linha que SÓ tem ela não executa", () => {
    // O `trimEnd` da régua aparece aqui: sem ele sobraria `run: node ` (com
    // espaço pendurado), e quem compara a linha como coluna receberia lixo.
    expect(executableLine("        run: node ${{ matrix.script }}")).toBe("        run: node")
    expect(executableLine("        run: ${{ vars.CMD }}")).toBe("        run:")
    expect(executableLine("  ${{ vars.CMD }}")).toBe("")
    expect(DYNAMIC_EXPR_RE.test("${{ a }}")).toBe(true)
  })

  it("`codeLine` tira o comentário e PRESERVA a expressão (a porta de quem quer o valor)", () => {
    // O `executableLine` responde "esta linha EXECUTA?" e por isso mascara a
    // expressão; quem precisa dela como VALOR (o `checkSetupBunRunLine` compara
    // o argumento com `${{ vars.BUN_VERSION }}`) usa a mesma régua sem esse
    // passo. Comentário de linha e de fim de linha saem nos dois casos, e a
    // COLUNA fica (só `trimEnd`) — quem julga recuo não recebe linha remendada.
    expect(codeLine('        run: echo "a#b"')).toBe('        run: echo "a#b"')
    expect(codeLine("          bun-version: 1.3.14 # nota")).toBe("          bun-version: 1.3.14")
    expect(codeLine("      # comentário inteiro")).toBe("")
    expect(codeLine("        run: node ${{ matrix.script }}")).toBe(
      "        run: node ${{ matrix.script }}",
    )
    // O contraste com o `executableLine` é o que prova que as duas portas são
    // DIFERENTES de propósito (e não uma cópia esquecida da outra).
    expect(executableLine("        run: node ${{ matrix.script }}")).toBe("        run: node")
  })

  it("`executableLines` preserva a COLUNA (trimEnd, nunca trim) e exclui as declaracoes", () => {
    const linhas = ["      - run: a", "defaults:", "  run: bash", "      - run: b"]
    expect(executableLines(linhas)).toEqual([
      "      - run: a",
      "defaults:",
      "  run: bash",
      "      - run: b",
    ])
    expect(executableLines(linhas, new Set([2, 3]))).toEqual(["      - run: a", "      - run: b"])
  })
})

describe("a régua de PASSO — declaração, item de lista, bloco literal e dobrado", () => {
  const passos = workflowRunBodies(FIXTURE)

  it("as declarações de `defaults:` NÃO são passos (nem no arquivo, nem no job)", () => {
    expect(passos).toHaveLength(6)
    expect(passos.some((p) => p.job === null)).toBe(false)
    expect(passos.map((p) => p.job)).toEqual(Array(6).fill("gates"))
  })

  it("o item com a chave na MESMA linha (`- run:`) é passo; `uses:` não é", () => {
    const inline = passos.find((p) => p.body === "node scripts/check-required-checks.mjs")
    expect(inline).toBeDefined()
    expect(passos.some((p) => p.body.includes("actions/checkout"))).toBe(false)
  })

  it("bloco literal: corpo de-indentado, e o comentário sai na RÉGUA DE LINHA", () => {
    const bloco = passos.find((p) => p.body.includes("check-registry-source"))!
    expect(bloco.body.split("\n")).toEqual([
      "# comentario inteiro",
      "node scripts/check-registry-source.mjs",
      "grep -Fq 'sentinel-real' /tmp/report.txt",
      "echo ok # grep -Fq 'sentinel-de-comentario' /tmp/outro.txt",
    ])
    // O corpo e o TEXTO do arquivo (e o que o runner entrega ao shell): quem
    // descarta comentario e a REGUA, aplicada por cada consumidor. Duas coisas,
    // dois lugares — e desindentar NAO e comentar.
    expect(executableLines(bloco.body.split("\n"))).toHaveLength(3)
    expect(executableLine("          # comentario inteiro")).toBe("")
  })

  it("bloco DOBRADO (`>`) é lido como passo (a régua antiga do mutation-jobs só conhecia `|`)", () => {
    const dobrado = passos.find((p) => p.body.includes("test-mutation-guards.sh"))
    expect(dobrado).toBeDefined()
  })

  it("o `shell:` do passo é lido, e `before`/`after` do `run:` dão no mesmo", () => {
    expect(passos.find((p) => p.body.includes("check-registry-source"))!.shell).toBeNull()
    expect(passos.find((p) => p.body.startsWith("print("))!.shell).toBe("python3")
  })

  it("`workflowRunSteps` (o dono do shell) mede os MESMOS passos — não há segunda leitura", () => {
    expect(workflowRunSteps(FIXTURE).map((s) => s.line)).toEqual(passos.map((p) => p.line))
  })
})

describe("o MESMO YAML, o MESMO veredito — em todos os guards", () => {
  it("a régua de RÓTULO e a de COMANDO concordam sobre o corpo do bloco", () => {
    const rotulos = discoverGates(FIXTURE)
    // O gate do bloco é VISTO pelos dois lados (era a divergência interna).
    expect(rotulos).toContain("scripts/check-registry-source.mjs")
    expect(executedCommands(FIXTURE)).toContain("node scripts/check-registry-source.mjs")
    // `runCommands` continua sendo o LITERAL do `run:` (outra pergunta): o bloco
    // não produz comando ali, e é por isso que ela não decide mais presença.
    expect(runCommands(FIXTURE)).toEqual([
      "bun run typecheck",
      "node scripts/check-required-checks.mjs",
      "print(1)",
      "node",
    ])
  })

  it("nenhum guard enxerga ref de comentário (nem de fim de linha)", () => {
    expect(discoverGates(FIXTURE)).not.toContain("scripts/ghost-comentario.mjs")
    const refs = extractScriptRefs(FIXTURE).map((r) => r.ref)
    expect(refs).toContain("check-registry-source.mjs")
    expect(refs).not.toContain("ghost-comentario.mjs")
    expect(refs).not.toContain("ghost-fim-de-linha.mjs")
  })

  it("a cobertura de mutation test vê o alvo dentro do bloco DOBRADO", () => {
    expect(extractWorkflowRunRefs(FIXTURE)).toContain("test-mutation-guards.sh")
  })

  it("o sentinel NÃO é demandado por um comentário de fim de linha", () => {
    const sentinels = extractSentinelGreps(FIXTURE).map((g) => g.sentinel)
    expect(sentinels).toContain("sentinel-real")
    expect(sentinels).not.toContain("sentinel-de-comentario")
  })
})

describe("a régua mora num lugar só — nenhum guard guarda a segunda cópia", () => {
  /** Os guards que leem YAML de workflow e a régua que cada um consome. */
  const CONSUMIDORES: [string, RegExp][] = [
    ["check-forge-parity.mjs", /executableLine[s]?,/],
    ["check-workflow-refs.mjs", /executableLine,/],
    ["check-mutation-jobs.mjs", /workflowRunBodies/],
    ["check-pipefail-sigpipe.mjs", /workflowRunBodies/],
    ["check-workflow-run-syntax.mjs", /DYNAMIC_EXPR_RE/],
    ["check-sentinel-producer.mjs", /executableLine/],
    // Os scanners de linha de workflow que ainda tinham regra PRÓPRIA de
    // comentário (`trim().startsWith("#")`) — e um deles com o alinhamento
    // escrito no código ("mesmo tratamento do check-no-setup-bun.mjs").
    ["check-bun-mirror.mjs", /codeLine,/],
    ["check-no-setup-bun.mjs", /codeLine,/],
    ["check-registry-source.mjs", /isHashComment as isCommentLine/],
    ["check-crlf-scope.mjs", /isCommentLine as reguaDeComentario/],
    ["check-utf8-scope.mjs", /isCommentLine as reguaDeComentario/],
    ["check-forge-workflow-scope.mjs", /isCommentLine as reguaDeComentario/],
  ]

  it("cada guard IMPORTA a régua (o teste falha se o import voltar a ser cópia local)", () => {
    for (const [file, esperado] of CONSUMIDORES) {
      const conteudo = fonte(`scripts/${file}`)
      expect(esperado.test(conteudo), `${file} deveria importar a régua única`).toBe(true)
    }
  })

  it("o regex do comentário de FIM DE LINHA existe em UM arquivo (o dono da régua)", () => {
    const portadores = guardsDoRepo(ROOT).filter((p) => fonte(p).includes("/(^|\\s)#.*$/"))
    expect(portadores).toEqual(["scripts/forge-workflows.mjs"])
  })

  it("o padrão da expressão dinâmica existe em UM lugar (os outros consomem a constante)", () => {
    // O PADRÃO (o corpo do regex), não a palavra `${{`: prosa e a forma
    // canônica documentada podem citar a expressão sem reimplementá-la.
    const portadores = guardsDoRepo(ROOT).filter((p) => fonte(p).includes("[^}]*\\}\\}/g"))
    expect(portadores).toEqual(["scripts/forge-workflows.mjs"])
  })

  it("a regra de comentário de LINHA não tem segunda definição nos guards", () => {
    const portadores = guardsDoRepo(ROOT)
      .filter((p) => p !== "scripts/forge-workflows.mjs")
      .filter((p) =>
        /function isCommentLine\(line\)\s*\{[\s\S]{0,400}?startsWith\("#"\)/.test(fonte(p)),
      )
    expect(portadores).toEqual([])
  })
})
