// =============================================================================
// forge-doctor.test.ts
//
// Testes do scripts/forge-doctor.mjs — o relatório único de prontidão da forja
// para bloquear o merge.
//
// O que precisa ser provado (o comando pode "parecer" certo e mentir):
//   1. os gates são DERIVADOS da pipeline dona do merge (nada de lista à mão
//      que envelhece em silêncio);
//   2. o COMANDO executado preserva as flags — o rótulo do descobridor descarta
//      (`bun scripts/rotate-secrets.mjs --check` vira `scripts/rotate-secrets.mjs`)
//      e executar o rótulo cru rodaria o script em modo de EFEITO. Este é o
//      defeito que o doctor cometeu e que estes testes impedem de voltar;
//   3. a trava recusa qualquer comando sem modo de verificação;
//   4. o veredito não diz "pronta" quando algo não foi provado (falsa segurança
//      é o defeito que o check-forge-parity foi escrito para matar);
//   5. o fluxo completo (diagnose) fecha ponta a ponta com dependências dubladas.
//
// Sem rede e sem executar gate de verdade: o `run` é injetado.
// =============================================================================

import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readFileSync } from "node:fs"

import { afterAll, describe, expect, it } from "vitest"

import {
  FORGE_GUARDS_JOB,
  MERGE_OWNER_PIPELINE,
  REQUIRED_CHECKS_MANIFEST,
  VERDICT,
  diagnose,
  forgeGates,
  gateCommand,
  gateRunLine,
  isVerificationCommand,
  githubRunnerLabelBlockers,
  protectionBlockers,
  readComposeInterpolation,
  readGithubRunnerLabels,
  readImageContract,
  readImageRefs,
  readMirrors,
  readProof,
  readProtection,
  readRunnerLabels,
  renderReport,
  sliceJob,
  summarize,
} from "../../../scripts/forge-doctor.mjs"

const ROOT = process.cwd()
const tmpDirs: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-doctor-"))
  tmpDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ── fixtures ──────────────────────────────────────────────────────────────

/** Pipeline sintética no formato real (2 níveis, `run:` executável). */
function pipeline(opts: { guardLines?: string[]; extraJob?: boolean } = {}): string {
  const guards = opts.guardLines ?? [
    "bun run check:bun-mirror",
    "bun scripts/rotate-secrets.mjs --check",
  ]
  const steps = guards.flatMap((g, i) => [`      - name: Gate ${i + 1}`, `        run: ${g}`])
  return [
    "on:",
    "  pull_request:",
    "jobs:",
    `  ${FORGE_GUARDS_JOB}:`,
    "    name: Repo Guards",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    ...steps,
    ...(opts.extraJob === false
      ? []
      : ["  typecheck:", "    steps:", "      - run: bunx tsc --noEmit"]),
    "",
  ].join("\n")
}

/** Fatores do veredito, todos "verdes" — cada teste estraga um. */
function facts(overrides: Record<string, unknown> = {}) {
  return {
    contract: { forges: [], failures: [], unknown: null },
    guards: { results: [], error: null, gates: [] },
    image: { code: 0, state: "exists", ref: "ghcr.io/x/ubuntu-bun:1.3.14", detail: "", lines: [] },
    proof: { status: "holds", ok: true, detail: "7 casos", cases: [] },
    compose: {
      state: "proven",
      violations: [],
      detail: "3 fases ok",
      hostCompare: { state: "in-sync", detail: "host x template em sincronia" },
    },
    mirrors: {
      actrc: "1.3.14",
      env: "1.3.14",
      // O default é o caso COMPARADO com o valor: é o único em que dá para dizer
      // "em sincronia" sem mentir (dois espelhos iguais podem estar os dois velhos).
      expected: "1.3.14",
      mirrors: [],
      warnings: [],
      blockers: [],
      unknowns: [],
    },
    protection: protectionFacts(),
    imageRefs: refsFacts(),
    runnerLabels: runnerLabelFacts(),
    githubRunnerLabels: githubRunnerLabelFacts(),
    imageContract: imageContractFacts(),
    skippedGuards: false,
    skippedProof: false,
    skippedProtection: false,
    skippedRunnerLabels: false,
    skippedImageContract: false,
    ...overrides,
  }
}

/**
 * O contrato REGISTRADO, em sincronia — o default do fixture. O doctor consome
 * `forges[].{state,detail}` (o que ele compara vem do aplicador), então o
 * fixture tem de falar a MESMA língua do relatório real.
 */
/**
 * O fato das referências NÃO versionadas, no formato que o guard devolve.
 *
 * O item `absent` está no default de propósito: ele aparece em QUALQUER
 * checkout que não seja o VPS, e o que se quer travar é que ele NÃO conta como
 * pendência (e não vira ❌ no relatório) — a diferença entre "não aplicável" e
 * "não provado" é o que faz a lista de pendências ser confiável.
 */
function refsFacts(over: Record<string, unknown> = {}) {
  return {
    state: "proven",
    violations: [],
    detail: "2 referencia(s) nao versionada(s) provadas, 1 nao aplicavel(is) neste checkout",
    items: [
      {
        source: "repository variable IMAGE_REGISTRY",
        state: "proven",
        detail: "confere com 3 espelho(s)",
      },
      {
        source: "registry (o que ghcr.io/severinno/ubuntu-bun:1.3.14 serve hoje)",
        state: "proven",
        detail: "ok",
      },
      {
        source: "env do host deploy/.env.gitea",
        state: "absent",
        detail: "gitignored por desenho",
      },
    ],
    ...over,
  }
}

/**
 * O fato do REGISTRO do act_runner, no formato que o guard devolve.
 *
 * O default é `proven` porque é o único estado que não muda o veredito — os
 * outros dois (violado / indisponível) são o que os testes abaixo exercitam.
 */
function runnerLabelFacts(over: Record<string, unknown> = {}) {
  return {
    state: "proven",
    violations: [],
    remedies: [],
    detail: "2 label(s) registrado(s) idênticos ao compose (declarado em deploy/env.gitea.example)",
    declared: ["ubuntu-latest:docker://ghcr.io/severinno/ubuntu-bun:1.3.14"],
    registered: ["ubuntu-latest:docker://ghcr.io/severinno/ubuntu-bun:1.3.14"],
    container: "gitea-runner",
    stateFile: "/data/.runner",
    ...over,
  }
}

/**
 * O fato do CONTRATO da imagem PUBLICADA, no formato que o probe devolve.
 *
 * `proven` é o default porque é o único que não muda o veredito; os outros
 * (violado / indisponível / pulado) são o que os testes exercitam.
 */
function imageContractFacts(over: Record<string, unknown> = {}) {
  return {
    state: "proven",
    digest: `sha256:${"a".repeat(64)}`,
    target: `ghcr.io/severinno/ubuntu-bun@sha256:${"a".repeat(64)}`,
    expectedVersion: "1.3.14",
    labelVersion: "1.3.14",
    findings: null,
    remedies: [],
    detail:
      "a imagem PUBLICADA (ghcr.io/severinno/ubuntu-bun@sha256:aaa…) executa o contrato: plugin `compose`, bun 1.3.14 em /usr/local/bin/bun (a label da imagem declara 1.3.14)",
    ...over,
  }
}

/** O fato IRMÃO: o registro do runner auto-hospedado do GitHub (a API). */
function githubRunnerLabelFacts(over: Record<string, unknown> = {}) {
  return {
    state: "proven",
    violations: [],
    remedies: [],
    detail: "4 label(s) registrado(s) idênticos ao setup, em 'hostinger-runner' (online)",
    declared: ["self-hosted", "linux", "x64", "docker"],
    registered: ["self-hosted", "Linux", "X64", "docker"],
    runner: "hostinger-runner",
    status: "online",
    repo: "severinno/severinno",
    ...over,
  }
}

function protectionFacts(over: Record<string, unknown> = {}) {
  return {
    state: "in-sync",
    detail: "gitea: main exige os 3 check(s) do manifesto",
    forges: [
      {
        forge: "gitea",
        state: "in-sync",
        desired: 3,
        branches: [],
        missing: [],
        extra: [],
        detail: "main exige os 3 check(s) do manifesto",
      },
    ],
    ...over,
  }
}

/** Prova que se sustenta, como dublê — o agregador não executa nada de verdade. */
const proofHolds = {
  prove: async () => ({ ok: true, status: "holds", detail: "7 casos", cases: [] }),
}

/**
 * O CONTRATO da imagem publicada, dublado: digest fixo (o probe do registry não
 * é chamado) e `docker run` dublê devolvendo a MARCA do bloco. O TEXTO é o
 * Dockerfile REAL — é dele que sai o bloco que o probe executa dentro da imagem,
 * e trocá-lo por um fixture faria o teste provar outro contrato.
 */
const imageContractProven = {
  digest: `sha256:${"a".repeat(64)}`,
  text: readFileSync(join(ROOT, "Dockerfile.ubuntu-bun"), "utf8"),
  run: () => ({
    status: 0,
    stdout: "  ✅ Contrato da imagem ok: plugin compose (Docker Compose version 5.4.0-2)",
    stderr: "",
  }),
}

/** Prova VIOLADA: a garantia da imagem existe no texto e não no comportamento. */
const proofViolated = {
  prove: async () => ({
    ok: false,
    status: "violated",
    detail: "1 caso(s) da prova falharam: ausente",
    cases: [{ id: "ausente", ok: false, failures: ["o runner SUBIU"] }],
  }),
}

/** `run` dublê: tudo passa, sem executar processo nenhum. */
const passRun = () => ({ status: 0, stdout: "", stderr: "", signal: null, error: undefined })

/**
 * O relatório `--json` do aplicador REAL, reduzido ao que o doctor lê.
 *
 * POR QUE UM EXTRATO E NÃO UMA ESTRUTURA INVENTADA: o doctor consome o JSON do
 * `apply-required-checks.mjs` (a mesma fonte que o cron de drift usa) — se o
 * fixture divergisse do formato de verdade, o teste passaria provando um
 * contrato que o aplicador não cumpre.
 */
/** O bloco de UMA forja em sincronia, no formato do relatório real. */
const forgeInSync = (): object => ({
  workflow: MERGE_OWNER_PIPELINE,
  desired: ["Repo Guards"],
  branches: [{ branch: "main", configured: true, inSync: true, missing: [], extra: [] }],
})

/** O bloco da forja SEM proteção: nenhum check bloqueia o merge. */
const forgeUnprotected = (): object => ({
  workflow: MERGE_OWNER_PIPELINE,
  desired: ["Repo Guards"],
  branches: [
    { branch: "main", configured: false, inSync: false, missing: ["Repo Guards"], extra: [] },
  ],
})

/** O bloco da forja em DRIFT: um check falta e outro sobrou (os dois remédios). */
const forgeDrift = (): object => ({
  workflow: MERGE_OWNER_PIPELINE,
  desired: ["Repo Guards"],
  branches: [
    {
      branch: "main",
      configured: true,
      inSync: false,
      missing: ["Repo Guards"],
      extra: ["Repo Guards (renomeado)"],
    },
  ],
})

/**
 * O relatório `--json` do aplicador REAL, reduzido ao que o doctor lê.
 *
 * POR QUE UM EXTRATO E NÃO UMA ESTRUTURA INVENTADA: o doctor consome o JSON do
 * `apply-required-checks.mjs` (a mesma fonte que o cron de drift usa) — se o
 * fixture divergisse do formato de verdade, o teste passaria provando um
 * contrato que o aplicador não cumpre.
 *
 * E o `drift` de TOPO é PER-FORJA de propósito: o aplicador é invocado uma vez
 * por forja (`--forge <nome>`), então o agregado dele cobre uma forja só. Um
 * dublê que devolvesse `drift: true` para a forja em sincronia acusaria a forja
 * errada — que é exatamente o defeito que este fixture impede de passar.
 */
function applierJson({
  forge,
  drift = false,
  forges,
}: {
  forge: string
  drift?: boolean
  forges?: object
}): string {
  return JSON.stringify({
    mode: "check",
    manifest: REQUIRED_CHECKS_MANIFEST,
    branches: ["main"],
    drift,
    forges: forges ?? { [forge]: forgeInSync() },
    errors: [],
  })
}

/** A forja que o `--forge` pediu (o aplicador é invocado uma vez por forja). */
const forgeOf = (args: string[]): string => args[args.indexOf("--forge") + 1]

/** O aplicador em `--check` respondendo "em sincronia" (exit 0, JSON no stdout). */
const protectionInSync = {
  run: (_bin: string, args: string[]) => ({
    status: 0,
    stdout: applierJson({ forge: forgeOf(args) }),
    stderr: "",
    signal: null,
    error: undefined,
  }),
}

/**
 * DRIFT: o `name:` de um job renomeado muda o CONTEXTO de status; o manifesto
 * passa a exigir um check que nunca roda e o PR trava para sempre. Nenhum teste
 * de PR enxerga isso (no PR o job novo existe e passa).
 */
const protectionDrift = {
  // O drift é de UMA forja: é isso que prova que o bloqueio nomeia a forja
  // certa em vez de "alguma forja falhou".
  run: (_bin: string, args: string[]) => {
    const forge = forgeOf(args)
    const drifted = forge === "gitea"
    return {
      status: drifted ? 1 : 0,
      stdout: JSON.stringify({
        mode: "check",
        manifest: REQUIRED_CHECKS_MANIFEST,
        branches: ["main"],
        drift: drifted,
        forges: { [forge]: drifted ? forgeDrift() : forgeInSync() },
        errors: [],
      }),
      stderr: "",
      signal: null,
      error: undefined,
    }
  },
}

/** Sem credencial de administração: o aplicador falha e diz por quê. */
const protectionUnreadable = {
  run: () => ({
    status: 1,
    stdout: JSON.stringify({
      mode: "check",
      manifest: REQUIRED_CHECKS_MANIFEST,
      branches: ["main"],
      drift: false,
      forges: {},
      errors: [{ forge: "gitea", message: "token sem permissao de administracao" }],
    }),
    stderr: "",
    signal: null,
    error: undefined,
  }),
}

// ── sliceJob ──────────────────────────────────────────────────────────────

describe("sliceJob", () => {
  it("fatia o job e para no próximo job", () => {
    const job = sliceJob(pipeline(), FORGE_GUARDS_JOB)
    expect(job).toContain("check:bun-mirror")
    expect(job).toContain("rotate-secrets.mjs --check")
    expect(job).not.toContain("tsc --noEmit")
  })

  it("job inexistente → null", () => {
    expect(sliceJob(pipeline(), "nao-existe")).toBeNull()
  })

  it("comentário em coluna 0 no meio do job NÃO encerra a fatia", () => {
    const comComment = pipeline().replace(
      "    runs-on: ubuntu-latest",
      "    runs-on: ubuntu-latest\n# nota",
    )
    expect(sliceJob(comComment, FORGE_GUARDS_JOB)).toContain("check:bun-mirror")
  })

  it("na pipeline REAL: a fatia do job de guards tem os invariantes da forja", () => {
    const job = sliceJob(readFileSync(join(ROOT, MERGE_OWNER_PIPELINE), "utf8"), FORGE_GUARDS_JOB)
    expect(job, "job de guards não encontrado na pipeline real").not.toBeNull()
    for (const expected of ["check:bun-mirror", "check:forge-parity", "check:registry-source"]) {
      expect(job).toContain(expected)
    }
  })
})

// ── a trava: nunca executar um gate em modo de EFEITO ─────────────────────

describe("isVerificationCommand / gateCommand — a trava do modo de verificação", () => {
  it("RECUSA script sem flag: 'bun scripts/rotate-secrets.mjs' é modo de EFEITO", () => {
    // O defeito real: o rótulo do descobridor é o caminho, sem a flag. Executá-lo
    // rodaria o rotate-secrets preparando uma rotação de segredos.
    expect(isVerificationCommand("bun scripts/rotate-secrets.mjs")).toBe(false)
    const parsed = gateCommand("bun scripts/rotate-secrets.mjs")
    if (!("error" in parsed)) throw new Error("esperava recusa do comando sem modo de verificação")
    expect(parsed.error).toContain("modo de verificação")
  })

  it("aceita as formas de verificação: --check, --ci, entrada check:, script check-*/run-*", () => {
    expect(isVerificationCommand("bun scripts/rotate-secrets.mjs --check")).toBe(true)
    expect(isVerificationCommand("bash scripts/check-crlf.sh --ci")).toBe(true)
    expect(isVerificationCommand("bun run check:bun-mirror")).toBe(true)
    expect(isVerificationCommand("bun scripts/check-hooks-symmetry.mjs")).toBe(true)
    expect(isVerificationCommand("bash scripts/run-encoding-guards.sh")).toBe(true)
    expect(isVerificationCommand("bunx tsc --noEmit")).toBe(true)
  })

  it("reconstrói o interpretador quando o comando é só o caminho do script", () => {
    const parsed = gateCommand("scripts/check-hooks-symmetry.mjs")
    expect(parsed).toEqual({ cmd: "bun", args: ["scripts/check-hooks-symmetry.mjs"] })
    expect(gateCommand("scripts/check-crlf.sh --ci")).toMatchObject({ cmd: "bash" })
  })

  it("recusa metacaractere de shell (o doctor executa por lista, não por shell)", () => {
    const parsed = gateCommand('bun run check:x "$(rm -rf /)"')
    if (!("error" in parsed)) throw new Error("esperava recusa de comando com metacaractere")
    expect(parsed.error).toContain("caractere de shell")
  })
})

// ── gateRunLine: a flag sobrevive ─────────────────────────────────────────

describe("gateRunLine — o comando vem da linha, não do rótulo", () => {
  it("preserva a flag que o rótulo descarta", () => {
    const lines = pipeline().split("\n")
    expect(gateRunLine(lines, "scripts/rotate-secrets.mjs")).toBe(
      "bun scripts/rotate-secrets.mjs --check",
    )
  })

  it("linha de comentário que menciona o gate não conta como comando", () => {
    const lines = [
      "      # rode bun scripts/rotate-secrets.mjs --check",
      "      - run: bun run check:x",
    ]
    expect(gateRunLine(lines, "scripts/rotate-secrets.mjs")).toBeNull()
  })

  it("sem linha executável → null", () => {
    expect(gateRunLine(["      - uses: actions/checkout@v4"], "check:bun-mirror")).toBeNull()
  })
})

// ── forgeGates: derivado da pipeline ──────────────────────────────────────

describe("forgeGates — a bateria vem da pipeline dona do merge", () => {
  it("devolve o par rótulo+comando, com a flag preservada", () => {
    const { gates } = forgeGates(pipeline())
    expect(gates.map((g) => g.label)).toContain("bun run check:bun-mirror")
    const rotate = gates.find((g) => g.label === "scripts/rotate-secrets.mjs")
    expect(rotate?.command).toBe("bun scripts/rotate-secrets.mjs --check")
  })

  it("job ausente → erro explicando que a bateria não tem de onde ser derivada", () => {
    const { gates, error } = forgeGates("jobs:\n  outro:\n    steps: []\n")
    expect(gates).toEqual([])
    expect(error).toContain(FORGE_GUARDS_JOB)
    expect(error).toContain(MERGE_OWNER_PIPELINE)
  })

  it("job presente mas sem nenhum gate → erro (não é bateria vazia silenciosa)", () => {
    const { error } = forgeGates(pipeline({ guardLines: [], extraJob: true }))
    expect(error).toContain("não declara nenhum gate")
  })

  it("na pipeline REAL: todo gate tem comando resolvido E em modo de verificação", () => {
    const { gates, error } = forgeGates(readFileSync(join(ROOT, MERGE_OWNER_PIPELINE), "utf8"))
    expect(error, String(error)).toBeUndefined()
    expect(gates.length).toBeGreaterThan(5)

    const semLinha = gates.filter((g) => !g.command)
    expect(semLinha, `gates sem linha run: ${JSON.stringify(semLinha)}`).toEqual([])

    // O CORAÇÃO do teste: nenhum comando pode ser executado em modo de efeito.
    for (const g of gates) {
      const parsed = gateCommand(g.command as string)
      expect("error" in parsed, `${g.label} → ${g.command}`).toBe(false)
    }
  })
})

// ── summarize: o veredito ─────────────────────────────────────────────────

describe("summarize — o veredito", () => {
  it("tudo provado e imagem confirmada → PRONTA", () => {
    const v = summarize(facts())
    expect(v.verdict).toBe(VERDICT.READY)
    expect(v.blockers).toEqual([])
    expect(v.unknowns).toEqual([])
  })

  it("gate vermelho → BLOQUEADA", () => {
    const v = summarize(
      facts({ guards: { results: [{ gate: "check:x", code: 1, seconds: 1 }], error: null } }),
    )
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.blockers[0]).toContain("check:x")
  })

  it("gate NÃO executado (timeout/binário ausente) → INDETERMINADA, nunca PRONTA", () => {
    const v = summarize(
      facts({
        guards: {
          results: [{ gate: "check:x", code: null, seconds: 1, error: "timeout" }],
          error: null,
        },
      }),
    )
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    expect(v.unknowns[0]).toContain("não foi verificado")
  })

  it("imagem AUSENTE (exit 4) → BLOQUEADA (nenhum job inicia)", () => {
    const v = summarize(facts({ image: { code: 4, state: "missing", lines: [] } }))
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.blockers[0]).toContain("AUSENTE")
  })

  it("env ausente no checkout (exit 2) → INDETERMINADA: falta de prova não é prova de falha", () => {
    const v = summarize(facts({ image: { code: 2, state: "no-env", lines: [] } }))
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    expect(v.blockers).toEqual([])
    expect(v.unknowns[0]).toContain("env não existe neste checkout")
  })

  it("espelho divergente do VALOR declarado → BLOQUEADA (o certo é conhecido, não é dúvida)", () => {
    const v = summarize(
      facts({
        mirrors: {
          actrc: "1.3.14",
          env: "1.3.13",
          expected: "1.3.14",
          mirrors: [],
          warnings: [],
          blockers: ["deploy/env.gitea.example define BUN_VERSION='1.3.13'"],
          unknowns: [],
        },
      }),
    )
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.blockers[0]).toContain("1.3.13")
  })

  it("SEM o valor da variável → INDETERMINADA (a metade que prova existência não é a que prova o valor)", () => {
    const v = summarize(
      facts({
        mirrors: {
          actrc: "1.3.14",
          env: "1.3.14",
          expected: null,
          mirrors: [],
          warnings: [],
          blockers: [],
          unknowns: ["o VALOR dos espelhos NAO foi comparado com vars.BUN_VERSION"],
        },
      }),
    )
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    expect(v.unknowns[0]).toContain("VALOR")
  })

  it("espelho da forja ausente → BLOQUEADA; .actrc divergente → INDETERMINADA", () => {
    expect(
      summarize(
        facts({ mirrors: { actrc: null, env: null, blockers: ["env ausente"], unknowns: [] } }),
      ).verdict,
    ).toBe(VERDICT.BLOCKED)
    expect(
      summarize(
        facts({
          mirrors: { actrc: "1.3.14", env: "1.3.15", blockers: [], unknowns: ["divergem"] },
        }),
      ).verdict,
    ).toBe(VERDICT.UNKNOWN)
  })

  it("--no-guards rebaixa o veredito a INDETERMINADA e o diz no relatório", () => {
    const v = summarize(facts({ skippedGuards: true }))
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    expect(v.unproven[0]).toContain("--no-guards")
  })

  it("prova do bloqueio VIOLADA → BLOQUEADA (a garantia da imagem é decorativa)", () => {
    const v = summarize(
      facts({
        proof: {
          status: "violated",
          ok: false,
          detail: "1 caso(s) da prova falharam: ausente",
          cases: [],
        },
      }),
    )
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.blockers[0]).toContain("PROVA do bloqueio")
    expect(v.blockers[0]).toContain("decorativo")
  })

  it("prova indisponível (sem bash/bring-up) → INDETERMINADA, nunca PRONTA", () => {
    const v = summarize(facts({ proof: { status: "unavailable", ok: false, detail: "sem bash" } }))
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    expect(v.blockers).toEqual([])
    expect(v.unknowns.join(" ")).toContain("prova do bloqueio não executada")
  })

  it("--no-proof rebaixa o veredito e o declara no 'NÃO cobre'", () => {
    const v = summarize(facts({ skippedProof: true }))
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    expect(v.unknowns.join(" ")).toContain("--no-proof")
    expect(v.unproven[0]).toContain("--no-proof")
  })

  it("sempre declara o que NÃO cobre (branch protection, smoke, env do VPS)", () => {
    const v = summarize(facts())
    expect(v.unproven.join(" ")).toContain("branch protection")
    expect(v.unproven.join(" ")).toContain("smoke")
    expect(v.unproven.join(" ")).toContain(".env.gitea")
  })
})

// ── readMirrors: gravidade diferente por espelho ──────────────────────────

describe("readMirrors — os espelhos, contra o valor DECLARADO (fonte única do guard)", () => {
  /** Árvore mínima com os dois espelhos e, opcionalmente, o env de um host. */
  function mirrorTree({
    actrc = "1.3.14",
    template = "1.3.14",
    host = null,
  }: { actrc?: string; template?: string; host?: string | null } = {}): string {
    const dir = makeDir()
    writeFileSync(join(dir, ".actrc"), `--var BUN_VERSION=${actrc}\n`)
    mkdirSync(join(dir, "deploy"), { recursive: true })
    writeFileSync(join(dir, "deploy", "env.gitea.example"), `BUN_VERSION=${template}\n`)
    if (host !== null) {
      writeFileSync(join(dir, "deploy", ".env.gitea"), `BUN_VERSION=${host}\n`)
    }
    return dir
  }

  it("batendo com o VALOR → nem bloqueio nem dúvida", () => {
    expect(readMirrors(mirrorTree(), { expected: "1.3.14" })).toMatchObject({
      actrc: "1.3.14",
      env: "1.3.14",
      expected: "1.3.14",
      blockers: [],
      unknowns: [],
    })
  })

  it("SEM o valor → dúvida explícita: existência e concordância local NÃO são 'em sincronia'", () => {
    const r = readMirrors(mirrorTree())
    expect(r.expected).toBeNull()
    expect(r.blockers).toEqual([])
    expect(r.unknowns).toHaveLength(1)
    expect(r.unknowns[0]).toContain("o VALOR dos espelhos NAO foi comparado")
    expect(r.unknowns[0]).toContain("--expected")
  })

  it("env da forja ausente → BLOQUEIO (a forja não sabe qual imagem rodar)", () => {
    const dir = makeDir()
    writeFileSync(join(dir, ".actrc"), "--var BUN_VERSION=1.3.14\n")
    const r = readMirrors(dir, { expected: "1.3.14" })
    expect(r.blockers.length).toBe(1)
    expect(r.blockers[0]).toContain("label do runner")
  })

  it(".actrc divergente SEM o valor → dúvida ('um dos dois está velho')", () => {
    const r = readMirrors(mirrorTree({ actrc: "1.3.14", template: "1.3.15" }))
    expect(r.blockers).toEqual([])
    expect(r.unknowns[0]).toContain("divergem")
    expect(r.unknowns[0]).toContain("qual é o certo só a repository variable diz")
  })

  it("TEMPLATE divergente do valor declarado → BLOQUEIO (o runner roda outra imagem)", () => {
    const r = readMirrors(mirrorTree({ template: "1.3.13" }), { expected: "1.3.14" })
    expect(r.blockers).toHaveLength(1)
    expect(r.blockers[0]).toContain("deploy/env.gitea.example define BUN_VERSION='1.3.13'")
    expect(r.blockers[0]).toContain("vars.BUN_VERSION='1.3.14'")
    // O remédio é o ESCRITOR dos dois espelhos, com a versão certa.
    expect(r.blockers[0]).toContain("bump-bun.sh 1.3.14")
    // O template NÃO é o host: re-registrar o runner não é o passo dele.
    expect(r.blockers[0]).not.toContain("--re-register")
  })

  it("o env do HOST do checkout divergente → BLOQUEIO com o re-registro (o label é estado do registro)", () => {
    // DESCOBERTA (sem `envPath`): é o modo que o doctor usa, e o único que compara
    // o template E o host ao mesmo tempo — que é o caso do VPS.
    const r = readMirrors(mirrorTree({ host: "1.3.12" }), { expected: "1.3.14" })
    expect(r.blockers).toHaveLength(1)
    expect(r.blockers[0]).toContain("deploy/.env.gitea define BUN_VERSION='1.3.12'")
    expect(r.blockers[0]).toContain("re-registre o runner: bash deploy/gitea-up.sh --re-register")
    expect((r.mirrors as { label: string }[]).map((m) => m.label)).toContain("deploy/.env.gitea")
  })

  it("host e template divergentes → DOIS bloqueios (apontar um arquivo não pode largar o outro)", () => {
    const r = readMirrors(mirrorTree({ template: "1.3.13", host: "1.3.12" }), {
      expected: "1.3.14",
    })
    expect(r.blockers).toHaveLength(2)
    expect(r.blockers.join(" ")).toContain("deploy/env.gitea.example")
    expect(r.blockers.join(" ")).toContain("deploy/.env.gitea")
  })

  it("host do checkout em SINCRONIA → nada a apontar (ele entra na comparação)", () => {
    const r = readMirrors(mirrorTree({ host: "1.3.14" }), { expected: "1.3.14" })
    expect(r.blockers).toEqual([])
    expect(r.unknowns).toEqual([])
    expect((r.mirrors as { deployed: boolean }[]).some((m) => m.deployed)).toBe(true)
  })

  it("envPath apontando um arquivo INEXISTENTE não estoura (a ausência é da seção da imagem)", () => {
    const dir = mirrorTree()
    const r = readMirrors(dir, {
      expected: "1.3.14",
      envPath: join(dir, "deploy", ".env.gitea"),
    })
    expect(r.blockers).toEqual([])
    expect(r.unknowns).toEqual([])
  })

  it(".actrc divergente DO VALOR → dúvida com remédio concreto (é o act local, não a forja)", () => {
    const r = readMirrors(mirrorTree({ actrc: "1.3.10" }), { expected: "1.3.14" })
    expect(r.blockers).toEqual([])
    expect(r.unknowns).toHaveLength(1)
    expect(r.unknowns[0]).toContain(".actrc define BUN_VERSION='1.3.10'")
    expect(r.unknowns[0]).toContain("bump-bun.sh 1.3.14")
    expect(r.unknowns[0]).toContain("dev experience")
  })

  it("os avisos do GUARD viajam no fato (o log do doctor e a issue não podem divergir)", () => {
    const r = readMirrors(mirrorTree({ template: "1.3.13" }), { expected: "1.3.14" })
    expect(r.warnings.join(" ")).toContain("deploy/env.gitea.example define BUN_VERSION='1.3.13'")
  })
})

describe("renderReport — a seção dos espelhos diz CONTRA O QUE comparou", () => {
  const render = (f: ReturnType<typeof facts>) => {
    const lines: string[] = []
    renderReport({ facts: f, verdict: summarize(f) }, { emit: (s = "") => lines.push(s) })
    return lines.join("\n")
  }

  it("com o valor: nomeia a variável e cobra o veredito contra ela", () => {
    const text = render(facts())
    expect(text).toContain("5/5  Espelhos da versão do Bun")
    expect(text).toContain("comparados com vars.BUN_VERSION='1.3.14'")
  })

  it("sem o valor: diz que o VALOR não foi comparado (nunca 'em sincronia' por omissão)", () => {
    const text = render(
      facts({
        mirrors: {
          actrc: "1.3.14",
          env: "1.3.14",
          expected: null,
          mirrors: [],
          warnings: [],
          blockers: [],
          unknowns: [],
        },
      }),
    )
    expect(text).toContain("o VALOR não foi comparado")
    expect(text).not.toContain("comparados com vars.BUN_VERSION")
  })

  it("lista cada espelho comparado com o valor lido, e a marca segue o veredito do valor", () => {
    const text = render(
      facts({
        mirrors: {
          actrc: "1.3.14",
          env: "1.3.13",
          expected: "1.3.14",
          mirrors: [{ label: "deploy/env.gitea.example", deployed: false, version: "1.3.13" }],
          warnings: [],
          blockers: ["template velho"],
          unknowns: [],
        },
      }),
    )
    expect(text).toContain("deploy/env.gitea.example (template comitado): 1.3.13")
    expect(text).toContain("❌")
  })

  it("imprime o aviso do GUARD verbatim (o log do doctor e a issue não podem divergir)", () => {
    const text = render(
      facts({
        mirrors: {
          actrc: "1.3.14",
          env: "1.3.13",
          expected: "1.3.14",
          mirrors: [{ label: "deploy/env.gitea.example", deployed: false, version: "1.3.13" }],
          warnings: [
            "deploy/env.gitea.example define BUN_VERSION='1.3.13' mas a repository variable do GitHub é vars.BUN_VERSION='1.3.14'.",
          ],
          blockers: ["template velho"],
          unknowns: [],
        },
      }),
    )
    expect(text).toContain("o MESMO texto que o job semanal publica")
    expect(text).toContain("mas a repository variable do GitHub é vars.BUN_VERSION='1.3.14'")
  })
})

describe("CLI — o valor esperado entra por flag e é validado", () => {
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [join(ROOT, "scripts", "forge-doctor.mjs"), ...args], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 60_000,
    })

  it("--expected sem valor → exit 3 (uso inválido), e o erro diz o formato", () => {
    const res = run(
      "--no-guards",
      "--no-proof",
      "--no-compose-render",
      "--no-protection",
      "--expected",
    )
    expect(res.status).toBe(3)
    expect(res.stderr).toContain("--expected exige uma versão")
  })

  it("uma FLAG engolida como valor → exit 3 (senão o espelho 'divergiria de --json')", () => {
    const res = run("--expected", "--json")
    expect(res.status).toBe(3)
    expect(res.stderr).toContain("não uma flag")
  })

  it("--help documenta a flag e por que sem ela o veredito fica parcial", () => {
    const res = run("--help")
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("--expected <versão>")
    expect(res.stdout).toContain("INDETERMINADA")
  })
})

// ── compose: a interpolação do compose da forja entra no veredito ─────────

/** Render com variável vazia/literal: a garantia existe no texto, não no render. */
const composeViolated = {
  state: "violated",
  violations: ["deploy/docker-compose.gitea.yml: a TAG do label resolveu VAZIA"],
  detail: "1 violacao(oes) na interpolacao",
  hostCompare: { state: "in-sync", detail: "host x template em sincronia" },
}

/** Sem docker/compose no ambiente: ausência de prova, não prova de falha. */
const composeUnavailable = {
  state: "unavailable",
  violations: [],
  detail: "docker compose indisponivel: spawn docker ENOENT",
  hostCompare: { state: "absent", detail: "o env do HOST nao existe neste checkout" },
}

describe("summarize — interpolação do compose", () => {
  it("provada → não muda o veredito", () => {
    expect(summarize(facts()).verdict).toBe(VERDICT.READY)
  })

  it("checkout sem a stack da forja ('absent') → não rebaixa (nada a interpolar)", () => {
    const v = summarize(
      facts({ compose: { state: "absent", violations: [], detail: "nao existe neste checkout" } }),
    )
    expect(v.verdict).toBe(VERDICT.READY)
  })

  it("VIOLADA → BLOQUEADA, com a violação no relatório de bloqueios", () => {
    const v = summarize(facts({ compose: composeViolated }))
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.blockers.join(" ")).toContain("VAZIA")
  })

  it("indisponível → INDETERMINADA (nunca 'pronta' sem a prova)", () => {
    const v = summarize(facts({ compose: composeUnavailable }))
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    expect(v.unknowns.join(" ")).toContain("nao foi provada")
  })

  it("pulada por --no-compose-render → INDETERMINADA, e o relatório diz o que ficou de fora", () => {
    const v = summarize(
      facts({
        compose: { state: "skipped", violations: [], detail: "pulada por --no-compose-render" },
      }),
    )
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    expect(v.unproven.join(" ")).toContain("DOCKER DO RUNNER")
  })

  it("o relatório mostra a interpolação na seção da imagem", () => {
    const lines: string[] = []
    renderReport(
      {
        facts: facts({ compose: composeViolated }),
        verdict: summarize(facts({ compose: composeViolated })),
      },
      { emit: (s = "") => lines.push(s) },
    )
    const text = lines.join("\n")
    expect(text).toContain("interpolacao do compose")
    expect(text).toContain("VAZIA")
  })

  it("o relatório nomeia a comparação host x template (o VPS x o repositório)", () => {
    const lines: string[] = []
    renderReport(
      {
        facts: facts(),
        verdict: summarize(facts()),
      },
      { emit: (s = "") => lines.push(s) },
    )
    expect(lines.join("\n")).toContain("host x template")
  })
})

// ── host x template: a metade da invariante 7 que depende do arquivo do VPS ──

describe("summarize — host x template", () => {
  /** O render provado, mas sem o arquivo do host para comparar. */
  const hostAbsent = {
    state: "proven",
    violations: [],
    detail: "3 fases ok",
    hostCompare: { state: "absent", detail: "o env do HOST (deploy/.env.gitea) nao existe" },
  }

  it("render provado SEM o env do host → INDETERMINADA (o VPS pode interpolar outra coisa)", () => {
    const v = summarize(facts({ compose: hostAbsent }))
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    expect(v.unknowns.join(" ")).toContain("env do HOST nao foi comparado")
  })

  it("em sincronia → não rebaixa o veredito", () => {
    expect(summarize(facts()).verdict).toBe(VERDICT.READY)
  })

  it("checkout SEM a stack da forja ('absent') → a ausência do host não é cobrada (nada a comparar)", () => {
    const v = summarize(
      facts({
        compose: {
          state: "absent",
          violations: [],
          detail: "nao existe neste checkout",
          hostCompare: { state: "absent", detail: "a stack nao existe neste checkout" },
        },
      }),
    )
    expect(v.verdict).toBe(VERDICT.READY)
  })
})

describe("readComposeInterpolation — o fato, sem executar docker", () => {
  it("injeta o check e devolve o estado", async () => {
    const r = await readComposeInterpolation({
      deps: { check: () => ({ state: "violated", violations: ["x"], detail: "1" }) },
    })
    expect(r).toMatchObject({ state: "violated", detail: "1" })
    expect(r.violations).toEqual(["x"])
  })

  it("check que lança → 'unavailable' (o doctor nunca cai por causa de um fato)", async () => {
    const r = await readComposeInterpolation({
      deps: {
        check: () => {
          throw new Error("boom")
        },
      },
    })
    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("boom")
    expect(r.hostCompare.state).toBe("absent")
  })

  it("o veredito da comparação host x template VIAJA com o fato (e o env apontado chega ao check)", async () => {
    let seen: Record<string, unknown> = {}
    const r = await readComposeInterpolation({
      hostEnv: "deploy/.env.gitea",
      deps: {
        check: (args: Record<string, unknown>) => {
          seen = args
          return {
            state: "proven",
            violations: [],
            detail: "3 fases ok",
            hostCompare: { state: "in-sync", detail: "host x template em sincronia" },
          }
        },
      },
    })
    expect(seen.hostEnv).toBe("deploy/.env.gitea")
    expect(r.hostCompare.state).toBe("in-sync")
  })
})

// ── branch protection REGISTRADA: o outro lado do contrato de merge ────────

describe("readProtection — o que a forja REGISTRA (e não o que o repo declara)", () => {
  const stub = (res: Record<string, unknown>) => () =>
    ({ status: 0, stdout: "", stderr: "", signal: null, error: undefined, ...res }) as never

  it("em sincronia → 'in-sync', com a contagem do manifesto", () => {
    const r = readProtection({ forges: ["gitea"], run: protectionInSync.run as never })
    expect(r.state).toBe("in-sync")
    expect((r.forges[0] as { desired: number }).desired).toBe(1)
    expect(r.detail).toContain("main exige os 1 check(s)")
  })

  it("DRIFT nos dois sentidos → nomeia o que falta E o que sobra (os remédios diferem)", () => {
    const r = readProtection({ forges: ["gitea"], run: protectionDrift.run as never })
    expect(r.state).toBe("drift")
    expect(r.detail).toContain("falta(m) 'Repo Guards'")
    expect(r.detail).toContain("sobra(m) 'Repo Guards (renomeado)'")
    expect((r.forges[0] as { missing: string[] }).missing).toEqual(["Repo Guards"])
  })

  it("sem credencial de administração → 'unavailable' (NÃO 'em sincronia')", () => {
    const r = readProtection({ forges: ["gitea"], run: protectionUnreadable.run as never })
    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("token sem permissao de administracao")
  })

  it("aplicador que não terminou → 'unavailable' com a promessa de timeout dita", () => {
    const r = readProtection({
      forges: ["gitea"],
      run: stub({ signal: "SIGTERM", status: null }) as never,
    })
    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("60s")
  })

  it("binário que não existe → 'unavailable' (falha de execução não é evidência sobre a forja)", () => {
    const r = readProtection({
      forges: ["gitea"],
      run: stub({ error: new Error("spawn node ENOENT"), status: null }) as never,
    })
    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("nao consegui executar o aplicador")
  })

  it("JSON ausente/ilegível no stdout → 'unavailable', nunca verde por omissão", () => {
    const r = readProtection({ forges: ["gitea"], run: stub({ status: 0 }) as never })
    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("nao reportou a forja")
  })

  it("aplicador que NÃO reporta a forja (ex.: pulou) → 'unavailable', não 'em sincronia'", () => {
    const r = readProtection({
      forges: ["gitea"],
      run: stub({ status: 0, stdout: applierJson({ forge: "gitea", forges: {} }) }) as never,
    })
    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("nao reportou a forja 'gitea'")
  })

  it("o veredito do APLICADOR manda: `drift: true` sem contexto nomeado ainda é drift", () => {
    const r = readProtection({
      forges: ["gitea"],
      run: stub({ status: 1, stdout: applierJson({ forge: "gitea", drift: true }) }) as never,
    })
    expect(r.state).toBe("drift")
    expect(r.detail).toContain("sem nomear contexto")
  })

  it("manifesto sem forja nenhuma → 'unavailable' (não há o que comparar)", () => {
    const r = readProtection({ forges: [], run: protectionInSync.run as never })
    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("nao declara forja nenhuma")
  })

  it("um drift em UMA forja contamina o agregado (o merge bloqueia em QUALQUER forja)", () => {
    const run = ((_bin: string, args: string[]) => {
      const forge = forgeOf(args)
      const drifted = forge === "github"
      return {
        status: drifted ? 1 : 0,
        stdout: applierJson({
          forge,
          drift: drifted,
          forges: { [forge]: drifted ? forgeUnprotected() : forgeInSync() },
        }),
        stderr: "",
        signal: null,
      }
    }) as never
    const r = readProtection({ forges: ["gitea", "github"], run })
    expect(r.state).toBe("drift")
    // A forja em sincronia NÃO é acusada (o relatório diz quem divergiu).
    expect(r.detail).toContain("gitea: main exige os 1 check(s)")
    expect(r.detail).toContain("github: main NAO tem protecao registrada")
  })

  it("proteção AUSENTE tem mensagem própria (0 de N não é o mesmo que falta um)", () => {
    const r = readProtection({
      forges: ["gitea"],
      run: (() => ({
        status: 1,
        stdout: applierJson({
          forge: "gitea",
          drift: true,
          forges: { gitea: forgeUnprotected() },
        }),
        stderr: "",
        signal: null,
      })) as never,
    })
    expect(r.state).toBe("drift")
    expect(r.detail).toContain("nenhum check bloqueia o merge")
  })

  it("o bloqueio carrega a forja E o remédio (o operador não precisa saber o manifesto)", () => {
    const protection = readProtection({
      forges: ["gitea", "github"],
      run: protectionDrift.run as never,
    })
    const msgs = protectionBlockers(protection)
    // Só a forja em drift bloqueia: a outra está em sincronia e não vira ruído.
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toContain("branch protection REGISTRADA no gitea")
    expect(msgs[0]).toContain(REQUIRED_CHECKS_MANIFEST)
    expect(msgs[0]).toContain("ci:required-checks -- --apply")
  })

  it("in-sync e unavailable não geram bloqueio (só drift bloqueia)", () => {
    expect(protectionBlockers({ forges: [{ forge: "gitea", state: "in-sync" }] })).toEqual([])
    expect(protectionBlockers({ forges: [{ forge: "gitea", state: "unavailable" }] })).toEqual([])
  })
})

describe("summarize — as referências NÃO versionadas", () => {
  it("provadas (com itens não aplicáveis) não entram nem em blocker nem em pendência", () => {
    const v = summarize(facts())
    expect(v.verdict).toBe(VERDICT.READY)
    expect(v.blockers.join(" ")).not.toContain("versionada")
    expect(v.unknowns.join(" ")).not.toContain("versionada")
    // "gitignored por desenho" NÃO pode virar pendência: é o arquivo do VPS ausente
    // num checkout que não é o VPS.
    expect(v.unknowns.join(" ")).not.toContain("deploy/.env.gitea")
  })

  it("uma VIOLAÇÃO bloqueia (o valor provado errado é pior que o valor não provado)", () => {
    const v = summarize(
      facts({
        imageRefs: refsFacts({
          state: "violated",
          violations: ["IMAGE_REGISTRY='git.severinno.cloud' diverge de .actrc='ghcr.io'"],
          detail: "1 violacao(oes)",
        }),
      }),
    )
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.blockers.join(" ")).toContain("git.severinno.cloud")
  })

  it("INDETERMINADO rebaixa para INDETERMINADA e nomeia o que faltou (sem os não aplicáveis)", () => {
    const v = summarize(
      facts({
        imageRefs: refsFacts({
          state: "indeterminate",
          detail: "1 referencia(s) NAO PROVADA(S)",
          items: [
            {
              source: "registry (o que a tag serve hoje)",
              state: "indeterminate",
              detail: "HTTP 401",
            },
            {
              source: "env do host .env.production.local",
              state: "absent",
              detail: "gitignored por desenho",
            },
          ],
        }),
      }),
    )
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    const unknown = v.unknowns.join(" ")
    expect(unknown).toContain("NAO VERSIONADAS")
    expect(unknown).toContain("registry")
    // O item `absent` NÃO entra na lista de pendências: ele existe em qualquer
    // checkout que não seja o VPS, e listá-lo faria a pendência parecer maior.
    expect(unknown).not.toContain(".env.production.local")
  })

  it("readImageRefs nunca derruba o doctor: se a avaliação falhar, é ausência de prova", async () => {
    const dir = forgeFixture()
    const r = await readImageRefs({
      cwd: dir,
      envFile: "deploy/.env.gitea",
      deps: {
        probe: async () => {
          throw new Error("boom")
        },
      },
    })
    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("boom")
    expect(summarize(facts({ imageRefs: r })).verdict).toBe(VERDICT.UNKNOWN)
  })
})

describe("summarize — o REGISTRO do act_runner", () => {
  it("provado não muda o veredito nem entra em pendência", () => {
    const v = summarize(facts())
    expect(v.verdict).toBe(VERDICT.READY)
    expect(v.blockers.filter((b) => b.includes("act_runner"))).toEqual([])
    expect(v.unknowns.filter((u) => u.includes("act_runner"))).toEqual([])
  })

  it("registro VELHO bloqueia, nomeando o arquivo lido e o remédio do guard", () => {
    const v = summarize(
      facts({
        runnerLabels: runnerLabelFacts({
          state: "violated",
          detail: "2 divergência(s) entre o registro e o compose",
          violations: [
            "o label 'ubuntu-latest' está registrado apontando para 'ghcr.io/severinno/ubuntu-bun:1.3.13', e o compose declara 'ghcr.io/severinno/ubuntu-bun:1.3.14' — o job cai na imagem ANTIGA, sem o Bun pré-instalado (o tier-1 do setup-bun não engaja e o download volta em TODO job, sem outro sintoma)",
          ],
          remedies: [
            "Remédio: `bash deploy/gitea-up.sh --re-register` — ver deploy/GITEA.md § Runner.",
          ],
        }),
      }),
    )
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    const blocker = v.blockers.find((b) => b.includes("act_runner"))!
    expect(blocker).toContain("NAO é o do compose")
    // Onde o arquivo foi lido: sem isto o operador não sabe QUAL registro julgar.
    expect(blocker).toContain("gitea-runner · /data/.runner")
    expect(blocker).toContain("1.3.13")
    expect(blocker).toContain("--re-register")
  })

  it("registro VAZIO (runner órfão) bloqueia pelo mesmo caminho", () => {
    const v = summarize(
      facts({
        runnerLabels: runnerLabelFacts({
          state: "violated",
          detail: "o registro do runner está VAZIO e o compose declara 2 label(s)",
          registered: [],
          violations: [
            "o runner está RODANDO e não tem NENHUM label registrado em /data/.runner: é um runner órfão — nenhum job é atribuído a ele",
          ],
          remedies: ["Remédio: `bash deploy/gitea-up.sh --re-register`"],
        }),
      }),
    )
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.blockers.join(" ")).toContain("runner órfão")
  })

  it("INDISPONÍVEL (sem docker/container/registro ilegível) rebaixa e diz POR QUÊ", () => {
    const v = summarize(
      facts({
        runnerLabels: runnerLabelFacts({
          state: "unavailable",
          registered: [],
          detail:
            "docker exec gitea-runner cat /data/.runner falhou: No such container: gitea-runner",
        }),
      }),
    )
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    const unknown = v.unknowns.find((u) => u.includes("act_runner"))!
    expect(unknown).toContain("nao foi comparado")
    expect(unknown).toContain("unavailable")
    expect(unknown).toContain("No such container")
    expect(v.blockers).toEqual([])
  })

  it("`env-missing` (o compose não renderiza o serviço) é não-provado, nunca 'está certo'", () => {
    const v = summarize(
      facts({
        runnerLabels: runnerLabelFacts({ state: "env-missing", detail: "sem env da forja" }),
      }),
    )
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    expect(v.unknowns.join(" ")).toContain("env-missing")
  })

  it("--no-runner-labels declara-se: pendência nomeada E o que o veredito NÃO cobre", () => {
    const v = summarize(facts({ skippedRunnerLabels: true }))
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    expect(v.unknowns.join(" ")).toContain("--no-runner-labels")
    expect(v.unproven.join(" ")).toContain("registro do act_runner")
  })

  it("readRunnerLabels nunca derruba o doctor: se a leitura falhar, é ausência de prova", () => {
    const r = readRunnerLabels({
      cwd: makeDir(),
      deps: {
        check: () => {
          throw new Error("boom")
        },
      },
    })
    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("boom")
    expect(r.violations).toEqual([])
    expect(summarize(facts({ runnerLabels: r })).verdict).toBe(VERDICT.UNKNOWN)
  })

  it("readRunnerLabels repassa a descoberta do guard: sem envFile próprio, o facto não inventa baseline", () => {
    const seen: (string | null)[] = []
    const r = readRunnerLabels({
      cwd: makeDir(),
      envFile: null,
      deps: {
        check: (opts: { envFile: string | null }) => {
          seen.push(opts.envFile)
          return {
            state: "proven",
            violations: [],
            remedies: [],
            detail: "ok",
            declared: ["a"],
            registered: ["a"],
            container: "c",
            stateFile: "/s",
          }
        },
      },
    })
    expect(seen).toEqual([null])
    expect(r.state).toBe("proven")
  })
})

describe("renderReport — o registro do act_runner", () => {
  it("mostra onde o registro foi lido e o remédio de cada caso", () => {
    const lines: string[] = []
    const f = facts({
      runnerLabels: runnerLabelFacts({
        state: "violated",
        detail: "o registro do runner está VAZIO e o compose declara 2 label(s)",
        registered: [],
        violations: ["o runner está RODANDO e não tem NENHUM label registrado"],
        remedies: ["Remédio: `bash deploy/gitea-up.sh --re-register`"],
      }),
    })
    renderReport({ facts: f, verdict: summarize(f) }, { emit: (s = "") => lines.push(s) })
    const text = lines.join("\n")
    expect(text).toContain("registro do act_runner (gitea-runner · /data/.runner)")
    expect(text).toContain("NENHUM label registrado")
    expect(text).toContain("--re-register")
  })

  it("com --no-runner-labels o relatório mostra 'pulada' (o veredito não a cobre)", () => {
    const lines: string[] = []
    const f = facts({
      // O fato PULADO, como o diagnose monta: sem container/stateFile (nada foi
      // lido), só o motivo. O relatório não pode inventar onde leu.
      runnerLabels: runnerLabelFacts({
        state: "skipped",
        detail: "pulada por --no-runner-labels",
        container: null,
        stateFile: null,
      }),
      skippedRunnerLabels: true,
    })
    renderReport({ facts: f, verdict: summarize(f) }, { emit: (s = "") => lines.push(s) })
    expect(lines.join("\n")).toContain("registro do act_runner: pulada por --no-runner-labels")
  })
})

describe("summarize — o REGISTRO do runner do GitHub (a outra forja)", () => {
  it("provado não muda o veredito nem entra em pendência", () => {
    const v = summarize(facts())
    expect(v.verdict).toBe(VERDICT.READY)
    expect(v.unknowns.join(" ")).not.toContain("GitHub")
  })

  it("registro VELHO → BLOQUEADA, nomeando runner, API e remédio — num bloqueio SÓ", () => {
    const f = facts({
      githubRunnerLabels: githubRunnerLabelFacts({
        state: "violated",
        detail:
          "1 problema(s) entre o registro do GitHub e o que deploy/setup-github-runner.sh declara",
        registered: ["self-hosted", "Linux", "X64"],
        violations: [
          "o setup declara o label 'docker' e o REGISTRO não o tem (registro: self-hosted , Linux , X64) — um job com `runs-on: docker` não encontra este runner: ele ESPERA, e nada falha",
        ],
        remedies: ["Remédio: `bash deploy/setup-github-runner.sh` — ele registra com `--replace`."],
      }),
    })
    const v = summarize(f)
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    // Um bloqueio, não N: as linhas do guard descrevem o MESMO problema.
    expect(v.blockers).toHaveLength(1)
    expect(v.blockers[0]).toContain("GITHUB")
    expect(v.blockers[0]).toContain("hostinger-runner")
    expect(v.blockers[0]).toContain("repos/severinno/severinno/actions/runners")
    expect(v.blockers[0]).toContain("setup-github-runner.sh")
    expect(v.blockers[0]).toContain("ESPERA")
  })

  it("runner OFFLINE → BLOQUEADA (existe no painel e não pega job)", () => {
    const f = facts({
      githubRunnerLabels: githubRunnerLabelFacts({
        state: "violated",
        status: "offline",
        detail: "1 problema(s)",
        violations: ["o runner 'hostinger-runner' está registrado como 'offline' (não 'online')"],
        remedies: ["Remédio: `sudo systemctl restart actions.runner.*`"],
      }),
    })
    const v = summarize(f)
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.blockers[0]).toContain("offline")
  })

  it("o bloqueio é UM só, e nomeia onde o registro foi lido", () => {
    const b = githubRunnerLabelBlockers(
      githubRunnerLabelFacts({
        state: "violated",
        detail: "2 problema(s)",
        violations: ["v1", "v2"],
        remedies: ["Remédio: r"],
      }),
    )
    expect(b).toHaveLength(1)
    expect(b[0]).toContain("v1 · v2")
    expect(b[0]).toContain("Remédio: r")
    expect(b[0]).toContain("'hostinger-runner' (online)")
    expect(b[0]).toContain("repos/severinno/severinno/actions/runners")
  })

  it("sem runner selecionado (o registro não tem o declarado) o bloqueio ainda nomeia a API", () => {
    const b = githubRunnerLabelBlockers({
      detail: "d",
      repo: "o/r",
      violations: ["v"],
      remedies: [],
    })
    expect(b[0]).toContain("repos/o/r/actions/runners")
    expect(b[0]).not.toContain("null")
  })

  it("sem token / API fora → INDETERMINADA, nunca 'em sincronia'", () => {
    for (const state of ["unavailable", "env-missing"]) {
      const f = facts({
        githubRunnerLabels: githubRunnerLabelFacts({
          state,
          detail: "sem token de self-hosted runners no ambiente (GITHUB_TOKEN ou GH_TOKEN)",
        }),
      })
      const v = summarize(f)
      expect(v.verdict).toBe(VERDICT.UNKNOWN)
      expect(v.unknowns.join(" ")).toContain("runner do GitHub nao foi comparado")
      expect(v.unknowns.join(" ")).toContain("setup-github-runner.sh")
    }
  })

  it("--no-runner-labels cobre as DUAS forjas (na pendência e no 'NÃO cobre')", () => {
    const v = summarize(facts({ skippedRunnerLabels: true }))
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    expect(v.unknowns.join(" ")).toContain("act_runner")
    expect(v.unknowns.join(" ")).toContain("GitHub")
    expect(v.unproven.join(" ")).toContain("act_runner")
    expect(v.unproven.join(" ")).toContain("auto-hospedado do GitHub")
  })
})

describe("readGithubRunnerLabels — o fato, sem tocar na API", () => {
  it("injeta o check e devolve o estado (incluindo onde o registro foi lido)", async () => {
    const res = await readGithubRunnerLabels({
      cwd: makeDir(),
      deps: {
        check: async () => ({
          state: "proven",
          violations: [],
          remedies: [],
          detail: "ok",
          declared: ["a"],
          registered: ["A"],
          runner: "r",
          status: "online",
          repo: "o/r",
        }),
      },
    })
    expect(res.state).toBe("proven")
    expect(res.runner).toBe("r")
    expect(res.repo).toBe("o/r")
  })

  it("check que lança → 'unavailable' (o doctor nunca cai por causa de um fato)", async () => {
    const res = await readGithubRunnerLabels({
      cwd: makeDir(),
      deps: {
        check: async () => {
          throw new Error("boom")
        },
      },
    })
    expect(res.state).toBe("unavailable")
    expect(res.detail).toContain("boom")
    expect(res.violations).toEqual([])
    expect(summarize(facts({ githubRunnerLabels: res })).verdict).toBe(VERDICT.UNKNOWN)
  })

  it("repassa o ENV (o token vem do ambiente, nunca do arquivo)", async () => {
    const seen: unknown[] = []
    await readGithubRunnerLabels({
      cwd: makeDir(),
      env: { ...process.env, GH_TOKEN: "segredo" },
      deps: {
        check: async (args: { env: unknown }) => {
          seen.push(args.env)
          return { state: "proven", violations: [], remedies: [], detail: "ok" }
        },
      },
    })
    // O ponto é o REPASSE do env (o token vive nele, nunca num arquivo) —
    // não o conteúdo inteiro, que é o ambiente do processo de teste.
    expect(seen).toHaveLength(1)
    expect((seen[0] as Record<string, string>).GH_TOKEN).toBe("segredo")
  })
})

describe("renderReport — o registro do runner (github)", () => {
  it("mostra o runner, a API e o remédio de cada caso", () => {
    const lines: string[] = []
    const f = facts({
      githubRunnerLabels: githubRunnerLabelFacts({
        state: "violated",
        detail: "1 problema(s)",
        registered: ["self-hosted", "Linux", "X64"],
        violations: ["o runner 'hostinger-runner' está registrado como 'offline' (não 'online')"],
        remedies: ["Remédio: `sudo systemctl restart actions.runner.*`"],
      }),
    })
    renderReport({ facts: f, verdict: summarize(f) }, { emit: (s = "") => lines.push(s) })
    const text = lines.join("\n")
    expect(text).toContain("registro do runner (github) (repos/severinno/severinno/actions/runners")
    expect(text).toContain("hostinger-runner")
    expect(text).toContain("systemctl restart")
  })

  it("com --no-runner-labels o relatório mostra 'pulada' nas DUAS linhas do registro", () => {
    const lines: string[] = []
    const f = facts({
      runnerLabels: runnerLabelFacts({
        state: "skipped",
        detail: "pulada por --no-runner-labels",
        container: null,
        stateFile: null,
      }),
      githubRunnerLabels: githubRunnerLabelFacts({
        state: "skipped",
        detail: "pulada por --no-runner-labels",
        runner: null,
        status: null,
        repo: null,
      }),
      skippedRunnerLabels: true,
    })
    renderReport({ facts: f, verdict: summarize(f) }, { emit: (s = "") => lines.push(s) })
    const text = lines.join("\n")
    expect(text).toContain("registro do act_runner: pulada por --no-runner-labels")
    expect(text).toContain("registro do runner (github): pulada por --no-runner-labels")
  })
})

describe("summarize — a branch protection REGISTRADA", () => {
  it("em sincronia → não muda o veredito", () => {
    expect(summarize(facts()).verdict).toBe(VERDICT.READY)
  })

  it("DRIFT → BLOQUEADA, nomeando a forja e o remédio (o manifesto é a fonte)", () => {
    const protection = protectionFacts({
      state: "drift",
      detail: "gitea: main exige 0 de 1 check(s): falta(m) 'Repo Guards'",
      forges: [
        {
          forge: "gitea",
          state: "drift",
          desired: 1,
          branches: [],
          missing: ["Repo Guards"],
          extra: [],
          detail: "main exige 0 de 1 check(s): falta(m) 'Repo Guards'",
        },
      ],
    })
    const v = summarize(facts({ protection }))
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.blockers.join(" ")).toContain("branch protection REGISTRADA no gitea")
    expect(v.blockers.join(" ")).toContain("ci:required-checks -- --apply")
  })

  it("não lida (sem token de administração) → INDETERMINADA, nunca 'pronta'", () => {
    const v = summarize(
      facts({
        protection: protectionFacts({
          state: "unavailable",
          detail: "gitea: token sem permissao de administracao",
        }),
      }),
    )
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    expect(v.blockers).toEqual([])
    expect(v.unknowns.join(" ")).toContain("branch protection REGISTRADA nao foi lida")
  })

  it("pulada por --no-protection → INDETERMINADA e o relatório diz o que ficou de fora", () => {
    const v = summarize(facts({ skippedProtection: true }))
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    expect(v.unknowns.join(" ")).toContain("--no-protection")
    expect(v.unproven[0]).toContain("--no-protection")
  })

  it("o relatório mostra as DUAS metades do contrato na seção 1", () => {
    const lines: string[] = []
    const f = facts()
    renderReport({ facts: f, verdict: summarize(f) }, { emit: (s = "") => lines.push(s) })
    const text = lines.join("\n")
    expect(text).toContain("o que o repositório DECLARA × o que a forja REGISTRA")
    expect(text).toContain("gitea")
    expect(text).toContain("registrado: main exige os 3 check(s) do manifesto")
  })

  it("com --no-protection o relatório diz 'pulado' em vez de mostrar a forja", () => {
    const lines: string[] = []
    const f = facts({ skippedProtection: true })
    renderReport({ facts: f, verdict: summarize(f) }, { emit: (s = "") => lines.push(s) })
    const text = lines.join("\n")
    expect(text).toContain("registrado: pulado por --no-protection")
    expect(text).not.toContain("main exige os 3 check(s)")
  })

  it("o que NÃO é provado nomeia a leitura COM o aplicador (a permissão do token)", () => {
    const v = summarize(facts())
    expect(v.unproven.join(" ")).toContain("PERMISSAO do token")
    expect(v.unproven.join(" ")).toContain("apply-required-checks.mjs")
  })
})

// ── diagnose: ponta a ponta, sem executar nada ────────────────────────────

/** Resposta OCI falsa (o mesmo formato que o ensure consome). */
function oci(status: number) {
  return { status, ok: status >= 200 && status < 300, headers: { get: () => null } }
}

/** Forja sintética COMPLETA (pipeline + manifesto + espelhos + env do runner). */
function forgeFixture(opts: { pipelineContent?: string } = {}): string {
  const dir = makeDir()
  mkdirSync(join(dir, ".gitea", "workflows"), { recursive: true })
  mkdirSync(join(dir, "ci"), { recursive: true })
  mkdirSync(join(dir, "deploy"), { recursive: true })

  writeFileSync(join(dir, MERGE_OWNER_PIPELINE), opts.pipelineContent ?? pipeline())
  writeFileSync(
    join(dir, REQUIRED_CHECKS_MANIFEST),
    JSON.stringify({
      version: 1,
      branches: ["main"],
      forges: {
        gitea: { workflow: MERGE_OWNER_PIPELINE, jobs: ["guards"] },
        github: { workflow: MERGE_OWNER_PIPELINE, jobs: ["guards"] },
      },
    }),
  )
  writeFileSync(join(dir, ".actrc"), "--var BUN_VERSION=1.3.14\n")
  writeFileSync(join(dir, "deploy", "env.gitea.example"), "BUN_VERSION=1.3.14\n")
  writeFileSync(
    join(dir, "deploy", ".env.gitea"),
    "IMAGE_REGISTRY=ghcr.io\nIMAGE_NAMESPACE=severinno\nBUN_VERSION=1.3.14\n",
  )
  return dir
}

describe("diagnose — fluxo completo com dependências dubladas", () => {
  /**
   * O fato das referências NÃO versionadas tem a própria fronteira de
   * dependência (o ambiente do processo e a consulta ao registry), e o dublê
   * devolve "provado" porque a pergunta AQUI é o veredito do doctor — a
   * consulta em si tem os seus testes, contra um registry HTTP de verdade.
   * Sem isto o diagnóstico tentaria a rede: lento, e dependente de DNS.
   */
  const refsProven = {
    env: {},
    probe: async () => ({
      state: "proven",
      detail: "dubê do registry",
      digest: null,
      version: "1.3.14",
    }),
  }

  /**
   * O mesmo para o registro do act_runner: o `check` dublê devolve "provado"
   * sem docker nenhum. A comparação em si (e os três estados) tem os próprios
   * testes, em check-runner-labels.test.ts.
   */
  const labelsProven = {
    check: () => ({
      state: "proven",
      violations: [],
      remedies: [],
      detail: "2 label(s) registrado(s) idênticos ao compose",
      declared: ["ubuntu-latest:docker://ghcr.io/o/ubuntu-bun:1.3.14"],
      registered: ["ubuntu-latest:docker://ghcr.io/o/ubuntu-bun:1.3.14"],
      container: "gitea-runner",
      stateFile: "/data/.runner",
    }),
  }

  /**
   * O mesmo para o registro do runner do GitHub: o `check` dublê devolve
   * "provado" sem API nem token. Sem isto, o fato iria de verdade à API — e o
   * teste dependeria de rede (e do escopo de self-hosted runners) para falar do
   * veredito, que é o que ele testa.
   */
  const githubLabelsProven = {
    check: async () => ({
      state: "proven",
      violations: [],
      remedies: [],
      detail: "4 label(s) registrado(s) idênticos ao setup, em 'hostinger-runner' (online)",
      declared: ["self-hosted", "linux", "x64", "docker"],
      registered: ["self-hosted", "Linux", "X64", "docker"],
      runner: "hostinger-runner",
      status: "online",
      repo: "severinno/severinno",
    }),
  }

  it("forja completa e registry 200 → PRONTA", async () => {
    const dir = forgeFixture()
    const { facts } = await diagnose({
      cwd: dir,
      envFile: "deploy/.env.gitea",
      expected: "1.3.14",
      run: passRun,
      imageDeps: { fetchImpl: async () => oci(200) },
      imageRefsDeps: refsProven,
      runnerLabelsDeps: labelsProven,
      githubRunnerLabelsDeps: githubLabelsProven,
      proofDeps: proofHolds,
      imageContractDeps: imageContractProven,
      protectionDeps: protectionInSync,
    })
    expect(summarize(facts).verdict, JSON.stringify(summarize(facts).blockers)).toBe(VERDICT.READY)
  })

  it("registry 404 na tag → BLOQUEADA, mesmo com todos os guards verdes", async () => {
    const dir = forgeFixture()
    const { facts } = await diagnose({
      cwd: dir,
      envFile: "deploy/.env.gitea",
      expected: "1.3.14",
      run: passRun,
      imageDeps: { fetchImpl: async () => oci(404) },
      imageRefsDeps: refsProven,
      runnerLabelsDeps: labelsProven,
      githubRunnerLabelsDeps: githubLabelsProven,
      proofDeps: proofHolds,
      imageContractDeps: imageContractProven,
      protectionDeps: protectionInSync,
    })
    const v = summarize(facts)
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.blockers.join(" ")).toContain("AUSENTE")
  })

  /**
   * O registro do runner do GitHub DIVERGENTE, dublado: o doctor tem de bloquear
   * mesmo com guards, imagem, prova, render e protection verdes — o merge no
   * GitHub depende dos checks que só rodam nesse runner.
   */
  const githubLabelsStale = {
    check: async () => ({
      state: "violated",
      detail:
        "1 problema(s) entre o registro do GitHub e o que deploy/setup-github-runner.sh declara",
      declared: ["self-hosted", "linux", "x64", "docker"],
      registered: ["self-hosted", "Linux", "X64"],
      violations: [
        "o setup declara o label 'docker' e o REGISTRO não o tem — um job com `runs-on: docker` não encontra este runner: ele ESPERA, e nada falha",
      ],
      remedies: ["Remédio: `bash deploy/setup-github-runner.sh`"],
      runner: "hostinger-runner",
      status: "online",
      repo: "severinno/severinno",
    }),
  }

  it("o registro do GitHub DIVERGENTE bloqueia mesmo com TODO o resto verde", async () => {
    const dir = forgeFixture()
    const { facts } = await diagnose({
      cwd: dir,
      envFile: "deploy/.env.gitea",
      expected: "1.3.14",
      run: passRun,
      imageDeps: { fetchImpl: async () => oci(200) },
      imageRefsDeps: refsProven,
      runnerLabelsDeps: labelsProven,
      githubRunnerLabelsDeps: githubLabelsStale,
      proofDeps: proofHolds,
      imageContractDeps: imageContractProven,
      protectionDeps: protectionInSync,
    })
    const v = summarize(facts)
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.blockers.join(" ")).toContain("runner do GITHUB")
    expect(v.blockers.join(" ")).toContain("setup-github-runner.sh")
  })

  it("--no-runner-labels NÃO consulta a API do GitHub e rebaixa o veredito", async () => {
    const dir = forgeFixture()
    const { facts } = await diagnose({
      cwd: dir,
      envFile: "deploy/.env.gitea",
      expected: "1.3.14",
      runnerLabels: false,
      run: passRun,
      imageDeps: { fetchImpl: async () => oci(200) },
      imageRefsDeps: refsProven,
      githubRunnerLabelsDeps: {
        check: async () => {
          throw new Error("a API do GitHub não pode ser consultada com --no-runner-labels")
        },
      },
      proofDeps: proofHolds,
      imageContractDeps: imageContractProven,
      protectionDeps: protectionInSync,
    })
    expect(facts.githubRunnerLabels.state).toBe("skipped")
    expect(facts.runnerLabels.state).toBe("skipped")
    const v = summarize(facts)
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    expect(v.unproven.join(" ")).toContain("auto-hospedado do GitHub")
  })

  it("um gate vermelho → BLOQUEADA e o relatório nomeia o gate", async () => {
    const dir = forgeFixture()
    const failing = (cmd: string, args: string[]) =>
      args.includes("check:bun-mirror")
        ? { status: 1, stdout: "", stderr: "❌ violação", signal: null }
        : passRun()
    const { facts } = await diagnose({
      cwd: dir,
      envFile: "deploy/.env.gitea",
      expected: "1.3.14",
      run: failing as unknown as typeof passRun,
      imageDeps: { fetchImpl: async () => oci(200) },
      imageRefsDeps: refsProven,
      runnerLabelsDeps: labelsProven,
      githubRunnerLabelsDeps: githubLabelsProven,
      proofDeps: proofHolds,
      imageContractDeps: imageContractProven,
      protectionDeps: protectionInSync,
    })
    const v = summarize(facts)
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.blockers[0]).toContain("check:bun-mirror")
  })

  it("check:required-checks vermelho BLOQUEIA pelo contrato (e não só pelos gates)", async () => {
    const dir = forgeFixture({ pipelineContent: pipeline({ guardLines: [], extraJob: true }) })
    const failing = () => ({ status: 1, stdout: "", stderr: "manifesto divergente", signal: null })
    const { facts } = await diagnose({
      cwd: dir,
      envFile: "deploy/.env.gitea",
      expected: "1.3.14",
      run: failing as unknown as typeof passRun,
      imageDeps: { fetchImpl: async () => oci(200) },
      imageRefsDeps: refsProven,
      runnerLabelsDeps: labelsProven,
      githubRunnerLabelsDeps: githubLabelsProven,
      proofDeps: proofHolds,
      imageContractDeps: imageContractProven,
      protectionDeps: protectionInSync,
    })
    const v = summarize(facts)
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.blockers.some((b) => b.includes("check:required-checks"))).toBe(true)
  })

  it("--no-guards não executa gate nenhum e rebaixa o veredito", async () => {
    const dir = forgeFixture()
    let calls = 0
    const { facts } = await diagnose({
      cwd: dir,
      envFile: "deploy/.env.gitea",
      expected: "1.3.14",
      guards: false,
      run: (() => {
        calls++
        return passRun()
      }) as unknown as typeof passRun,
      imageDeps: { fetchImpl: async () => oci(200) },
      imageRefsDeps: refsProven,
      runnerLabelsDeps: labelsProven,
      githubRunnerLabelsDeps: githubLabelsProven,
      proofDeps: proofHolds,
      imageContractDeps: imageContractProven,
      // A leitura da forja tem o PRÓPRIO dublê: se ela usasse o `run` contado,
      // um `calls` alto deixaria de significar "a bateria rodou".
      protectionDeps: protectionInSync,
    })
    // Só o gate do CONTRATO roda; a bateria é pulada.
    expect(calls).toBe(1)
    expect(facts.guards.results).toEqual([])
    expect(summarize(facts).verdict).toBe(VERDICT.UNKNOWN)
  })

  it("prova VIOLADA → BLOQUEADA mesmo com a imagem presente e todos os guards verdes", async () => {
    const dir = forgeFixture()
    const { facts } = await diagnose({
      cwd: dir,
      envFile: "deploy/.env.gitea",
      expected: "1.3.14",
      run: passRun,
      imageDeps: { fetchImpl: async () => oci(200) },
      imageRefsDeps: refsProven,
      runnerLabelsDeps: labelsProven,
      githubRunnerLabelsDeps: githubLabelsProven,
      proofDeps: proofViolated,
      imageContractDeps: imageContractProven,
      protectionDeps: protectionInSync,
    })
    const v = summarize(facts)
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.blockers.join(" ")).toContain("PROVA do bloqueio")
  })

  it("--no-proof NÃO executa a prova e rebaixa o veredito (falsa segurança é o alvo)", async () => {
    const dir = forgeFixture()
    let called = 0
    const { facts } = await diagnose({
      cwd: dir,
      envFile: "deploy/.env.gitea",
      expected: "1.3.14",
      proof: false,
      run: passRun,
      imageDeps: { fetchImpl: async () => oci(200) },
      imageRefsDeps: refsProven,
      runnerLabelsDeps: labelsProven,
      githubRunnerLabelsDeps: githubLabelsProven,
      protectionDeps: protectionInSync,
      imageContractDeps: imageContractProven,
      proofDeps: {
        prove: async () => {
          called++
          return { ok: true, status: "holds", detail: "", cases: [] }
        },
      },
    })
    expect(called).toBe(0)
    expect(facts.proof.status).toBe("skipped")
    expect(summarize(facts).verdict).toBe(VERDICT.UNKNOWN)
  })

  it("readProof numa raiz sem o bring-up → 'unavailable' (ausência de prova ≠ falha)", async () => {
    const r = await readProof({ cwd: makeDir() })
    expect(r.status).toBe("unavailable")
    expect(r.detail).toContain("gitea-up.sh")
  })

  it("a interpolação VIOLADA bloqueia mesmo com guards, imagem e prova verdes", async () => {
    const dir = forgeFixture()
    const { facts: f } = await diagnose({
      cwd: dir,
      envFile: "deploy/.env.gitea",
      expected: "1.3.14",
      run: passRun,
      imageDeps: { fetchImpl: async () => oci(200) },
      imageRefsDeps: refsProven,
      runnerLabelsDeps: labelsProven,
      githubRunnerLabelsDeps: githubLabelsProven,
      proofDeps: proofHolds,
      imageContractDeps: imageContractProven,
      protectionDeps: protectionInSync,
      composeDeps: { check: () => composeViolated },
    })
    const v = summarize(f)
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.blockers.join(" ")).toContain("VAZIA")
  })

  it("--no-compose-render NÃO executa o render e rebaixa o veredito", async () => {
    const dir = forgeFixture()
    let called = 0
    const { facts: f } = await diagnose({
      cwd: dir,
      envFile: "deploy/.env.gitea",
      expected: "1.3.14",
      composeRender: false,
      run: passRun,
      imageDeps: { fetchImpl: async () => oci(200) },
      imageRefsDeps: refsProven,
      runnerLabelsDeps: labelsProven,
      githubRunnerLabelsDeps: githubLabelsProven,
      proofDeps: proofHolds,
      imageContractDeps: imageContractProven,
      protectionDeps: protectionInSync,
      composeDeps: {
        check: () => {
          called++
          return { state: "proven", violations: [], detail: "" }
        },
      },
    })
    expect(called).toBe(0)
    expect(f.compose.state).toBe("skipped")
    expect(summarize(f).verdict).toBe(VERDICT.UNKNOWN)
  })

  it("a branch protection em DRIFT bloqueia mesmo com guards, imagem, prova e render verdes", async () => {
    const dir = forgeFixture()
    const { facts: f } = await diagnose({
      cwd: dir,
      envFile: "deploy/.env.gitea",
      expected: "1.3.14",
      run: passRun,
      imageDeps: { fetchImpl: async () => oci(200) },
      imageRefsDeps: refsProven,
      runnerLabelsDeps: labelsProven,
      githubRunnerLabelsDeps: githubLabelsProven,
      proofDeps: proofHolds,
      imageContractDeps: imageContractProven,
      protectionDeps: protectionDrift,
    })
    const v = summarize(f)
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.blockers.join(" ")).toContain("falta(m) 'Repo Guards'")
  })

  it("sem credencial de administração a forja NÃO é declarada em sincronia (INDETERMINADA)", async () => {
    const dir = forgeFixture()
    const { facts: f } = await diagnose({
      cwd: dir,
      envFile: "deploy/.env.gitea",
      expected: "1.3.14",
      run: passRun,
      imageDeps: { fetchImpl: async () => oci(200) },
      imageRefsDeps: refsProven,
      runnerLabelsDeps: labelsProven,
      githubRunnerLabelsDeps: githubLabelsProven,
      proofDeps: proofHolds,
      imageContractDeps: imageContractProven,
      protectionDeps: protectionUnreadable,
    })
    const v = summarize(f)
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    expect(v.blockers).toEqual([])
    expect(f.protection.state).toBe("unavailable")
  })

  it("as forjas lidas saem do MANIFESTO (uma fonte): toda forja declarada é lida", async () => {
    const dir = forgeFixture()
    const seen: string[] = []
    const { facts: f } = await diagnose({
      cwd: dir,
      envFile: "deploy/.env.gitea",
      expected: "1.3.14",
      run: passRun,
      imageDeps: { fetchImpl: async () => oci(200) },
      imageRefsDeps: refsProven,
      runnerLabelsDeps: labelsProven,
      githubRunnerLabelsDeps: githubLabelsProven,
      proofDeps: proofHolds,
      imageContractDeps: imageContractProven,
      protectionDeps: {
        run: ((_bin: string, args: string[]) => {
          const forge = forgeOf(args)
          seen.push(forge)
          return { status: 0, stdout: applierJson({ forge }), stderr: "", signal: null }
        }) as never,
      },
    })
    expect(seen.sort()).toEqual(["gitea", "github"])
    expect((f.protection.forges as { forge: string }[]).map((x) => x.forge).sort()).toEqual([
      "gitea",
      "github",
    ])
  })

  it("--no-protection NÃO lê a forja e rebaixa o veredito", async () => {
    const dir = forgeFixture()
    let called = 0
    const { facts: f } = await diagnose({
      cwd: dir,
      envFile: "deploy/.env.gitea",
      expected: "1.3.14",
      protection: false,
      run: passRun,
      imageDeps: { fetchImpl: async () => oci(200) },
      imageRefsDeps: refsProven,
      runnerLabelsDeps: labelsProven,
      githubRunnerLabelsDeps: githubLabelsProven,
      proofDeps: proofHolds,
      imageContractDeps: imageContractProven,
      protectionDeps: {
        run: (() => {
          called++
          return passRun()
        }) as never,
      },
    })
    expect(called).toBe(0)
    expect(f.protection.state).toBe("skipped")
    expect(summarize(f).verdict).toBe(VERDICT.UNKNOWN)
    expect(summarize(f).unproven[0]).toContain("--no-protection")
  })
})

// ── o CONTRATO da imagem PUBLICADA ─────────────────────────────────────────

describe("readImageContract — o fato, sem tocar no registry", () => {
  it("sem o ref resolvido não há artefato: unavailable (não é falha)", async () => {
    const res = await readImageContract({ image: { ref: null } })
    expect(res.state).toBe("unavailable")
    expect(res.detail).toContain("nao foi resolvida")
  })

  it("o valor esperado cai para a TAG que o compose declara quando não há --expected", async () => {
    const seen: { ref: string; expectedVersion: string }[] = []
    const res = await readImageContract({
      image: { ref: "ghcr.io/severinno/ubuntu-bun:1.3.14" },
      env: {},
      deps: {
        digest: `sha256:${"b".repeat(64)}`,
        run: () => ({
          status: 0,
          stdout: "  ✅ Contrato da imagem ok: plugin compose",
          stderr: "",
        }),
      },
    })
    expect(res.state).toBe("proven")
    expect(res.expectedVersion).toBe("1.3.14")
    void seen
  })

  it("--expected manda: é ele que a imagem tem de executar", async () => {
    const res = await readImageContract({
      image: { ref: "ghcr.io/severinno/ubuntu-bun:1.3.14" },
      expected: "1.3.15",
      deps: {
        digest: `sha256:${"b".repeat(64)}`,
        run: () => ({
          status: 0,
          stdout: "  ✅ Contrato da imagem ok: plugin compose",
          stderr: "",
        }),
      },
    })
    expect(res.expectedVersion).toBe("1.3.15")
  })

  it("a credencial do ambiente entra no probe do digest (uma leitura só)", async () => {
    let got: unknown = null
    const res = await readImageContract({
      image: { ref: "ghcr.io/severinno/ubuntu-bun:1.3.14" },
      env: { GHCR_TOKEN: "segredo" },
      deps: {
        resolveIdentity: async (_ref: string, opts: { credentials?: unknown }) => {
          got = opts.credentials
          return { state: "unauthorized", digest: null, version: null, detail: "sem credencial" }
        },
        run: () => ({ status: 125, stdout: "", stderr: "docker: x" }),
      },
    })
    expect(got).not.toBeNull()
    expect(res.state).toBe("unavailable")
  })
})

describe("summarize — o contrato da imagem PUBLICADA", () => {
  it("proven não muda o veredito (o controle: o caminho verde existe)", () => {
    expect(summarize(facts()).verdict).toBe(VERDICT.READY)
  })

  it("VIOLADO bloqueia: o job roda uma imagem que não cumpre a promessa do build", () => {
    const v = summarize(
      facts({
        imageContract: imageContractFacts({
          state: "violated",
          detail:
            "a imagem PUBLICADA (...) NAO executa o contrato: o PLUGIN 'compose' nao esta na imagem",
        }),
      }),
    )
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.blockers.join(" ")).toContain("contrato da imagem PUBLICADA FALHOU")
    expect(v.blockers.join(" ")).toContain("NAO cumpre a promessa do build")
  })

  it("INDETERMINADO não bloqueia e não vira pronta: é ausência de prova", () => {
    const v = summarize(
      facts({
        imageContract: imageContractFacts({
          state: "unavailable",
          detail:
            "o docker NAO conseguiu rodar o contrato na imagem publicada (exit 125): pull access denied",
        }),
      }),
    )
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    expect(v.blockers).toEqual([])
    expect(v.unknowns.join(" ")).toContain("nao foi provado (unavailable)")
  })

  it("--no-image-contract rebaixa o veredito E entra no NÃO CUBRE", () => {
    const v = summarize(
      facts({
        imageContract: imageContractFacts({
          state: "skipped",
          detail: "pulada por --no-image-contract",
        }),
        skippedImageContract: true,
      }),
    )
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    expect(v.unknowns.join(" ")).toContain("pulado (--no-image-contract)")
    expect(v.unproven.join(" ")).toContain("contrato da imagem PUBLICADA")
  })
})

describe("renderReport — o contrato da imagem PUBLICADA", () => {
  it("proven: alvo por digest e os três fatos medidos quando existem", () => {
    const out: string[] = []
    renderReport(
      {
        facts: facts({
          imageContract: imageContractFacts({
            findings: {
              bunPath: "/usr/local/bin/bun",
              bunVersion: "1.3.14",
              composeVersion: "Docker Compose version 5.4.0-2",
            },
          }),
        }),
        verdict: summarize(facts()),
      },
      { emit: (s: string) => out.push(s) },
    )
    const report = out.join("\n")
    expect(report).toContain("contrato da imagem PUBLICADA")
    expect(report).toContain("alvo: ghcr.io/severinno/ubuntu-bun@sha256:")
    expect(report).toContain("bun: /usr/local/bin/bun · versao: 1.3.14")
  })

  it("violado: ❌ com o remédio da republicação", () => {
    const out: string[] = []
    const ic = imageContractFacts({
      state: "violated",
      detail:
        "a imagem PUBLICADA (x@sha256:aaa) NAO executa o contrato: o PLUGIN 'compose' nao esta na imagem",
      remedies: [
        "republicar a imagem da versao declarada (variavel BUN_VERSION): bun run runner-image:ensure",
      ],
    })
    const f = facts({ imageContract: ic })
    renderReport({ facts: f, verdict: summarize(f) }, { emit: (s: string) => out.push(s) })
    const report = out.join("\n")
    expect(report).toContain("❌ contrato da imagem PUBLICADA")
    expect(report).toContain("runner-image:ensure")
  })

  it("pulado: ⊘ com a flag na cara (o silêncio seria o defeito)", () => {
    const out: string[] = []
    const f = facts({
      imageContract: imageContractFacts({
        state: "skipped",
        detail: "pulada por --no-image-contract",
      }),
      skippedImageContract: true,
    })
    renderReport({ facts: f, verdict: summarize(f) }, { emit: (s: string) => out.push(s) })
    // A marca do "pulado" é a mesma das outras seções; o que importa é a FLAG
    // aparecer na linha (o silêncio seria o defeito).
    expect(out.join("\n")).toContain("contrato da imagem PUBLICADA: pulada por --no-image-contract")
  })
})
