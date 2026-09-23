import { describe, expect, it } from "vitest"

import {
  FONTE_DAS_FORMAS,
  FORM_SECTION,
  MASTER_DOS_SUBTESTS,
  fonteDaForma,
  mapaDoMaster,
} from "../../../scripts/bench-families.mjs"
import { formOrigin, pathInCommit, treeState } from "../../../scripts/bench-guard-timing.mjs"
import { formOriginFact, formOriginLine } from "../../../scripts/bench-freshness.mjs"

/**
 * A RÉGUA das formas medidas × o COMMIT DE ORIGEM — o defeito que a idade
 * sozinha não via: a baseline grava um commit de origem e uma das formas que ela
 * mediu (`doc-hashes`, medido em 22/09/2026) NÃO existe naquele commit. A idade
 * mede a DISTÂNCIA em commits; esta régua mede o CONTEÚDO daquele commit.
 *
 * São três perguntas, e cada uma tem o seu dono: a FOLHA (de qual arquivo veio
 * esta forma?), o ATO (o que eu acabei de medir está no commit de origem?) e a
 * RÉGUA DA IDADE (o que a baseline versionada declara está no commit dela?).
 */

/** Um master mínimo no formato real: `SUBTESTS=( "id|script" )`. */
function master(entries: [string, string][]): string {
  return [
    "#!/usr/bin/env bash",
    "SUBTESTS=(",
    ...entries.map(([id, script]) => `  "${id}|${script}"`),
    ")",
  ].join("\n")
}

describe("mapaDoMaster — o id→script do SUBTESTS (a fonte que o ato e a régua leem)", () => {
  it("lê o formato de dois campos", () => {
    const mapa = mapaDoMaster(
      master([
        ["bun-literal", "scripts/test-mutation-bun-literal.sh"],
        ["readme", "scripts/test-mutation-readme-guards.sh"],
      ]),
    )
    // O id NÃO é o nome do arquivo (medido: `readme` → `test-mutation-readme-guards.sh`):
    // é por isso que a régua lê o mapa em vez de derivar por convenção de nome.
    expect(mapa.get("readme")).toBe("scripts/test-mutation-readme-guards.sh")
    expect(mapa.size).toBe(2)
  })

  it("lê o formato ANTIGO (id|descrição|script) sem confundir a descrição com o caminho", () => {
    const mapa = mapaDoMaster(
      ["SUBTESTS=(", '  "velho|Desc com | pipe|scripts/test-mutation-velho.sh"', ")"].join("\n"),
    )
    expect(mapa.get("velho")).toBe("scripts/test-mutation-velho.sh")
  })

  it("um arquivo sem o array devolve um mapa VAZIO (não inventa entrada)", () => {
    expect(mapaDoMaster("# nada aqui\n").size).toBe(0)
    expect(mapaDoMaster(null as never).size).toBe(0)
  })
})

describe("fonteDaForma — de qual ARQUIVO veio esta forma?", () => {
  const scripts = new Map([["stack-per-commit", "scripts/test-mutation-stack-per-commit.sh"]])

  it("a forma que declara o próprio `script` responde por si (o ato grava isso)", () => {
    expect(fonteDaForma("mutations", { role: "x", script: "scripts/x.sh" }, { scripts })).toEqual({
      path: "scripts/x.sh",
      via: "form.script",
    })
  })

  it("sem o `script`, a família da matriz nomeia pelo MAPA daquele commit", () => {
    expect(fonteDaForma("mutations", { role: "stack-per-commit" }, { scripts })).toEqual({
      path: "scripts/test-mutation-stack-per-commit.sh",
      via: "subtest-do-master",
      id: "stack-per-commit",
    })
  })

  it("o id que o master DAQUELE commit não tem é uma RESPOSTA (o caso `doc-hashes`)", () => {
    // É o defeito medido: a forma foi medida numa árvore cuja matriz aquele
    // commit não carrega — e a régua tem de nomear isso, não ficar calada.
    expect(fonteDaForma("mutations", { role: "doc-hashes" }, { scripts })).toEqual({
      path: null,
      via: "ausente-do-master",
      id: "doc-hashes",
    })
  })

  it("a família sem fonte própria sai `null` (NÃO julgada) — e é a tabela que o diz", () => {
    // As famílias que medem COMANDOS (o hook, o lint, o tsc, a suíte unitária)
    // não nomeiam arquivo próprio: um `null` explícito é o limite DECLARADO.
    for (const familia of ["hook", "lint", "typecheck", "tests", "battery"]) {
      expect(FONTE_DAS_FORMAS[familia]).toBeNull()
      expect(fonteDaForma(familia, { role: "qualquer" })).toBeNull()
    }
    expect(FONTE_DAS_FORMAS.mutations?.master).toBe(MASTER_DOS_SUBTESTS)
  })

  it("sem o mapa do master a pergunta NÃO foi feita — e isso é DIFERENTE de não ter fonte", () => {
    // `null` = a família não nomeia fonte nenhuma (o limite por desenho);
    // `sem-master` = a família nomeia, e aquele commit não tem o mapa — o
    // chamador conta as duas separado, e é o que impede o limite da régua de
    // engolir uma pergunta que ficou sem resposta.
    expect(fonteDaForma("mutations", { role: "x" }, { scripts: null })).toEqual({
      path: null,
      via: "sem-master",
      id: "x",
    })
  })
})

describe("treeState — o ESTADO DA ÁRVORE no ato (staged/unstaged)", () => {
  // O `run` é o `spawnSync` REAL no módulo: o dublê entra pelo mesmo lugar e o
  // `as never` é o apagamento de tipo que o resto do repositório usa para injetar
  // um dublê numa costura tipada pelo `node:child_process`.
  const comStatus = (stdout: string, status = 0) => ({
    run: (() => ({ status, stdout })) as never,
  })

  it("separa o ÍNDICE (staged) da árvore (unstaged) e deriva o limpo", () => {
    const estado = treeState(
      comStatus(
        [
          " M scripts/check-mutation-count.mjs",
          "M  scripts/bench-guard-timing.mjs",
          "MM scripts/bench-freshness.mjs",
          "?? docs/novo.md",
        ].join("\n"),
      ),
    )
    expect(estado.state).toBe("measured")
    expect(estado.clean).toBe(false)
    // `M ` (só o índice) NÃO é unstaged; `MM` é os dois; `??` é árvore.
    expect(estado.staged).toEqual(["scripts/bench-freshness.mjs", "scripts/bench-guard-timing.mjs"])
    expect(estado.unstaged).toEqual([
      "docs/novo.md",
      "scripts/bench-freshness.mjs",
      "scripts/check-mutation-count.mjs",
    ])
  })

  it("a árvore LIMPA é dita limpa (e é o caso em que nada fica fora do commit)", () => {
    const estado = treeState(comStatus("\n"))
    expect(estado.clean).toBe(true)
    expect(estado.staged).toEqual([])
    expect(estado.unstaged).toEqual([])
  })

  it("git que não responde é `unavailable` com o motivo — nunca uma árvore limpa", () => {
    const estado = treeState(comStatus("", 128))
    expect(estado.state).toBe("unavailable")
    expect(estado.clean).toBeNull()
    expect(estado.reason).toContain("git status")
  })
})

describe("pathInCommit — a árvore do commit tem este caminho?", () => {
  it("devolve true/false a partir do `git cat-file -e`", () => {
    const ok = { run: (() => ({ status: 0 })) as never }
    const nao = { run: (() => ({ status: 128 })) as never }
    expect(pathInCommit("scripts/x.sh", "abc1234", { run: ok.run })).toBe(true)
    expect(pathInCommit("scripts/x.sh", "abc1234", { run: nao.run })).toBe(false)
  })

  it("sem commit (ou com `unknown`) é `null`: não consegui perguntar ≠ não está lá", () => {
    const ok = { run: (() => ({ status: 0 })) as never }
    expect(pathInCommit("scripts/x.sh", null as never, { run: ok.run })).toBeNull()
    expect(pathInCommit("scripts/x.sh", "unknown", { run: ok.run })).toBeNull()
    expect(pathInCommit("", "abc1234", { run: ok.run })).toBeNull()
  })
})

describe("formOrigin (o ATO) — o que a rodada mediu × o commit de origem", () => {
  const rodada = {
    guards: [],
    lint: null,
    rulers: null,
    hook: { forms: [{ role: "comum-hoje", ms: 77 }] },
    mutations: { forms: [{ role: "a", script: "scripts/test-mutation-a.sh" }, { role: "b" }] },
  }
  const scripts = new Map([["b", "scripts/test-mutation-b.sh"]])

  it("julga as formas com fonte e CONTA as sem fonte (o limite declarado)", () => {
    const fato = formOrigin({
      result: rodada,
      commit: "abc1234",
      scripts,
      deps: { inCommit: () => true },
    })
    expect(fato.judged).toBe(2)
    // O hook não nomeia fonte própria: contado, não silenciado.
    expect(fato.notJudged).toBe(1)
    expect(fato.missing).toEqual([])
  })

  it("a forma que o commit de origem não tem é ACHADO (com o caminho e a via)", () => {
    const fato = formOrigin({
      result: rodada,
      commit: "abc1234",
      scripts,
      deps: { inCommit: (p: string) => p !== "scripts/test-mutation-b.sh" },
    })
    expect(fato.missing).toEqual([
      {
        family: "mutations",
        form: "b",
        path: "scripts/test-mutation-b.sh",
        via: "subtest-do-master",
      },
    ])
    expect(fato.families.mutations).toHaveLength(1)
  })

  it("o id FORA do master daquele commit é achado sem caminho (o `doc-hashes`)", () => {
    const fato = formOrigin({
      result: { ...rodada, mutations: { forms: [{ role: "doc-hashes" }] } },
      commit: "abc1234",
      scripts,
      deps: { inCommit: () => true },
    })
    expect(fato.missing).toEqual([
      {
        family: "mutations",
        form: "doc-hashes",
        path: null,
        id: "doc-hashes",
        via: "ausente-do-master",
      },
    ])
  })

  it("sem resposta do git NÃO vira achado nem verde: sai contado em `semResposta`", () => {
    const fato = formOrigin({
      result: rodada,
      commit: "abc1234",
      scripts,
      deps: { inCommit: () => null },
    })
    expect(fato.missing).toEqual([])
    expect(fato.semResposta).toBe(2)
  })
})

describe("formOriginFact (a RÉGUA DA IDADE) — a baseline × o commit de origem DELA", () => {
  const bench = {
    meta: {
      commit: "8e76c9a6",
      families: { mutations: { act: "measured", commit: "8e76c9a6", commitDate: null } },
    },
    mutations: {
      measured: true,
      forms: [
        { role: "stack-per-commit" },
        { role: "doc-hashes" },
        { role: "readme", script: "scripts/test-mutation-readme-guards.sh" },
      ],
    },
  }
  const ler = (commit: string, path: string) =>
    path === MASTER_DOS_SUBTESTS
      ? {
          ok: true,
          conteudo: master([
            ["stack-per-commit", "scripts/test-mutation-stack-per-commit.sh"],
            ["readme", "scripts/test-mutation-readme-guards.sh"],
          ]),
        }
      : { ok: false, motivo: "não existe" }

  it("o caso MEDIDO: o id que o master daquele commit não tem é a forma FORA", () => {
    const fato = formOriginFact(bench, { deps: { ler, existe: () => true } })
    expect(fato.state).toBe("measured")
    expect(fato.missing).toEqual([
      {
        family: "mutations",
        form: "doc-hashes",
        path: null,
        id: "doc-hashes",
        commit: "8e76c9a6",
        via: "ausente-do-master",
      },
    ])
    expect(formOriginLine(fato)).toContain("doc-hashes")
  })

  it("o caminho que não existe NAQUELE commit também é achado (a suíte no índice)", () => {
    const fato = formOriginFact(bench, {
      deps: {
        ler,
        existe: (_c: string, p: string) => p !== "scripts/test-mutation-readme-guards.sh",
      },
    })
    expect(fato.missing.map((m) => m.form)).toEqual(["doc-hashes", "readme"])
  })

  it("tudo no commit de origem: nenhum achado, e a linha diz o LIMITE (as sem fonte)", () => {
    const soUm = {
      ...bench,
      mutations: { ...bench.mutations, forms: [{ role: "stack-per-commit" }] },
    }
    const fato = formOriginFact(soUm, { deps: { ler, existe: () => true } })
    expect(fato.missing).toEqual([])
    expect(fato.judged).toBe(1)
    expect(formOriginLine(fato)).toContain("limite declarado")
  })

  it("FAIL-CLOSED: sem o master daquele commit a pergunta NÃO é respondida (semResposta)", () => {
    const fato = formOriginFact(bench, {
      deps: { ler: () => ({ ok: false, motivo: "sem master" }), existe: () => true },
    })
    // A forma que declara o próprio `script` ainda é julgável (não depende do
    // master); as duas que só têm o id saem como NÃO perguntadas.
    expect(fato.semResposta).toBe(2)
    expect(fato.judged).toBe(1)
    expect(formOriginLine(fato)).toContain("NÃO puderam ser perguntadas")
  })

  it("um bench SEM família medida é `unavailable` com o motivo — nunca 'tudo no commit'", () => {
    const fato = formOriginFact({ meta: {} }, { deps: { ler, existe: () => true } })
    expect(fato.state).toBe("unavailable")
    expect(fato.missing).toEqual([])
    expect(formOriginLine(fato)).toContain("NÃO foram julgadas")
  })

  it("a régua anda sobre as MESMAS seções que o ato (a tabela da folha)", () => {
    // Uma segunda lista de seções divergiria no dia em que uma família nascesse:
    // aqui a prova é que a tabela é a mesma para as duas pontas.
    expect(FORM_SECTION.mutations(bench)).toBe(bench.mutations.forms)
    expect(FORM_SECTION.hook({ hook: { forms: [1] } })).toEqual([1])
  })
})
