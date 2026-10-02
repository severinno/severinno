/**
 * bench-guard-timing-mutations.test.ts
 *
 * Trava o CONTRATO da família `mutations` do `bench-guard-timing.mjs`: o custo de
 * CADA sub-test do master de mutação (`scripts/test-mutation-guards.sh`), que
 * passou a ser MEDIDO pelo próprio master (`--json`) e VERSIONADO na baseline —
 * em vez de um job cujo custo alguém compunha à mão.
 *
 * O QUE ESTE TESTE PROTEGE (e o que o número versionado passa a afirmar):
 *   1. o comando medido é o do JOB (derivado das duas pipelines), e o modo máquina
 *      é o `--json` do master — não uma variação que só o benchmark conhece;
 *   2. cada sub-test vira uma FORMA com o id dele (o papel que a comparação casa),
 *      o ms, o exit e as metades — e o harness sai da diferença entre o total do
 *      master e a soma dos sub-tests, não de uma constante;
 *   3. fail-closed: sem o JSON (comando que não termina, saída ilegível, matriz
 *      vazia) a família é NÃO MEDIDA com o motivo — nunca uma lista vazia que
 *      passaria por "nenhum sub-test custa nada";
 *   4. o master VERMELHO ainda é medido (o `--json` sai antes do veredito) e o
 *      contrato acusa: sub-test que não passou, sub-test sem metades declaradas e
 *      a conta que não fecha (total menor que a soma);
 *   5. na comparação, o sub-test NOVO entra com o ms MEDIDO (forma nova) e um
 *      sub-test que não passou não julga custo nenhum;
 *   6. a baseline versionada carrega a família sub-test a sub-test, com o ato e o
 *      commit de origem;
 *   7. o modelo de latência deriva o passo do master DESTA medição (e não deriva
 *      nada quando a família não está no arquivo).
 *
 * Execução focada:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/bench-guard-timing-mutations.test.ts
 */

import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  FAMILY_MEASURED,
  LATEST_FILE,
  MUTATION_CMD,
  MUTATION_MASTER_CMD,
  REUSED_FAMILY_LABELS,
  comMetadesDaMatriz,
  compareTimings,
  familyProvenance,
  measureMutationCost,
  mutationCostViolations,
  mutationWhatItAdded,
  parseOnly,
  reuseFamilies,
} from "../../../scripts/bench-guard-timing.mjs"
import {
  MASTER_DOS_SUBTESTS,
  mapaDoMaster,
  metadesDaMatriz,
  origemDoRegistro,
} from "../../../scripts/bench-families.mjs"
import { comparaComOAto, run as runCountGuard } from "../../../scripts/check-mutation-count.mjs"
import { benchIndex, instrumentKey } from "../../../scripts/merge-latency.mjs"

const REPO_ROOT = join(__dirname, "..", "..", "..")

const jsonDo = (rel: string) => JSON.parse(readFileSync(join(REPO_ROOT, rel), "utf8"))

// ── O fixture de um master: o JSON que o `--json` publica ─────────────────

type Subtest = {
  id: string
  script: string
  ms: number
  exit: number
  metades: number
  /** Os campos da RE-MEDIÇÃO: um fixture sem eles é o master de ANTES da régua. */
  tentativas?: number
  exit1?: number
  exit2?: number | null
  ms1?: number
  ms2?: number | null
  flake?: boolean
  /**
   * A classe INFRA: NENHUMA tentativa mediu (exit 2 declarado pela suíte,
   * 126/127). O fixture publica o mesmo que o master real, senão o teste mediria
   * um master que não existe.
   */
  infra?: boolean
}

/**
 * A forma do que a família publica — o contrato tipado que o `--json` da baseline
 * carrega. O `measureMutationCost` devolve `object` na JSDoc (o arquivo é `.mjs`,
 * importado sem tipos gerados), então o teste declara a forma que ele AFIRMA e faz
 * a asserção contra ela: um campo renomeado no guard quebra aqui, não em silêncio.
 */
type FormaMedida = {
  role: string
  label: string
  ms: number
  exit: number
  metades: number
  ok: boolean
  tentativas: number
  exit1: number
  exit2: number | null
  ms1: number
  ms2: number | null
  flake: boolean
  /** A suíte NÃO mediu (exit 2/126/127): não é verde nem vermelha. */
  infra: boolean
  runs: { ms: number; exit: number | null; ok: boolean }[]
}
type Deltas = {
  subtestsMs: number
  harnessMs: number
  totalMs: number
  wallMs: number
  proximoSubtestProjetadoMs: number
  maisCaro: string | null
  maisCaroMs: number | null
  medianaMs: number | null
}
type Medicao = {
  measured: boolean
  reason: string | null
  cmd: string
  exit: number | null
  wallMs: number
  subtests: number
  metades: number
  forms: FormaMedida[]
  deltas: Deltas | null
  violations: string[]
  whatItAdded: string[]
  /** Quantas TENTATIVAS a matriz pagou no total (uma re-medição por vermelho). */
  tentativas: number
  /** Os ids das formas que se contradisseram entre duas medições da MESMA árvore. */
  flakes: string[]
  /** Os ids das formas que NÃO mediram (exit 2/126/127) — a classe INFRA. */
  infra: string[]
}

/** A mesma coisa para a comparação (`forms` sai como `object[]` na JSDoc). */
type FormaCmp = {
  kind: string
  label: string
  currentMs: number | null
  baselineMs: number | null
  deltaMs: number | null
  pct: number | null
  isNew: boolean
  unmeasured: boolean
  regression: boolean
}
const comparar = (current: object, baseline: object) =>
  compareTimings(current as never, baseline as never) as unknown as {
    measured: boolean
    reason: string | null
    forms: FormaCmp[]
  }

/**
 * Um master de mentira: um arquivo com o JSON e o `cmd` que o imprime (`cat`).
 *
 * O `measureMutationCost` roda `bash -c <cmd>` no repositório, então o fixture é
 * o MESMO caminho do de verdade (spawn + stdio + parse), sem pagar os ~4min da
 * matriz real.
 */
function masterFalso(subtests: Subtest[], { falha = null as string | null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bench-mut-"))
  const subtestsMs = subtests.reduce((acc, s) => acc + s.ms, 0)
  const summary = {
    count: subtests.length,
    // O FLAKE não conta como passado NEM como falhado no master (é a classe que
    // se contradiz): o fixture publica o mesmo que ele, senão o teste mediria um
    // master que não existe.
    passed: subtests.filter((s) => s.exit === 0 && s.flake !== true).length,
    failed: subtests.filter((s) => s.exit !== 0).map((s) => s.id),
    flakes: subtests.filter((s) => s.flake === true).map((s) => s.id),
    // A INFRA é a classe que NÃO mediu — publicada à parte dos dois lados (nem
    // passou nem falhou), como faz o master real.
    infra: subtests.filter((s) => s.infra === true).map((s) => s.id),
    tentativas: subtests.reduce((acc, s) => acc + (s.tentativas ?? 1), 0),
    metades: subtests.reduce((acc, s) => acc + s.metades, 0),
    subtestsMs,
    harnessMs: 1500,
    totalMs: subtestsMs + 1500,
  }
  const arquivo = join(dir, "master.json")
  writeFileSync(arquivo, JSON.stringify({ tool: "test-mutation-guards", subtests, summary }))
  const cmd = falha === null ? `cat ${arquivo}` : `cat ${arquivo}; exit ${falha}`
  return { cmd, dir }
}

const TRES: Subtest[] = [
  {
    id: "workflow-run-syntax",
    script: "scripts/test-mutation-workflow-run-syntax.sh",
    ms: 58_000,
    exit: 0,
    metades: 14,
  },
  {
    id: "hook-commands",
    script: "scripts/test-mutation-hook-commands.sh",
    ms: 41_500,
    exit: 0,
    metades: 24,
  },
  {
    id: "archived-pipeline",
    script: "scripts/test-mutation-archived-pipeline.sh",
    ms: 1_000,
    exit: 0,
    metades: 2,
  },
]

const criados: string[] = []
const comFalso = (subtests: Subtest[], opts: { falha?: string | null } = {}): Medicao => {
  const f = masterFalso(subtests, opts)
  criados.push(f.dir)
  return measureMutationCost({ cmd: f.cmd }) as unknown as Medicao
}

afterAll(() => {
  for (const dir of criados) rmSync(dir, { recursive: true, force: true })
})

// ── 1. O comando medido é o do JOB ────────────────────────────────────────

describe("bench-guard-timing — a régua da família `mutations`", () => {
  it("o comando medido é o que as DUAS pipelines rodam (derivado, não escrito aqui)", () => {
    // O número só vale para o job se o comando for o MESMO: um benchmark que
    // medisse uma variação (`--scenario`, outro shell) versionaria o custo de
    // outra coisa — a mesma classe que a família do typecheck fecha ao medir o
    // comando canônico do invariante.
    for (const pipeline of [".github/workflows/pr-check.yml", ".gitea/workflows/ci.yml"]) {
      const linhas = readFileSync(join(REPO_ROOT, pipeline), "utf8")
        .split("\n")
        .map((l) => l.trim())
      expect(linhas).toContain(`run: ${MUTATION_MASTER_CMD}`)
    }
    // E o modo máquina é o `--json` do master (o que publica o custo): o mesmo
    // script, com a flag que dá o dado.
    expect(MUTATION_CMD).toBe(`${MUTATION_MASTER_CMD} --json`)
  })

  it("a família é SELECIONÁVEL no `--only` (o contrário exigiria a rodada inteira)", () => {
    expect(parseOnly("mutations")).toEqual({ families: ["mutations"], error: null })
    // Uma família que existe no relatório mas não na lista do `--only` obrigaria
    // quem só quer o custo dela a pagar as outras famílias inteiras.
    expect(parseOnly("hook,mutations").families).toEqual(["hook", "mutations"])
    expect(parseOnly("bogus").error).toContain("mutations")
  })

  it("o master é quem sabe rodar `--json` (o benchmark não inventa a flag)", () => {
    const fonte = readFileSync(join(REPO_ROOT, "scripts", "test-mutation-guards.sh"), "utf8")
    expect(fonte).toContain("--json")
    expect(fonte).toContain("subtestsMs")
    // O JSON sai ANTES do veredito: é isso que faz um master vermelho ainda ter
    // custo medido (o teste do contrato abaixo depende deste contrato).
    expect(fonte.indexOf("imprime_json")).toBeLessThan(
      fonte.indexOf('if [ "${#FAILED_LIST[@]}" -gt 0 ]'),
    )
  })

  it("o master RE-MEDE o vermelho e publica as tentativas (a régua é a repetição)", () => {
    // A disciplina da re-medição mora no MASTER, não aqui: quem lê o custo lê o
    // `--json` dele e recebe as tentativas prontas. Este teste trava o contrato
    // na FONTE (o comportamento inteiro roda no ensaio de bash abaixo).
    const fonte = readFileSync(join(REPO_ROOT, "scripts", "test-mutation-guards.sh"), "utf8")

    expect(fonte).toContain("roda_tentativa")
    expect(fonte).toContain("RE-MEDINDO uma vez")
    // O registro carrega as DUAS tentativas e a classe, não só o veredito.
    for (const campo of ["tentativas", "exit1", "exit2", "ms1", "ms2", "flake", "infra"])
      expect(fonte).toContain(campo)
    expect(fonte).toContain("FLAKY_LIST")
    // A INFRA é a TERCEIRA classe: a régua `tentativa_mediu` (exit 2/126/127 não
    // mede) e o bucket próprio — a não-medição não vira "o vermelho repetiu".
    expect(fonte).toContain("INFRA_LIST")
    expect(fonte).toContain("tentativa_mediu")
    // O flake é INDETERMINADO (2) e nunca verde nem reprovado: o 1 é a
    // regressão e o 3 é uso inválido (o `exit 2` que era do uso virou o 3).
    expect(fonte).toContain("exit 2")
    expect(fonte).toContain("exit 3")
  })
})

// ── 2. Cada sub-test medido, o harness por diferença ──────────────────────

describe("bench-guard-timing — o custo de CADA sub-test", () => {
  it("cada sub-test vira uma forma com o seu ID (o papel da comparação)", () => {
    const r = comFalso(TRES)

    expect(r.measured).toBe(true)
    expect(r.exit).toBe(0)
    expect(r.subtests).toBe(3)
    expect(r.metades).toBe(40)
    expect(r.forms.map((f) => f.role)).toEqual([
      "workflow-run-syntax",
      "hook-commands",
      "archived-pipeline",
    ])
    for (const form of r.forms) {
      expect(form.label).toBe(form.role)
      expect(form.ok).toBe(true)
      expect(form.ms).toBeGreaterThan(0)
      expect(form.metades).toBeGreaterThan(0)
    }
  })

  it("o harness sai da DIFERENÇA (total do master − soma dos sub-tests)", () => {
    const r = comFalso(TRES)
    const d = r.deltas!

    expect(d.subtestsMs).toBe(100_500)
    // O total é o do master (`summary.totalMs`), não o wall time do spawn: o que
    // se versiona é o custo do master, e o harness é o que sobra dele.
    expect(d.totalMs).toBe(102_000)
    expect(d.harnessMs).toBe(1_500)
    expect(d.maisCaro).toBe("workflow-run-syntax")
    expect(d.maisCaroMs).toBe(58_000)
    // A mediana da TABELA ordenada por custo (índice do meio): 41.5s entre 58s
    // e 1s — o sub-test do meio, não a média.
    expect(d.medianaMs).toBe(41_500)
  })

  it("o que o PRÓXIMO sub-test acrescenta é dito como PROJEÇÃO (não como medição)", () => {
    const r = comFalso(TRES)

    expect(r.deltas!.proximoSubtestProjetadoMs).toBe(
      Math.round(100_500 / 3) + Math.round(1_500 / 3),
    )
    // Dois pedaços MEDIDOS (a média dos scripts que existem + o harness por
    // sub-test) e nenhum deles é o custo de um sub-test que ainda não existe —
    // por isso a frase diz PROJEÇÃO e reserva "MEDIDO" para a lista.
    const frase = r.whatItAdded.join(" ")
    expect(frase).toContain("MEDIDO, sub-test a sub-test")
    expect(frase).toContain("PROJEÇÃO")
    expect(frase).toContain("entra MEDIDO na primeira rodada que o tiver")
  })

  it("um sub-test que não passou sai com `ok: false` no próprio registro", () => {
    const r = comFalso([
      ...TRES,
      { id: "cego", script: "scripts/x.sh", ms: 900, exit: 1, metades: 3 },
    ])

    expect(r.forms.find((f) => f.role === "cego")!.ok).toBe(false)
    expect(r.forms.find((f) => f.role === "workflow-run-syntax")!.ok).toBe(true)
  })
})

// ── 2b. A RE-MEDIÇÃO do vermelho: as TENTATIVAS no registro ──────────────

/**
 * Os fixtures do master COM a disciplina de repetição (o cabeçalho dele):
 *
 *   · FLAKY    — a 1ª tentativa reprovou e a 2ª PASSOU: o `ms` é a SOMA, o `exit`
 *                publicado é o da 2ª (0) e a CLASSE vai em `flake`;
 *   · REPETIDO — o vermelho repetiu na 2ª: `ok: false`, e o ↺ no registro diz
 *                que aquele ms são DOIS tiros (não é ruído para re-rodar).
 */
const FLAKY: Subtest = {
  id: "flaky",
  script: "scripts/test-mutation-flaky.sh",
  ms: 3_000,
  exit: 0,
  metades: 4,
  tentativas: 2,
  exit1: 1,
  exit2: 0,
  ms1: 1_800,
  ms2: 1_200,
  flake: true,
}
const REPETIDO: Subtest = {
  id: "repetido",
  script: "scripts/test-mutation-repetido.sh",
  ms: 5_000,
  exit: 1,
  metades: 2,
  tentativas: 2,
  exit1: 1,
  exit2: 1,
  ms1: 2_400,
  ms2: 2_600,
  flake: false,
}
/**
 * A classe INFRA: as DUAS tentativas saíram com exit 2 — o "não mediu" que a
 * suíte declara no cabeçalho dela (git/node/bancada ausentes, fail-closed). Não
 * é um vermelho (não houve medição que reprovasse) nem um flake (as duas
 * CONCORDAM: nenhuma mediu).
 */
const NAO_MEDIDO: Subtest = {
  id: "nao-medido",
  script: "scripts/test-mutation-nao-medido.sh",
  ms: 4_000,
  exit: 2,
  metades: 3,
  tentativas: 2,
  exit1: 2,
  exit2: 2,
  ms1: 1_700,
  ms2: 2_300,
  flake: false,
  infra: true,
}
/** A 1ª NÃO mediu (exit 2) e a 2ª mediu VERMELHO: o veredito é o da que mediu. */
const MEDIDA_DEPOIS: Subtest = {
  id: "medida-depois",
  script: "scripts/test-mutation-medida-depois.sh",
  ms: 5_500,
  exit: 1,
  metades: 2,
  tentativas: 2,
  exit1: 2,
  exit2: 1,
  ms1: 1_900,
  ms2: 3_600,
  flake: false,
}
/** A 1ª NÃO mediu (exit 2) e a 2ª PASSOU: VERDE, e NÃO um flake (sem contradição). */
const MEDIDA_DEPOIS_OK: Subtest = {
  id: "medida-depois-ok",
  script: "scripts/test-mutation-medida-depois-ok.sh",
  ms: 3_200,
  exit: 0,
  metades: 2,
  tentativas: 2,
  exit1: 2,
  exit2: 0,
  ms1: 2_100,
  ms2: 1_100,
  flake: false,
}

describe("bench-guard-timing — a re-medição do vermelho (as tentativas no registro)", () => {
  it("o FLAKE sai com a classe DITA: `flake` + as duas tentativas, nunca só o exit", () => {
    const r = comFalso([...TRES, FLAKY], { falha: "2" })

    const forma = r.forms.find((f) => f.role === "flaky")!
    expect(forma.flake).toBe(true)
    expect(forma.tentativas).toBe(2)
    expect(forma.exit1).toBe(1)
    expect(forma.exit2).toBe(0)
    // O `exit` publicado é o da ÚLTIMA tentativa (0): a classe NÃO se esconde
    // dentro dele — sem o `flake`, este registro diria "passou".
    expect(forma.exit).toBe(0)
    expect(forma.ok).toBe(true)
    // O ms é a SOMA das duas: o custo versionado é o que o job pagou.
    expect(forma.ms).toBe(3_000)
    expect(forma.ms1 + (forma.ms2 ?? 0)).toBe(forma.ms)
    // As tentativas, uma a uma (é o que a re-medição existe para publicar).
    expect(forma.runs.map((t) => t.exit)).toEqual([1, 0])
    expect(forma.runs.map((t) => t.ok)).toEqual([false, true])

    // A família NOMEIA o flake — e NÃO o trata como sub-test que não passou:
    // "não passou" seria uma regressão inventada (a 2ª tentativa passou).
    expect(r.flakes).toEqual(["flaky"])
    expect(r.tentativas).toBe(5)
    expect(r.violations).toEqual([])
    const frases = r.whatItAdded.join(" ")
    expect(frases).toContain("🌀 1 forma(s) FLAKY: flaky")
    expect(frases).toContain("SOMA das duas tentativas")
  })

  it("o master INDETERMINADO (exit 2) ainda é medido: o custo dos dois tiros fica", () => {
    // O `--json` sai ANTES do veredito: um flake não apaga o custo dele (nem o
    // da matriz), e o `exit` do master fica dito para o consumidor saber com o
    // que ele está falando.
    const r = comFalso([...TRES, FLAKY], { falha: "2" })

    expect(r.measured).toBe(true)
    expect(r.exit).toBe(2)
    expect(r.deltas!.subtestsMs).toBe(103_500)
    expect(r.subtests).toBe(4)
  })

  it("o vermelho REPETIDO é dito: 2 tentativas iguais, `ok: false` e o ↺ no registro", () => {
    const r = comFalso([...TRES, REPETIDO], { falha: "1" })

    const forma = r.forms.find((f) => f.role === "repetido")!
    expect(forma.tentativas).toBe(2)
    expect(forma.exit1).toBe(1)
    expect(forma.exit2).toBe(1)
    expect(forma.flake).toBe(false)
    expect(forma.ok).toBe(false)
    expect(forma.runs.map((t) => t.exit)).toEqual([1, 1])
    expect(r.flakes).toEqual([])

    // A violação do contrato continua existindo (é um sub-test que não passou) e
    // a frase acrescenta o que o exit sozinho não diz: o vermelho REPETIU.
    expect(r.violations.join(" ")).toContain("repetido (exit 1)")
    expect(r.whatItAdded.join(" ")).toContain("↺ 1 forma(s) RE-MEDIDA(s): repetido")
  })

  it("a INFRA sai com a classe DITA: `infra` + as duas tentativas, NUNCA como vermelho", () => {
    const r = comFalso([...TRES, NAO_MEDIDO], { falha: "2" })

    const forma = r.forms.find((f) => f.role === "nao-medido")!
    expect(forma.infra).toBe(true)
    expect(forma.tentativas).toBe(2)
    expect(forma.exit1).toBe(2)
    expect(forma.exit2).toBe(2)
    // O `exit` publicado é o da última (2) e `ok: false`, MAS a classe vai em
    // `infra`: é ela que impede a leitura "não passou", porque não houve medição
    // que reprovasse.
    expect(forma.exit).toBe(2)
    expect(forma.ok).toBe(false)
    expect(forma.runs.map((t) => t.exit)).toEqual([2, 2])

    // A família NOMEIA a não-medição — e NÃO a trata como sub-test que não passou.
    expect(r.infra).toEqual(["nao-medido"])
    expect(r.flakes).toEqual([])
    // A violação "sub-test(s) que NÃO passaram" NÃO existe: o exit 2 é a AUSÊNCIA
    // de medição, e acusar a árvore por ela seria mandar consertar o que ninguém
    // mediu (era este o defeito: afirmar "o vermelho REPETIU" sobre um exit 2).
    expect(r.violations).toEqual([])
    const frases = r.whatItAdded.join(" ")
    expect(frases).toContain("🚧 1 forma(s) NÃO MEDIRAM (INFRA): nao-medido")
    // Nem flake nem "RE-MEDIDA": não houve vermelho para repetir.
    expect(frases).not.toContain("🌀")
    expect(frases).not.toContain("RE-MEDIDA")
  })

  it("a RE-MEDIDA com a 2ª tentativa NÃO MEDINDO não é 'o vermelho repetiu'", () => {
    // A 1ª não mediu (exit 2) e a 2ª mediu VERMELHO: o vermelho é o da tentativa
    // que MEDIU, e a prosa não pode dizer que ele "repetiu" — não houve uma 2ª
    // medição que o confirmasse.
    const r = comFalso([...TRES, MEDIDA_DEPOIS], { falha: "1" })

    const forma = r.forms.find((f) => f.role === "medida-depois")!
    expect(forma.infra).toBe(false)
    expect(forma.flake).toBe(false)
    expect(forma.ok).toBe(false)
    expect(forma.exit).toBe(1)
    expect(forma.runs.map((t) => t.exit)).toEqual([2, 1])

    expect(r.infra).toEqual([])
    // Ela É um vermelho (a tentativa que mediu reprovou) — por isso entra em
    // `violations`, ao contrário da INFRA pura.
    expect(r.violations.join(" ")).toContain("medida-depois (exit 1)")
    const frases = r.whatItAdded.join(" ")
    expect(frases).toContain("↺ 1 forma(s) RE-MEDIDA(s) com UMA tentativa que NÃO MEDIU")
    expect(frases).not.toContain("o vermelho REPETIU")
  })

  it("a 1ª que NÃO mediu e a 2ª VERDE é VERDE — NÃO é flake (não houve contradição)", () => {
    // O flake exige as DUAS tentativas MEDINDO: uma 1ª que não mediu não afirmou
    // nada, então o verde da 2ª é o veredito — e o `flake` NÃO acende.
    const r = comFalso([...TRES, MEDIDA_DEPOIS_OK], { falha: null })

    const forma = r.forms.find((f) => f.role === "medida-depois-ok")!
    expect(forma.infra).toBe(false)
    expect(forma.flake).toBe(false)
    expect(forma.ok).toBe(true)
    expect(forma.exit).toBe(0)
    expect(forma.tentativas).toBe(2)
    expect(forma.runs.map((t) => t.exit)).toEqual([2, 0])

    expect(r.infra).toEqual([])
    expect(r.flakes).toEqual([])
    expect(r.violations).toEqual([])
    const frases = r.whatItAdded.join(" ")
    expect(frases).not.toContain("🌀")
    expect(frases).not.toContain("🚧")
  })

  it("um master SEM os campos (de antes da régua) vale 1 tentativa — nunca `undefined`", () => {
    // O registro herdado de uma rodada anterior à re-medição não pode sair com
    // `tentativas: undefined` (que leria como "não medido") nem ser re-escrito:
    // o default é o mundo de UMA tentativa, que é o que aquele master fazia.
    const r = comFalso(TRES)

    for (const forma of r.forms) {
      expect(forma.tentativas).toBe(1)
      expect(forma.exit1).toBe(forma.exit)
      expect(forma.exit2).toBeNull()
      expect(forma.ms2).toBeNull()
      expect(forma.flake).toBe(false)
      expect(forma.runs).toHaveLength(1)
    }
    expect(r.flakes).toEqual([])
    expect(r.tentativas).toBe(3)
    expect(r.whatItAdded.join(" ")).not.toContain("🌀")
    expect(r.whatItAdded.join(" ")).not.toContain("RE-MEDIDA")
  })
})

// ── 3. Fail-closed: não medido não vira "nada a medir" ────────────────────

describe("bench-guard-timing — a família `mutations` quando não dá para medir", () => {
  it("um stdio que não é o JSON do `--json` sai NÃO MEDIDO com o motivo", () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-mut-"))
    criados.push(dir)
    const r = measureMutationCost({ cmd: "printf '🏁 nao e json'" }) as unknown as Medicao

    expect(r.measured).toBe(false)
    expect(r.reason).toContain("nao e o JSON")
    expect(r.forms).toEqual([])
    expect(r.whatItAdded[0]).toContain("NÃO MEDIDO")
  })

  it("uma matriz VAZIA é não-medida (um master que não reportou sub-test nenhum)", () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-mut-"))
    criados.push(dir)
    const arquivo = join(dir, "vazio.json")
    writeFileSync(
      arquivo,
      JSON.stringify({ tool: "test-mutation-guards", subtests: [], summary: { totalMs: 10 } }),
    )
    const r = measureMutationCost({ cmd: `cat ${arquivo}` }) as unknown as Medicao

    expect(r.measured).toBe(false)
    expect(r.reason).toContain("matriz vazia")
    expect(r.deltas).toBeNull()
  })

  it("o master VERMELHO ainda é medido — e o exit fica dito no resultado", () => {
    // O `--json` sai antes do veredito: a suíte é que fica vermelha, não a
    // medição. Perder o custo por causa de um sub-test vermelho apagaria
    // exatamente o custo que originou a investigação.
    const r = comFalso(
      [...TRES, { id: "cego", script: "scripts/x.sh", ms: 900, exit: 1, metades: 3 }],
      {
        falha: "1",
      },
    )

    expect(r.measured).toBe(true)
    expect(r.exit).toBe(1)
    expect(r.subtests).toBe(4)
  })
})

// ── 4. O contrato da família ──────────────────────────────────────────────

describe("bench-guard-timing — o contrato da família `mutations`", () => {
  const formas = (ms: number[]) =>
    ms.map((m, i) => ({ label: `s${i}`, ms: m, exit: 0, metades: 3, ok: true }))

  it("acusa o sub-test que NÃO passou (o custo dele não julga nada)", () => {
    const v = mutationCostViolations({
      // Com as metades declaradas: o único defeito aqui é o exit (senão a
      // violação das metades viria junto e o teste mediria duas coisas).
      forms: [{ label: "cego", ms: 10, exit: 3, metades: 3, ok: false }],
      summary: { totalMs: 20, subtestsMs: 10 },
      harnessMs: 10,
    })

    expect(v).toHaveLength(1)
    expect(v[0]).toContain("cego (exit 3)")
    expect(v[0]).toContain("NÃO passaram")
  })

  it("acusa o sub-test SEM metades declaradas (custo sem o que ele protege)", () => {
    const v = mutationCostViolations({
      forms: [{ label: "mudo", ms: 10, exit: 0, metades: 0, ok: true }],
      summary: { totalMs: 20, subtestsMs: 10 },
      harnessMs: 10,
    })

    expect(v).toHaveLength(1)
    expect(v[0]).toContain("mudo")
    expect(v[0]).toContain("SEM metades")
  })

  it("acusa a conta que não fecha (o harness sairia negativo)", () => {
    const v = mutationCostViolations({
      forms: formas([100, 100]),
      summary: { totalMs: 150, subtestsMs: 200 },
      harnessMs: -50,
    })

    expect(v).toHaveLength(1)
    expect(v[0]).toContain("não fecha")
  })

  it("sem defeito não acusa nada — e as frases dão o mais caro e a mediana", () => {
    const forms = formas([10_000, 5_000, 1_000])
    const deltas = {
      subtestsMs: 16_000,
      harnessMs: 1_000,
      totalMs: 17_000,
      maisCaro: "s0",
      maisCaroMs: 10_000,
      medianaMs: 5_000,
      proximoSubtestProjetadoMs: 5_666,
    }

    expect(
      mutationCostViolations({
        forms,
        summary: { totalMs: 17_000, subtestsMs: 16_000 },
        harnessMs: 1_000,
      }),
    ).toEqual([])

    const frases = mutationWhatItAdded({ forms, deltas, subtests: 3, metades: 9 })
    expect(frases[0]).toContain("3 sub-test(s) · 9 metade(s)")
    expect(frases[1]).toContain("o mais caro: s0 (10.0s)")
    expect(frases[1]).toContain("a mediana: 5.0s")
    expect(frases[2]).toContain("~5.7s")
  })
})

// ── 5. Na comparação: o sub-test novo entra MEDIDO ────────────────────────

describe("bench-guard-timing — o sub-test novo e a comparação", () => {
  const familiaMedida = (
    forms: {
      role: string
      label: string
      ms: number
      ok: boolean
      flake?: boolean
      infra?: boolean
    }[],
  ) => ({
    measured: true,
    reason: null,
    exit: 0,
    cmd: MUTATION_CMD,
    forms: forms.map((f) => ({
      ...f,
      flake: f.flake === true,
      infra: f.infra === true,
      tentativas: f.flake ? 2 : 1,
      metades: 3,
      exit: f.ok ? 0 : f.infra ? 2 : 1,
      runs: [],
    })),
    deltas: {
      subtestsMs: forms.reduce((acc, f) => acc + f.ms, 0),
      harnessMs: 1_000,
      totalMs: forms.reduce((acc, f) => acc + f.ms, 0) + 1_000,
      proximoSubtestProjetadoMs: 1,
    },
    violations: [],
    whatItAdded: [],
  })

  const relatorio = (mutations: unknown) => ({
    meta: {
      tool: "bench-guard-timing",
      version: 6,
      commit: "aaaa1111",
      commitDate: "2026-09-21 09:00:00 -0300",
      timestamp: "2026-09-21T12:00:00.000Z",
      act: "bench-guard-timing --only mutations --json",
      reused: {},
      families: {},
    },
    summary: { totalMs: 20_000 },
    guards: [{ label: "check:x", ms: 100, ok: true, exit: 0 }],
    doctor: { ms: 3000, exit: 0, ok: true },
    lint: null,
    rulers: { typecheck: null, tests: null },
    hook: null,
    mutations,
  })

  it("o sub-test que NÃO estava na baseline entra como forma NOVA, com o ms medido", () => {
    const baseline = relatorio(
      familiaMedida([
        { role: "workflow-run-syntax", label: "workflow-run-syntax", ms: 58_000, ok: true },
        { role: "hook-commands", label: "hook-commands", ms: 41_000, ok: true },
      ]),
    )
    const atual = relatorio(
      familiaMedida([
        { role: "workflow-run-syntax", label: "workflow-run-syntax", ms: 58_400, ok: true },
        { role: "hook-commands", label: "hook-commands", ms: 41_200, ok: true },
        // A 33ª: entrou agora. Ninguém precisou compor a conta dela — a rodada
        // que a tem mede, e ela aparece aqui com o número dela.
        { role: "gate-registration", label: "gate-registration", ms: 7_900, ok: true },
      ]),
    )

    const cmp = comparar(atual, baseline)
    const nova = cmp.forms.find((f) => f.label === "sub-test gate-registration")!

    expect(nova.isNew).toBe(true)
    expect(nova.currentMs).toBe(7_900)
    expect(nova.baselineMs).toBeNull()
    expect(nova.unmeasured).toBe(false)
    // Forma nova não é regressão (não havia com o que comparar) — nem some do
    // relatório: é ela que documenta o custo que a mudança acrescentou.
    expect(nova.regression).toBe(false)
    expect(cmp.forms.filter((f) => f.kind === "mutation")).toHaveLength(3)
  })

  it("o sub-test que fica mais lento é REGRESSÃO (>= 50ms e +20%)", () => {
    const baseline = relatorio(
      familiaMedida([{ role: "hook-commands", label: "hook-commands", ms: 10_000, ok: true }]),
    )
    const atual = relatorio(
      familiaMedida([{ role: "hook-commands", label: "hook-commands", ms: 40_000, ok: true }]),
    )

    const cmp = comparar(atual, baseline)
    const form = cmp.forms.find((f) => f.label === "sub-test hook-commands")!

    expect(form.regression).toBe(true)
    expect(form.pct).toBeCloseTo(3, 5)
  })

  it("o custo do FLAKE também não julga: o ms dele são DUAS tentativas, não um tiro", () => {
    // Sem isto, o `ms` somado (duas medições) viraria "o sub-test ficou MAIS
    // LENTO" contra a baseline de uma rodada limpa — um delta que existe, um
    // trabalho extra que existe, e nenhuma regressão de velocidade do guard.
    const baseline = relatorio(
      familiaMedida([{ role: "flaky", label: "flaky", ms: 1_500, ok: true }]),
    )
    const atual = relatorio(
      familiaMedida([{ role: "flaky", label: "flaky", ms: 3_000, ok: true, flake: true }]),
    )

    const form = comparar(atual, baseline).forms.find((f) => f.label === "sub-test flaky")!

    expect(form.unmeasured).toBe(true)
    expect(form.regression).toBe(false)
    expect(form.pct).toBeCloseTo(1, 5)
  })

  it("o custo da INFRA também não julga (o ms inclui a tentativa que NÃO mediu)", () => {
    // Sem isto, a primeira rodada em que a suíte NÃO medisse (exit 2) pareceria
    // uma regressão de velocidade contra a baseline de uma rodada que mediu.
    const baseline = relatorio(
      familiaMedida([{ role: "nao-medido", label: "nao-medido", ms: 1_500, ok: true }]),
    )
    const atual = relatorio(
      familiaMedida([
        { role: "nao-medido", label: "nao-medido", ms: 3_000, ok: false, infra: true },
      ]),
    )

    const form = comparar(atual, baseline).forms.find((f) => f.label === "sub-test nao-medido")!

    expect(form.unmeasured).toBe(true)
    expect(form.regression).toBe(false)
  })

  it("o sub-test que NÃO passou não julga custo (nem rápido nem lento)", () => {
    const baseline = relatorio(
      familiaMedida([{ role: "hook-commands", label: "hook-commands", ms: 40_000, ok: true }]),
    )
    const atual = relatorio(
      familiaMedida([{ role: "hook-commands", label: "hook-commands", ms: 900, ok: false }]),
    )

    const form = comparar(atual, baseline).forms.find((f) => f.label === "sub-test hook-commands")!

    // Um sub-test que morre no meio fica RÁPIDO — chamar isso de "melhorou" seria
    // publicar como ganho um trabalho que não foi feito.
    expect(form.unmeasured).toBe(true)
    expect(form.regression).toBe(false)
  })

  it("sem a família nesta rodada o veredito é PARCIAL e ela é NOMEADA; herdada, sai dele", () => {
    const baseline = relatorio(
      familiaMedida([{ role: "hook-commands", label: "hook-commands", ms: 40_000, ok: true }]),
    )
    const semFamilia = relatorio(null)
    const cmp = comparar(semFamilia, baseline)

    expect(cmp.measured).toBe(false)
    expect(cmp.reason).toContain(REUSED_FAMILY_LABELS.mutations)

    const herdada = reuseFamilies(relatorio(null) as never, [
      { source: LATEST_FILE, report: baseline },
    ]) as unknown as {
      meta: {
        reused: Record<string, unknown>
        families: Record<string, { act: string; commit: string | null }>
      }
    }
    expect(herdada.meta.families.mutations.act).toBe("reused")
    expect(herdada.meta.families.mutations.commit).toBe("aaaa1111")

    const cmpHerdada = comparar(herdada as object, baseline as object)
    expect(cmpHerdada.measured).toBe(false)
    expect(cmpHerdada.reason).toContain(REUSED_FAMILY_LABELS.mutations)
    // A herdada não entra como forma: o número é de outra rodada.
    expect(cmpHerdada.forms.some((f) => f.kind === "mutation")).toBe(false)
  })

  it("a família tem ATO em toda rodada — a lista de famílias cobrem o mesmo conjunto", () => {
    const p = familyProvenance({ result: relatorio(null) as never })

    expect(Object.keys(FAMILY_MEASURED)).toContain("mutations")
    expect(Object.keys(p).sort()).toEqual(Object.keys(FAMILY_MEASURED).sort())
    expect(p.mutations.act).toBe("not-measured")
    expect(p.mutations.commit).toBeNull()
  })
})

// ── 6. A baseline versionada: o custo de cada sub-test ────────────────────

describe("bench-guard-timing — a baseline versionada carrega CADA sub-test", () => {
  const baseline = jsonDo("docs/benchmarks/guard-timing-baseline.json")

  it("a baseline tem a família `mutations` medida, com o ato e a origem RESOLVIDA", () => {
    expect(baseline.meta.version).toBeGreaterThanOrEqual(6)
    expect(Object.keys(baseline.meta.families).sort()).toEqual(Object.keys(FAMILY_MEASURED).sort())
    // O ATO diz qual comando mediu — sem ele o número não é auditável.
    expect(baseline.meta.families.mutations.act).toBe("measured")
    // O esquema v7 NÃO grava o hash do PORTADOR (um commit não pode conter o
    // próprio hash): o registro declara `anchor: "carrier"` e quem lê RESOLVE o
    // portador pela história (`origemDoRegistro`). O `parentCommit` é a
    // PROCEDÊNCIA (o topo sobre o qual o ato rodou), não a âncora.
    const origem = origemDoRegistro(baseline, { cwd: REPO_ROOT })
    expect(origem.via).toBe("carrier")
    expect(origem.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(origem.parent).toBe(baseline.meta.parentCommit)
    expect(baseline.mutations.cmd).toBe(MUTATION_CMD)
  })

  it("o custo está versionado por SUB-TEST (id + ms), não só como soma", () => {
    const subs: { role: string; label: string; ms: number; exit: number; metades: number }[] =
      baseline.mutations.forms

    expect(subs.length).toBe(baseline.mutations.subtests)
    expect(subs.length).toBeGreaterThan(30)
    for (const s of subs) {
      expect(s.role).toBe(s.label)
      expect(Number.isFinite(s.ms)).toBe(true)
      expect(s.ms).toBeGreaterThan(0)
      expect(s.metades).toBeGreaterThan(0)
    }
    // Um sub-test que NÃO passou pode estar no registro — o custo dele não julga
    // nada —, mas não pode passar em SILÊNCIO: o registro versionado tem de
    // NOMEAR cada forma vermelha em `mutations.violations`. A violação é por
    // CLASSE — uma entrada "NÃO passaram" agrega TODAS as formas vermelhas (como
    // "SEM metades declaradas" agrega as suas) — então a prova é nas duas
    // direções contra o texto agregado: nenhuma vermelha sem citação e nenhuma
    // citação que não seja uma vermelha. A régua que produz a violação é
    // `mutationCostViolations`, provada acima; aqui se prova o que o ARQUIVO
    // declara. Medido em 26/09/2026: o `workflow-run-syntax` fica vermelho NESTA
    // árvore por um scratch local (`.tmp/mineracao`, gitignored — declarado no
    // `meta.treeState`), e o CI, que não o tem, o vê verde: exigir verde
    // absoluto aqui seria exigir que o registro escondesse o que a árvore mediu.
    const vermelhas = subs.filter((s) => s.exit !== 0).map((s) => s.role)
    const declaradas = (baseline.mutations.violations as string[]).filter((v) =>
      v.includes("NÃO passaram"),
    )
    expect(declaradas.length).toBeGreaterThan(0)
    const nomesCitados = declaradas.join(" ")
    for (const role of vermelhas) expect(nomesCitados).toContain(role)
    const citadas = nomesCitados.match(/[a-z0-9-]+ \(exit \d+\)/g) ?? []
    expect(citadas).toHaveLength(vermelhas.length)
    // As somas da baseline FECHAM com as formas que ela guarda: `harnessMs` é a
    // diferença entre o total do master e a soma — se alguém editar um sub-test à
    // mão, a conta para de fechar e este teste cai.
    const soma = subs.reduce((acc, s) => acc + s.ms, 0)
    expect(baseline.mutations.deltas.subtestsMs).toBe(soma)
    expect(baseline.mutations.deltas.totalMs).toBe(soma + baseline.mutations.deltas.harnessMs)
    // O modelo de latência lê o total daqui: ele tem de ser o do master.
    expect(baseline.mutations.deltas.wallMs).toBeGreaterThan(0)
  })

  it("o sub-test mais caro e a mediana versionados são os das formas guardadas", () => {
    const ordenadas = [...baseline.mutations.forms].sort(
      (a: { ms: number }, b: { ms: number }) => b.ms - a.ms,
    )

    expect(baseline.mutations.deltas.maisCaro).toBe(ordenadas[0].role)
    expect(baseline.mutations.deltas.maisCaroMs).toBe(ordenadas[0].ms)
    expect(baseline.mutations.deltas.medianaMs).toBe(ordenadas[Math.floor(ordenadas.length / 2)].ms)
  })
})

// ── 7. O modelo de latência deriva o passo do master desta medição ────────

// ── 6. A COLUNA de metades: derivada da MATRIZ, não herdada do ato ─────────

/**
 * O fixture de uma MATRIZ: o `SUBTESTS` do master (id|script) e os blocos
 * `METADES=(...)` das suítes — os dois que a derivação lê.
 */
const matrizSrc = (ids: string[]) =>
  ["SUBTESTS=(", ...ids.map((id) => `  "${id}|scripts/${id}.sh"`), ")"].join("\n")
const suiteSrc = (metades: string[]) =>
  [
    "#!/usr/bin/env bash",
    "METADES=(",
    ...metades.map((id) => `  '${id}|descrição da metade ${id}'`),
    ")",
  ].join("\n")
const derivacao = (suites: Record<string, string[]>, ids = Object.keys(suites)) =>
  metadesDaMatriz({
    masterSrc: matrizSrc(ids),
    // `lerSuite` devolve o TEXTO da suíte (é ele que carrega o bloco), não a
    // lista de ids: a derivação passa pelo mesmo parser que a doc lê.
    lerSuite: (rel) => {
      const metades = suites[rel.replace("scripts/", "").replace(".sh", "")]
      return metades ? suiteSrc(metades) : null
    },
  })

/** Uma família `mutations` medida, com a coluna que o registro GRAVOU. */
const familiaGravada = (formas: { id: string; metades: number }[], total: number) => ({
  measured: true,
  reason: null,
  cmd: MUTATION_CMD,
  exit: 0,
  wallMs: 60_000,
  subtests: formas.length,
  metades: total,
  forms: formas.map((f) => ({
    role: f.id,
    label: f.id,
    ms: 10_000,
    exit: 0,
    metades: f.metades,
    ok: true,
    runs: [{ ms: 10_000, ok: true }],
  })),
  deltas: { subtestsMs: 20_000, harnessMs: 1_000, totalMs: 21_000, wallMs: 21_000 },
  violations: [],
  whatItAdded: ["MEDIDO: a frase do ato anterior"],
})

/**
 * A família DEPOIS de passar pela derivação: `comMetadesDaMatriz` é JS puro (o
 * `.mjs` não declara tipos), então a marca que ela acrescenta precisa ser nomeada
 * aqui — sem isso o `as typeof familia` apagaria justamente o campo que esta suíte
 * veio medir.
 */
type FamiliaComColuna = ReturnType<typeof familiaGravada> & {
  metadesDaMatriz: {
    total: number
    atualizadas: number
    semDerivacao: string[]
    naoMedidas: { id: string; motivo: string }[]
  }
}

describe("bench-guard-timing — a coluna de metades é DERIVADA da matriz", () => {
  it("a unidade que entrou DEPOIS da medição é corrigida, com o TOTAL e a frase", () => {
    // O caso medido (23/09/2026): a `bench-freshness` declarava 8 metades quando
    // o ato mediu o custo dela, e a suíte passou a declarar 10. A rodada que
    // HERDA a família trazia o `8` junto — e o registro descrevia a unidade
    // anterior.
    const familia = familiaGravada(
      [
        { id: "a", metades: 8 },
        { id: "b", metades: 3 },
      ],
      11,
    )
    const derivadas = derivacao({
      a: ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9", "M10"],
      b: ["C1", "C2", "C3"],
    })
    const depois = comMetadesDaMatriz(familia, derivadas) as FamiliaComColuna

    expect(depois.forms.find((f: { role: string }) => f.role === "a")?.metades).toBe(10)
    expect(depois.forms.find((f) => f.role === "b")?.metades).toBe(3)
    expect(depois.metades).toBe(13)
    // A procedência da COLUNA deixa de ser promessa da prosa: ela é dado.
    expect(depois.metadesDaMatriz).toEqual({
      total: 13,
      atualizadas: 1,
      semDerivacao: [],
      naoMedidas: [],
    })
    // A frase narra o MESMO que a coluna: 8+3=11 → 13.
    expect(depois.whatItAdded[0]).toContain("13 metade(s)")
    expect(depois.whatItAdded[0]).not.toContain("11 metade(s)")
  })

  it("o CUSTO não é tocado — o ms, o exit e os deltas seguem da medição", () => {
    const familia = familiaGravada([{ id: "a", metades: 1 }], 1)
    const depois = comMetadesDaMatriz(familia, derivacao({ a: ["M1", "M2"] })) as FamiliaComColuna

    expect(depois.forms[0].ms).toBe(familia.forms[0].ms)
    expect(depois.forms[0].exit).toBe(familia.forms[0].exit)
    expect(depois.forms[0].runs).toBe(familia.forms[0].runs)
    expect(depois.deltas).toBe(familia.deltas)
    expect(depois.wallMs).toBe(familia.wallMs)
  })

  it("a forma que a matriz NÃO conhece fica intocada e é DITA (nada é inventado)", () => {
    const familia = familiaGravada(
      [
        { id: "a", metades: 2 },
        { id: "saiu-da-matriz", metades: 7 },
      ],
      9,
    )
    const depois = comMetadesDaMatriz(familia, derivacao({ a: ["M1"] })) as FamiliaComColuna

    expect(depois.forms.find((f) => f.role === "saiu-da-matriz")?.metades).toBe(7)
    expect(depois.metadesDaMatriz.semDerivacao).toEqual(["saiu-da-matriz"])
  })

  it("a unidade que a matriz NÃO conseguiu medir fica intocada: zero não é a resposta", () => {
    const familia = familiaGravada([{ id: "a", metades: 5 }], 5)
    // A suíte `a` existe no master e não está na árvore: a derivação devolve 0
    // com o MOTIVO, e gravar 0 apagaria o número que o registro já tinha.
    const derivadas = metadesDaMatriz({ masterSrc: matrizSrc(["a"]), lerSuite: () => null })
    const depois = comMetadesDaMatriz(familia, derivadas) as FamiliaComColuna

    expect(depois.forms[0].metades).toBe(5)
    expect(depois.metadesDaMatriz.naoMedidas).toEqual([
      { id: "a", motivo: "`scripts/a.sh` não está nesta árvore" },
    ])
  })

  it("sem derivação não há reescrita — e a família sai pela MESMA referência", () => {
    const familia = familiaGravada([{ id: "a", metades: 5 }], 5)

    expect(comMetadesDaMatriz(familia, null)).toBe(familia)
    expect(comMetadesDaMatriz(familia, new Map())).toBe(familia)
    expect(comMetadesDaMatriz(null, derivacao({ a: ["M1"] }))).toBeNull()
  })

  it("a derivação que não corrigiu nada AINDA deixa a marca (nada mudou ≠ não rodou)", () => {
    // A família já coerente com a matriz: nenhuma forma é reescrita, e a
    // procedência é o único dado que distingue "a derivação rodou e conferiu"
    // de "a derivação não rodou" no arquivo versionado.
    const familia = familiaGravada([{ id: "a", metades: 2 }], 2)
    const depois = comMetadesDaMatriz(familia, derivacao({ a: ["M1", "M2"] })) as FamiliaComColuna

    expect(depois).not.toBe(familia)
    expect(depois.forms[0].metades).toBe(2)
    expect(depois.metades).toBe(2)
    expect(depois.metadesDaMatriz).toEqual({
      total: 2,
      atualizadas: 0,
      semDerivacao: [],
      naoMedidas: [],
    })
  })

  it("a régua é a MESMA do guard da contagem (duas leituras, um só número)", () => {
    // Aqui não há fixture: é a árvore real. O `check-mutation-count` conta as
    // metades pelo caminho dele (para julgar a doc e o registro) e a derivação
    // do ato pelo caminho dela (para gravar o registro) — se as duas
    // divergissem, o ato gravaria um número que o guard recusa.
    const doGuard = runCountGuard(REPO_ROOT) as {
      derivedCount: number
      derivedMetades: number
      metades: { id: string; count: number }[]
    }
    const derivadas = metadesDaMatriz({
      masterSrc: readFileSync(join(REPO_ROOT, MASTER_DOS_SUBTESTS), "utf8"),
      lerSuite: (rel) => {
        try {
          return readFileSync(join(REPO_ROOT, rel), "utf8")
        } catch {
          return null
        }
      },
    })

    expect(derivadas.size).toBe(doGuard.derivedCount)
    expect([...derivadas.keys()]).toEqual(doGuard.metades.map((m) => m.id))
    expect([...derivadas.values()].reduce((s, d) => s + d.count, 0)).toBe(doGuard.derivedMetades)
    // E o master é a fonte dos ids: nenhuma forma do registro fica sem matriz.
    expect([
      ...mapaDoMaster(readFileSync(join(REPO_ROOT, MASTER_DOS_SUBTESTS), "utf8")).keys(),
    ]).toEqual(doGuard.metades.map((m) => m.id))
  })

  it("o registro REAL tem a coluna da matriz — e UMA unidade perdida é o único vermelho", () => {
    // A prova do elo (ato → arquivo → guard), sobre o registro versionado de
    // AGORA: a coluna dele é a que a MATRIZ declara hoje (é o ato que a derivou),
    // e o caso da unidade que entrou depois da medição é injetado a partir da
    // PRÓPRIA derivação — nenhum número reescrito à mão.
    const bench = jsonDo("docs/benchmarks/guard-timing-baseline.json")
    const doGuard = runCountGuard(REPO_ROOT) as {
      metades: { id: string; count: number }[]
      derivedMetades: number
    }
    const derivadas = metadesDaMatriz({
      masterSrc: readFileSync(join(REPO_ROOT, MASTER_DOS_SUBTESTS), "utf8"),
      lerSuite: (rel) => {
        try {
          return readFileSync(join(REPO_ROOT, rel), "utf8")
        } catch {
          return null
        }
      },
    })
    const ids = doGuard.metades.map((m) => m.id)

    // O elo no tip: a coluna do registro é a da matriz (nenhuma forma atrás).
    const comoEsta = comparaComOAto(bench, ids, { metades: doGuard.metades })
    expect(comoEsta.metadesDivergentes).toEqual([])

    // O DEFEITO (o caso de 23/09/2026): a suíte ganha uma metade DEPOIS da
    // medição e o registro segue com a unidade anterior. A forma alvo sai da
    // derivação (a que declara mais de uma metade), não de uma lista à mão.
    const alvo = doGuard.metades.find((m) => m.count > 1)
    expect(alvo).toBeDefined()
    const atrasada = {
      ...bench,
      mutations: {
        ...bench.mutations,
        metades: bench.mutations.metades - 1,
        forms: bench.mutations.forms.map((f: { role: string; metades: number }) =>
          f.role === alvo!.id ? { ...f, metades: f.metades - 1 } : f,
        ),
      },
    }

    const antes = comparaComOAto(atrasada, ids, { metades: doGuard.metades })
    const corrigida = comMetadesDaMatriz(atrasada.mutations, derivadas) as typeof bench.mutations
    const depois = comparaComOAto({ ...atrasada, mutations: corrigida }, ids, {
      metades: doGuard.metades,
    })

    // Antes: a divergência é da COLUNA (as formas existem, o custo está medido) —
    // e nenhuma outra violação do ato aparece, senão este teste mediria outra
    // coisa que não o assunto dele.
    expect(antes.faltando).toEqual([])
    expect(antes.metadesDivergentes).toEqual([
      { id: alvo!.id, gravado: alvo!.count - 1, derivado: alvo!.count },
    ])
    expect(antes.ok).toBe(false)
    expect(antes.violations.every((v) => !v.includes("não versionou"))).toBe(true)

    // Depois: a derivação fecha o veredito, sem tocar no custo.
    expect(depois.metadesDivergentes).toEqual([])
    expect(depois.violations.filter((v) => v.includes("metade"))).toEqual([])
    expect(corrigida.metades).toBe(doGuard.derivedMetades)
    expect(
      corrigida.forms.every((f: { ms: number }, i: number) => f.ms === bench.mutations.forms[i].ms),
    ).toBe(true)
    expect(derivadas.get(alvo!.id)?.count).toBe(alvo!.count)
  })
})

describe("merge-latency — o passo do master vem da MEDIÇÃO, não da conta à mão", () => {
  const bench = jsonDo("docs/benchmarks/guard-timing-baseline.json")

  it("o índice casa o passo do job (`bash scripts/test-mutation-guards.sh`) com o total medido", () => {
    const { byCmd } = benchIndex(bench)

    // O passo do job e o comando MEDIDO (com `--json`) são o mesmo script: a
    // chave do índice é o script, então o derivado é a medição por sub-test.
    expect(instrumentKey(MUTATION_MASTER_CMD)).toBe("test-mutation-guards")
    expect(byCmd.get("test-mutation-guards")).toBe(bench.mutations.deltas.totalMs)
  })

  it("sem a família no arquivo não se deriva nada (não herda um número de lugar nenhum)", () => {
    const { byCmd } = benchIndex({ ...bench, mutations: undefined })
    expect(byCmd.get("test-mutation-guards")).toBeUndefined()

    const naoMedida = benchIndex({ ...bench, mutations: { measured: false, deltas: null } })
    expect(naoMedida.byCmd.get("test-mutation-guards")).toBeUndefined()
  })
})

// ── 8. O master de VERDADE, com uma matriz de ensaio: as três classes ──────

/**
 * A prova de COMPORTAMENTO da re-medição: o master REAL, numa árvore de ensaio
 * com três stubs (verde, vermelho, flake).
 *
 * POR QUE ASSIM: a disciplina é do BASH (re-medir o vermelho, somar as duas
 * tentativas, ir a 2 no flake) e um teste que a re-implementasse em JS mediria a
 * re-implementação. A árvore de ensaio é feita de três coisas e nada mais: a
 * cópia do mestre com a matriz TROCADA, o `metades.mjs` de verdade (a régua das
 * metades é a MESMA do repositório, não uma imitação) e os stubs. Nada disto
 * toca a árvore: quem roda os 42 sub-tests de verdade é o CI.
 */
function ensaioDoMaster(subtests: [string, string][]): string {
  const dir = mkdtempSync(join(tmpdir(), "mut-master-"))
  criados.push(dir)
  mkdirSync(join(dir, "scripts"), { recursive: true })

  const fonte = readFileSync(join(REPO_ROOT, "scripts", "test-mutation-guards.sh"), "utf8")
  const matriz = ["SUBTESTS=(", ...subtests.map(([id, rel]) => `  "${id}|${rel}"`), ")"].join("\n")
  const trocada = fonte.replace(/SUBTESTS=\(\n[\s\S]*?\n\)/, matriz)
  expect(trocada).not.toBe(fonte)
  writeFileSync(join(dir, "scripts", "test-mutation-guards.sh"), trocada)
  copyFileSync(join(REPO_ROOT, "scripts", "metades.mjs"), join(dir, "scripts", "metades.mjs"))

  const stub = (nome: string, corpo: string) =>
    writeFileSync(
      join(dir, "scripts", nome),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "# STUB DE ENSAIO (vive num tmpdir): a descrição da metade é lida pelo",
        "# metades.mjs de verdade, e o exit é o que o mestre re-mede.",
        "METADES=(",
        "  'M1|a metade de ensaio — o teste mede o mestre, não o guard'",
        ")",
        corpo,
      ].join("\n"),
    )
  stub("stub-verde.sh", "exit 0\n")
  stub("stub-vermelho.sh", "exit 1\n")
  // A INFRA: a suíte NÃO mediu — o exit 2 que o cabeçalho dela declara (git/node/
  // bancada ausentes, fail-closed). As duas tentativas concordam: nenhuma mediu.
  stub("stub-infra.sh", "exit 2\n")
  // A 1ª tentativa NÃO mede (exit 2) e a 2ª PASSA: não é flake (não houve
  // contradição — a 1ª não afirmou nada), é o VERDE da que mediu.
  stub(
    "stub-mede-depois.sh",
    [
      `conta="${dir}/mede-depois"`,
      'n=$(cat "$conta" 2>/dev/null || echo 0)',
      "n=$((n + 1))",
      'printf "%s" "$n" >"$conta"',
      'if [ "$n" -le 1 ]; then',
      "  exit 2",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
  )
  // O FLAKE: reprova na 1ª e passa na 2ª. O contador é o estado ENTRE as duas
  // tentativas — do lado do mestre são dois tiros iguais, que é exatamente o
  // caso que só a REPETIÇÃO distingue.
  stub(
    "stub-flake.sh",
    [
      `conta="${dir}/flake"`,
      'n=$(cat "$conta" 2>/dev/null || echo 0)',
      "n=$((n + 1))",
      'printf "%s" "$n" >"$conta"',
      'if [ "$n" -le 1 ]; then',
      "  exit 1",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
  )
  return dir
}

/** O master do ensaio, com o `--json` dele lido como o bench o lê. */
function rodaEnsaio(subtests: [string, string][]) {
  const dir = ensaioDoMaster(subtests)
  const res = spawnSync("bash", [join(dir, "scripts", "test-mutation-guards.sh"), "--json"], {
    encoding: "utf8",
    timeout: 60_000,
  })
  return {
    exit: res.status,
    json: JSON.parse(res.stdout) as {
      subtests: Subtest[]
      summary: {
        count: number
        passed: number
        failed: string[]
        flakes: string[]
        infra: string[]
        tentativas: number
        metades: number
      }
    },
  }
}

describe("test-mutation-guards — a re-medição no master de VERDADE (matriz de ensaio)", () => {
  it("verde sai com UMA tentativa: o verde não é re-medido", () => {
    const { exit, json } = rodaEnsaio([["verde", "scripts/stub-verde.sh"]])

    expect(exit).toBe(0)
    expect(json.subtests[0].tentativas).toBe(1)
    expect(json.subtests[0].exit2).toBeNull()
    expect(json.subtests[0].ms2).toBeNull()
    expect(json.subtests[0].flake).toBe(false)
    expect(json.summary.flakes).toEqual([])
    expect(json.summary.passed).toBe(1)
  })

  it("vermelho REPETIDO → exit 1, com o exit das DUAS tentativas no registro", () => {
    const { exit, json } = rodaEnsaio([["vermelho", "scripts/stub-vermelho.sh"]])

    expect(exit).toBe(1)
    const s = json.subtests[0]
    expect(s.tentativas).toBe(2)
    expect(s.exit1).toBe(1)
    expect(s.exit2).toBe(1)
    expect(s.exit).toBe(1)
    expect(s.flake).toBe(false)
    expect(s.ms).toBe((s.ms1 ?? 0) + (s.ms2 ?? 0))
    expect(json.summary.failed).toEqual(["vermelho"])
    expect(json.summary.flakes).toEqual([])
  })

  it("FLAKE → exit 2 (INDETERMINADO): nenhum reprovou, e o exit não carrega a classe", () => {
    const { exit, json } = rodaEnsaio([
      ["verde", "scripts/stub-verde.sh"],
      ["flake", "scripts/stub-flake.sh"],
    ])

    expect(exit).toBe(2)
    expect(json.summary.failed).toEqual([])
    const s = json.subtests.find((x) => x.id === "flake")!
    expect(s.tentativas).toBe(2)
    expect(s.exit1).toBe(1)
    expect(s.exit2).toBe(0)
    // O `exit` por sub-test é o da ÚLTIMA tentativa (0) MAIS `flake: true`: sem
    // a classe, este registro diria que o sub-test passou.
    expect(s.exit).toBe(0)
    expect(s.flake).toBe(true)
    expect(s.ms).toBe((s.ms1 ?? 0) + (s.ms2 ?? 0))
    // O flake não é passado nem falhado; o verde (1 tentativa) segue intacto.
    expect(json.summary.passed).toBe(1)
    expect(json.summary.flakes).toEqual(["flake"])
    expect(json.subtests.find((x) => x.id === "verde")!.tentativas).toBe(1)
    expect(json.summary.tentativas).toBe(3)
  })

  it("vermelho E flake → exit 1 (a regressão manda) e o flake segue NOMEADO", () => {
    const { exit, json } = rodaEnsaio([
      ["vermelho", "scripts/stub-vermelho.sh"],
      ["flake", "scripts/stub-flake.sh"],
    ])

    expect(exit).toBe(1)
    expect(json.summary.failed).toEqual(["vermelho"])
    expect(json.summary.flakes).toEqual(["flake"])
  })

  it("INFRA → exit 2 (INDETERMINADO): `infra: true` e o id FORA de `failed`", () => {
    // O defeito que isto fecha: um exit 2 (git indisponível, bancada que não
    // monta) NÃO é um vermelho — gravar "não passou" sobre ele acusa a árvore por
    // uma medição que ninguém fez.
    const { exit, json } = rodaEnsaio([
      ["verde", "scripts/stub-verde.sh"],
      ["infra", "scripts/stub-infra.sh"],
    ])

    expect(exit).toBe(2)
    const s = json.subtests.find((x) => x.id === "infra")!
    expect(s.tentativas).toBe(2)
    expect(s.exit1).toBe(2)
    expect(s.exit2).toBe(2)
    expect(s.exit).toBe(2)
    expect(s.infra).toBe(true)
    expect(s.flake).toBe(false)
    // A não-medição sai à parte dos DOIS lados, com o id NOMEADO.
    expect(json.summary.failed).toEqual([])
    expect(json.summary.infra).toEqual(["infra"])
    expect(json.summary.flakes).toEqual([])
    expect(json.summary.passed).toBe(1)
    expect(json.summary.tentativas).toBe(3)
  })

  it("a 1ª que NÃO mediu (exit 2) e a 2ª que PASSOU → VERDE, NÃO flake", () => {
    // A classe do flake exige as DUAS tentativas MEDINDO: uma 1ª que não mediu não
    // contradiz o verde da 2ª — o veredito é o da que mediu, e o `flake` fica
    // apagado (não houve contradição, houve ausência).
    const { exit, json } = rodaEnsaio([["mede-depois", "scripts/stub-mede-depois.sh"]])

    expect(exit).toBe(0)
    const s = json.subtests[0]
    expect(s.tentativas).toBe(2)
    expect(s.exit1).toBe(2)
    expect(s.exit2).toBe(0)
    expect(s.exit).toBe(0)
    expect(s.flake).toBe(false)
    expect(s.infra).toBe(false)
    expect(json.summary.failed).toEqual([])
    expect(json.summary.infra).toEqual([])
    expect(json.summary.flakes).toEqual([])
    expect(json.summary.passed).toBe(1)
  })
})
