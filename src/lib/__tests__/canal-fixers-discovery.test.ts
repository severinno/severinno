// canal-fixers-discovery.test.ts
//
// O REGISTRO do canal do PR é DERIVADO, não escrito à mão: cada remendo é
// declarado em `scripts/remedy-canal/<id>.mjs`, e o `pr-fixers.mjs` o descobre
// casando a declaração com a CLASSE de mesmo id (`scripts/remedy-classes/`) — de
// onde saem o guard dono, o comando do `--fix` e a ordem. Estes testes medem as
// quatro metades disso:
//
//   1. no REPOSITÓRIO REAL o registro é exatamente o dos ARQUIVOS declarados —
//      mesma lista que o LEITOR folha (`remedy-canal.mjs`, o que o
//      `check-forge-parity` usa para a cobertura) publica. Duas leituras do mesmo
//      diretório não podem divergir;
//   2. um fixer NOVO (declaração do canal + classe + guard dono escritos no
//      fixture) ENTRA no registro sem que ninguém edite o registro — é a metade
//      que a lista à mão não conseguia cumprir;
//   3. a declaração é validada campo a campo, e nada inválido entra em silêncio:
//      sai nomeado em `CANAL_PROBLEMAS` (o publicador recusa a rodada);
//   4. as DUAS direções da régua: a declaração sem classe/dono com `remedyPatch`
//      não entra, e o dono que SABE produzir o patch sem declaração de canal não
//      some calado.
//
// Os fixtures usam `discoverFixers` com os diretórios injetados e a importação
// por `data:` (o carregador da suíte não resolve arquivos fora do projeto) — o
// caminho REAL de importação é medido nos testes do repositório REAL, no topo.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { afterAll, describe, expect, it } from "vitest"

import {
  CANAL_FIXERS,
  CANAL_PROBLEMAS,
  CAMPOS_DO_CANAL,
  DEFAULT_FIXER,
  FIXERS,
  PRODUTOR_DO_PATCH,
  discoverFixers,
} from "../../../scripts/pr-fixers.mjs"
import { CANAL_DIR, arquivosDoCanal, idsDoCanal } from "../../../scripts/remedy-canal.mjs"
import { REMEDY_CLASSES_DIR } from "../../../scripts/remedy-classes.mjs"
import { remedyFixers } from "../../../scripts/check-forge-parity.mjs"

const BANCADAS: string[] = []
afterAll(() => {
  for (const dir of BANCADAS) rmSync(dir, { recursive: true, force: true })
})

/** Um diretório temporário com `scripts/` + os DOIS diretórios de declaração. */
function bancada(): string {
  const dir = mkdtempSync(join(tmpdir(), "canal-fixers-"))
  mkdirSync(join(dir, "scripts", "remedy-canal"), { recursive: true })
  mkdirSync(join(dir, "scripts", "remedy-classes"), { recursive: true })
  BANCADAS.push(dir)
  return dir
}

/**
 * A descoberta de uma BANCADA. `importar` por `data:` de propósito: o carregador
 * desta suíte resolve arquivos do projeto, e um fixture em `/tmp` fica fora do
 * root — o CONTEÚDO é o mesmo, sem o resolvedor do runner.
 */
async function descobrirNaBancada(dir: string) {
  return discoverFixers({
    canalDir: join(dir, "scripts", "remedy-canal"),
    classesDir: join(dir, "scripts", "remedy-classes"),
    scriptsDir: join(dir, "scripts"),
    importar: async (url: string) => {
      const fonte = readFileSync(fileURLToPath(url), "utf8")
      const b64 = Buffer.from(fonte, "utf8").toString("base64")
      return import(`data:text/javascript;base64,${b64}`)
    },
  })
}

/** O guard DONO mínimo: um módulo com `--fix` e o produtor do patch. */
function donoModulo(dir: string, nome: string, { patch = true } = {}): void {
  writeFileSync(
    join(dir, "scripts", nome),
    "// fixture — o guard dono declara --fix\n" +
      "export const FIXER = '--fix'\n" +
      (patch ? `export async function ${PRODUTOR_DO_PATCH}() { return null }\n` : ""),
    "utf8",
  )
}

/**
 * Uma CLASSE válida do pre-commit, em fonte JS (as funções entram como fonte).
 * É a outra ponta do par: é dela que a descoberta do canal tira a ordem e o
 * comando do `--fix`.
 */
function classeSrc(extra: Record<string, string | undefined> = {}): string {
  const campos: Record<string, string> = {
    id: '"sonda"',
    ordem: "900",
    script: '"sonda.mjs"',
    label: '"defeito de fixture"',
    verde: '"o defeito sumiu"',
    vermelho: '"o defeito continua"',
    estagio: '"add"',
    fixer: '"node scripts/sonda.mjs --fix"',
    sugere: "() => []",
    aplicavel: "() => null",
    detectar: "() => ({ offenders: [], relatorio: '', violacoes: 0 })",
    aplicar: "() => ({ relatorio: '' })",
  }
  // `undefined` num campo o OMITE do fonte: é assim que os casos de CAMPO
  // AUSENTE são montados (o contrato é validado campo a campo).
  for (const [chave, valor] of Object.entries(extra)) {
    if (valor === undefined) delete campos[chave]
    else campos[chave] = valor
  }
  const linhas = Object.entries(campos).map(([chave, valor]) => `  ${chave}: ${valor},`)
  return `export default {\n${linhas.join("\n")}\n}\n`
}

/**
 * Uma DECLARAÇÃO do canal válida, em fonte JS. `undefined` num campo o OMITE (é
 * assim que os casos de campo ausente são montados).
 */
function canalSrc(extra: Record<string, string | undefined> = {}): string {
  const campos: Record<string, string> = {
    id: '"sonda"',
    default: "false",
    marker: '"<!-- sonda-remedy -->"',
    gateJob: '"Gate da sonda"',
    titulo: '"🩹 sonda"',
    achado: "(n) => `achou ${n}`",
    naoCobre: '"o que precisa de mão"',
    rodape: '"> o diff é o que se revisa"',
  }
  for (const [chave, valor] of Object.entries(extra)) {
    if (valor === undefined) delete campos[chave]
    else campos[chave] = valor
  }
  const linhas = Object.entries(campos).map(([chave, valor]) => `  ${chave}: ${valor},`)
  return `export default {\n${linhas.join("\n")}\n}\n`
}

function escrever(
  dir: string,
  pasta: "remedy-canal" | "remedy-classes",
  nome: string,
  conteudo: string,
) {
  writeFileSync(join(dir, "scripts", pasta, nome), conteudo, "utf8")
}

// ── 1. o registro do repositório REAL ─────────────────────────────────────

describe("o registro do repositório real", () => {
  it("nenhuma declaração ficou fora: `CANAL_PROBLEMAS` está VAZIO", () => {
    expect(CANAL_PROBLEMAS).toEqual([])
    expect(CANAL_FIXERS.length).toBeGreaterThan(0)
  })

  it("o registro é o dos ARQUIVOS declarados — e o LEITOR folha concorda (duas leituras, um só diretório)", () => {
    expect(CANAL_FIXERS.map((f) => f.id).sort()).toEqual(idsDoCanal().sort())
    expect(Object.keys(FIXERS).sort()).toEqual(idsDoCanal().sort())
    expect(arquivosDoCanal()).toEqual([...arquivosDoCanal()!].sort())
  })

  it("exatamente UM fixer declara `default: true`, e é ele o `DEFAULT_FIXER`", () => {
    const comDefault = CANAL_FIXERS.filter((f) => f.default === true)
    expect(comDefault).toHaveLength(1)
    expect(DEFAULT_FIXER).toBe(comDefault[0].id)
  })

  it("cada fixer tem a prosa cheia e um marcador próprio (a reconciliação é por marcador)", () => {
    const marcadores = new Set<string>()
    for (const f of CANAL_FIXERS) {
      for (const campo of CAMPOS_DO_CANAL) expect(f).toHaveProperty(campo)
      expect(typeof f.achado).toBe("function")
      expect(f.achado(3)).toContain("3")
      expect(f.marker.length).toBeGreaterThan(0)
      expect(marcadores.has(f.marker)).toBe(false)
      marcadores.add(f.marker)
    }
  })

  it("o par com a CLASSE é o que dá ordem e comando: o registro não os copia", async () => {
    // A ordem e o comando saem da classe de mesmo id — se um dia a classe mudar a
    // superfície do dono, o registro muda junto (é a razão do par).
    for (const f of CANAL_FIXERS) {
      expect(typeof f.ordem).toBe("number")
      const classe = (await import(`../../../scripts/remedy-classes/${f.id}.mjs`)).default
      expect(f.ordem).toBe(classe.ordem)
      expect(f.comandoFix).toBe(classe.fixer)
    }
    const ordens = CANAL_FIXERS.map((f) => f.ordem)
    expect(ordens).toEqual([...ordens].sort((a, b) => a - b))
    expect(new Set(ordens).size).toBe(ordens.length)
    for (const f of CANAL_FIXERS) {
      expect(f.comandoFix.endsWith("--fix")).toBe(true)
    }
  })

  it("a medição sai do produtor do patch do PRÓPRIO dono (a mesma função, não uma cópia)", async () => {
    for (const f of CANAL_FIXERS) {
      expect(typeof f.medir).toBe("function")
      const classe = (await import(`../../../scripts/remedy-classes/${f.id}.mjs`)).default
      const dono = await import(`../../../scripts/${classe.script}`)
      expect(f.medir).toBe(dono[PRODUTOR_DO_PATCH])
    }
  })

  it("a COBERTURA que o `check-forge-parity` lê é a mesma do registro montado", () => {
    // Duas leituras do MESMO diretório (a folha, no guard; a descoberta, aqui):
    // uma divergência significaria um fixer publicado e não coberto (ou o
    // contrário) — e é por isso que as duas são comparadas.
    expect(remedyFixers().slice().sort()).toEqual(Object.keys(FIXERS).sort())
  })
})

// ── 2. um fixer NOVO entra no registro ────────────────────────────────────

describe("um fixer novo entra sem editar o registro", () => {
  it("declaração + classe + dono na bancada: o registro o publica (id, ordem, comando e prosa)", async () => {
    const dir = bancada()
    donoModulo(dir, "sonda.mjs")
    escrever(dir, "remedy-classes", "sonda.mjs", classeSrc())
    // O único fixer da bancada é o DEFAULT (a descoberta exige exatamente um).
    escrever(dir, "remedy-canal", "sonda.mjs", canalSrc({ default: "true" }))
    const { fixers, problemas } = await descobrirNaBancada(dir)

    expect(problemas).toEqual([])
    expect(fixers.map((f) => f.id)).toEqual(["sonda"])
    const sonda = fixers[0]
    // O que vem da CLASSE (uma só fonte para as duas pontas do par)…
    expect(sonda.ordem).toBe(900)
    expect(sonda.comandoFix).toBe("node scripts/sonda.mjs --fix")
    // …e o que vem da DECLARAÇÃO do canal.
    expect(sonda.marker).toBe("<!-- sonda-remedy -->")
    expect(sonda.gateJob).toBe("Gate da sonda")
    expect(typeof sonda.medir).toBe("function")
  })

  it("o id vem do NOME do arquivo: dois fixers novos entram e a ordem é a das classes", async () => {
    const dir = bancada()
    donoModulo(dir, "sonda.mjs")
    donoModulo(dir, "outra.mjs")
    escrever(dir, "remedy-classes", "sonda.mjs", classeSrc())
    escrever(
      dir,
      "remedy-classes",
      "outra.mjs",
      classeSrc({
        id: '"outra"',
        ordem: "10",
        script: '"outra.mjs"',
        fixer: '"node scripts/outra.mjs --fix"',
      }),
    )
    escrever(dir, "remedy-canal", "sonda.mjs", canalSrc({ default: "true" }))
    escrever(
      dir,
      "remedy-canal",
      "outra.mjs",
      canalSrc({ id: '"outra"', marker: '"<!-- outra-remedy -->"' }),
    )
    const { fixers, problemas } = await descobrirNaBancada(dir)

    expect(problemas).toEqual([])
    expect(fixers.map((f) => f.id)).toEqual(["outra", "sonda"]) // `ordem` 10 < 900
    expect(fixers.map((f) => f.default)).toEqual([false, true])
  })

  it("o registro NÃO cita o id novo: quem o faz entrar é o diretório", () => {
    // A prova de que nada foi editado para o fixer novo entrar: o módulo do
    // registro e o publicador são os do repositório, sem uma linha de fixture.
    for (const arquivo of ["pr-fixers.mjs", "pr-remedy-comment.mjs"]) {
      const fonte = readFileSync(join(CANAL_DIR, "..", arquivo), "utf8")
      expect(fonte).not.toContain("sonda")
    }
  })
})

// ── 3. a validação, campo a campo (fail-closed) ───────────────────────────

describe("a declaração do canal é validada (fail-closed)", () => {
  const ruins: Array<{
    nome: string
    canal?: string
    /** `null` = sem a classe de mesmo id; ausente = a classe válida do fixture. */
    classe?: string | null
    /** O dono da sonda exporta `remedyPatch`? (default: sim) */
    patch?: boolean
    espera: RegExp
  }> = [
    {
      nome: "id ≠ nome do arquivo",
      canal: canalSrc({ id: '"outro"' }),
      espera: /`id` é 'outro' e o arquivo é 'sonda\.mjs'/,
    },
    {
      nome: "`marker` ausente",
      canal: canalSrc({ marker: undefined }),
      espera: /`marker` ausente/,
    },
    {
      nome: "`marker` que não é comentário HTML",
      canal: canalSrc({ marker: '"sonda-remedy"' }),
      espera: /não é um comentário HTML/,
    },
    { nome: "`gateJob` vazio", canal: canalSrc({ gateJob: '"  "' }), espera: /`gateJob` vazio/ },
    {
      nome: "`achado` que não é função",
      canal: canalSrc({ achado: '"não sou função"' }),
      espera: /`achado` não é função/,
    },
    {
      nome: "`rodape` ausente",
      canal: canalSrc({ rodape: undefined }),
      espera: /`rodape` ausente/,
    },
    {
      nome: "`default` que não é booleano",
      canal: canalSrc({ default: '"sim"' }),
      espera: /`default` não é booleano/,
    },
    {
      nome: "sem a CLASSE de mesmo id",
      canal: canalSrc(),
      classe: null,
      espera: /não há classe 'remedy-classes\/sonda\.mjs'/,
    },
    {
      nome: "a classe aponta para um dono sem `remedyPatch`",
      canal: canalSrc(),
      patch: false,
      espera: /não exporta `remedyPatch`/,
    },
    {
      nome: "o módulo da declaração não importa",
      canal: "isto não é javascript ###\n",
      espera: /não pude importar/,
    },
    {
      nome: "não exporta um objeto (default)",
      canal: "export default 42\n",
      espera: /não é um objeto/,
    },
  ]

  for (const caso of ruins) {
    it(`${caso.nome}: fica FORA do canal e NOMEADA`, async () => {
      const dir = bancada()
      // O dono da sonda: com patch (o caso padrão), exceto no caso que mede a
      // exigência do `remedyPatch` — que é justamente o que a classe aponta.
      donoModulo(dir, "sonda.mjs", { patch: caso.patch ?? true })
      if (caso.classe !== null) {
        escrever(dir, "remedy-classes", "sonda.mjs", caso.classe ?? classeSrc())
      }
      if (caso.canal !== undefined) escrever(dir, "remedy-canal", "sonda.mjs", caso.canal)
      const { fixers, problemas } = await descobrirNaBancada(dir)
      expect(problemas.join("\n")).toMatch(caso.espera)
      expect(fixers.map((f) => f.id)).not.toContain("sonda")
      // A mensagem nomeia o ARQUIVO: é o que o operador lê no PR recusado.
      expect(problemas.join("\n")).toContain("sonda")
    })
  }

  it("dois marcadores IGUAIS: o segundo é recusado (a reconciliação retiraria um comentário pelo outro)", async () => {
    const dir = bancada()
    donoModulo(dir, "sonda.mjs")
    donoModulo(dir, "outra.mjs")
    escrever(dir, "remedy-classes", "sonda.mjs", classeSrc())
    escrever(
      dir,
      "remedy-classes",
      "outra.mjs",
      classeSrc({
        id: '"outra"',
        ordem: "10",
        script: '"outra.mjs"',
        fixer: '"node scripts/outra.mjs --fix"',
      }),
    )
    escrever(dir, "remedy-canal", "sonda.mjs", canalSrc({ default: "true" }))
    escrever(
      dir,
      "remedy-canal",
      "outra.mjs",
      canalSrc({ id: '"outra"', marker: '"<!-- sonda-remedy -->"' }),
    )
    const { fixers, problemas } = await descobrirNaBancada(dir)

    // A ordem de leitura é a dos ARQUIVOS ('outra' < 'sonda'): quem entra é o
    // primeiro, e a mensagem aponta o primeiro como o dono do marcador.
    expect(problemas.join("\n")).toMatch(/mesmo de 'outra'/)
    expect(fixers.map((f) => f.id)).toEqual(["outra"])
  })

  it("ZERO `default: true` recusa a rodada (o `fixerOf()` sem argumento não teria default)", async () => {
    const dir = bancada()
    donoModulo(dir, "sonda.mjs")
    escrever(dir, "remedy-classes", "sonda.mjs", classeSrc())
    escrever(dir, "remedy-canal", "sonda.mjs", canalSrc({ default: undefined }))
    const { problemas } = await descobrirNaBancada(dir)
    expect(problemas.join("\n")).toMatch(/nenhum fixer declara `default: true`/)
  })

  it("DOIS `default: true` recusam a rodada (o default não se escolhe por ordem de arquivo)", async () => {
    const dir = bancada()
    donoModulo(dir, "sonda.mjs")
    donoModulo(dir, "outra.mjs")
    escrever(dir, "remedy-classes", "sonda.mjs", classeSrc())
    escrever(
      dir,
      "remedy-classes",
      "outra.mjs",
      classeSrc({
        id: '"outra"',
        ordem: "10",
        script: '"outra.mjs"',
        fixer: '"node scripts/outra.mjs --fix"',
      }),
    )
    escrever(dir, "remedy-canal", "sonda.mjs", canalSrc({ default: "true" }))
    escrever(
      dir,
      "remedy-canal",
      "outra.mjs",
      canalSrc({ id: '"outra"', default: "true", marker: '"<!-- outra-remedy -->"' }),
    )
    const { problemas } = await descobrirNaBancada(dir)
    expect(problemas.join("\n")).toMatch(/dois fixers declaram `default: true`/)
  })

  it("diretório do canal VAZIO (ou ilegível) recusa a rodada — nunca um canal que 'não cobre nada'", async () => {
    const vazia = bancada()
    donoModulo(vazia, "sonda.mjs")
    escrever(vazia, "remedy-classes", "sonda.mjs", classeSrc())
    const r1 = await descobrirNaBancada(vazia)
    expect(r1.fixers).toEqual([])
    expect(r1.problemas.join("\n")).toMatch(/nenhuma declaração de canal/)

    const inexistente = join(bancada(), "scripts", "nao-existe")
    const r2 = await discoverFixers({
      canalDir: inexistente,
      classesDir: REMEDY_CLASSES_DIR,
      scriptsDir: join(REMEDY_CLASSES_DIR, ".."),
    })
    expect(r2.fixers).toEqual([])
    expect(r2.problemas.join("\n")).toMatch(/não consegui listar/)
  })
})

// ── 4. as duas direções da régua ──────────────────────────────────────────

describe("as duas direções da régua", () => {
  it("o dono que SABE produzir o patch e não tem declaração de canal não some calado", async () => {
    const dir = bancada()
    donoModulo(dir, "sonda.mjs")
    escrever(dir, "remedy-classes", "sonda.mjs", classeSrc())
    const { fixers, problemas } = await descobrirNaBancada(dir)

    expect(fixers).toEqual([]) // a única declaração é a CLASSE, que não publica
    expect(problemas.join("\n")).toMatch(/exporta `remedyPatch`, e não há declaração de canal/)
    expect(problemas.join("\n")).toContain("remedy-canal/sonda.mjs")
  })

  it("o dono sem `remedyPatch` (não é módulo JS) NÃO exige canal: a ausência é mecânica", async () => {
    const dir = bancada()
    // Um dono `.sh`: não exporta função nenhuma — não há patch a publicar.
    writeFileSync(
      join(dir, "scripts", "sonda.sh"),
      "#!/usr/bin/env bash\n# --fix\nexit 0\n",
      "utf8",
    )
    escrever(
      dir,
      "remedy-classes",
      "sonda.mjs",
      classeSrc({ script: '"sonda.sh"', fixer: '"bash scripts/sonda.sh --fix"' }),
    )
    // O canal da bancada tem o fixer dele — a bancada não pode ficar sem canal
    // NENHUM (isso é outra regra, medida logo abaixo).
    donoModulo(dir, "outra.mjs")
    escrever(
      dir,
      "remedy-classes",
      "outra.mjs",
      classeSrc({
        id: '"outra"',
        ordem: "10",
        script: '"outra.mjs"',
        fixer: '"node scripts/outra.mjs --fix"',
      }),
    )
    escrever(
      dir,
      "remedy-canal",
      "outra.mjs",
      canalSrc({ id: '"outra"', default: "true", marker: '"<!-- outra-remedy -->"' }),
    )
    const { fixers, problemas } = await descobrirNaBancada(dir)

    // Nenhuma palavra sobre a classe do `.sh`: a ausência dela no canal é
    // MECÂNICA (não há patch a publicar), não uma declaração que falte.
    expect(problemas).toEqual([])
    expect(fixers.map((f) => f.id)).toEqual(["outra"])
  })

  it("uma classe INVÁLIDA também derruba a declaração do canal (uma só régua de classe)", async () => {
    const dir = bancada()
    donoModulo(dir, "sonda.mjs")
    // `estagio` desconhecido: a classe sai da oferta, e a declaração do canal
    // fica órfã — as duas mensagens aparecem, porque as duas coisas estão
    // erradas.
    escrever(dir, "remedy-classes", "sonda.mjs", classeSrc({ estagio: '"push"' }))
    escrever(dir, "remedy-canal", "sonda.mjs", canalSrc())
    const { fixers, problemas } = await descobrirNaBancada(dir)

    expect(fixers).toEqual([])
    expect(problemas.join("\n")).toMatch(/`estagio` desconhecido/)
    expect(problemas.join("\n")).toMatch(/não há classe/)
  })
})
