/**
 * check-contract-pairs.test.ts
 *
 * Testes do scripts/check-contract-pairs.mjs — o guard PARAMETRIZÁVEL por
 * pares arquivo↔marker que valida CONTRATOS DUPLICADOS do repo (padrão
 * check-mutation-timing-contract.mjs generalizado). Cada contrato declara um
 * literal que DEVE ser consistente entre vários arquivos:
 *
 *   mode "equal"    — { file, regex com 1 grupo } × N; o valor capturado deve
 *                     ser o MESMO em todos os pares (zero matches = violação)
 *   mode "contains" — marker + files[]; o marcador deve existir em todos
 *
 * Contratos reais wireados no CONTRACTS do guard:
 *   1-3. BUDGET_MAX=240 / --warn-median 4 / --warn-margin 0.2 do mutation
 *        test ↔ --max/--warn-median/--warn-margin dos jobs do CI (pr-check +
 *        benchmark-weekly) — mode "equal" (regexes escopo-delimitadas pela
 *        invocação do medidor para não casar --max de outros jobs)
 *   4-5. markers tier-1 'Usando Bun pré-instalado' / 'Use pre-installed Bun
 *        (fast path)' (action setup-bun ↔ check-tier1-fastpath) — contains
 *
 * Cobre (padrão dos testes de guards — funções puras + CLI real):
 *   - extractPairValues: 1 match, N matches (regex sem /g), 0 matches
 *   - checkEqualContract: consistente; DRIFT de valor; zero matches;
 *     arquivo não lido (fail-closed); múltiplos matches mesmo valor
 *   - checkContainsContract: presente; AUSENTE num arquivo
 *   - checkContractPairs: agregação com prefixo do nome do contrato
 *   - contractFiles: dedupe de paths (contains + equal)
 *   - CLI real --root: fixture consistente → exit 0; drift → exit 1;
 *     arquivo ausente → exit 2; --root sem valor → exit 2
 */

import { describe, it, expect, afterEach } from "vitest"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  extractPairValues,
  checkEqualContract,
  checkContainsContract,
  checkContractPairs,
  contractFiles,
  CONTRACTS,
} from "../../../scripts/check-contract-pairs.mjs"

const SCRIPT = resolve(process.cwd(), "scripts/check-contract-pairs.mjs")
const tmpDirs: string[] = []

/** Escreve um fixture mínimo com TODOS os arquivos referenciados pelos
 * contratos (o --root real lê os paths do CONTRACTS).
 *
 * Semântica: o MUTATION TEST (scripts/test-mutation-timing-budget.sh) é a
 * FONTE DA VERDADE — recebe os valores parametrizados; os WORKFLOWS sempre
 * gravam os DEFAULTS (240/4/0.2). Assim `writeFixture(dir, { budgetMax:
 * "300" })` produz DRIFT real (script 300 vs workflows 240) — o cenário
 * que o guard deve acusar. `writeFixture(dir, {})` = tudo consistente. */
function writeFixture(
  dir: string,
  values: {
    budgetMax?: string
    warnMedian?: string
    warnMargin?: string
    tier1Marker?: boolean
    tier1Step?: boolean
  },
): void {
  const {
    budgetMax = "240",
    warnMedian = "4",
    warnMargin = "0.2",
    tier1Marker = true,
    tier1Step = true,
  } = values
  mkdirSync(join(dir, "scripts"), { recursive: true })
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true })
  mkdirSync(join(dir, ".github", "actions", "setup-bun"), { recursive: true })
  writeFileSync(
    join(dir, "scripts", "test-mutation-timing-budget.sh"),
    `BUDGET_MAX=${budgetMax}\nBUDGET_WARN=180\nBUDGET_ALERT=100\nRUN_ARGS="--max ${budgetMax} --warn-median ${warnMedian} --warn-margin ${warnMargin}"\n`,
    "utf8",
  )
  writeFileSync(
    join(dir, ".github", "workflows", "pr-check.yml"),
    `      - name: Guard mutation coord timing (act log)\n        run: |\n          node scripts/measure-mutation-timing.mjs \\\n            --act-log /tmp/act.log \\\n            --max 240 \\\n            --warn-median 4 \\\n            --warn-margin 0.2 \\\n            --act-exit 0\n`,
    "utf8",
  )
  writeFileSync(
    join(dir, ".github", "workflows", "benchmark-weekly.yml"),
    `        run: |\n          node scripts/measure-mutation-timing.mjs \\\n            --run 1 \\\n            --max 240 \\\n            --warn-median 4 \\\n            --warn-margin 0.2 \\\n            --json /tmp/mutation-timing.json\n\n      - name: Guard warm cache (limiar 10s)\n        run: |\n          node scripts/check-setup-bun-warm.mjs \\\n            --max 10\n`,
    "utf8",
  )
  writeFileSync(
    join(dir, ".github", "actions", "setup-bun", "action.yml"),
    `    - name: Detect pre-installed Bun\n    - name: Use pre-installed Bun (fast path)\n        run: echo "✅ Usando Bun pré-instalado: $(bun --version) (0s, sem download)"\n`,
    "utf8",
  )
  writeFileSync(
    join(dir, "scripts", "check-tier1-fastpath.mjs"),
    `export function parseMarkerVersion(line) {\n  const m = String(line).match(/Usando Bun pré-instalado:\\s*([\\d.]+)/)\n  return m ? m[1] : null\n}\nexport function findFastPathLine(lines) {\n  return lines.find((l) => l.includes("Success - Main Use pre-installed Bun (fast path)"))\n}\n`,
    "utf8",
  )
  // tokens configuráveis para os testes de drift do contains
  if (!tier1Marker) {
    writeFileSync(join(dir, "scripts", "check-tier1-fastpath.mjs"), "export const x = 1\n", "utf8")
  }
  if (!tier1Step) {
    writeFileSync(
      join(dir, ".github", "actions", "setup-bun", "action.yml"),
      `    - name: Detect pre-installed Bun\n    - name: Use instaled Bun (renamed)\n`,
      "utf8",
    )
  }
}

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "ccp-unit-"))
  tmpDirs.push(dir)
  return dir
}

function runCli(cwd: string, args: string[] = []): { status: number | null; out: string } {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` }
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("extractPairValues", () => {
  it("extrai 1 valor do grupo 1", () => {
    expect(extractPairValues("BUDGET_MAX=240", /BUDGET_MAX=(\d+)/)).toEqual(["240"])
  })

  it("extrai N matches (regex sem /g vira global internamente)", () => {
    expect(extractPairValues("--max 240\n--max 240", /--max (\d+)/)).toEqual(["240", "240"])
  })

  it("0 matches → array vazio (violação de 'literal sumiu')", () => {
    expect(extractPairValues("BUDGET_MAX=240", /--max (\d+)/)).toEqual([])
  })

  it("ignora grupos ausentes (undefined)", () => {
    expect(extractPairValues("foo", /bar/)).toEqual([])
  })
})

describe("checkEqualContract", () => {
  const base = {
    name: "test",
    mode: "equal" as const,
    pairs: [
      { file: "a.sh", regex: /BUDGET_MAX=(\d+)/ },
      { file: "b.yml", regex: /--max (\d+)/ },
    ],
  }

  it("consistente (mesmo valor nos pares) → sem violações", () => {
    const vs = checkEqualContract(base, { "a.sh": "BUDGET_MAX=240", "b.yml": "--max 240" })
    expect(vs).toEqual([])
  })

  it("DRIFT de valor entre os pares → violação com os valores de cada arquivo", () => {
    const vs = checkEqualContract(base, { "a.sh": "BUDGET_MAX=240", "b.yml": "--max 300" })
    expect(vs).toHaveLength(1)
    expect(vs[0]).toContain("DIVERGEM")
    expect(vs[0]).toContain("'a.sh'=[240]")
    expect(vs[0]).toContain("'b.yml'=[300]")
  })

  it("zero matches num arquivo → violação de literal removido/renomeado", () => {
    const vs = checkEqualContract(base, { "a.sh": "BUDGET_MAX=240", "b.yml": "no max here" })
    expect(vs).toHaveLength(1)
    expect(vs[0]).toContain("não encontrado em b.yml")
  })

  it("arquivo não lido (conteúdo vazio) → fail-closed", () => {
    const vs = checkEqualContract(base, { "a.sh": "BUDGET_MAX=240" })
    expect(vs).toHaveLength(1)
    expect(vs[0]).toContain("não lido")
  })

  it("múltiplos matches com o MESMO valor → consistente", () => {
    const multi = {
      name: "t",
      mode: "equal" as const,
      pairs: [{ file: "b.yml", regex: /--max (\d+)/ }],
    }
    expect(checkEqualContract(multi, { "b.yml": "--max 240\n--max 240" })).toEqual([])
  })
})

describe("checkContainsContract", () => {
  const base = {
    name: "test",
    mode: "contains" as const,
    marker: "Usando Bun pré-instalado",
    files: ["action.yml", "guard.mjs"],
  }

  it("marcador presente em todos os arquivos → sem violações", () => {
    const vs = checkContainsContract(base, {
      "action.yml": 'echo "✅ Usando Bun pré-instalado: 1.2.3"',
      "guard.mjs": "match(/Usando Bun pré-instalado:/)",
    })
    expect(vs).toEqual([])
  })

  it("marcador AUSENTE num arquivo → violação citando o arquivo", () => {
    const vs = checkContainsContract(base, {
      "action.yml": 'echo "✅ Usando Bun pré-instalado: 1.2.3"',
      "guard.mjs": "export const x = 1",
    })
    expect(vs).toHaveLength(1)
    expect(vs[0]).toContain("AUSENTE em guard.mjs")
  })
})

describe("checkContractPairs + contractFiles", () => {
  it("agrega violações com o prefixo do nome do contrato", () => {
    const contracts = [
      {
        name: "ct-equal",
        mode: "equal" as const,
        pairs: [{ file: "a.sh", regex: /BUDGET_MAX=(\d+)/ }],
      },
      { name: "ct-contains", mode: "contains" as const, marker: "X", files: ["b.yml"] },
    ]
    // a.sh SEM o literal → o equal também viola (padrão não encontrado) —
    // os DOIS modos produzem violação com prefixo do nome do contrato.
    const vs = checkContractPairs(contracts, { "a.sh": "BUDGET_MAX=x", "b.yml": "no marker" })
    expect(vs).toHaveLength(2)
    expect(vs[0]).toContain("[ct-equal]")
    expect(vs[1]).toContain("[ct-contains]")
  })

  it("contractFiles dedupe paths de contains e equal", () => {
    expect(contractFiles()).toContain("scripts/test-mutation-timing-budget.sh")
    expect(contractFiles()).toContain(".github/actions/setup-bun/action.yml")
    expect(new Set(contractFiles()).size).toBe(contractFiles().length)
  })
})

describe("CLI real --root", () => {
  it("exit 0: fixture consistente (todos os 5 contratos)", () => {
    const dir = makeRoot()
    writeFixture(dir, {})
    const { status, out } = runCli(dir, ["--root", dir])
    expect(status).toBe(0)
    expect(out).toContain("5 contratos duplicados consistentes")
  })

  it("exit 1: DRIFT do BUDGET_MAX (240 vs 300) — o --max 10 do warm cache não atrapalha", () => {
    const dir = makeRoot()
    writeFixture(dir, { budgetMax: "300" })
    const { status, out } = runCli(dir, ["--root", dir])
    expect(status).toBe(1)
    expect(out).toContain("[budget duro do mutation-coord")
    expect(out).toContain("DIVERGEM")
  })

  it("exit 1: DRIFT do warn-margin (0.2 vs 0.5)", () => {
    const dir = makeRoot()
    writeFixture(dir, { warnMargin: "0.5" })
    const { status, out } = runCli(dir, ["--root", dir])
    expect(status).toBe(1)
    expect(out).toContain("[margem da mediana do mutation-coord")
  })

  it("exit 1: marker tier-1 renomeado no guard → contains falha", () => {
    const dir = makeRoot()
    writeFixture(dir, { tier1Marker: false })
    const { status, out } = runCli(dir, ["--root", dir])
    expect(status).toBe(1)
    expect(out).toContain("AUSENTE em scripts/check-tier1-fastpath.mjs")
  })

  it("exit 1: step tier-1 renomeado na action → contains falha", () => {
    const dir = makeRoot()
    writeFixture(dir, { tier1Step: false })
    const { status, out } = runCli(dir, ["--root", dir])
    expect(status).toBe(1)
    expect(out).toContain("AUSENTE em .github/actions/setup-bun/action.yml")
  })

  it("exit 2: arquivo do contrato ausente no fixture → fail-closed", () => {
    const dir = makeRoot()
    mkdirSync(join(dir, "scripts"), { recursive: true })
    writeFileSync(join(dir, "scripts", "test-mutation-timing-budget.sh"), "BUDGET_MAX=240", "utf8")
    const { status, out } = runCli(dir, ["--root", dir])
    expect(status).toBe(2)
    expect(out).toContain("ausente em")
  })

  it("exit 2: --root sem valor", () => {
    const dir = makeRoot()
    const { status, out } = runCli(dir, ["--root"])
    expect(status).toBe(2)
    expect(out).toContain("--root exige um caminho")
  })
})

describe("CONTRACTS reais — shape (o conteúdo é validado pelo guard real no CI)", () => {
  it("cada contrato equal tem pairs com file + regex; contains tem marker + files", () => {
    for (const c of CONTRACTS) {
      expect(c.name.length).toBeGreaterThan(0)
      if (c.mode === "contains") {
        expect(c.marker.length).toBeGreaterThan(0)
        expect(c.files.length).toBeGreaterThanOrEqual(2)
      } else {
        expect(c.pairs.length).toBeGreaterThanOrEqual(2)
        for (const p of c.pairs) {
          expect(p.file.length).toBeGreaterThan(0)
          expect(p.regex).toBeInstanceOf(RegExp)
        }
      }
    }
  })

  it("os 3 contratos equal do mutation-coord compartilham os MESMOS 3 arquivos", () => {
    const equals = CONTRACTS.filter(
      (c): c is Extract<(typeof CONTRACTS)[number], { mode: "equal" }> => c.mode === "equal",
    )
    expect(equals).toHaveLength(3)
    const files = equals.map((c) => c.pairs.map((p) => p.file).join("|"))
    expect(new Set(files).size).toBe(1)
  })
})
