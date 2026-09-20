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
 *     package.json), a descida neles (`check_utf8.py` e `check_utf8.mjs`, dentro
 *     do `check-utf8.sh`) e a prova de que a BATERIA LOCAL os executa pelos
 *     runners do hook. Sem esta metade, uma descida CEGA passaria verde: nao
 *     achar sub-guard nenhum tambem nao produz violacao nenhuma.
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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
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
function daRegra4(violations: string[]): string[] {
  return violations.filter((v) => v.includes("SUB-GUARD") || v.startsWith("RUNNER_SUBGUARD:"))
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
    const runners = pipelineRunners(RAIZ, scripts)
    // O caso que uma lista por forma perderia: a pipeline nao escreve
    // `bash scripts/test-mutation-guards.sh`, escreve a ENTRADA
    // (`bun run test:mutation-guards`) — sem resolver o package.json o runner
    // mais pesado do contrato nem entraria na descida.
    expect([...runners.keys()]).toContain("scripts/test-mutation-guards.sh")
    expect([...runners.keys()]).toContain("scripts/check-utf8.sh")
    expect(runners.size).toBeGreaterThanOrEqual(12)
    // Todo runner derivado existe (o que nao existir sai como LIMITE nomeado,
    // nunca como verde silencioso).
    for (const file of runners.keys()) expect(file.endsWith(".sh")).toBe(true)
  })

  it("a descida encontra os DOIS sub-guards do check-utf8.sh (nao pode ficar cega)", () => {
    const scripts = JSON.parse(
      execFileSync("node", ["-p", "JSON.stringify(require('./package.json').scripts)"], {
        cwd: RAIZ,
        encoding: "utf8",
      }),
    )
    const descida = descendScripts(RAIZ, [...pipelineRunners(RAIZ, scripts).keys()])
    expect([...descida.alcancados.keys()].sort()).toEqual([
      "scripts/check_utf8.mjs",
      "scripts/check_utf8.py",
    ])
    // A procedencia sai no relatorio: qual runner trouxe cada sub-guard.
    expect(descida.alcancados.get("scripts/check_utf8.py")).toBe("scripts/check-utf8.sh")
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

  it("o guard inteiro sai verde, com CADA sub-guard decidido e os limites nomeados", () => {
    const report = analyze({ root: RAIZ })
    expect(report.violations).toEqual([])
    expect(report.subguards.length).toBe(2)
    for (const s of report.subguards) expect(s.decision).not.toBeNull()
    // Os limites da descida: o idioma de `SCRIPT_DIR` de alguns runners nao e
    // provavel hoje — e isso NAO some do relatorio (o numero crescer sem
    // ninguem revisar e o sinal de que a descida perdeu alcance).
    expect(report.limitesDaDescida.length).toBeGreaterThan(0)
    for (const l of report.limitesDaDescida) {
      expect(typeof l.arquivo).toBe("string")
      expect(l.motivo.length).toBeGreaterThan(20)
    }
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
