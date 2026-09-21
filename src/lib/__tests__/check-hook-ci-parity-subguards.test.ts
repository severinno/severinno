/**
 * check-hook-ci-parity-subguards.test.ts
 *
 * A REGRA 4 do `scripts/check-hook-ci-parity.mjs`: o SUB-GUARD DE UM RUNNER.
 *
 * O defeito que ela mede: quando o comando que a pipeline escreve e um RUNNER
 * (`bash scripts/x.sh`), o que ele executa por dentro nao tinha dono — o guard
 * entrava no contrato de merge e o veredito local nao o via. Duas metades:
 *
 *  1. POR MEDICAO NO REPO REAL — os runners derivados das DUAS pipelines (12
 *     hoje, incluindo o que so aparece depois de resolver a entrada do
 *     package.json), a descida neles (**oito** alcancados: os dois do
 *     `check-utf8.sh` + os seis que so aparecem depois que a regua resolve o
 *     idioma `SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"` e o alvo
 *     `node "$GUARD"` que sai dele) e a prova de que a BATERIA LOCAL os executa
 *     pelos runners do hook. Sem esta metade, uma descida CEGA passaria verde:
 *     nao achar sub-guard nenhum tambem nao produz violacao nenhuma.
 *
 *  2. POR FIXTURE — repo git temporario com hooks e pipelines minimos: sub-guard
 *     sem decisao local, sub-guard coberto direto pelo hook, sub-guard coberto
 *     PELA DESCIDA do hook, ausencia declarada com e sem razao, declaracao
 *     stale e o alvo que nao da para provar (o limite NOMEADO — "nao desci" e
 *     diferente de "nao ha o que descer").
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-hook-ci-parity-subguards.test.ts
 */

import { describe, expect, it, afterEach } from "vitest"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

import {
  HOOKS,
  PIPELINES,
  RUNNER_SUBGUARD,
  analyze,
  descendScripts,
  localBattery,
  pipelineRunners,
} from "../../../scripts/check-hook-ci-parity.mjs"
import { ehCaminhoDoRepositorio } from "../../../scripts/check-hook-commands.mjs"

const RAIZ = resolve(process.cwd())
const tmpDirs: string[] = []

afterEach(() => {
  while (tmpDirs.length > 0) rmSync(tmpDirs.pop() as string, { recursive: true, force: true })
})

/**
 * Um repo de fixture com o MINIMO que o `analyze` le: `package.json` (scripts),
 * os dois hooks e as duas pipelines. As regras 1–3 falam dos invariantes REAIS
 * do CORE (a lista e um modulo, nao uma entrada do fixture), entao elas acusam
 * o fixture inteiro — o que este arquivo julga e a REGRA 4, filtrada.
 */
function fixture({
  scripts = {},
  preCommit = "#!/usr/bin/env bash\nset -eu\n",
  prePush = "#!/usr/bin/env bash\nset -eu\n",
  gitea = "",
  github = "",
  arquivos = {},
}: {
  scripts?: Record<string, string>
  preCommit?: string
  prePush?: string
  gitea?: string
  github?: string
  arquivos?: Record<string, string>
}): string {
  const dir = mkdtempSync(join(tmpdir(), "hook-ci-parity-"))
  tmpDirs.push(dir)
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts }, null, 2))
  mkdirSync(join(dir, ".husky"), { recursive: true })
  writeFileSync(join(dir, HOOKS[0]), preCommit)
  writeFileSync(join(dir, HOOKS[1]), prePush)
  for (const [rel, content] of Object.entries({ [PIPELINES[0]]: gitea, [PIPELINES[1]]: github })) {
    mkdirSync(join(dir, dirname(rel)), { recursive: true })
    writeFileSync(join(dir, rel), content)
  }
  for (const [rel, content] of Object.entries(arquivos)) {
    mkdirSync(join(dir, dirname(rel)), { recursive: true })
    writeFileSync(join(dir, rel), content)
  }
  execFileSync("git", ["init", "-q"], { cwd: dir })
  return dir
}

/** As violacoes da REGRA 4 (as outras regras falam do fixture, nao do defeito). */
/**
 * As violacoes da REGRA 4 — sem as que a TABELA REAL produz NO FIXTURE.
 *
 * O fixture nao tem as pipelines reais, entao as entradas reais de
 * `RUNNER_SUBGUARD` aparecem nele como **stale** — um fato do FIXTURE (nenhum
 * runner dele executa aqueles arquivos), nao do repositorio, onde elas decidem
 * dois sub-guards ALCANCADOS. Elas saem por CITACAO DO ARQUIVO, e so as do estado
 * inicial: o teste da declaracao stale empurra a propria entrada e continua
 * medindo a regra nas duas direcoes.
 */
const TABELA_REAL = new Set(RUNNER_SUBGUARD.map((e) => e.file))
function daRegra4(violations: string[]): string[] {
  return violations
    .filter((v) => v.includes("SUB-GUARD") || v.startsWith("RUNNER_SUBGUARD:"))
    .filter((v) => ![...TABELA_REAL].some((f) => v.includes(`'${f}'`)))
}

const PIPELINE_COM_RUNNER = [
  "name: ci",
  "jobs:",
  "  guards:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - name: Runner com sub-guard",
  "        run: bash scripts/runner.sh",
  "",
].join("\n")

const RUNNER_COM_SUBGUARD = "#!/usr/bin/env bash\nset -eu\nnode scripts/guard-novo.mjs\n"

// ── 1. o repo REAL: a derivacao mede, e a bateria local desce ─────────────

describe("no REPO REAL: a descida alcanca os sub-guards dos runners das pipelines", () => {
  it("os runners vem das DUAS pipelines, e o que so existe como entrada do package.json entra", () => {
    const scripts = JSON.parse(
      execFileSync("node", ["-p", "JSON.stringify(require('./package.json').scripts)"], {
        cwd: RAIZ,
        encoding: "utf8",
      }),
    )
    const { runners, limites } = pipelineRunners(RAIZ, scripts)
    // O caso que uma lista por forma perderia: a pipeline nao escreve
    // `bash scripts/test-mutation-guards.sh`, escreve a ENTRADA
    // (`bun run test:mutation-guards`) — sem resolver o package.json o runner
    // mais pesado do contrato nem entraria na descida.
    expect([...runners.keys()]).toContain("scripts/test-mutation-guards.sh")
    expect([...runners.keys()]).toContain("scripts/check-utf8.sh")
    expect(runners.size).toBeGreaterThanOrEqual(12)
    // A REGUA do runner e a CLASSE do alvo (a do `check-hook-commands`), nao o
    // sufixo `.sh`: um runner sem extensao E um caminho do repositorio que o
    // interpretador le, e o sufixo era a segunda leitura que o deixava invisivel.
    for (const file of runners.keys()) {
      expect(ehCaminhoDoRepositorio(file)).toBe(true)
      expect(existsSync(join(RAIZ, file))).toBe(true)
    }
    // E o que nao da para provar sai DITO: nenhuma pipeline real tem alvo
    // irresolvivel hoje, e um alvo novo que apareca vira limite nomeado.
    expect(limites).toEqual([])
  })

  it("a descida alcanca os NOVE sub-guards (inclusive os do idioma `SCRIPT_DIR`)", () => {
    const scripts = JSON.parse(
      execFileSync("node", ["-p", "JSON.stringify(require('./package.json').scripts)"], {
        cwd: RAIZ,
        encoding: "utf8",
      }),
    )
    const descida = descendScripts(RAIZ, [...pipelineRunners(RAIZ, scripts).runners.keys()])
    expect([...descida.alcancados.keys()].sort()).toEqual([
      "scripts/audit-blob-crlf-history.sh",
      "scripts/check-bun-audit-baseline.mjs",
      "scripts/check-forge-parity.mjs",
      "scripts/check-jsdom-baseline.mjs",
      "scripts/check-unused-deps.mjs",
      "scripts/check-workflow-run-syntax.mjs",
      "scripts/check_utf8.mjs",
      "scripts/check_utf8.py",
      "scripts/metades.mjs",
    ])
    // A procedencia sai no relatorio: qual runner trouxe cada sub-guard.
    expect(descida.alcancados.get("scripts/check_utf8.py")).toBe("scripts/check-utf8.sh")
    // A REGUA das metades entra pela descida do master (ela e executada por ele),
    // e nao por ser um gate: e o que a tabela decide abaixo.
    expect(descida.alcancados.get("scripts/metades.mjs")).toBe("scripts/test-mutation-guards.sh")
  })

  it("a BATERIA LOCAL desce tambem: o hook executa os dois pelos runners dele", () => {
    const scripts = JSON.parse(
      execFileSync("node", ["-p", "JSON.stringify(require('./package.json').scripts)"], {
        cwd: RAIZ,
        encoding: "utf8",
      }),
    )
    const local = localBattery(RAIZ, scripts)
    // Sem a descida do lado local, os dois seriam "sem decisao" e a correcao
    // errada seria DECLARAR de fora o que o hook roda de dentro.
    expect(local.arquivos.has("scripts/check_utf8.py")).toBe(true)
    expect(local.arquivos.has("scripts/check_utf8.mjs")).toBe(true)
    expect(local.runners.has("scripts/run-encoding-guards.sh")).toBe(true)
    expect(local.arquivos.get("scripts/check_utf8.py")).toContain("pelo runner")
  })

  it("o guard inteiro sai verde, com CADA sub-guard decidido e os DOIS limites nomeados", () => {
    const report = analyze({ root: RAIZ })
    expect(report.violations).toEqual([])
    expect(report.subguards.length).toBe(9)
    for (const s of report.subguards) expect(s.decision).not.toBeNull()
    // Os DOIS limites que sobraram, nomeados um a um: os bloqueios que NAO sao o
    // idioma do `SCRIPT_DIR` (esse deixou de ser limite quando a regua passou a
    // resolve-lo — eram 18). Sao eles a variavel de laco do master
    // (`${rest#*|}`, montada em runtime) e o `bash -n` sobre um arquivo
    // TEMPORARIO, que nao e caminho do repositorio. Um TERCEIRO limite aqui e a
    // descida perdendo alcance, e e isso que este teste pega.
    // O ARQUIVO de cada limite e o que se cobra (a LINHA muda a cada edicao da
    // suite e nao acrescenta defesa: o que protege o alcance e o numero e o dono).
    expect(report.limitesDaDescida.map((l) => l.arquivo).sort()).toEqual([
      "scripts/test-mutation-guards.sh",
      "scripts/test-mutation-workflow-run-syntax.sh",
    ])
    for (const l of report.limitesDaDescida) expect(l.linha).toBeGreaterThan(0)
    for (const l of report.limitesDaDescida) expect(l.motivo.length).toBeGreaterThan(20)
    // E o motivo de CADA um e a CLASSE do que nao deu para provar — nao um
    // generico "nao e um arquivo do repositorio": o `${entry#*|}` e uma
    // referencia que a regua nao resolve, e o `bash -n` recebe um arquivo que
    // ele SO NAO EXECUTA (a leitura de antes acusava o alvo de nao existir no
    // repositorio, o que era falso: o arquivo esta ali, atras do flag).
    const porArquivo = new Map(report.limitesDaDescida.map((l) => [l.arquivo, l.motivo]))
    expect(porArquivo.get("scripts/test-mutation-workflow-run-syntax.sh")).toContain(
      "CONFERE a sintaxe",
    )
    expect(porArquivo.get("scripts/test-mutation-guards.sh")).toContain("não resolve")
  })
})

// ── 2. por fixture: a decisao local e exigida (e conferida nos dois sentidos) ──

describe("o sub-guard de um runner exige decisao local", () => {
  it("sub-guard sem decisao nenhuma: VIOLACAO nomeando o arquivo, o runner e o comando do CI", () => {
    const dir = fixture({
      gitea: PIPELINE_COM_RUNNER,
      github: PIPELINE_COM_RUNNER,
      arquivos: {
        "scripts/runner.sh": RUNNER_COM_SUBGUARD,
        "scripts/guard-novo.mjs": "// guard\n",
      },
    })
    const v = daRegra4(analyze({ root: dir }).violations)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("scripts/guard-novo.mjs")
    expect(v[0]).toContain("scripts/runner.sh")
    expect(v[0]).toContain("bash scripts/runner.sh")
    expect(v[0]).toContain("RUNNER_SUBGUARD")
  })

  it("o hook executando o sub-guard DIRETO decide (a paridade mais forte)", () => {
    const dir = fixture({
      preCommit: "#!/usr/bin/env bash\nset -eu\nnode scripts/guard-novo.mjs\n",
      gitea: PIPELINE_COM_RUNNER,
      github: PIPELINE_COM_RUNNER,
      arquivos: {
        "scripts/runner.sh": RUNNER_COM_SUBGUARD,
        "scripts/guard-novo.mjs": "// guard\n",
      },
    })
    const report = analyze({ root: dir })
    expect(daRegra4(report.violations)).toEqual([])
    expect(report.subguards[0].decision).toContain("executado direto")
  })

  it("o hook executando um RUNNER que o chama decide tambem (a descida do lado local)", () => {
    const dir = fixture({
      preCommit: "#!/usr/bin/env bash\nset -eu\nbash scripts/runner-local.sh\n",
      gitea: PIPELINE_COM_RUNNER,
      github: PIPELINE_COM_RUNNER,
      arquivos: {
        "scripts/runner.sh": RUNNER_COM_SUBGUARD,
        "scripts/runner-local.sh": "#!/usr/bin/env bash\nset -eu\nnode scripts/guard-novo.mjs\n",
        "scripts/guard-novo.mjs": "// guard\n",
      },
    })
    const report = analyze({ root: dir })
    expect(daRegra4(report.violations)).toEqual([])
    expect(report.subguards[0].decision).toContain("pelo runner scripts/runner-local.sh")
  })

  it("a ausencia DECLARADA decide — e a declaracao sem razao escrita nao vale", () => {
    const base = {
      gitea: PIPELINE_COM_RUNNER,
      github: PIPELINE_COM_RUNNER,
      arquivos: {
        "scripts/runner.sh": RUNNER_COM_SUBGUARD,
        "scripts/guard-novo.mjs": "// guard\n",
      },
    }
    RUNNER_SUBGUARD.push({
      file: "scripts/guard-novo.mjs",
      why: "e uma prova de mutacao que so roda no job do CI: o hook nao pode paga-la por commit (medido: 4min).",
    })
    try {
      const report = analyze({ root: fixture(base) })
      expect(daRegra4(report.violations)).toEqual([])
      expect(report.subguards[0].decision).toBe("RUNNER_SUBGUARD")
    } finally {
      RUNNER_SUBGUARD.pop()
    }
    RUNNER_SUBGUARD.push({ file: "scripts/guard-novo.mjs", why: "curta" })
    try {
      const v = daRegra4(analyze({ root: fixture(base) }).violations)
      expect(v.some((x) => x.includes("sem razao escrita"))).toBe(true)
    } finally {
      RUNNER_SUBGUARD.pop()
    }
  })

  it("declaracao STALE (nenhum sub-guard alcancado a usa) e violacao", () => {
    RUNNER_SUBGUARD.push({
      file: "scripts/guard-que-nao-existe-mais.mjs",
      why: "declaracao que envelheceu: o runner deixou de executa-lo e a ausencia seguia autorizada por escrito.",
    })
    try {
      const dir = fixture({
        gitea: PIPELINE_COM_RUNNER,
        github: PIPELINE_COM_RUNNER,
        arquivos: {
          "scripts/runner.sh": RUNNER_COM_SUBGUARD,
          "scripts/guard-novo.mjs": "// guard\n",
        },
      })
      const v = daRegra4(analyze({ root: dir }).violations)
      expect(v.some((x) => x.includes("nao e sub-guard de nenhum runner"))).toBe(true)
    } finally {
      RUNNER_SUBGUARD.pop()
    }
  })

  it('o idioma `SCRIPT_DIR=$(cd $(dirname $0)/..)` PROVA o alvo de `node "$GUARD"`', () => {
    // O defeito de LEITURA que a regua fechou: enquanto o valor do idioma era
    // uma substituicao de comando, o `node "$GUARD"` de dentro do runner saia
    // como limite nomeado — o guard que ele executa ficava invisivel para a
    // decisao local (e o `GUARD="$GUARD"` do PREFIXO DE AMBIENTE, que a casa usa
    // para passar o caminho ao script de mutacao, era lido como CICLO).
    const dir = fixture({
      gitea: PIPELINE_COM_RUNNER,
      github: PIPELINE_COM_RUNNER,
      arquivos: {
        "scripts/runner.sh": [
          "#!/usr/bin/env bash",
          "set -eu",
          'SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"',
          'GUARD="$SCRIPT_DIR/scripts/guard-novo.mjs"',
          'GUARD="$GUARD" ALVO="" python3 - <<PY',
          "print(1)",
          "PY",
          'node "$GUARD"',
          "",
        ].join("\n"),
        "scripts/guard-novo.mjs": "// guard\n",
      },
    })
    const report = analyze({ root: dir })
    // PROVADO: o alvo entra na descida e exige decisao local (a violacao o
    // NOMEIA), e nenhum limite sobra por causa do idioma ou do prefixo.
    const v = daRegra4(report.violations)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("scripts/guard-novo.mjs")
    expect(report.subguards.some((s) => s.file === "scripts/guard-novo.mjs")).toBe(true)
    expect(report.limitesDaDescida).toEqual([])
  })

  it("o alvo que nao da para provar sai como LIMITE NOMEADO (nao como verde)", () => {
    const dir = fixture({
      gitea: PIPELINE_COM_RUNNER,
      github: PIPELINE_COM_RUNNER,
      arquivos: {
        "scripts/runner.sh": '#!/usr/bin/env bash\nset -eu\nbash "$ALVO"\n',
      },
    })
    const report = analyze({ root: dir })
    expect(daRegra4(report.violations)).toEqual([])
    expect(report.limitesDaDescida.length).toBe(1)
    expect(report.limitesDaDescida[0].arquivo).toBe("scripts/runner.sh")
    // O motivo cita a variavel que nao deu para provar (a regua vem do dono).
    expect(report.limitesDaDescida[0].motivo).toContain("ALVO")
  })

  it("runner que a pipeline chama e nao existe: limite nomeado (nao se desce o que nao se leu)", () => {
    const dir = fixture({ gitea: PIPELINE_COM_RUNNER, github: PIPELINE_COM_RUNNER })
    const report = analyze({ root: dir })
    expect(daRegra4(report.violations)).toEqual([])
    expect(report.limitesDaDescida.some((l) => l.arquivo === "scripts/runner.sh")).toBe(true)
  })
})

// ── 3. a CLASSE do alvo na descida (a mesma regua do check-hook-commands) ─────
//
// A leitura de antes era inline e por FORMA (`endsWith(".sh")`,
// `startsWith("/")`, `includes("$")`): um runner sem sufixo e um alvo com FLAG
// na frente ficavam invisiveis (nem runner, nem limite), e um GLOB virava runner
// com um limite que AFIRMAVA "o arquivo nao existe neste checkout". A regua
// passou a ser a CLASSE do alvo, do dono dela, nos DOIS sentidos: o que E
// caminho do repositorio desce, e o que nao da para provar sai NOMEADO com a
// classe (ou com o motivo do flag), em vez de sumir.

describe("a descida le o alvo pela CLASSE (a mesma regua do check-hook-commands)", () => {
  const pipeline = (comando: string): string =>
    [
      "name: ci",
      "jobs:",
      "  guards:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - name: o alvo",
      `        run: ${comando}`,
      "",
    ].join("\n")

  /** O sub-guard que o runner executai por dentro (o que exige decisao local). */
  const COM_SUBGUARD = "#!/usr/bin/env bash\nset -eu\nnode scripts/guard-novo.mjs\n"
  const ARQUIVOS = { "scripts/guard-novo.mjs": "// guard\n" }

  it("o runner SEM sufixo `.sh` entra na descida (o sufixo era uma segunda regua)", () => {
    const dir = fixture({
      gitea: pipeline("bash scripts/runner-sem-sufixo"),
      github: pipeline("bash scripts/runner-sem-sufixo"),
      arquivos: {
        // Sem extensao: quem confirma que da para ler como shell e o SHEBANG.
        "scripts/runner-sem-sufixo": COM_SUBGUARD,
        ...ARQUIVOS,
      },
    })
    const report = analyze({ root: dir })
    expect(report.runners.map((r) => r.file)).toEqual(["scripts/runner-sem-sufixo"])
    expect(report.subguards.map((s) => s.file)).toEqual(["scripts/guard-novo.mjs"])
    // E o sub-guard alcancado EXIGE decisao local (a violacao o nomeia).
    const v = daRegra4(report.violations)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("scripts/guard-novo.mjs")
    expect(report.limitesDaDescida).toEqual([])
  })

  it("o alvo com FLAG que EXECUTA (`bash -u x.sh`) desce: o alvo e o arquivo, nao o flag", () => {
    const dir = fixture({
      gitea: pipeline("bash -u scripts/runner.sh"),
      github: pipeline("bash -u scripts/runner.sh"),
      arquivos: { "scripts/runner.sh": COM_SUBGUARD, ...ARQUIVOS },
    })
    const report = analyze({ root: dir })
    expect(report.runners.map((r) => r.file)).toEqual(["scripts/runner.sh"])
    expect(report.subguards.map((s) => s.file)).toEqual(["scripts/guard-novo.mjs"])
    expect(report.limitesDaDescida).toEqual([])
  })

  it("`bash -n x.sh` NAO desce, e o limite DIZ por que (o arquivo nao e executado)", () => {
    const dir = fixture({
      gitea: pipeline("bash -n scripts/runner.sh"),
      github: pipeline("bash -n scripts/runner.sh"),
      arquivos: { "scripts/runner.sh": COM_SUBGUARD, ...ARQUIVOS },
    })
    const report = analyze({ root: dir })
    // Nao desce — e nao porque o alvo "nao e um arquivo do repositorio": ele E,
    // e o que muda e o `-n`, que so confere a sintaxe.
    expect(report.runners).toEqual([])
    expect(report.subguards).toEqual([])
    expect(report.limitesDaDescida.length).toBe(2)
    for (const l of report.limitesDaDescida) expect(l.motivo).toContain("CONFERE a sintaxe")
  })

  it("o GLOB e o ABSOLUTO saem como limite NOMEADO com a CLASSE (nunca runner falso)", () => {
    const casos: [string, string][] = [
      ["bash scripts/*.sh", "padrao"],
      ["bash /opt/tool.sh", "absoluto"],
    ]
    for (const [comando, classe] of casos) {
      const dir = fixture({ gitea: pipeline(comando), github: pipeline(comando) })
      const report = analyze({ root: dir })
      // A leitura de antes criava um runner `scripts/*.sh` (que "nao existe") e
      // um arquivo de bateria `/opt/tool.sh` — dois fatos falsos.
      expect(report.runners).toEqual([])
      expect(report.bateriaLocal.arquivos).toEqual([])
      expect(report.limitesDaDescida).toHaveLength(2)
      for (const l of report.limitesDaDescida) expect(l.motivo).toContain(classe)
    }
  })

  it("o alvo em `$VAR` do HOOK vira o valor PROVADO (e nao o texto da variavel)", () => {
    const dir = fixture({
      preCommit: '#!/usr/bin/env bash\nset -eu\nRUNNER=scripts/hrunner.sh\nbash "$RUNNER"\n',
      arquivos: { "scripts/hrunner.sh": COM_SUBGUARD, ...ARQUIVOS },
    })
    const local = localBattery(dir, {})
    expect([...local.runners.keys()]).toEqual(["scripts/hrunner.sh"])
    expect([...local.arquivos.keys()]).toContain("scripts/hrunner.sh")
    // O sujeito NAO e o texto da variavel: uma entrada `$RUNNER` aqui afirmaria
    // que o hook executa um arquivo chamado literalmente `$RUNNER`.
    expect([...local.arquivos.keys()]).not.toContain("$RUNNER")
  })
})
