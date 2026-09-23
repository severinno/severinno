/**
 * A régua das citações de commit na prosa versionada (`scripts/check-doc-hashes.mjs`).
 *
 * O que esta suíte prende, e por quê:
 *
 *  - o número PURO não é citação (`86400000` é hex válido e não é um commit) — a
 *    régua que evita 78 falsos positivos medidos em 22/09/2026;
 *  - o DIGEST de artefato (`sha256:fd027ee7…`) não é citação: a régua lê o
 *    prefixo, e a decisão fica contada, não sumida;
 *  - o token é julgado contra a HISTÓRIA: `git cat-file` responde "existe" para
 *    um objeto órfão de rewrite, e é o `--is-ancestor` que separa os dois
 *    defeitos (o órfão, que tem remédio nomeado, e o hash sem commit);
 *  - o veredito é FAIL-CLOSED sem git: uma árvore que não é repositório dá exit
 *    2, nunca "tudo na história";
 *  - e a ÁRVORE REAL passa — é esta asserção que faz o guard morder nas duas
 *    forjas (as duas rodam `test:unit`/`test:run`).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  criarParDeReescrita,
  garantirRepoComBase,
  limparTmpDirs,
} from "./helpers/doc-hashes-fixture"
import {
  avaliarCitacoes,
  ehArquivoDoAuditor,
  extrairCitacoes,
  foraPorExtensao,
  pareceCommit,
  temPrefixoDeDigest,
  violacoesDeCitacoes,
  ESCOPO,
  FORA_POR_EXTENSAO,
  NAO_CITACOES,
} from "../../../scripts/check-doc-hashes.mjs"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const SCRIPT = join(ROOT, "scripts", "check-doc-hashes.mjs")

/** Roda a CLI num checkout (`--root`) e devolve o veredito cru. */
function rodar(root: string): { code: number; saida: string } {
  const r = spawnSync(process.execPath, [SCRIPT, "--json", "--root", root], {
    encoding: "utf8",
  })
  return { code: r.status ?? -1, saida: `${r.stdout}${r.stderr}` }
}

describe("a régua do token: o que é citação, o que é número e o que é digest", () => {
  it("NÚMERO puro não é citação — ms, TTL, timestamp e telefone de fixture", () => {
    for (const numero of ["86400000", "31536000", "1581578731548", "11999999999", "1048576"]) {
      expect(pareceCommit(numero), `${numero} virou citação`).toBe(false)
    }
  })

  it("com LETRA a-f é candidato a citação — inclusive o de 7 e o de 40", () => {
    for (const hash of ["eee4f65e", "2757e3a5", "6125c9da", "a".repeat(40)]) {
      expect(pareceCommit(hash), `${hash} deixou de ser candidato`).toBe(true)
    }
  })

  it("o prefixo de digest tira a citação (a imagem não é commit)", () => {
    const linha = "| `ubuntu-bun` | `sha256:fd027ee7…` | 1.3.14 |"
    const i = linha.indexOf("fd027ee7")
    expect(temPrefixoDeDigest(linha, i)).toBe(true)
    expect(temPrefixoDeDigest("o commit fd027ee7 por extenso", 9)).toBe(false)
  })

  it("extrairCitacoes conta as linhas, separa digest e ignora número", () => {
    const conteudo = [
      "o ato foi no `eee4f65e`", // 1 — citação
      "o TTL é 31536000 e o sha é `sha256:fd027ee7…`", // 2 — número + digest
      "o outro ato, `2757e3a5`", // 3 — citação
    ].join("\n")
    const { citacoes, digests } = extrairCitacoes(conteudo, "docs/x.md")
    expect(citacoes).toEqual([
      { file: "docs/x.md", line: 1, token: "eee4f65e" },
      { file: "docs/x.md", line: 3, token: "2757e3a5" },
    ])
    expect(digests).toBe(1)
  })
})

describe("o julgamento: órfão de rewrite x hash sem commit x não-citação declarada", () => {
  const citacoes = [
    { file: "README.md", line: 1, token: "2757e3a5" }, // na história
    { file: "README.md", line: 2, token: "eee4f65e" }, // órfão, com o nome de hoje
    { file: "README.md", line: 3, token: "deadbee1" }, // não existe
    { file: "README.md", line: 4, token: "abc1234" }, // não-citação declarada
  ]
  const verificar = (token: string) => {
    if (token === "2757e3a5")
      return { existe: true, naHistoria: true, assunto: "s", candidato: null }
    if (token === "eee4f65e")
      return { existe: true, naHistoria: false, assunto: "s", candidato: "2757e3a5" }
    return { existe: false, naHistoria: false, assunto: null, candidato: null }
  }
  const aval = avaliarCitacoes({ citacoes, verificar })

  /** Os tokens de uma gaveta (o módulo é `.mjs`: a forma vem do JSDoc, não do TS). */
  const tokens = (xs: object[]) => xs.map((o) => (o as { token: string }).token)

  it("classifica cada token na sua gaveta", () => {
    expect(aval.naHistoria).toBe(1)
    expect(tokens(aval.orfaos)).toEqual(["eee4f65e"])
    expect(tokens(aval.inexistentes)).toEqual(["deadbee1"])
    expect(tokens(aval.naoCitacoes)).toEqual(["abc1234"])
  })

  it("o órfão sai com o REMÉDIO nomeado (o mesmo assunto na história)", () => {
    const [v] = violacoesDeCitacoes(aval).filter((x) => x.includes("eee4f65e"))
    expect(v).toContain("ÓRFÃO")
    expect(v).toContain("`2757e3a5`")
  })

  it("o hash que não existe sai SEM candidato e com o motivo do defeito", () => {
    const v = violacoesDeCitacoes(aval).find((x) => x.includes("deadbee1")) as string
    expect(v).toContain("não existe como commit")
    expect(v).toContain("NAO_CITACOES")
  })

  it("sem candidato de mesmo assunto, o órfão NÃO inventa um remédio", () => {
    const so = avaliarCitacoes({
      citacoes: [{ file: "a.md", line: 1, token: "eee4f65e" }],
      verificar: () => ({ existe: true, naHistoria: false, assunto: "x", candidato: null }),
    })
    expect(violacoesDeCitacoes(so)[0]).toContain("não há commit de mesmo assunto")
  })
})

describe("os limites declarados da varredura (e o auditor que não se conta)", () => {
  it("o escopo é a PROSA — o `src/` não está nele", () => {
    expect(ESCOPO.some((p) => p.startsWith("src"))).toBe(false)
    expect(ESCOPO).toContain("README.md")
    expect(ESCOPO).toContain(".husky/")
  })

  it("o `.ts` de fixture fica fora, e a extensão tem MOTIVO declarado", () => {
    expect(foraPorExtensao("scripts/seed-complete-flow.ts")).toBe(true)
    expect(foraPorExtensao("scripts/check-doc-hashes.mjs")).toBe(false)
    expect(foraPorExtensao(".husky/pre-push")).toBe(false)
    for (const e of FORA_POR_EXTENSAO) expect(e.porque.length).toBeGreaterThan(20)
  })

  it("toda não-citação declarada traz o motivo", () => {
    for (const n of NAO_CITACOES) {
      expect(n.porque.length, `${n.literal} sem motivo`).toBeGreaterThan(20)
    }
  })

  it("o auditor não é varrido (a prosa que DESCREVE o defeito cita os nomes órfãos)", () => {
    expect(ehArquivoDoAuditor("scripts/check-doc-hashes.mjs")).toBe(true)
    expect(ehArquivoDoAuditor("scripts/check-forge-parity.mjs")).toBe(false)
  })
})

describe("a CLI contra um repositório de verdade (o fixture é git, não dublê)", () => {
  let raiz = ""
  // O nome VIVO (na história, com o hash garantidamente uma citação) e o ÓRFÃO que
  // a dobra deixou: o par vem do helper compartilhado com as suítes do remédio e
  // do canal — um fixture que às vezes não cita nada é um teste que às vezes não
  // testa (a régua exige uma letra `a-f`, e um hash de 7 dígitos sai só com
  // algarismos em ~2% das vezes).
  let primeiro = ""
  let orfao = ""

  beforeAll(() => {
    raiz = mkdtempSync(join(tmpdir(), "doc-hashes-"))
    garantirRepoComBase(raiz)
    const par = criarParDeReescrita(raiz)
    orfao = par.orfao
    primeiro = par.vivo
  })

  afterAll(() => {
    if (raiz !== "") rmSync(raiz, { recursive: true, force: true })
    limparTmpDirs()
  })

  const citar = (texto: string) => writeFileSync(join(raiz, "README.md"), `${texto}\n`, "utf8")

  it("o commit que ESTÁ na história passa", () => {
    citar(`o ato foi no \`${primeiro}\``)
    const { code } = rodar(raiz)
    expect(code).toBe(0)
  })

  it("o commit ÓRFÃO (existe, fora da história) reprova — e o relatório diz isso", () => {
    // A pré-condição do caso: o hash CITADO é uma citação (tem letra) — sem isso
    // o teste mediria o vazio e passaria por acidente.
    expect(pareceCommit(orfao)).toBe(true)
    citar(`o ato foi no \`${orfao}\``)
    const { code, saida } = rodar(raiz)
    expect(code).toBe(1)
    const j = JSON.parse(saida)
    expect(j.orfaos.map((o: { token: string }) => o.token)).toEqual([orfao])
  })

  it("um hash sem commit nenhum reprova do outro jeito", () => {
    citar("o ato foi no `deadbee1`")
    const { code, saida } = rodar(raiz)
    expect(code).toBe(1)
    expect(JSON.parse(saida).inexistentes.map((i: { token: string }) => i.token)).toEqual([
      "deadbee1",
    ])
  })

  it("número puro, digest e não-citação declarada passam", () => {
    citar("TTL 31536000 ms · `sha256:fd027ee7…` · exemplo `abc1234`")
    const { code } = rodar(raiz)
    expect(code).toBe(0)
  })

  it("uma árvore que NÃO é repositório git é fail-closed (exit 2)", () => {
    const semGit = mkdtempSync(join(tmpdir(), "doc-hashes-sem-git-"))
    // (diretório cru, sem `git init`: o guard não cunha veredito sem git)
    try {
      expect(rodar(semGit).code).toBe(2)
    } finally {
      rmSync(semGit, { recursive: true, force: true })
    }
  })
})

describe("a árvore REAL (é esta asserção que morde nas duas forjas)", () => {
  it("toda citação de commit na prosa pertence à história do HEAD", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "--json"], { cwd: ROOT, encoding: "utf8" })
    const j = JSON.parse(r.stdout)
    expect(
      j.orfaos,
      `citações órfãs (rewrite trocou o nome do commit): ${JSON.stringify(j.orfaos)}`,
    ).toEqual([])
    expect(j.inexistentes, `hashes citados sem commit: ${JSON.stringify(j.inexistentes)}`).toEqual(
      [],
    )
    expect(r.status).toBe(0)
  })
})
