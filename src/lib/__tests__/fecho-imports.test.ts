// =============================================================================
// fecho-imports.test.ts
//
// Testes do `scripts/fecho-imports.mjs` — a régua que DERIVA o fecho de imports
// de um módulo (em vez da lista à mão que deixava os fixtures de mutação mortos).
//
// O que precisa ser provado (a régua pode "parecer" certa e mentir):
//   1. o scanner separa ARESTA de DADO: um `from "./x.mjs"` dentro de string,
//      comentário ou template não é aresta (a lista copiaria arquivo que ninguém
//      importa), e a escrita real depois de uma regex que carrega aspa continua
//      sendo vista (o limite declarado não pode custar aresta de verdade);
//   2. a derivação é do GRAFO e TRANSITIVA: vizinho de segundo grau (o caso
//      medido: `check-act-origin` → `bench-table` → `prettier-format`), caminho
//      relativo preservado (`../`), dedup em losango e `--com-raiz`;
//   3. é FAIL-CLOSED: aresta relativa que não resolve e bare de PACOTE saem como
//      problema (o fixture roda sem `node_modules`, e meio fecho mede outra coisa)
//      — salvo quando quem copia DECLARA que resolve pacotes (`permitirPacotes`,
//      que é o caso do fixture do pre-commit);
//   4. a CLI é o que o shell consome: um caminho por LINHA na saída padrão e,
//      quando o fecho não fecha, saída padrão VAZIA (o loop de cópia nunca recebe
//      caminho com veredito vermelho) + exit 1;
//   5. os DOIS guards que montam fixture são medidos na árvore REAL, com a aresta
//      de segundo grau que a lista à mão não enxergava.
//
// Fixtures no tmpdir (o fecho é do sistema de arquivos) e nenhuma escrita no
// repositório: só a árvore real é LIDA.
// =============================================================================

import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import { EXIT, fechoDeImports, lerModulo } from "../../../scripts/fecho-imports.mjs"

const ROOT = process.cwd()
const tmpDirs: string[] = []

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Uma árvore de módulos no tmpdir — o fecho é do SISTEMA DE ARQUIVOS. */
function arvore(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "fecho-imports-"))
  tmpDirs.push(dir)
  for (const [rel, conteudo] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, conteudo, "utf8")
  }
  return dir
}

/** A CLI, como o shell a chama. */
function cli(args: string[]) {
  const r = spawnSync(process.execPath, [join("scripts", "fecho-imports.mjs"), ...args], {
    cwd: ROOT,
    encoding: "utf8",
  })
  return {
    status: r.status,
    linhas: r.stdout.split("\n").filter((l) => l !== ""),
    erro: r.stderr,
  }
}

describe("lerModulo — o que é ARESTA e o que é DADO", () => {
  it("lê as cinco formas: estático, efeito, dinâmico literal, export-from e `new URL`", () => {
    const { arestas, adiados } = lerModulo(
      [
        'import { a } from "./a.mjs"',
        'import "./efeito.mjs"',
        'export { b } from "./b.mjs"',
        'await import("./c.mjs")',
        'import("node:fs")',
        'const u = new URL("./d.mjs", import.meta.url)',
        "",
      ].join("\n"),
    )
    expect(arestas.map((a) => [a.spec, a.forma])).toEqual([
      ["./a.mjs", "estático"],
      ["./efeito.mjs", "import"],
      ["./b.mjs", "estático"],
      ["./c.mjs", "dinâmico"],
      ["node:fs", "dinâmico"],
      ["./d.mjs", "url"],
    ])
    expect(arestas.map((a) => a.linha)).toEqual([1, 2, 3, 4, 5, 6])
    expect(adiados).toEqual([])
  })

  it("o `new URL` só é aresta com o `new` na frente e o literal no primeiro argumento", () => {
    // A forma MEDIDA no repositório: `scripts/pre-commit-remedy.mjs` referencia o
    // guard vizinho por `new URL("./check-workflow-run-syntax.mjs", import.meta.url)`.
    // Sem o `new` não é a construção de URL da referência, e um primeiro argumento
    // NÃO literal é o limite declarado (nomeia-se, não se inventa aresta).
    const { arestas, adiados } = lerModulo(
      [
        'const a = new URL("./vizinho.mjs", import.meta.url)',
        'const b = URL("./sem-new.mjs", import.meta.url)',
        "const c = new URL(url, import.meta.url)",
        // O DADO não é aresta: a linha é montada com o literal que o próprio JS
        // escreveria, em vez de aspas escapadas à mão.
        `const s = ${JSON.stringify('new URL("./dentro-de-string.mjs", import.meta.url)')}`,
        '// new URL("./em-comentario.mjs", import.meta.url)',
        "",
      ].join("\n"),
    )
    expect(arestas.map((a) => a.spec)).toEqual(["./vizinho.mjs"])
    expect(arestas[0].linha).toBe(1)
    expect(adiados).toEqual([])
  })

  it("não confunde string, comentário e template com aresta", () => {
    const { arestas } = lerModulo(
      [
        "const s = 'import x from \"./nao1.mjs\"'",
        '// from "./nao2.mjs"',
        '/* from "./nao3.mjs" */',
        'const t = `from "./nao4.mjs"`',
        'const deVerdade = await import("./sim.mjs")',
        "",
      ].join("\n"),
    )
    expect(arestas.map((a) => a.spec)).toEqual(["./sim.mjs"])
  })

  it("a regex que carrega aspa não custa a aresta da LINHA SEGUINTE (limite declarado)", () => {
    const { arestas } = lerModulo(
      ["const u = /[\"']/", 'import { a } from "./depois.mjs"', ""].join("\n"),
    )
    expect(arestas.map((a) => a.spec)).toEqual(["./depois.mjs"])
  })

  it("nomeia o `import()` NÃO literal em vez de inventar aresta", () => {
    const { arestas, adiados } = lerModulo(
      ["const url = caminhoDoFormatador()", "await import(url)", ""].join("\n"),
    )
    expect(arestas).toEqual([])
    expect(adiados).toHaveLength(1)
    expect(adiados[0].linha).toBe(2)
  })
})

describe("fechoDeImports — o GRAFO, transitivo e fail-closed", () => {
  it("fecha transitivamente, preserva o caminho relativo e dedupa em losango", () => {
    // O losango: `a → b → c` e `a → fora/c` (o MESMO c por dois caminhos), mais
    // `b → base/d`. A raiz é o tmpdir, então o caminho de cada cópia é o do import.
    const raiz = arvore({
      "base/a.mjs": 'import { b } from "./sub/b.mjs"\nimport { c } from "../fora/c.mjs"\n',
      "base/sub/b.mjs": 'import { c } from "./c.mjs"\nimport { d } from "../d.mjs"\n',
      "base/sub/c.mjs": "",
      "base/d.mjs": "",
      "fora/c.mjs": "",
    })
    const { fecho, problemas } = fechoDeImports(["base/a.mjs"], { root: raiz })
    expect(problemas).toEqual([])
    expect(fecho).toEqual(["base/sub/b.mjs", "base/sub/c.mjs", "base/d.mjs", "fora/c.mjs"])
  })

  it("`comRaiz` põe os módulos de entrada ANTES do que eles importam", () => {
    const dir = arvore({ "a.mjs": 'import "./b.mjs"\n', "b.mjs": "" })
    const { fecho } = fechoDeImports([join(dir, "a.mjs")], { root: dir, comRaiz: true })
    expect(fecho).toEqual(["a.mjs", "b.mjs"])
  })

  it("pula builtin e RECUSA bare de pacote (o fixture roda sem node_modules)", () => {
    const dir = arvore({
      "a.mjs":
        'import { readFileSync } from "node:fs"\nimport { p } from "fs"\nimport { z } from "zod"\n',
    })
    const { fecho, problemas } = fechoDeImports([join(dir, "a.mjs")], { root: dir })
    expect(fecho).toEqual([])
    expect(problemas).toHaveLength(1)
    expect(problemas[0]).toContain("zod")
    expect(problemas[0]).toContain("a.mjs:3")
  })

  it("`permitirPacotes` é DECLARADO por quem resolve pacotes — e o default segue fail-closed", () => {
    // O fixture do pre-commit roda com o `node_modules` da instalação (o parser de
    // YAML): ele declara isso e mede os pacotes por outro caminho (o probe dele).
    // Quem NÃO declara continua recebendo o problema — a régua não afrouxa sozinha.
    const dir = arvore({
      "a.mjs": 'import { z } from "zod"\nimport "./b.mjs"\n',
      "b.mjs": "",
    })
    const estrito = fechoDeImports([join(dir, "a.mjs")], { root: dir })
    expect(estrito.problemas).toHaveLength(1)
    expect(estrito.problemas[0]).toContain("zod")

    const declarado = fechoDeImports([join(dir, "a.mjs")], { root: dir, permitirPacotes: true })
    expect(declarado.problemas).toEqual([])
    expect(declarado.fecho).toEqual(["b.mjs"])
  })

  it("RECUSA a aresta relativa que não resolve — nomeando quem a trouxe", () => {
    const dir = arvore({
      "a.mjs": 'import "./b.mjs"\n',
      "b.mjs": 'import { x } from "./faltando.mjs"\n',
    })
    const { fecho, problemas } = fechoDeImports([join(dir, "a.mjs")], { root: dir })
    // O fecho LISTA o que a aresta pediu (a entrada fica de fora: quem a copia é
    // quem chama); o `problemas` é quem DIZ que a cópia não é possível — e é ele
    // que faz a suíte sair 2 em vez de montar meio fixture.
    expect(fecho).toEqual(["b.mjs", "faltando.mjs"])
    expect(problemas).toHaveLength(1)
    expect(problemas[0]).toContain("b.mjs:1")
    expect(problemas[0]).toContain("./faltando.mjs")
  })

  it("recusa a entrada que nem existe (nada a copiar, nunca um fecho vazio por acidente)", () => {
    const dir = arvore({})
    const { problemas } = fechoDeImports([join(dir, "nao-existe.mjs")], { root: dir })
    expect(problemas[0]).toContain("ausente do checkout")
  })
})

describe("CLI — o que o SHELL consome", () => {
  it("saída padrão: um caminho por linha, e só caminho", () => {
    const dir = arvore({ "a.mjs": 'import "./b.mjs"\n', "b.mjs": "" })
    const r = cli([join(dir, "a.mjs"), "--root", dir])
    expect(r.status).toBe(EXIT.OK)
    expect(r.linhas).toEqual(["b.mjs"])
    expect(r.erro).toBe("")
  })

  it("fecho aberto: exit 1, a acusação no ERRO e a saída padrão VAZIA", () => {
    const dir = arvore({ "a.mjs": 'import "./faltando.mjs"\n' })
    const r = cli([join(dir, "a.mjs"), "--root", dir])
    expect(r.status).toBe(EXIT.FECHO_ABERTO)
    expect(r.linhas).toEqual([])
    expect(r.erro).toContain("fecho de imports ABERTO")
  })

  it("uso inválido: sem módulo e com flag desconhecida sai 2", () => {
    expect(cli([]).status).toBe(EXIT.USO)
    expect(cli(["a.mjs", "--zebra"]).status).toBe(EXIT.USO)
  })

  it("`--com-raiz --json` publica o próprio módulo, os adiados e o veredito", () => {
    const dir = arvore({ "a.mjs": "const url = x\nawait import(url)\n" })
    const r = cli([join(dir, "a.mjs"), "--root", dir, "--com-raiz", "--json"])
    expect(r.status).toBe(EXIT.OK)
    const dados = JSON.parse(r.linhas.join("\n"))
    expect(dados.fecho).toEqual(["a.mjs"])
    expect(dados.adiados).toHaveLength(1)
    expect(dados.ok).toBe(true)
  })
})

describe("os DOIS guards da casa que montam fixture", () => {
  it("doc-hashes: o guard e os vizinhos que o remédio trouxe", () => {
    const { fecho, problemas } = fechoDeImports(["scripts/check-doc-hashes.mjs"], { root: ROOT })
    expect(problemas).toEqual([])
    expect(fecho).toContain("scripts/confirm-prompt.mjs")
    expect(fecho).toContain("scripts/unified-patch.mjs")
    expect(fecho).toContain("scripts/prettier-format.mjs")
  })

  it("act-origin: alcança o FORMATADOR pelo vizinho de SEGUNDO grau (a aresta que a lista à mão perdeu)", () => {
    const { fecho, problemas } = fechoDeImports(["scripts/check-act-origin.mjs"], { root: ROOT })
    expect(problemas).toEqual([])
    expect(fecho).toContain("scripts/check-mutation-count.mjs")
    expect(fecho).toContain("scripts/bench-table.mjs")
    // `check-act-origin` NÃO importa o formatador: quem o importa é o `bench-table`.
    // É exatamente esta aresta de segundo grau que a lista à mão não enxergava.
    expect(fecho).toContain("scripts/prettier-format.mjs")
  })
})
