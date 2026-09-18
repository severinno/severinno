// remedy-classes-discovery.test.ts
//
// A OFERTA do remédio do pre-commit é DERIVADA, não escrita à mão: cada classe é
// declarada pelo guard DONO dela em `scripts/remedy-classes/<id>.mjs`, e o
// `pre-commit-remedy.mjs` a descobre varrendo o diretório. Estes testes medem as
// quatro metades disso:
//
//   1. no REPOSITÓRIO REAL a oferta é exatamente a dos arquivos declarados, cada
//      dono existe e declara `--fix` (a regra que a descoberta cobra);
//   2. a declaração é validada campo a campo, e uma declaração inválida NÃO entra
//      na oferta em silêncio — ela sai nomeada em `CLASSES_PROBLEMAS`;
//   3. um fixer NOVO (declaração + guard dono escritos no fixture) entra na
//      oferta e é EXECUTADO pelo remédio, sem que ninguém edite o remédio — é a
//      metade que a lista à mão não conseguia cumprir;
//   4. oferta INCOMPLETA recusa a rodada (exit 2): o commit não é julgado por uma
//      oferta que oferece menos do que o repositório sabe remendar.
//
// Os fixtures rodam a CLI do REMÉDIO com o cwd no repositório temporário: é o
// processo que lê o `scripts/remedy-classes/` DAQUELE repo (importar o módulo
// dentro deste processo leria o do repositório de quem roda a suíte, e o teste
// mediria outra coisa).

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { afterAll, describe, expect, it } from "vitest"

import {
  CAMPOS_OBRIGATORIOS,
  CLASSES as CLASSES_DESCOBERTA,
  CLASSES_PROBLEMAS,
  ESTAGIOS,
  REMEDY_CLASSES_DIR,
  SUFIXO,
  discoverRemedyClasses,
} from "../../../scripts/remedy-classes.mjs"
import {
  CLASSES,
  USAGE,
  blocoClasses,
  recusaDaOferta,
} from "../../../scripts/pre-commit-remedy.mjs"
// O `novoRepo` daqui é o do PROOF, não o cru do simulador: ele traz o fecho do
// hook (as declarações, os guards donos, o remédio) — o fixture precisa da oferta
// COMPLETA, senão o remédio recusa a rodada por oferta incompleta.
import { cleanupFixtures, stage } from "../../../scripts/hook-simulator.mjs"
import { WORKFLOW_CICATRIZ, novoRepo } from "./helpers/pre-commit-fixture"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const SCRIPTS = join(ROOT, "scripts")

afterAll(() => cleanupFixtures())

/** Um diretório temporário com `scripts/` + `scripts/remedy-classes/`. */
function bancada(): string {
  const dir = mkdtempSync(join(tmpdir(), "remedy-classes-"))
  mkdirSync(join(dir, "scripts", "remedy-classes"), { recursive: true })
  return dir
}

/**
 * A descoberta de uma BANCADA (diretório temporário fora do projeto).
 *
 * `importar` é passado de propósito: o carregador DESTE processo (o da suíte)
 * resolve arquivos do projeto, e uma declaração em `/tmp` fica fora do root — daí
 * a importação por `data:` (o mesmo CONTEÚDO, sem passar pelo resolvedor do
 * runner). O caminho REAL de importação é medido nos testes de ponta a ponta
 * abaixo, onde quem importa é o processo da CLI, com o carregador comum do Node.
 */
async function descobrirNaBancada(dir: string) {
  return discoverRemedyClasses({
    dir: join(dir, "scripts", "remedy-classes"),
    scriptsDir: join(dir, "scripts"),
    importar: async (url: string) => {
      const fonte = readFileSync(fileURLToPath(url), "utf8")
      const b64 = Buffer.from(fonte, "utf8").toString("base64")
      return import(`data:text/javascript;base64,${b64}`)
    },
  })
}

/** O guard dono mínimo: declara `--fix` (é o que a descoberta exige dele). */
function guardDono(dir: string, nome: string, comFix = true): void {
  writeFileSync(
    join(dir, "scripts", nome),
    `#!/usr/bin/env bash\n# fixture\n${comFix ? 'if [ "$1" = "--fix" ]; then exit 0; fi\n' : ""}exit 0\n`,
    "utf8",
  )
}

/**
 * Uma declaração VÁLIDA em fonte JS (as funções entram como fonte: não há como
 * serializá-las), com o que cada teste quiser trocar — o valor de `extra` entra
 * como literal.
 */
function declaracao(extra: Record<string, unknown> = {}): string {
  const campos: Record<string, string> = {
    id: '"nova"',
    ordem: "900",
    script: '"nova.sh"',
    label: '"defeito de fixture"',
    verde: '"o defeito sumiu"',
    vermelho: '"o defeito continua"',
    estagio: '"add"',
    fixer: '"bash scripts/nova.sh --fix"',
    sugere: "() => []",
    aplicavel: "() => null",
    detectar: "() => ({ offenders: [], relatorio: '', violacoes: 0 })",
    aplicar: "() => ({ relatorio: '' })",
  }
  for (const [chave, valor] of Object.entries(extra)) campos[chave] = JSON.stringify(valor)
  const linhas = Object.entries(campos).map(([chave, valor]) => `  ${chave}: ${valor},`)
  return `export default {\n${linhas.join("\n")}\n}\n`
}

/** Escreve a declaração no diretório de um repo (fixture ou bancada). */
function declarar(dir: string, nomeArquivo: string, conteudo: string): void {
  writeFileSync(join(dir, "scripts", "remedy-classes", nomeArquivo), conteudo, "utf8")
}

/**
 * Roda a CLI do remédio no repositório dado — o processo que lê a oferta DAQUELE
 * repo. A pergunta é desligada (`PRE_COMMIT_REMEDY_NO_PROMPT`): o assunto aqui é
 * a OFERTA, e um fixture não tem operador.
 */
function rodarRemedio(dir: string) {
  const r = spawnSync(process.execPath, ["scripts/pre-commit-remedy.mjs"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, PRE_COMMIT_REMEDY_NO_PROMPT: "1" },
  })
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` }
}

// ── 1. a oferta do repositório REAL ───────────────────────────────────────

describe("a oferta do repositório real", () => {
  it("nenhuma declaração ficou fora: `CLASSES_PROBLEMAS` está VAZIO", () => {
    expect(CLASSES_PROBLEMAS).toEqual([])
    expect(CLASSES.length).toBeGreaterThan(0)
  })

  it("a oferta é a dos ARQUIVOS declarados, na ordem declarada (não a do sistema de arquivos)", () => {
    const arquivos = readdirSync(REMEDY_CLASSES_DIR)
      .filter((f) => f.endsWith(SUFIXO))
      .map((f) => f.slice(0, -SUFIXO.length))
      .sort()
    expect(CLASSES.map((c) => c.id).sort()).toEqual(arquivos)
    // A ordem da oferta é a de `ordem` — crescente, e é ela que as mensagens seguem.
    const ordens = CLASSES.map((c) => c.ordem)
    expect(ordens).toEqual([...ordens].sort((a, b) => a - b))
  })

  it("cada classe tem os campos obrigatórios e um `estagio` conhecido", () => {
    for (const c of CLASSES) {
      for (const campo of CAMPOS_OBRIGATORIOS) expect(c).toHaveProperty(campo)
      expect(ESTAGIOS).toContain(c.estagio)
      expect(typeof c.detectar).toBe("function")
      expect(typeof c.aplicar).toBe("function")
      expect(typeof c.aplicavel).toBe("function")
    }
  })

  it("o GUARD DONO de cada declaração existe e declara `--fix` — e o fixer o cita", () => {
    for (const c of CLASSES) {
      const dono = join(SCRIPTS, c.script)
      expect(existsSync(dono)).toBe(true)
      expect(readFileSync(dono, "utf8")).toContain("--fix")
      expect(c.fixer).toContain(`scripts/${c.script}`)
    }
  })

  it("a CLI do remédio não recusa a rodada por causa da oferta (recusaDaOferta == null)", () => {
    expect(recusaDaOferta(CLASSES, CLASSES_PROBLEMAS)).toBe(null)
  })

  it("a descoberta e o reexport do remédio são a MESMA oferta", () => {
    expect(CLASSES).toBe(CLASSES_DESCOBERTA)
  })
})

// ── 2. a validação, campo a campo ─────────────────────────────────────────

describe("a declaração é validada (fail-closed)", () => {
  it("uma declaração válida entra", async () => {
    const dir = bancada()
    guardDono(dir, "nova.sh")
    declarar(dir, "nova.mjs", declaracao())
    const { classes, problemas } = await descobrirNaBancada(dir)
    expect(problemas).toEqual([])
    expect(classes.map((c) => c.id)).toEqual(["nova"])
  })

  const ruins: Array<{ nome: string; conteudo: string; espera: RegExp }> = [
    {
      nome: "id ≠ nome do arquivo",
      conteudo: declaracao({ id: "outro" }),
      espera: /id 'outro' ≠ nome do arquivo 'nova'/,
    },
    {
      nome: "ordem repetida (com outra declaração já lida)",
      conteudo: declaracao({ ordem: 900 }),
      espera: /ordem 900 repetida/,
    },
    {
      nome: "guard dono ausente",
      conteudo: declaracao({ script: "nao-existe.sh", fixer: "bash scripts/nao-existe.sh --fix" }),
      espera: /guard dono 'scripts\/nao-existe\.sh' não existe/,
    },
    {
      nome: "estagio desconhecido",
      conteudo: declaracao({ estagio: "push" }),
      espera: /`estagio` desconhecido: push/,
    },
    {
      nome: "campo obrigatório ausente",
      conteudo: "export default { id: 'nova' }\n",
      espera: /campo obrigatório ausente/,
    },
    {
      nome: "campo de função que não é função",
      conteudo: declaracao({ detectar: "não sou função" }),
      espera: /`detectar` não é função/,
    },
    {
      nome: "não exporta um objeto (default)",
      conteudo: "export default 42\n",
      espera: /não exporta um objeto/,
    },
    {
      nome: "o módulo não importa",
      conteudo: "isto não é javascript válido ###\n",
      espera: /não pude importar/,
    },
  ]

  for (const caso of ruins) {
    it(`${caso.nome}: fica FORA da oferta e nomeada`, async () => {
      const dir = bancada()
      guardDono(dir, "nova.sh")
      // A ordem 900 é tomada pela declaração lida ANTES (a leitura é ordenada
      // pelo nome do arquivo: 'a-primeira' < 'nova') — assim quem colide é
      // sempre a declaração sob teste, e não a de apoio.
      if (caso.espera.source.includes("repetida")) {
        declarar(dir, "a-primeira.mjs", declaracao({ id: "a-primeira", ordem: 900 }))
      }
      declarar(dir, "nova.mjs", caso.conteudo)
      const { classes, problemas } = await descobrirNaBancada(dir)
      expect(problemas.join("\n")).toMatch(caso.espera)
      expect(classes.map((c) => c.id)).not.toContain("nova")
      // A mensagem NOMEIA o arquivo: é o que o operador lê no commit recusado.
      expect(problemas.join("\n")).toContain("nova.mjs")
      rmSync(dir, { recursive: true, force: true })
    })
  }

  it("um dono que existe mas NÃO declara `--fix` é problema (a classe promete o que ele não tem)", async () => {
    const dir = bancada()
    guardDono(dir, "nova.sh", false)
    declarar(dir, "nova.mjs", declaracao())
    const { problemas } = await descobrirNaBancada(dir)
    expect(problemas.join("\n")).toMatch(/não declara `--fix`/)
  })

  it("o fixer que NÃO cita o guard dono é problema (a classe e o comando divergiriam)", async () => {
    const dir = bancada()
    guardDono(dir, "nova.sh")
    declarar(dir, "nova.mjs", declaracao({ fixer: "bash scripts/outro.sh --fix" }))
    const { problemas } = await descobrirNaBancada(dir)
    expect(problemas.join("\n")).toMatch(/não cita o guard dono/)
  })

  it("diretório VAZIO e diretório ILEGÍVEL não são 'nenhuma classe': são problema", async () => {
    const vazio = await discoverRemedyClasses({
      dir: join(bancada(), "scripts", "remedy-classes"),
      scriptsDir: join(bancada(), "scripts"),
    })
    expect(vazio.classes).toEqual([])
    expect(vazio.problemas.join("\n")).toMatch(/nenhuma declaração de classe/)

    const ilegivel = await discoverRemedyClasses({
      dir: join(bancada(), "scripts", "nao-existe"),
      scriptsDir: SCRIPTS,
    })
    expect(ilegivel.problemas.join("\n")).toMatch(/não consegui listar as declarações/)
  })

  it("a recusa nomeia o arquivo e o que falta (a mensagem do commit recusado)", () => {
    const recusa = recusaDaOferta([{ id: "x" }], ["nova.mjs: ordem repetida"])
    expect(recusa).toContain("nova.mjs: ordem repetida")
    const semClasse = recusaDaOferta([], ["nova.mjs: campo obrigatório ausente: `label`"])
    expect(semClasse).toMatch(/NENHUMA classe na oferta/)
    expect(semClasse).toContain("nova.mjs")
    expect(recusaDaOferta([], [])).toMatch(/não tem declaração nenhuma/)
  })
})

// ── 3. um fixer NOVO entra na oferta sem editar o remédio ─────────────────

/** A declaração de fixture cujo `detectar` ACUSA (é o que a oferta executa). */
const NOVA_DECL = `import { spawnSync } from "node:child_process"

export default {
  id: "nova",
  ordem: 900,
  script: "nova.sh",
  label: "defeito de fixture (declarado fora do remédio)",
  verde: "o defeito de fixture sumiu",
  vermelho: "o defeito de fixture continua",
  estagio: "add",
  fixer: "bash scripts/nova.sh --fix",
  sugere: () => ["bash scripts/nova.sh --fix   # remenda a ÁRVORE — REVISE o diff"],
  aplicavel: () => null,
  detectar(root) {
    const r = spawnSync("bash", ["scripts/nova.sh"], { cwd: root, encoding: "utf8" })
    return {
      offenders: ["arquivo-de-fixture.txt"],
      relatorio: \`defeito de fixture detectado (exit \${r.status})\`,
      violacoes: r.status === 0 ? 0 : 1,
    }
  },
  aplicar() {
    return { relatorio: "remendo de fixture aplicado" }
  },
}
`

describe("um fixer novo entra na oferta SEM editar o remédio", () => {
  it("a declaração + o guard dono escritos no fixture bastam: o remédio EXECUTA a classe nova", () => {
    const dir = novoRepo({ prefix: "remedy-nova-" })
    // O guard dono: acusa (exit 1) e remenda com `--fix` (exit 0).
    writeFileSync(
      join(dir, "scripts", "nova.sh"),
      '#!/usr/bin/env bash\nif [ "$1" = "--fix" ]; then exit 0; fi\nexit 1\n',
      "utf8",
    )
    declarar(dir, "nova.mjs", NOVA_DECL)
    stage(dir, ".github/workflows/ci.yml", WORKFLOW_CICATRIZ)

    const r = rodarRemedio(dir)
    // A classe declarada no FIXTURE está na oferta daquele repo: o remédio a
    // detectou, mostrou o relatório dela e o caminho à mão com o fixer dela.
    expect(r.out).toContain("defeito de fixture detectado")
    expect(r.out).toContain("`nova` — defeito de fixture")
    expect(r.out).toContain("bash scripts/nova.sh --fix")
    // ...e o remédio do REPOSITÓRIO REAL não conhece essa classe: quem a achou
    // foi a varredura do diretório, não uma lista.
    expect(CLASSES.map((c) => c.id)).not.toContain("nova")
    // A oferta do fixture é a MESMA que o remédio do fixture usou (o `-h` sai da
    // descoberta local): a classe nova aparece na ajuda DAQUELE repo.
    const ajuda = spawnSync(process.execPath, ["scripts/pre-commit-remedy.mjs", "-h"], {
      cwd: dir,
      encoding: "utf8",
    })
    expect(ajuda.stdout).toContain("nova")
    expect(USAGE).not.toContain("\n  nova ")
  })

  it("com a declaração QUEBRADA no fixture a rodada é RECUSADA (exit 2) e o commit não é julgado", () => {
    const dir = novoRepo({ prefix: "remedy-nova-quebrada-" })
    declarar(dir, "nova.mjs", "export default { id: 'nova' }\n")
    stage(dir, ".github/workflows/ci.yml", WORKFLOW_CICATRIZ)

    const r = rodarRemedio(dir)
    expect(r.status).toBe(2)
    expect(r.out).toContain("oferta de classes INCOMPLETA")
    expect(r.out).toContain("nova.mjs")
    expect(r.out).toMatch(/campo obrigatório ausente/)
    // O commit NÃO foi julgado: nenhum veredito de remendo saiu.
    expect(r.out).not.toContain("nada a remendar")
  })
})

// ── 4. o bloco da ajuda sai da MESMA oferta ───────────────────────────────

describe("a ajuda documenta a oferta que o remédio executa", () => {
  it("o bloco de classes é o `blocoClasses()` da oferta (id, label e fixer de cada uma)", () => {
    const bloco = blocoClasses(CLASSES)
    for (const c of CLASSES) {
      expect(bloco).toContain(c.id)
      expect(bloco).toContain(c.label)
      expect(bloco).toContain(c.fixer)
    }
    expect(USAGE).toContain(bloco)
  })

  it("uma classe a mais aparece no bloco — a lista não é uma string escrita à mão", () => {
    const comExtra = blocoClasses([
      ...CLASSES,
      { id: "zz-extra", label: "extra de teste", fixer: "node scripts/zz.mjs --fix" },
    ])
    expect(comExtra).toContain("zz-extra")
    expect(USAGE).not.toContain("zz-extra")
  })
})
