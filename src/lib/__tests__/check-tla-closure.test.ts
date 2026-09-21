/**
 * check-tla-closure.test.ts
 *
 * O CONTRATO do `scripts/check-tla-closure.mjs`: a régua que só vivia em prosa
 * ("nenhum módulo com top-level await pode ser ALCANÇÁVEL a partir de uma
 * declaração do remédio") virou veredito — e este arquivo mede as partes dele.
 *
 * Duas metades:
 *
 *  1. PURA — a DETECÇÃO (`ocorrenciasTLA`: o `await` de nível de módulo, com as
 *     formas que o repositório usa e as que NÃO são TLA — corpo de função, arrow
 *     de expressão, método, IIFE, texto de template/regex/comentário), a leitura
 *     dos IMPORTS (`specsDoModulo`: estático × dinâmico × dentro de string), a
 *     resolução (`resolverLocal`) e o FECHO (`fechoEstatico`, com ciclo).
 *
 *  2. POR EXECUÇÃO — `julgar` contra uma árvore de fixture REAL em disco (com o
 *     loader, as declarações e os módulos), provando o veredito nos dois
 *     sentidos: o ALCANCE (a cadeia nomeada, o par que fecha CICLO e o par
 *     declarado) e a CATRACA (a forma não declarada, o declarado que a régua
 *     deixou de ver e o alcance declarado que não existe mais). As tabelas são
 *     INJETADAS: a fixture não tem o `scripts/` do repositório.
 *
 * Usage:
 *   bun x vitest run --config vitest.config.unit.ts src/lib/__tests__/check-tla-closure.test.ts
 */

import { describe, it, expect, afterEach } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  cabecaEhCorpoDeFuncao,
  fechoEstatico,
  julgar,
  ocorrenciasTLA,
  resolverLocal,
  specsDoModulo,
  temTLA,
} from "../../../scripts/check-tla-closure.mjs"

const GUARD = join(process.cwd(), "scripts/check-tla-closure.mjs")
const tmpDirs: string[] = []

afterEach(() => {
  while (tmpDirs.length > 0) rmSync(tmpDirs.pop() as string, { recursive: true, force: true })
})

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "tla-closure-test-"))
  tmpDirs.push(dir)
  return dir
}

/** Escreve um arquivo (criando os diretórios) dentro de uma raiz de fixture. */
function escrever(root: string, rel: string, conteudo: string): string {
  const p = join(root, rel)
  mkdirSync(join(p, ".."), { recursive: true })
  writeFileSync(p, conteudo)
  return p
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. A DETECÇÃO
// ─────────────────────────────────────────────────────────────────────────────

describe("ocorrenciasTLA — o que É top-level await", () => {
  it("a forma do repositório na CLI: `if (IS_DIRECT_RUN) await main()` (sem chaves)", () => {
    const src = "const IS_DIRECT_RUN = true\nif (IS_DIRECT_RUN) await main()\n"
    expect(temTLA(src)).toBe(true)
    expect(ocorrenciasTLA(src)[0].entrada).toBe(true)
  })

  it("a forma COM chaves: o bloco do guard de entrada não esconde o await", () => {
    const src =
      "const IS_DIRECT_RUN = true\nif (IS_DIRECT_RUN) {\n  let code = 1\n  try {\n    code = await main()\n  } catch {}\n  process.exit(code)\n}\n"
    expect(temTLA(src)).toBe(true)
    expect(ocorrenciasTLA(src)[0].entrada).toBe(true)
  })

  it("o segundo nome do guard de entrada do repositório: `isMain`", () => {
    const src =
      'const isMain = process.argv[1].endsWith("x.mjs")\nif (isMain) {\n  const r = await check({})\n  console.log(r)\n}\n'
    expect(temTLA(src)).toBe(true)
    expect(ocorrenciasTLA(src)[0].entrada).toBe(true)
  })

  it("`await` solto no topo (fora de guard nenhum) é TLA e NÃO é de entrada", () => {
    const src = "let code = 1\ntry {\n  code = await main()\n} catch {}\n"
    expect(temTLA(src)).toBe(true)
    expect(ocorrenciasTLA(src)[0].entrada).toBe(false)
  })

  it("`for await` de nível de módulo e a atribuição que quebra linha", () => {
    expect(temTLA("for await (const x of y) {}\n")).toBe(true)
    expect(temTLA("const descoberta =\n  await discover()\n")).toBe(true)
  })

  it("`await` dentro da INTERPOLAÇÃO de um template é código", () => {
    expect(temTLA("const t = `x ${await f()} y`\n")).toBe(true)
  })
})

describe("ocorrenciasTLA — o que NÃO é top-level await", () => {
  it("corpo de função (inclusive com assinatura multi-linha, que o prettier quebra)", () => {
    const src =
      "export async function giteaApi({ token, baseUrl }, method, path, body) {\n  const response = await fetch(url, { method })\n  return response\n}\n"
    expect(temTLA(src)).toBe(false)
  })

  it("assinatura quebrada em várias linhas: `}) {` não perde o corpo", () => {
    const src =
      "async function main({\n  a,\n  b = 1,\n} = {}) {\n  const x = await go(a, b)\n  return x\n}\n"
    expect(temTLA(src)).toBe(false)
  })

  it("arrow de expressão no MESMO lado e quebrada logo depois do `=>`", () => {
    expect(temTLA("const f = async () => await g()\n")).toBe(false)
    expect(temTLA("const f = async () =>\n  await g()\n")).toBe(false)
  })

  it("método de classe, objeto com método e IIFE async", () => {
    expect(temTLA("class A {\n  async m() {\n    return await g()\n  }\n}\n")).toBe(false)
    expect(temTLA("const o = {\n  async m() {\n    await g()\n  },\n}\n")).toBe(false)
    expect(temTLA("(async () => {\n  await g()\n})()\n")).toBe(false)
  })

  it("texto: dentro de string, de template e de REGEX (a régua compartilhada mascara os três)", () => {
    expect(temTLA('const s = "await x"\n')).toBe(false)
    expect(temTLA("const s = `await x`\n")).toBe(false)
    expect(temTLA("const re = /await x/\n")).toBe(false)
    // O caso MEDIDO na régua compartilhada: o backtick dentro do regex abria um
    // template e o resto do arquivo virava texto.
    expect(temTLA("if (/[\"'`$|&;<>()\\\\*?]/.test(c)) {\n  return 1\n}\n")).toBe(false)
  })

  it("comentário de linha e de bloco", () => {
    expect(temTLA("// await x\nconst y = 1\n")).toBe(false)
    expect(temTLA("/* await x */\nconst y = 1\n")).toBe(false)
  })
})

describe("specsDoModulo — estático × dinâmico", () => {
  it("pega as três formas ESTÁTICAS e a dinâmica, com o tipo certo", () => {
    const src = [
      'import { a } from "./a.mjs"',
      'import "./b.mjs"',
      'export { c } from "./c.mjs"',
      'const d = await import("./d.mjs")',
      "",
    ].join("\n")
    expect(specsDoModulo(src)).toEqual([
      { spec: "./a.mjs", tipo: "estatico" },
      { spec: "./b.mjs", tipo: "estatico" },
      { spec: "./c.mjs", tipo: "estatico" },
      { spec: "./d.mjs", tipo: "dinamico" },
    ])
  })

  it("specifier citado em texto (string/template) NÃO é import", () => {
    expect(specsDoModulo("const s = \"import x from './x.mjs'\"\n")).toEqual([])
    expect(specsDoModulo('const s = `from "./x.mjs"`\n')).toEqual([])
  })
})

describe("cabecaEhCorpoDeFuncao — a palavra antes do `(` decide", () => {
  it("função, arrow, classe e método são CORPO", () => {
    expect(cabecaEhCorpoDeFuncao("export async function f(a) ")).toBe(true)
    expect(cabecaEhCorpoDeFuncao("const f = (a) => ")).toBe(true)
    expect(cabecaEhCorpoDeFuncao("export class A ")).toBe(true)
    expect(cabecaEhCorpoDeFuncao("  async m(a) ")).toBe(true)
    expect(cabecaEhCorpoDeFuncao("  constructor(a) ")).toBe(true)
  })

  it("instrução (`if`, `for`, `while`, `switch`, `catch`, `try`) é BLOCO", () => {
    expect(cabecaEhCorpoDeFuncao("if (a) ")).toBe(false)
    expect(cabecaEhCorpoDeFuncao("for (const x of y) ")).toBe(false)
    expect(cabecaEhCorpoDeFuncao("while (a) ")).toBe(false)
    expect(cabecaEhCorpoDeFuncao("switch (a) ")).toBe(false)
    expect(cabecaEhCorpoDeFuncao("catch (e) ")).toBe(false)
    expect(cabecaEhCorpoDeFuncao("try ")).toBe(false)
  })

  it("assinatura em várias linhas com `>`/`=` no meio: o NOME antes do parêntese basta", () => {
    // A cabeça pode chegar como FRAGMENTO (um `{` de padrão desestruturado a
    // corta); o que decide é o nome imediatamente antes do `(` que casa.
    expect(cabecaEhCorpoDeFuncao("giteaApi(a, b) ")).toBe(true)
    expect(cabecaEhCorpoDeFuncao("const r = await f(a) => ")).toBe(true)
  })

  it("o fragmento SEM nome (o `(` é o primeiro caractere) é conservadoramente BLOCO", () => {
    // Não há como saber a que pertence esse `(`; o que o guard NÃO faz é
    // adivinhar função — a cabeça inteira (com o nome) é quem classifica, e é o
    // que os testes de assinatura multi-linha medem acima.
    expect(cabecaEhCorpoDeFuncao(", method, path, body) ")).toBe(false)
    expect(cabecaEhCorpoDeFuncao("(a, b) ")).toBe(false)
  })

  it("o `{` de um padrão desestruturado dentro dos PARÊNTESES não corta a cabeça", () => {
    const src = "export async function f({ a = { b: 1 } }, c) {\n  return await g()\n}\n"
    expect(temTLA(src)).toBe(false)
  })
})

describe("resolverLocal e fechoEstatico", () => {
  it("resolve relativo (com e sem extensão, e o index) e devolve null para bare/inexistente", () => {
    const root = tmp()
    escrever(root, "scripts/a.mjs", "")
    escrever(root, "scripts/sub/b.mjs", "")
    escrever(root, "scripts/sub/index.mjs", "")
    const a = join(root, "scripts/a.mjs")
    expect(resolverLocal(a, "./sub/b.mjs")).toBe(join(root, "scripts/sub/b.mjs"))
    expect(resolverLocal(a, "./sub/b")).toBe(join(root, "scripts/sub/b.mjs"))
    expect(resolverLocal(a, "./sub")).toBe(join(root, "scripts/sub/index.mjs"))
    expect(resolverLocal(a, "node:fs")).toBeNull()
    expect(resolverLocal(a, "./nao-existe.mjs")).toBeNull()
  })

  it("o fecho segue o grafo, TERMINA num ciclo e conta o specifier que não resolve", () => {
    const root = tmp()
    const a = escrever(root, "scripts/a.mjs", 'import "./b.mjs"\nimport "./falta.mjs"\n')
    escrever(root, "scripts/b.mjs", 'import "./a.mjs"\n')
    const { arquivos, naoResolvidos } = fechoEstatico(a)
    expect(arquivos.sort()).toEqual([a, join(root, "scripts/b.mjs")].sort())
    expect(naoResolvidos).toHaveLength(1)
    expect(naoResolvidos[0]).toContain("./falta.mjs")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. O VEREDITO (contra uma árvore de fixture real)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Uma árvore de fixture com o mínimo da régua: o loader das classes, o do canal,
 * uma declaração de cada e os módulos alcançáveis que o teste pedir.
 *
 * @param {{classe?: string, canal?: string, modulos?: Record<string, string>}} opts
 */
function fixture(opts: { classe?: string; canal?: string; modulos?: Record<string, string> } = {}) {
  const root = tmp()
  escrever(root, "scripts/remedy-classes.mjs", "export const CLASSES = []\n")
  escrever(root, "scripts/pr-fixers.mjs", "export const FIXERS = []\n")
  escrever(
    root,
    "scripts/remedy-classes/classe-a.mjs",
    opts.classe ?? 'export default { id: "classe-a" }\n',
  )
  escrever(
    root,
    "scripts/remedy-canal/canal-a.mjs",
    opts.canal ?? 'export default { id: "canal-a" }\n',
  )
  // Os dois TLA que a tabela abaixo DECLARA existem por padrão: sem eles a
  // fixture seria vermelha na catraca e nenhum veredito de ALCANCE seria
  // legível (um teste cego por acidente de árvore).
  const padrao: Record<string, string> = {
    "scripts/tla-declarado.mjs": "const x = await go()\nexport const f = x\n",
    "scripts/tla.mjs": "const x = await go()\nexport const y = x\n",
  }
  for (const [rel, conteudo] of Object.entries({ ...padrao, ...(opts.modulos ?? {}) })) {
    escrever(root, rel, conteudo)
  }
  return root
}

const CLASSES_FIXTURE = [
  { id: "entrada-cli", motivo: "guard de entrada" },
  { id: "descoberta", motivo: "descoberta", declarados: ["scripts/tla-declarado.mjs"] },
  { id: "descoberta", motivo: "descoberta", declarados: ["scripts/tla.mjs"] },
]

describe("julgar — a metade do ALCANCE", () => {
  it("verde quando nenhuma declaração alcança TLA", () => {
    const root = fixture({ modulos: { "scripts/outro.mjs": "const x = 1\n" } })
    const r = julgar({ root, classes: CLASSES_FIXTURE, alcance: [] })
    expect(r.violacoes).toEqual([])
    expect(r.problemas).toEqual([])
    expect(r.declaracoes).toHaveLength(2)
    expect(r.declaracoes.every((d) => d.alcancados.length === 0)).toBe(true)
  })

  it("violação com a CADEIA nomeada quando a declaração alcança um TLA (sem ciclo)", () => {
    const root = fixture({
      classe: 'import { g } from "../meio.mjs"\nexport default { id: "classe-a", g }\n',
      modulos: {
        "scripts/meio.mjs": 'import "./tla.mjs"\nexport const g = 1\n',
        "scripts/tla.mjs": "const x = await go()\nexport const y = x\n",
      },
    })
    const r = julgar({ root, classes: CLASSES_FIXTURE, alcance: [] })
    expect(r.violacoes).toHaveLength(1)
    expect(r.violacoes[0]).toContain("ALCANCE")
    expect(r.violacoes[0]).toContain(
      "scripts/remedy-classes/classe-a.mjs → scripts/meio.mjs → scripts/tla.mjs",
    )
    expect(r.violacoes[0]).toContain("NÃO volta")
    const alc = r.declaracoes.find((d) => d.id === "classe-a")?.alcancados[0] as {
      fechaCiclo: boolean
    }
    expect(alc.fechaCiclo).toBe(false)
  })

  it("o grafo que FECHA O CICLO é nomeado como tal (o que mata: exit 13, zero bytes)", () => {
    // A declaração importa um TLA que (transitivamente) alcança o LOADER dela:
    // o loader espera a declaração, a declaração espera o TLA, e o TLA espera o
    // loader — o ciclo que o node mata com `await` no meio (rc=13, zero bytes).
    const root = fixture({
      classe: 'import { f } from "../tla-declarado.mjs"\nexport default { id: "classe-a", f }\n',
      modulos: {
        "scripts/tla-declarado.mjs":
          'import "./remedy-classes.mjs"\nconst x = await go()\nexport const f = x\n',
      },
    })
    const r = julgar({ root, classes: CLASSES_FIXTURE, alcance: [] })
    expect(r.violacoes).toHaveLength(1)
    expect(r.violacoes[0]).toContain("CICLO FECHADO")
    expect(r.violacoes[0]).toContain("sai 13 SEM IMPRIMIR NADA")
    const alc = r.declaracoes.find((d) => d.id === "classe-a")?.alcancados[0] as {
      fechaCiclo: boolean
    }
    expect(alc.fechaCiclo).toBe(true)
  })

  it("o par DECLARADO não é violação — e sai nomeado no relatório", () => {
    const root = fixture({
      classe: 'import { g } from "../meio.mjs"\nexport default { id: "classe-a", g }\n',
      modulos: {
        "scripts/meio.mjs": 'import "./tla.mjs"\nexport const g = 1\n',
        "scripts/tla.mjs": "const x = await go()\n",
      },
    })
    const r = julgar({
      root,
      classes: CLASSES_FIXTURE,
      alcance: [
        {
          de: "scripts/remedy-classes/classe-a.mjs",
          para: "scripts/tla.mjs",
          motivo: "dívida do teste",
          data: "2026-09-21",
        },
      ],
    })
    expect(r.violacoes).toEqual([])
    expect(r.tolerados).toEqual([
      { de: "scripts/remedy-classes/classe-a.mjs", para: "scripts/tla.mjs" },
    ])
  })

  it("um alcance declarado que NÃO existe mais é violação (dívida paga não fica no papel)", () => {
    const root = fixture({ modulos: { "scripts/tla.mjs": "const x = await go()\n" } })
    const r = julgar({
      root,
      classes: CLASSES_FIXTURE,
      alcance: [
        {
          de: "scripts/remedy-classes/classe-a.mjs",
          para: "scripts/tla.mjs",
          motivo: "dívida velha",
          data: "2026-01-01",
        },
      ],
    })
    expect(r.violacoes).toHaveLength(1)
    expect(r.violacoes[0]).toContain("ALCANCE DECLARADO")
    expect(r.violacoes[0]).toContain("NÃO existe mais")
  })
})

describe("julgar — a metade da CATRACA", () => {
  it("a forma `entrada-cli` é derivada e NÃO precisa de declaração", () => {
    const root = fixture({
      modulos: {
        "scripts/cli.mjs": 'if (process.argv[1] === "x") {\n  await main()\n}\n',
      },
    })
    const r = julgar({ root, classes: CLASSES_FIXTURE, alcance: [] })
    expect(r.violacoes).toEqual([])
    expect(r.classes.find((c) => c.caminho === "scripts/cli.mjs")?.classe).toBe("entrada-cli")
  })

  it("uma forma NÃO declarada é violação, com a linha e o contexto do achado", () => {
    const root = fixture({
      modulos: { "scripts/solto.mjs": "let code = 1\ntry {\n  code = await main()\n} catch {}\n" },
    })
    const r = julgar({ root, classes: CLASSES_FIXTURE, alcance: [] })
    expect(r.violacoes).toHaveLength(1)
    expect(r.violacoes[0]).toContain("forma NÃO declarada")
    expect(r.violacoes[0]).toContain("scripts/solto.mjs")
    expect(r.violacoes[0]).toContain("linha 3")
  })

  it("o DECLARADO que a régua deixou de ver é violação (a detecção cegou?)", () => {
    const root = fixture({ modulos: { "scripts/tla-declarado.mjs": "export const f = 1\n" } })
    const r = julgar({ root, classes: CLASSES_FIXTURE, alcance: [] })
    // a classe `descoberta` declara `scripts/tla-declarado.mjs`, que deixou de ser TLA
    const cegou = r.violacoes.find(
      (v) => v.includes("não o vê como TLA") || v.includes("NÃO o vê como TLA"),
    )
    expect(cegou).toBeDefined()
    expect(cegou).toContain("scripts/tla-declarado.mjs")
  })

  it("o módulo declarado e TLA passa (a classe descreve a realidade)", () => {
    const root = fixture({
      modulos: { "scripts/tla-declarado.mjs": "const x = await go()\nexport const f = x\n" },
    })
    const r = julgar({ root, classes: CLASSES_FIXTURE, alcance: [] })
    expect(r.violacoes).toEqual([])
    expect(r.classes.find((c) => c.caminho === "scripts/tla-declarado.mjs")?.classe).toBe(
      "descoberta",
    )
  })

  it("fail-closed: diretório de declaração ausente NÃO é 'nada a julgar' (vira problema)", () => {
    const root = tmp()
    escrever(root, "scripts/remedy-classes.mjs", "export const CLASSES = []\n")
    const r = julgar({ root, classes: CLASSES_FIXTURE, alcance: [] })
    expect(r.problemas.join("\n")).toContain("não consegui listar as declarações")
  })
})

describe("a CLI", () => {
  it("exit 1 e a violação nomeada quando a declaração alcança TLA", () => {
    const root = fixture({
      classe: 'import { f } from "../tla.mjs"\nexport default { id: "classe-a", f }\n',
      modulos: { "scripts/tla.mjs": "const x = await go()\n" },
    })
    let saida = ""
    try {
      execFileSync(process.execPath, [GUARD, "--root", root], { encoding: "utf8" })
      throw new Error("a CLI deveria sair 1")
    } catch (e) {
      const err = e as { status?: number; stderr?: string }
      expect(err.status).toBe(1)
      saida = err.stderr ?? ""
    }
    expect(saida).toContain("ALCANCE")
    expect(saida).toContain("scripts/tla.mjs")
  })

  it("exit 2 (fail-closed) quando não dá para medir", () => {
    const root = tmp()
    try {
      execFileSync(process.execPath, [GUARD, "--root", root], { encoding: "utf8" })
      throw new Error("a CLI deveria sair 2")
    } catch (e) {
      expect((e as { status?: number }).status).toBe(2)
    }
  })
})
