// =============================================================================
// check-pipefail-sigpipe-cobertura.test.ts
//
// A PROVA DE COBERTURA da varredura do `scripts/check-pipefail-sigpipe.mjs`.
//
// POR QUE UMA PROVA DE COBERTURA, E NÃO MAIS UM CASO: o valor do guard não é o
// que ele acusa — é o que ele NÃO acusa. Um gate que varre menos do que parece
// fica verde pelo mesmo motivo que um gate honesto: nada falhou. As classes de
// "varre menos" que este arquivo trava:
//
//   - o `- run:` INLINE com continuação: o YAML dobra `run: cmd` + as linhas
//     mais indentadas num escalar ÚNICO, e ler só a primeira linha julga o passo
//     por METADE (era o defeito: um `| grep -q` na continuação passava invisível);
//   - a chave `shell:` DEPOIS do `run:` (a ordem das chaves do passo é livre):
//     parar a leitura no `run:` lê o shell do RUNNER onde o passo declara o dele;
//   - o corpo de HEREDOC: é DADO, não sintaxe — acusá-lo seria o guard reprovando
//     os próprios fixtures do repositório;
//   - o `run:` DECLARADO com corpo VAZIO: não há o que julgar, mas ele não pode
//     SUMIR da conta (um passo que a varredura esquece em silêncio é a mesma
//     mentira de um gate que varre menos do que parece) — sai nomeado, com o
//     arquivo, a linha e o motivo;
//   - `- uses:` no meio: não é passo de shell e não pode entrar na conta.
//
// O FIXTURE É DIFERENCIAL: cada passo DECLARA o que ele é (de onde vem o shell,
// se liga pipefail, se o corpo tem a classe) e o teste cobra do guard exatamente
// isso. As contas não são números mágicos: são DERIVADAS do fixture, e é isso
// que faz a soma fechar como prova — `julgados + fora do escopo = declarados`.
//
// Sem docker, sem rede, sem executar gate: funções puras + fixtures em tmpdir.
// =============================================================================

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import { scanRoot } from "../../../scripts/check-pipefail-sigpipe.mjs"

/** De onde o guard tem de dizer que vem o shell do passo. */
type Fonte = "step" | "job-default" | "workflow-default" | "runner"

/** O contexto do diagnóstico (a EXPLICAÇÃO), derivado do passo, não do texto. */
type Contexto = "pipefail" | "shell-declared" | "shell-default"

/**
 * UM passo `run:` do fixture, com o que ele DECLARA ser — a expectativa viaja
 * junto do passo para a asserção ser diferencial (fixture diz, guard confere).
 */
type Passo = {
  nome: string
  /** A linha (1-based) da chave `run:` — o marcador do passo no arquivo. */
  run: number
  /** A última linha do passo (a chave `shell:` pode vir DEPOIS do `run:`). */
  fim: number
  fonte: Fonte
  ligaPipefail: boolean
  /** O corpo tem a classe (o guard tem de acusar)? */
  classe: boolean
  /** O diagnóstico esperado quando `classe` — a causa, não só o remédio. */
  contexto: Contexto | null
  /** O `run:` é declarado com corpo vazio (fora do escopo, e NOMEADO). */
  corpoVazio: boolean
}

type Violacao = {
  file: string
  line: number
  text: string
  suggestion: string
  context?: Contexto
}

type ResultadoScan = {
  violations: Violacao[]
  foraDoEscopo: { file: string; line: number; job: string | null; motivo: string }[]
  premissas: {
    file: string
    line: number
    scope: "workflow" | "job"
    job: string | null
    shell: string
    passos: number
  }[]
  scanned: {
    runStepsComPipefail: number
    runStepsSemPipefail: number
    passosCorpoVazio: number
    passosDoRunner: number
    passosComDefaultDeclarado: number
    passosComShellNoPasso: number
    defaultShellsEmPipefail: number
  }
}

/** Um arquivo de workflow montado linha a linha, com os passos marcados. */
type Fixture = {
  add: (...linhas: string[]) => void
  passo: (p: Omit<Passo, "run" | "fim">, run: string, ...corpo: string[]) => void
  /** A linha (1-based) da primeira ocorrência EXATA de `linha`. */
  linhaDe: (linha: string) => number
  conteudo: () => string
  passos: Passo[]
}

function fixture(): Fixture {
  const linhas: string[] = []
  const passos: Passo[] = []
  return {
    add: (...ls) => void linhas.push(...ls),
    passo: (p, run, ...corpo) => {
      const inicio = linhas.length + 1
      linhas.push(run, ...corpo)
      passos.push({ ...p, run: inicio, fim: linhas.length })
    },
    linhaDe: (linha) => {
      const idx = linhas.indexOf(linha)
      if (idx === -1) throw new Error(`o fixture não tem a linha exata: ${JSON.stringify(linha)}`)
      return idx + 1
    },
    conteudo: () => linhas.join("\n"),
    passos,
  }
}

/**
 * O WORKFLOW MISTO: `defaults:` de ARQUIVO (sem pipefail) + `defaults:` de JOB
 * (que LIGA o pipefail) + `- uses:` + `- run:` inline + `- run: |` com
 * continuação + heredoc + corpo vazio, no MESMO arquivo. Um segundo arquivo
 * cobre a chave fora de ordem e a continuação inline sem `defaults:` nenhum.
 */
function montar(root: string) {
  const ci = fixture()
  ci.add("on:", "  pull_request:")
  ci.add("defaults:", "  run:", "    shell: bash -e {0}", "jobs:")
  ci.add("  a:", "    defaults:", "      run:", "        shell: bash", "    steps:")
  // A linha que o guard tem de apontar é a da chave `shell:` do `defaults:` do job.
  const linhaDefaultDoJob = ci.linhaDe("        shell: bash")
  ci.add("      - uses: actions/checkout@v4")
  ci.passo(
    {
      nome: "job-default-inline",
      fonte: "job-default",
      ligaPipefail: true,
      classe: true,
      contexto: "pipefail",
      corpoVazio: false,
    },
    '      - run: echo "$OUT" | grep -q padrao',
  )
  ci.passo(
    {
      nome: "continuacao-em-bloco",
      fonte: "job-default",
      ligaPipefail: true,
      classe: true,
      contexto: "pipefail",
      corpoVazio: false,
    },
    "      - run: |",
    "          docker compose ps --format '{{.Names}}' \\",
    "            | grep -qi runner",
  )
  ci.passo(
    {
      nome: "heredoc-nao-julgado",
      fonte: "job-default",
      ligaPipefail: true,
      classe: false,
      contexto: null,
      corpoVazio: false,
    },
    "      - run: |",
    "          cat <<'EOF'",
    '          echo "$OUT" | grep -q padrao',
    "          EOF",
  )
  ci.passo(
    {
      nome: "corpo-vazio",
      fonte: "job-default",
      ligaPipefail: true,
      classe: false,
      contexto: null,
      corpoVazio: true,
    },
    "      - run: |",
  )
  ci.add("  b:", "    steps:")
  ci.passo(
    {
      nome: "default-de-arquivo",
      fonte: "workflow-default",
      ligaPipefail: false,
      classe: true,
      contexto: "shell-declared",
      corpoVazio: false,
    },
    "      - run: docker exec ${{ job.services.db.id }} psql -tAc 1 | grep -qx 1",
  )
  ci.passo(
    {
      nome: "limpo",
      fonte: "workflow-default",
      ligaPipefail: false,
      classe: false,
      contexto: null,
      corpoVazio: false,
    },
    "      - run: echo limpo",
  )
  ci.add(
    "      - uses: actions/cache@v4",
    "        with:",
    "          path: ~/.bun",
    "          key: x",
  )

  const outro = fixture()
  outro.add("on:", "  pull_request:", "jobs:", "  unico:", "    steps:")
  outro.passo(
    {
      nome: "shell-depois-do-run",
      fonte: "step",
      ligaPipefail: true,
      classe: true,
      contexto: "pipefail",
      corpoVazio: false,
    },
    "      - run: printf '%s' \"$X\" | grep -qc valor",
    "        shell: bash",
  )
  outro.passo(
    {
      nome: "continuacao-inline",
      fonte: "runner",
      ligaPipefail: false,
      classe: true,
      contexto: "shell-default",
      corpoVazio: false,
    },
    "      - run: docker ps \\",
    "          | grep -q runner",
  )

  const arquivos: [string, Fixture][] = [
    [".gitea/workflows/ci.yml", ci],
    [".github/workflows/outro.yml", outro],
  ]
  for (const [rel, f] of arquivos) {
    const abs = join(root, rel)
    mkdirSync(join(abs, ".."), { recursive: true })
    writeFileSync(abs, f.conteudo())
  }
  return { arquivos, linhaDefaultDoJob }
}

const tmpDirs: string[] = []

function cenario() {
  const root = mkdtempSync(join(tmpdir(), "sigpipe-cobertura-"))
  tmpDirs.push(root)
  const { arquivos, linhaDefaultDoJob } = montar(root)
  const resultado = scanRoot(root) as unknown as ResultadoScan
  /** Os passos dos dois arquivos, com o arquivo de cada um (a identidade do span). */
  const declarados = arquivos.flatMap(([rel, f]) => f.passos.map((p) => ({ rel, ...p })))
  /** As violações DENTRO do span de um passo — a atribuição, não a contagem. */
  const violacoesDe = (rel: string, p: Passo) =>
    resultado.violations.filter((v) => v.file === rel && v.line >= p.run && v.line <= p.fim)
  return { root, resultado, declarados, violacoesDe, linhaDefaultDoJob, arquivos }
}

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("a cobertura da varredura: cada passo tem DESFECHO, nenhum some", () => {
  it("o fixture realmente mistura as formas (senão a prova não prova nada)", () => {
    const { declarados } = cenario()
    const porNome = new Map(declarados.map((d) => [d.nome, d]))
    // As formas que este arquivo existe para travar, uma a uma:
    expect(porNome.get("job-default-inline")?.corpoVazio).toBe(false)
    expect(porNome.get("continuacao-em-bloco")?.fim).toBeGreaterThan(
      porNome.get("continuacao-em-bloco")!.run,
    )
    expect(porNome.get("heredoc-nao-julgado")?.classe).toBe(false)
    expect(porNome.get("corpo-vazio")?.corpoVazio).toBe(true)
    expect(porNome.get("shell-depois-do-run")?.fonte).toBe("step")
    expect(porNome.get("continuacao-inline")?.fonte).toBe("runner")
    // As TRÊS origens de shell (passo, default, runner) aparecem de fato:
    expect(new Set(declarados.map((d) => d.fonte))).toEqual(
      new Set(["step", "job-default", "workflow-default", "runner"]),
    )
  })

  it("a soma FECHA: julgados + corpo vazio = passos `run:` declarados", () => {
    const { resultado, declarados } = cenario()
    const { runStepsComPipefail, runStepsSemPipefail, passosCorpoVazio } = resultado.scanned
    const declaradosCom = declarados.length
    // O invariante que o corpo vazio quebrava: os passos que o guard NÃO julga
    // continuam na conta, nomeados — em vez de desaparecerem do total (era o
    // defeito: `- run: |` sem corpo não entrava nem na conta nem na lista, e um
    // passo a menos no denominador é um gate que varre menos do que parece).
    expect(runStepsComPipefail + runStepsSemPipefail + passosCorpoVazio).toBe(declaradosCom)
    expect(passosCorpoVazio).toBe(declarados.filter((d) => d.corpoVazio).length)
  })

  it("cada passo tem o DESFECHO que ele mesmo declara (classe achada, ou nada a julgar)", () => {
    const { resultado, declarados, violacoesDe } = cenario()
    const desfechos = declarados.map((d) => ({
      passo: d.nome,
      classe: violacoesDe(d.rel, d).length > 0,
    }))
    expect(desfechos).toEqual(declarados.map((d) => ({ passo: d.nome, classe: d.classe })))
    // Nenhum passo ficou sem DESFECHO: cada um ou tem a classe (é acusado), ou o
    // corpo não tem a classe, ou o corpo é VAZIO — e este último sai NOMEADO da
    // varredura em vez de sumir (a conta que o corpo vazio fechava por baixo).
    const semClasse = declarados.filter((d) => !d.classe)
    expect(semClasse.map((d) => d.corpoVazio).filter(Boolean)).toEqual([true])
    expect(resultado.foraDoEscopo).toHaveLength(semClasse.filter((d) => d.corpoVazio).length)
  })

  it("o corpo VAZIO fica FORA do escopo, e NOMEADO (arquivo, linha, job e motivo)", () => {
    const { resultado, declarados } = cenario()
    const vazio = declarados.find((d) => d.corpoVazio)!
    expect(resultado.foraDoEscopo).toEqual([
      {
        file: vazio.rel,
        line: vazio.run,
        job: "a",
        motivo: "corpo `run:` VAZIO — nada executa, nada a julgar",
      },
    ])
  })

  it("nenhuma violação é atribuída a uma linha que não é de um passo `run:`", () => {
    const { resultado, declarados } = cenario()
    // O `- uses:`/`with:`/`defaults:` estão entre os passos: uma violação ali
    // seria um passo FANTASMA — a mesma classe que o guard existe para fechar,
    // agora do lado do diagnóstico (apontar para o lugar errado é pior que calar).
    const fora = resultado.violations.filter(
      (v) => !declarados.some((d) => d.rel === v.file && v.line >= d.run && v.line <= d.fim),
    )
    expect(fora).toEqual([])
  })

  it("o contexto do diagnóstico é a CAUSA: pipefail, default declarado ou runner", () => {
    const { declarados, violacoesDe } = cenario()
    for (const d of declarados.filter((p) => p.classe)) {
      expect(
        violacoesDe(d.rel, d).map((v) => v.context),
        d.nome,
      ).toEqual(expect.arrayContaining([d.contexto]))
    }
    // E o `shell:` DEPOIS do `run:` é lido como do PASSO: sem isso o passo sairia
    // como "premissa do runner" — a explicação apontaria a premissa que o autor
    // justamente não está usando.
    const foraDeOrdem = declarados.find((d) => d.nome === "shell-depois-do-run")!
    expect(violacoesDe(foraDeOrdem.rel, foraDeOrdem).map((v) => v.context)).toEqual(["pipefail"])
  })
})

describe("a conta por ORIGEM do shell — a prosa do relatório vira número", () => {
  it("noPasso / porDefault / peloRunner somam o total, e cada um é o do fixture", () => {
    const { resultado, declarados } = cenario()
    const julgados = declarados.filter((d) => !d.corpoVazio)
    const { passosComShellNoPasso, passosComDefaultDeclarado, passosDoRunner } = resultado.scanned
    const esperado = (fonte: Fonte) => julgados.filter((d) => d.fonte === fonte).length
    expect(passosComShellNoPasso).toBe(esperado("step"))
    expect(passosComDefaultDeclarado).toBe(esperado("job-default") + esperado("workflow-default"))
    expect(passosDoRunner).toBe(esperado("runner"))
    expect(passosComShellNoPasso + passosComDefaultDeclarado + passosDoRunner).toBe(julgados.length)
    // A conta é um retrato do fixture, não de um guard que sempre diz o mesmo:
    expect([passosComShellNoPasso, passosComDefaultDeclarado, passosDoRunner]).toEqual([1, 5, 1])
  })

  it("`runStepsComPipefail` conta o pipefail EFETIVO (do passo e do default do job)", () => {
    const { resultado, declarados } = cenario()
    expect(resultado.scanned.runStepsComPipefail).toBe(
      declarados.filter((d) => !d.corpoVazio && d.ligaPipefail).length,
    )
    expect(resultado.scanned.runStepsSemPipefail).toBe(
      declarados.filter((d) => !d.corpoVazio && !d.ligaPipefail).length,
    )
  })

  it("a declaração que LIGA o pipefail é premissa, e sabe quantos passos reclassificou", () => {
    const { resultado, declarados, linhaDefaultDoJob } = cenario()
    const noJob = declarados.filter((d) => d.fonte === "job-default" && !d.corpoVazio)
    expect(resultado.scanned.defaultShellsEmPipefail).toBe(1)
    expect(resultado.premissas).toEqual([
      {
        file: ".gitea/workflows/ci.yml",
        line: linhaDefaultDoJob,
        scope: "job",
        job: "a",
        shell: "bash",
        passos: noJob.length,
      },
    ])
    // O default do ARQUIVO (`bash -e {0}`) NÃO é premissa: ele não liga pipefail.
    // Nomeá-lo como premissa faria o relatório acusar uma linha inofensiva.
    expect(declarados.filter((d) => d.fonte === "workflow-default").length).toBeGreaterThan(0)
  })
})

describe("as leituras que a varredura faz do TEXTO (onde ela varria pela metade)", () => {
  it("a continuação INLINE é lida INTEIRA — o passo não é julgado por metade", () => {
    const { declarados, violacoesDe } = cenario()
    const p = declarados.find((d) => d.nome === "continuacao-inline")!
    const [v] = violacoesDe(p.rel, p)
    // O corpo é o escalar DOBRADO pelo YAML (uma linha lógica), então a violação
    // sai na chave `run:` — e o remédio carrega as DUAS metades: julgar só a
    // PRIMEIRA linha lia o passo por metade e deixava o `| grep -q` invisível, que
    // é a classe que o guard fecha (medido: 0 casos no repositório hoje, e é por
    // isso que a prova precisa do fixture sintético).
    expect(v.line).toBe(p.run)
    expect(v.suggestion).toBe('grep -q runner <<< "$(docker ps)"')
    expect(v.text).toContain("docker ps")
  })

  it("a continuação em BLOCO entra junta, e a barra de linha NÃO vai para o remédio", () => {
    const { declarados, violacoesDe } = cenario()
    const p = declarados.find((d) => d.nome === "continuacao-em-bloco")!
    const [v] = violacoesDe(p.rel, p)
    // `p.run` é a linha da CHAVE `run: |`; num BLOCO o corpo começa na SEGUINTE.
    // Somar a linha da chave com a linha do corpo errava por um em todo bloco —
    // o `arquivo:linha` que o gate publica apontava para a linha de cima (é a
    // linha que o comentário do PR e o relatório do doctor mostram ao operador).
    expect(v.line).toBe(p.run + 1)
    // A `\` era a tentativa do autor de continuar em shell; o YAML a transforma
    // em `\` + quebra, e mantê-la no remédio gravaria uma barra no meio do
    // conselho (`<<< "$(docker compose ps \)"`) — um `--fix` que quebra o comando.
    expect(v.suggestion).toBe("grep -qi runner <<< \"$(docker compose ps --format '{{.Names}}')\"")
    expect(v.suggestion).not.toContain("\\")
  })

  it("o corpo de HEREDOC é DADO, não sintaxe: não vira violação do próprio fixture", () => {
    const { declarados, violacoesDe } = cenario()
    const p = declarados.find((d) => d.nome === "heredoc-nao-julgado")!
    expect(violacoesDe(p.rel, p)).toEqual([])
  })

  it("o `- uses:` NÃO é passo de shell e não entra na conta", () => {
    const { resultado, declarados } = cenario()
    const julgados = declarados.filter((d) => !d.corpoVazio).length
    // Os 3 `uses:`/`with:` do fixture estão entre os passos, e mesmo assim o
    // total é o dos passos `run:` — nenhum deles foi contado.
    expect(resultado.scanned.runStepsComPipefail + resultado.scanned.runStepsSemPipefail).toBe(
      julgados,
    )
    expect(declarados.length).toBe(8)
  })
})
