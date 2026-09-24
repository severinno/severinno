import { describe, expect, it } from "vitest"
import {
  BLOCO_GUARDS,
  BLOCO_README,
  DOCS,
  blocoDoTexto,
  conteudoDoBloco,
  divergencia,
  escreverDocs,
  estadoDaMatriz,
  linhasDoBloco,
  mediana,
  paragrafoCusto,
  substituirBloco,
  tabelaSubTests,
} from "../../../scripts/bench-table.mjs"

/**
 * Um registro com a família `mutations` — a ÚNICA entrada de tudo o que a folha
 * renderiza. `wallMs` é o total da rodada (a soma dos sub-tests + o harness).
 */
function registro({
  forms = [
    { role: "caro", ms: 8000, metades: 3, exit: 0 },
    { role: "meio", ms: 2000, metades: 2, exit: 0 },
    { role: "barato", ms: 500, metades: 1, exit: 0 },
  ] as Array<Record<string, unknown>>,
  wallMs = 10700,
  commit = "abc1234",
  medições = true,
}: {
  forms?: Array<Record<string, unknown>>
  wallMs?: number
  commit?: string
  medições?: boolean
} = {}) {
  return {
    meta: {
      tool: "bench-guard-timing",
      version: 6,
      commit,
      commitDate: "2026-09-23 02:51:18 -0300",
    },
    mutations: medições === false ? { measured: false } : { measured: true, forms, wallMs },
  }
}

describe("estadoDaMatriz — a leitura do registro (a única entrada)", () => {
  it("a família não medida (ou sem forma) devolve null: não há o que renderizar", () => {
    expect(estadoDaMatriz(null)).toBeNull()
    expect(estadoDaMatriz({})).toBeNull()
    expect(estadoDaMatriz(registro({ medições: false }))).toBeNull()
    expect(estadoDaMatriz(registro({ forms: [] }))).toBeNull()
  })

  it("o HARNESS é a DIFERENÇA (total − soma dos sub-tests), não uma constante", () => {
    const e = estadoDaMatriz(registro({ wallMs: 10700 }))
    expect(e!.somaSubTestsMs).toBe(10500)
    expect(e!.harnessMs).toBe(200)
    expect(e!.wallMs).toBe(10700)
  })

  it("sem `wallMs` o harness é 0 e o total é a própria soma (nada inventado)", () => {
    const e = estadoDaMatriz({ mutations: { forms: [{ role: "a", ms: 100, metades: 1 }] } })
    expect(e!.wallMs).toBe(100)
    expect(e!.harnessMs).toBe(0)
  })

  it("as metades são a soma das formas (a coluna derivada da matriz)", () => {
    expect(estadoDaMatriz(registro())!.metades).toBe(6)
  })

  it("a ordem é do mais caro ao mais barato, e o empate sai pelo id (determinismo)", () => {
    const e = estadoDaMatriz(
      registro({
        forms: [
          { role: "z", ms: 100, metades: 1 },
          { role: "a", ms: 100, metades: 1 },
          { role: "caro", ms: 900, metades: 1 },
        ],
      }),
    )
    expect(e!.formas.map((f) => f.role)).toEqual(["caro", "a", "z"])
  })

  it("a MEDIANA e a CONCENTRAÇÃO saem da medição, não de um número declarado", () => {
    expect(mediana([3, 1, 2])).toBe(2)
    expect(mediana([4, 1, 3, 2])).toBe(3)
    expect(mediana([])).toBe(0)
    // dez formas de 1000ms e uma de 10ms: os dez pagam 99.9% da soma
    const e = estadoDaMatriz(
      registro({
        forms: [
          ...Array.from({ length: 10 }, (_, i) => ({ role: `g${i}`, ms: 1000, metades: 1 })),
          { role: "x", ms: 10, metades: 1 },
        ],
        wallMs: 10010,
      }),
    )
    expect(e!.concentracaoPct).toBe(100)
    expect(e!.medianaMs).toBe(1000)
  })

  it("a PROJEÇÃO do próximo sub-test é a média medida + o harness por sub-test (dita como projeção)", () => {
    const e = estadoDaMatriz(
      registro({
        forms: [
          { role: "a", ms: 1000, metades: 1 },
          { role: "b", ms: 3000, metades: 1 },
        ],
        wallMs: 4600,
      }),
    )
    // média 2000 + harness 600/2 = 2300
    expect(e!.projecaoMs).toBe(2300)
  })

  it("a forma que NÃO passou é nomeada — o custo dela não julga nada", () => {
    const e = estadoDaMatriz(
      registro({
        forms: [
          { role: "ok", ms: 100, metades: 1, exit: 0 },
          { role: "quebrada", ms: 50, metades: 1, exit: 1 },
        ],
        wallMs: 200,
      }),
    )
    expect(e!.verdes).toBe(1)
    expect(e!.vermelhas.map((f: { role: string }) => f.role)).toEqual(["quebrada"])
    expect(tabelaSubTests(e)).toContain("`quebrada`")
    expect(paragrafoCusto(e)).toContain("`quebrada`")
  })

  it("a procedência é o commit de ORIGEM do ato, e a data sai por extenso", () => {
    const e = estadoDaMatriz(registro({ commit: "0eed6e7f" })) as {
      procedencia: { commit: string; dia: string }
    }
    expect(e.procedencia.commit).toBe("0eed6e7f")
    expect(e.procedencia.dia).toBe("23/09/2026")
  })
})

describe("tabelaSubTests — a tabela do GUARDS (todas as formas, sem corte editorial)", () => {
  const e = estadoDaMatriz(registro())
  const tabela = tabelaSubTests(e)!

  it("o cabeçalho e o separador são os da tabela markdown (e as colunas alinham)", () => {
    const linhas = tabela.split("\n")
    const iCabecalho = linhas.findIndex((l) => l.startsWith("| sub-test"))
    expect(linhas[iCabecalho]).toContain("| wall time")
    expect(linhas[iCabecalho + 1]).toMatch(/^\| [-: ]+\|$|-:/)
  })

  it("cada forma tem a sua linha, com o tempo, a FATIA da soma e as metades", () => {
    const linhaCaro = tabela.split("\n").find((l) => l.includes("`caro`"))!
    expect(linhaCaro).toContain("8.0s")
    expect(linhaCaro).toContain("76%") // 8000 de 10500
    // a coluna das metades é numérica: o valor fica alinhado à direita
    expect(linhaCaro).toMatch(/\|\s+3 \|$/)
  })

  it("a glosa é declarada UMA vez (a folha) e entra ao lado do id", () => {
    const comGlosa = estadoDaMatriz(
      registro({ forms: [{ role: "pre-commit-proof", ms: 1000, metades: 1 }], wallMs: 1000 }),
    )
    expect(tabelaSubTests(comGlosa)).toContain("`pre-commit-proof` (a declaração dos recusadores")
  })

  it("as três linhas de fecho: a soma, o harness e o total do master", () => {
    const linhas = tabela.split("\n")
    expect(
      linhas.some(
        (l) =>
          l.includes("**soma dos 3 sub-tests**") && l.includes("**10.5s**") && l.includes("**6**"),
      ),
    ).toBe(true)
    expect(
      linhas.some((l) => l.startsWith("| harness (parse das metades") && l.includes("0.2s")),
    ).toBe(true)
    expect(
      linhas.some((l) => l.startsWith("| **total do master**") && l.includes("**10.7s**")),
    ).toBe(true)
  })

  it("a leitura da tabela (dez/mediana/projeção) sai do mesmo estado", () => {
    expect(tabela).toContain("**Dez** sub-tests pagam")
    expect(tabela).toContain("a mediana é **2.0s**")
    expect(tabela).toContain("**~3.6s**")
  })

  it("uma família não medida devolve null (nada a escrever)", () => {
    expect(tabelaSubTests(null)).toBeNull()
    expect(paragrafoCusto(null)).toBeNull()
  })
})

describe("paragrafoCusto — o parágrafo do README (os mesmos fatos, em prosa)", () => {
  it("declara a soma, o harness, o total, o topo e as metades do registro", () => {
    const p = paragrafoCusto(estadoDaMatriz(registro()))!
    expect(p).toContain("roda 3 sub-tests")
    expect(p).toContain("**10.5s** de sub-tests + **0.2s** de harness")
    expect(p).toContain("**10.7s**")
    expect(p).toContain("`caro` (8.0s, 76%)")
    expect(p).toContain("**6 metades**")
  })

  it("diz em voz alta que a prosa é DERIVADA (e quem a reescreve)", () => {
    const p = paragrafoCusto(estadoDaMatriz(registro()))!
    expect(p).toContain("DERIVADA")
    expect(p).toContain("o ato")
  })

  it("é determinístico: o mesmo registro renderiza byte a byte o mesmo texto", () => {
    const a = paragrafoCusto(estadoDaMatriz(registro()))
    const b = paragrafoCusto(estadoDaMatriz(registro()))
    expect(a).toBe(b)
    expect(tabelaSubTests(estadoDaMatriz(registro()))).toBe(
      tabelaSubTests(estadoDaMatriz(registro())),
    )
  })
})

describe("blocoDoTexto / substituirBloco / divergencia — o recorte e a régua", () => {
  const texto = ["antes", BLOCO_README.abre, "conteúdo vivo", BLOCO_README.fecha, "depois"].join(
    "\n",
  )

  it("acha o bloco, com a linha do marcador e o conteúdo", () => {
    const b = blocoDoTexto(texto, BLOCO_README)!
    expect(b.conteudo).toEqual(["conteúdo vivo"])
    expect(b.linhaDoInicio).toBe(2)
    expect(b.linhaDoFim).toBe(4)
  })

  it("marcador ausente OU duplicado devolve null (fail-closed: a prosa não sai do julgamento)", () => {
    expect(blocoDoTexto("sem marcador nenhum", BLOCO_README)).toBeNull()
    expect(blocoDoTexto(`${texto}\n${BLOCO_README.abre}`, BLOCO_README)).toBeNull()
    expect(
      blocoDoTexto(["antes", BLOCO_README.fecha, BLOCO_README.abre].join("\n"), BLOCO_README),
    ).toBeNull()
  })

  it("substituirBloco troca o conteúdo e PRESERVA os marcadores", () => {
    const novo = substituirBloco(texto, BLOCO_README, "linha a\nlinha b")!
    expect(novo.split("\n")).toEqual([
      "antes",
      BLOCO_README.abre,
      "linha a",
      "linha b",
      BLOCO_README.fecha,
      "depois",
    ])
  })

  it("substituirBloco sem o bloco devolve null (não inventa marcador)", () => {
    expect(substituirBloco("nada aqui", BLOCO_README, "x")).toBeNull()
  })

  it("divergencia nomeia a PRIMEIRA linha que mudou, com o vivo e o renderizado", () => {
    const d = divergencia(["a", "b", "c"], ["a", "B", "c"])!
    expect(d.linha).toBe(2)
    expect(d.vivo).toBe("b")
    expect(d.esperado).toBe("B")
  })

  it("um número de linha diferente também é divergência (e não um 'ok' silencioso)", () => {
    const d = divergencia(["a"], ["a", "b"])!
    expect(d.linha).toBe(2)
    expect(d.vivo).toBe("(fim do bloco)")
    expect(divergencia(["a", "b"], ["a", "b"])).toBeNull()
  })
})

describe("escreverDocs — quem reescreve é o ATO, e ele diz o que fez em cada arquivo", () => {
  const registroOk = registro()
  // O bloco vivo carrega a linha em BRANCO depois do marcador (o prettier a
  // separa do parágrafo) — a mesma convenção do `conteudoDoBloco`.
  const render = (bloco: { abre: string; fecha: string }, conteudo: string) =>
    [`x`, bloco.abre, ...linhasDoBloco(conteudo), bloco.fecha, `y`].join("\n")

  function lerDe(arquivos: Record<string, string>) {
    return (p: string) => {
      const chave = Object.keys(arquivos).find((k) => p.endsWith(k))
      if (chave === undefined) throw new Error(`sem arquivo: ${p}`)
      return arquivos[chave]
    }
  }
  /** Os dois arquivos existem (o `existe` é injetado, como o `ler`). */
  const existem = () => true

  it("reescreve os DOIS blocos a partir do registro (e injeta o `escrever` por parâmetro)", () => {
    const escritos: Record<string, string> = {}
    const status = escreverDocs({
      registro: registroOk,
      cwd: "/repo",
      existe: existem,
      ler: lerDe({
        "docs/GUARDS.md": render(BLOCO_GUARDS, "tabela velha"),
        "README.md": render(BLOCO_README, "prosa velha"),
      }),
      escrever: (p: string, t: string) => {
        escritos[p] = t
      },
    })
    expect(status.map((s) => s.status)).toEqual(["reescrito", "reescrito"])
    expect(escritos["/repo/docs/GUARDS.md"]).toContain("**total do master**")
    expect(escritos["/repo/README.md"]).toContain("DERIVADA")
    expect(escritos["/repo/README.md"]).not.toContain("prosa velha")
  })

  it("o bloco que JÁ descreve o registro sai como `jaEstava` (nada reescrito)", () => {
    const estado = estadoDaMatriz(registroOk)
    const status = escreverDocs({
      registro: registroOk,
      cwd: "/repo",
      existe: existem,
      ler: lerDe({
        "docs/GUARDS.md": render(BLOCO_GUARDS, tabelaSubTests(estado)!),
        "README.md": render(BLOCO_README, paragrafoCusto(estado)!),
      }),
      escrever: () => {
        throw new Error("não podia escrever")
      },
    })
    expect(status.map((s) => s.status)).toEqual(["jaEstava", "jaEstava"])
  })

  it("sem o marcador, o arquivo é DITO (`semMarcador`) em vez de o ato afirmar que reescreveu", () => {
    const status = escreverDocs({
      registro: registroOk,
      cwd: "/repo",
      existe: existem,
      ler: lerDe({ "docs/GUARDS.md": "sem marcador", "README.md": "sem marcador" }),
      escrever: () => {
        throw new Error("não podia escrever")
      },
    })
    expect(status.map((s) => s.status)).toEqual(["semMarcador", "semMarcador"])
  })

  it("a família não medida sai como `naoMedida` (nunca um bloco vazio no lugar da prosa)", () => {
    const status = escreverDocs({
      registro: registroOk,
      cwd: "/repo",
      existe: existem,
      ler: () => "sem marcador",
      escrever: () => {
        throw new Error("não podia escrever")
      },
    })
    expect(status.map((s) => s.status)).toEqual(["semMarcador", "semMarcador"])
    const semMedida = escreverDocs({
      registro: registro({ medições: false }),
      cwd: "/repo",
      existe: existem,
      ler: () => {
        throw new Error("nem devia ler")
      },
      escrever: () => {
        throw new Error("nem devia escrever")
      },
    })
    expect(semMedida.map((s) => s.status)).toEqual(["naoMedida", "naoMedida"])
  })

  it("a lista de blocos é a do repositório: a doc dos guards e a porta de entrada", () => {
    expect(DOCS.map((d) => d.arquivo)).toEqual(["docs/GUARDS.md", "README.md"])
  })
})
