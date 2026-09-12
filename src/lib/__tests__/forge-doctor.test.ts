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
  readComposeInterpolation,
  readMirrors,
  readProof,
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
    proof: { status: "holds", ok: true, detail: "3 casos", cases: [] },
    compose: { state: "proven", violations: [], detail: "3 fases ok" },
    mirrors: { actrc: "1.3.14", env: "1.3.14", blockers: [], unknowns: [] },
    skippedGuards: false,
    skippedProof: false,
    ...overrides,
  }
}

/** Prova que se sustenta, como dublê — o agregador não executa nada de verdade. */
const proofHolds = {
  prove: async () => ({ ok: true, status: "holds", detail: "3 casos", cases: [] }),
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

describe("readMirrors", () => {
  it("espelhos concordando → nem bloqueio nem dúvida", () => {
    const dir = makeDir()
    writeFileSync(join(dir, ".actrc"), "--var BUN_VERSION=1.3.14\n")
    mkdirSync(join(dir, "deploy"), { recursive: true })
    writeFileSync(join(dir, "deploy", "env.gitea.example"), "BUN_VERSION=1.3.14\n")
    expect(readMirrors(dir)).toMatchObject({
      actrc: "1.3.14",
      env: "1.3.14",
      blockers: [],
      unknowns: [],
    })
  })

  it("env da forja ausente → BLOQUEIO (a forja não sabe qual imagem rodar)", () => {
    const dir = makeDir()
    writeFileSync(join(dir, ".actrc"), "--var BUN_VERSION=1.3.14\n")
    const r = readMirrors(dir)
    expect(r.blockers.length).toBe(1)
    expect(r.blockers[0]).toContain("label do runner")
  })

  it(".actrc divergente → dúvida, não bloqueio (é o act local, não a forja)", () => {
    const dir = makeDir()
    writeFileSync(join(dir, ".actrc"), "--var BUN_VERSION=1.3.14\n")
    mkdirSync(join(dir, "deploy"), { recursive: true })
    writeFileSync(join(dir, "deploy", "env.gitea.example"), "BUN_VERSION=1.3.15\n")
    const r = readMirrors(dir)
    expect(r.blockers).toEqual([])
    expect(r.unknowns.length).toBe(1)
    expect(r.unknowns[0]).toContain("divergem")
  })
})

// ── compose: a interpolação do compose da forja entra no veredito ─────────

/** Render com variável vazia/literal: a garantia existe no texto, não no render. */
const composeViolated = {
  state: "violated",
  violations: ["deploy/docker-compose.gitea.yml: a TAG do label resolveu VAZIA"],
  detail: "1 violacao(oes) na interpolacao",
}

/** Sem docker/compose no ambiente: ausência de prova, não prova de falha. */
const composeUnavailable = {
  state: "unavailable",
  violations: [],
  detail: "docker compose indisponivel: spawn docker ENOENT",
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
  it("forja completa e registry 200 → PRONTA", async () => {
    const dir = forgeFixture()
    const { facts } = await diagnose({
      cwd: dir,
      envFile: "deploy/.env.gitea",
      run: passRun,
      imageDeps: { fetchImpl: async () => oci(200) },
      proofDeps: proofHolds,
    })
    expect(summarize(facts).verdict, JSON.stringify(summarize(facts).blockers)).toBe(VERDICT.READY)
  })

  it("registry 404 na tag → BLOQUEADA, mesmo com todos os guards verdes", async () => {
    const dir = forgeFixture()
    const { facts } = await diagnose({
      cwd: dir,
      envFile: "deploy/.env.gitea",
      run: passRun,
      imageDeps: { fetchImpl: async () => oci(404) },
      proofDeps: proofHolds,
    })
    const v = summarize(facts)
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.blockers.join(" ")).toContain("AUSENTE")
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
      run: failing as unknown as typeof passRun,
      imageDeps: { fetchImpl: async () => oci(200) },
      proofDeps: proofHolds,
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
      run: failing as unknown as typeof passRun,
      imageDeps: { fetchImpl: async () => oci(200) },
      proofDeps: proofHolds,
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
      guards: false,
      run: (() => {
        calls++
        return passRun()
      }) as unknown as typeof passRun,
      imageDeps: { fetchImpl: async () => oci(200) },
      proofDeps: proofHolds,
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
      run: passRun,
      imageDeps: { fetchImpl: async () => oci(200) },
      proofDeps: proofViolated,
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
      proof: false,
      run: passRun,
      imageDeps: { fetchImpl: async () => oci(200) },
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
      run: passRun,
      imageDeps: { fetchImpl: async () => oci(200) },
      proofDeps: proofHolds,
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
      composeRender: false,
      run: passRun,
      imageDeps: { fetchImpl: async () => oci(200) },
      proofDeps: proofHolds,
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
})
