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
import { dirname, join } from "node:path"
import { readFileSync } from "node:fs"

import { afterAll, describe, expect, it } from "vitest"

import {
  BRING_UP_GATE_JOB,
  CI_PROFILE_SKIPS,
  DEFAULT_GATE_CONCURRENCY,
  FORGE_GUARDS_JOB,
  MERGE_OWNER_PIPELINE,
  REQUIRED_CHECKS_MANIFEST,
  VERDICT,
  coreGateContracts,
  readBringUpGate,
  readAllGateContracts,
  readContract,
  scriptOfCommand,
  diagnose,
  parseArgs,
  firstRunLine,
  forgeGates,
  gateCommand,
  gateRunLine,
  isVerificationCommand,
  runGate,
  runGateAsync,
  runGatesConcurrent,
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
  ENV_MIRROR_CHECK,
  NESTED_GUARD_ENV,
  NESTED_GUARD_FLAG,
  NESTED_GUARD_EXIT,
  isNestedDoctorInvocation,
  nestedGuardReport,
  recursionGuardFacts,
  declaredDebtBlockers,
  declaredDebtUnknowns,
  readDeclaredDebt,
  deriveBringUpEnv,
  readShellInheritance,
  shellInheritanceBlockers,
  shellInheritanceUnknowns,
  describeShellScope,
  readPreCommitBlock,
  aggregateLocalState,
  localContractBlockers,
  localContractUnknowns,
  readHookCommands,
  readLocalContract,
  readPrePushBlock,
  LOCAL_LINKS,
} from "../../../scripts/forge-doctor.mjs"

// A prova EXECUTADA pelo doctor e as constantes do hook que ela usa: o teste mede
// a MESMA função que o relatório chama (e é por isso que a mutação do hook aqui
// embaixo muda o veredito do fato).
import { GUARD_COMMAND, hookSource, proveCommitBlocks } from "../../../scripts/pre-commit-proof.mjs"
// A RÉGUA DOS COMANDOS DOS HOOKS: o teste compara o que o FATO do contrato
// local declara com o que o GATE julga — as duas leituras têm de ser a mesma.
import { analyze as analyzeHookCommands } from "../../../scripts/check-hook-commands.mjs"
// O OUTRO ELO do contrato local: a prova do PUSH é executada pelo doctor pelo
// mesmo módulo que o teste do hook importa.
import {
  TYPECHECK_COMMAND,
  hookSource as pushHookSource,
  provePushBlocks,
} from "../../../scripts/pre-push-proof.mjs"

import { GITEA_BRING_UP, GITEA_COMPOSE } from "../../../scripts/check-bun-mirror.mjs"
import { GITEA_ENV_MIRROR } from "../../../scripts/check-actrc-sync.mjs"
import { scanRoot } from "../../../scripts/check-pipefail-sigpipe.mjs"

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
  // Os comandos CANÔNICOS (o `command` de cada invariante): é a linha que as
  // duas forjas executam. Uma fixture com a forma indireta (`bun run check:x`)
  // ou com um argumento a menos mediria um contrato que não existe mais.
  const guards = opts.guardLines ?? [
    "node scripts/check-bun-mirror.mjs",
    "node scripts/rotate-secrets.mjs --check",
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
      : ["  typecheck:", "    steps:", "      - run: bun run typecheck"]),
    // O GATE do bring-up faz parte de uma forja SAUDÁVEL: sem este job (e sem o
    // id dele no manifesto, ver `forgeFixture`), o fato `bringUpGate` acusa — e
    // toda fixture de doctor que se diga completa tem de carregá-lo.
    "  bring-up-proof:",
    "    name: Bring-up Gate Proof",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - run: node scripts/prove-runner-image-gate.mjs",
    // Jobs adicionais que o manifesto exige — um mínimo para que
    // readAllGateContracts encontre todos os gates CORE.
    "  lint:",
    "    steps:",
    "      - run: bun run lint",
    "  test:",
    "    steps:",
    "      - run: bun run test:run",
    "  lint-guard:",
    "    steps:",
    "      - run: bun run lint",
    "  check:",
    "    steps:",
    "      - run: bun run test:run",
    "",
  ].join("\n")
}

/**
 * O fato da dívida DECLARADA, medido e dentro da janela — ponto de partida dos
 * testes de peso (cada um estraga a lista que quer medir).
 */
function declaredDebtFacts(overrides: Record<string, unknown> = {}) {
  return {
    state: "proven",
    sources: [
      {
        id: "unused-deps",
        listName: "ALLOWLIST",
        owner: "scripts/check-unused-deps.mjs",
        kind: "entries",
        remedy: "reafirme a exceção atualizando `addedAt`",
        reviewDays: 180,
        state: "proven",
        total: 1,
        oldest: { id: "sharp", addedAt: "2026-09-01", days: 2 },
        aged: [],
        invalid: [],
        detail: "scripts/check-unused-deps.mjs: 1 decisão(ões) na ALLOWLIST",
      },
    ],
    aged: [],
    invalid: [],
    unread: [],
    total: 1,
    ...overrides,
  }
}

/**
 * A herança de shell dos workflows, MEDIDA num checkout sem workflow nenhum: o
 * `proven` de zero passo, que é o mínimo que o veredito lê.
 *
 * Ela NÃO pode ser omitida da fixture: ausente, o fato vira dúvida ("não está
 * declarada no relatório") — e uma fixture que diz "tudo verde" com menos fatos
 * do que o relatório real carrega mede outra coisa. Os testes do PRÓPRIO fato
 * usam YAML de verdade, em fixtures com `workflows()`.
 */
const SHELL_INHERITANCE_LIMPA = readShellInheritance({ cwd: makeDir() }) as unknown as object

/**
 * A prova do bloqueio LOCAL, provada — o default do fixture. Ela é um OBJETO
 * escrito à mão (e não a execução real) porque os fatores do veredito têm de ser
 * determinísticos: o teste de integração da prova é um só, e roda de verdade.
 */
const PRE_COMMIT_BLOCK_PROVEN = {
  state: "proven",
  detail: "um 'git commit' com o corpo quebrado é recusado e o controle entra",
  evidence: null,
  remedies: [],
}

/**
 * O OUTRO ELO do contrato local (o `pre-push`), também PROVADO — escrito à mão
 * pelo mesmo motivo do de cima: os fatores do veredito têm de ser determinísticos.
 */
const PRE_PUSH_BLOCK_PROVEN = {
  state: "proven",
  detail: "um 'git push' com a árvore vermelha é recusado e o verde chega ao remoto",
  evidence: null,
  remedies: [],
}

/** Um comando dentro de um hook, no formato que o fato publica. */
type ComandoDoHook = { arquivo: string; linha: number; comando: string; motivo?: string }

/** O que cada hook RODA, como o fato publica (um estado por arquivo de hook). */
type HookDoFato = {
  state: string
  detail: string
  elo: "pre-commit" | "pre-push" | null
  commands: ComandoDoHook[]
  unresolved: ComandoDoHook[]
  declared: ComandoDoHook[]
  limits: { arquivo: string; linha: number; motivo: string }[]
  descended: string[]
}

/** Um hook com todos os comandos RESOLVENDO (o default do fixture). */
const hookProven = (elo: HookDoFato["elo"]): HookDoFato => ({
  state: "proven",
  detail: "10 comando(s) resolvem (1 script(s) por descida), 0 declarado(s) indeterminado(s)",
  elo,
  commands: [],
  unresolved: [],
  declared: [],
  limits: [],
  descended: [],
})

/** O que CADA hook roda, provado — a segunda metade do fato único. */
const HOOKS_PROVEN: Record<string, HookDoFato> = {
  ".husky/pre-commit": hookProven("pre-commit"),
  ".husky/pre-push": hookProven("pre-push"),
  ".husky/post-checkout": hookProven(null),
}

/**
 * O LIMITE do gate local, MEDIDO (o default do fixture): o `--no-verify` leva a
 * árvore vermelha ao remoto e o comando do gate reprova o conteúdo clonado.
 */
const BYPASS_PROVEN: ParteDoFato = {
  state: "proven",
  detail:
    "um 'git push --no-verify' com a árvore VERMELHA CHEGA ao remoto (exit 0, refs/heads/main, 2 objeto(s)) " +
    "e o hook NÃO roda — e quem barra é o CI: 'bun run typecheck' REPROVA o conteúdo que chegou (exit 1) num CLONE do remoto",
  evidence: {
    controle: { status: 1, refs: [], objetosNoRemoto: 0, invocacoes: 1 },
    contorno: {
      status: 0,
      refs: ["refs/heads/main"],
      objetosNoRemoto: 2,
      conteudoNaRef: 'export const oi: number = "ERRO_DE_TIPO"\n',
      invocacoes: 1,
      arg: "--no-verify",
    },
    ci: {
      comando: "bun run typecheck",
      status: 1,
      output: "src/foo.ts(1,8): error TS2322: TYPECHECK_DO_FIXTURE_REPROVOU",
      conteudoNoClone: 'export const oi: number = "ERRO_DE_TIPO"\n',
      invocacoes: 1,
    },
  },
  remedies: [],
}

/**
 * O CONTRATO LOCAL inteiro, com o que o teste quiser estragar em cada parte.
 *
 * O AGREGADO é derivado pela MESMA função do doctor (`aggregateLocalState`): se
 * esta fixture tivesse a própria regra de "pior estado", o teste estaria medindo
 * a régua dela, e não a do relatório.
 */
type ParteDoFato = { state: string; detail?: string; evidence?: unknown; remedies?: string[] }

function localContractFacts(
  over: {
    links?: Record<string, Partial<ParteDoFato>>
    hooks?: Record<string, HookDoFato>
    bypass?: Partial<ParteDoFato> | null
  } = {},
) {
  const links: Record<string, ParteDoFato> = {
    "pre-commit": { ...PRE_COMMIT_BLOCK_PROVEN, ...(over.links?.["pre-commit"] ?? {}) },
    "pre-push": { ...PRE_PUSH_BLOCK_PROVEN, ...(over.links?.["pre-push"] ?? {}) },
  }
  const hooks = { ...HOOKS_PROVEN, ...(over.hooks ?? {}) }
  const commands = {
    state: aggregateLocalState(Object.values(hooks).map((h) => h.state)),
    detail: `${Object.keys(hooks).length} hook(s) do .husky/, 30 comando(s) julgado(s), 0 nao resolvido(s)`,
    hooks,
    unattributed: [],
  }
  // `bypass: null` é o caso "o fato sem a parte do limite" — o que o teste do
  // fail-closed precisa medir.
  const bypass = over.bypass === null ? undefined : { ...BYPASS_PROVEN, ...(over.bypass ?? {}) }
  return {
    state: aggregateLocalState([
      links["pre-commit"].state,
      links["pre-push"].state,
      commands.state,
      ...(bypass ? [bypass.state] : []),
    ]),
    detail:
      "pre-commit: proven | pre-push: proven | 3 hook(s) do .husky/, 30 comando(s) julgado(s), 0 nao resolvido(s)",
    links,
    commands,
    ...(bypass ? { bypass } : {}),
    evidence: {
      "pre-commit": links["pre-commit"].evidence ?? null,
      "pre-push": links["pre-push"].evidence ?? null,
    },
    remedies: [...(links["pre-commit"].remedies ?? []), ...(links["pre-push"].remedies ?? [])],
  } as const
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
    // O guard de recursão ARMADO, como o `diagnose` o declara em todo relatório
    // (o disparo é que vira um relatório à parte, com `state: fired`).
    nestedGuard: recursionGuardFacts(),
    // A dívida DECLARADA medida e DENTRO da janela: com o fato presente e limpo,
    // o veredito não ganha nem bloqueio nem dúvida (cada teste estraga o que quer
    // medir). Ausente, ele passa a INDETERMINADA — como o guard de recursão.
    declaredDebt: declaredDebtFacts(),
    // A herança de shell dos workflows (de onde vem o shell de CADA passo):
    // presente e limpa. Cada teste estraga o que quer medir.
    shellInheritance: SHELL_INHERITANCE_LIMPA,
    // O CONTRATO LOCAL — UM fato só: os DOIS elos executados e o que cada hook
    // RODA. Presente e medido: ausente, o veredito vira dúvida (cada teste
    // estraga o que quer medir).
    localContract: localContractFacts(),
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
 * Os DOIS elos locais PROVADOS, para os fluxos de VEREDITO cuja fixture é um
 * repositório temporário SEM `.husky/` — ali a prova real sai INDISPONÍVEL (com
 * razão: não há o que provar), e desde que o recorte `--ci` EXIGE os dois elos
 * provados, um fluxo que dubla todos os outros fatos precisa dublar estes também.
 * A prova REAL não fica sem cobertura por causa disto: ela tem a integração
 * própria (`pre-push-git-push-blocks`, `pre-commit-git-commit-blocks`) e a
 * sensibilidade do doctor sobre o hook do checkout.
 */
const localProofsProven = {
  /**
   * O contrato dos comandos dos hooks, dublado pelo mesmo motivo dos dois elos:
   * a fixture destes fluxos é um repositório temporário SEM `.husky/`, onde a
   * leitura real sai INDISPONÍVEL (com razão). A leitura REAL tem teste próprio
   * (`o contrato local é UM fato só`, sobre o checkout), e aqui o dublê declara
   * os DOIS elos com um comando cada, resolvendo.
   */
  hookCommandsDeps: {
    analyze: () => ({
      infra: false,
      hooks: [".husky/pre-commit", ".husky/pre-push"],
      comandos: [
        {
          arquivo: ".husky/pre-commit",
          linha: 1,
          programa: "bash",
          tokens: ["scripts/run-encoding-guards.sh"],
          origem: "",
          desfecho: "resolvido",
          motivo: "arquivo do repositório",
        },
        {
          arquivo: ".husky/pre-push",
          linha: 1,
          programa: "bun",
          tokens: ["run", "typecheck"],
          origem: "",
          desfecho: "resolvido",
          motivo: "script do package.json",
        },
      ],
      limites: [],
    }),
  },
  preCommitBlockDeps: {
    prove: () => ({
      state: "proven",
      detail: "prova dublada do fluxo",
      evidence: null,
      remedies: [],
    }),
  },
  prePushBlockDeps: {
    prove: () => ({
      state: "proven",
      detail: "prova dublada do fluxo",
      evidence: null,
      remedies: [],
    }),
  },
  // A MEDIDA DO LIMITE tem o próprio ponto de injeção: sem ele, o fluxo do
  // `diagnose` mediria o LIMITE no `cwd` do teste (um repo sem `.husky/`), e o
  // veredito do fluxo falaria do fixture em vez do contrato.
  pushBypassDeps: {
    prove: () => ({
      state: "proven",
      detail: "medida dublada do fluxo (o --no-verify contorna e o CI barra)",
      evidence: null,
      remedies: [],
    }),
  },
}

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
  errors = [],
}: {
  forge: string
  drift?: boolean
  forges?: object
  errors?: { forge: string; message: string; unsupported?: boolean }[]
}): string {
  return JSON.stringify({
    mode: "check",
    manifest: REQUIRED_CHECKS_MANIFEST,
    branches: ["main"],
    drift,
    forges: forges ?? { [forge]: forgeInSync() },
    errors,
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
    expect(job).toContain("check-bun-mirror.mjs")
    expect(job).toContain("rotate-secrets.mjs --check")
    expect(job).not.toContain("bun run typecheck")
  })

  it("job inexistente → null", () => {
    expect(sliceJob(pipeline(), "nao-existe")).toBeNull()
  })

  it("comentário em coluna 0 no meio do job NÃO encerra a fatia", () => {
    const comComment = pipeline().replace(
      "    runs-on: ubuntu-latest",
      "    runs-on: ubuntu-latest\n# nota",
    )
    expect(sliceJob(comComment, FORGE_GUARDS_JOB)).toContain("check-bun-mirror.mjs")
  })

  it("na pipeline REAL: a fatia do job de guards tem os invariantes da forja", () => {
    const job = sliceJob(readFileSync(join(ROOT, MERGE_OWNER_PIPELINE), "utf8"), FORGE_GUARDS_JOB)
    expect(job, "job de guards não encontrado na pipeline real").not.toBeNull()
    // Os COMANDOS canônicos, um a um — não as entradas do package.json
    // (`bun run check:x`) que a forja usava antes do contrato de régua única.
    for (const expected of [
      "node scripts/check-bun-mirror.mjs",
      "node scripts/check-forge-parity.mjs",
      "node scripts/check-registry-source.mjs",
    ]) {
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
      "node scripts/rotate-secrets.mjs --check",
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
    // O RÓTULO é a identidade do gate (o caminho do script); o COMANDO é a
    // linha canônica, com o lançador e os argumentos — é ela que a bateria
    // executa dentro da imagem, e é ela que as duas forjas compartilham.
    expect(gates.map((g) => g.label)).toContain("scripts/check-bun-mirror.mjs")
    const rotate = gates.find((g) => g.label === "scripts/rotate-secrets.mjs")
    expect(rotate?.command).toBe("node scripts/rotate-secrets.mjs --check")
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

  it("GATE do bring-up fora do contrato → BLOQUEADA, nomeando a forja e o remédio", () => {
    // A prova pode estar VERDE (a seção 4 mede comportamento) e o merge seguir
    // livre: quem obriga o PR a passar pela prova é o contrato. Por isso o fato
    // bloqueia, e o texto tem de dizer QUAL forja parou de exigir o gate.
    const v = summarize(
      facts({
        bringUpGate: {
          state: "violated",
          job: BRING_UP_GATE_JOB,
          script: "scripts/prove-runner-image-gate.mjs",
          forges: [],
          violations: [
            `gitea: o contrato de merge NAO exige o job '${BRING_UP_GATE_JOB}'`,
            `github: o job '${BRING_UP_GATE_JOB}' existe e nenhum 'run:' executa a prova`,
          ],
          detail: "gitea: ... · github: ...",
          remedies: [],
        },
      }),
    )
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.blockers.join(" | ")).toContain("GATE do bring-up")
    expect(v.blockers.join(" | ")).toContain("gitea")
    expect(v.blockers.join(" | ")).toContain("github")
    expect(v.blockers.length).toBe(2)
  })

  it("GATE do bring-up não conferido → INDETERMINADA (nunca 'pronta' por omissão)", () => {
    const v = summarize(
      facts({
        bringUpGate: {
          state: "unavailable",
          job: BRING_UP_GATE_JOB,
          script: "scripts/prove-runner-image-gate.mjs",
          forges: [],
          violations: [],
          detail: "ci/required-checks.json nao declara forja nenhuma",
          remedies: [],
        },
      }),
    )
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    expect(v.unknowns.join(" ")).toContain("gate do bring-up")
    expect(v.unknowns.join(" ")).toContain("nao declara forja")
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

  it("skippedGateContracts declara no 'NÃO cobre' (o veredito não é alterado — é declaração, não violação)", () => {
    const v = summarize(facts({ skippedGateContracts: true }))
    expect(v.unproven[0]).toContain("gates CORE no contrato de merge")
  })

  it("sempre declara o que NÃO cobre (branch protection, smoke, env do VPS)", () => {
    const v = summarize(facts())
    expect(v.unproven.join(" ")).toContain("branch protection")
    expect(v.unproven.join(" ")).toContain("smoke")
    expect(v.unproven.join(" ")).toContain(".env.gitea")
  })
})

// ── a DÍVIDA DECLARADA (a IDADE das isenções) ────────────────────────────

/**
 * A isenção que sustenta um verde tem PRAZO — e a idade dela vira fato do
 * veredito.
 *
 * POR QUE ISTO EXISTE: cada lista de dívida declarada do repositório registra
 * quando a decisão foi tomada e a janela de revisão, mas essa idade só existia
 * no run semanal que a revisa. O doctor media a forja inteira e não sabia que a
 * isenção que sustenta o verde está a 179 dias — nem que venceu ontem. Aqui a
 * ISENÇÃO SEM REGISTRO (que não tem como envelhecer) BLOQUEIA, a VENCIDA impede
 * PRONTA sem bloquear (a cobrança é a issue do publicador, não o veredito), e a
 * lista ILEGÍVEL é ausência de prova — nunca "sem dívida".
 */
describe("summarize — a IDADE da dívida declarada", () => {
  it("decisão VENCIDA → INDETERMINADA, com a idade e o remédio (zero bloqueios)", () => {
    const vencida = declaredDebtFacts({
      state: "aged",
      aged: [{ id: "sharp", days: 200, limit: 180 }],
      sources: [
        {
          id: "unused-deps",
          listName: "ALLOWLIST",
          owner: "scripts/check-unused-deps.mjs",
          state: "aged",
          total: 1,
          reviewDays: 180,
          aged: [{ id: "sharp", addedAt: "2026-01-01", days: 200, limit: 180 }],
          invalid: [],
          oldest: { id: "sharp", addedAt: "2026-01-01", days: 200 },
          detail: "scripts/check-unused-deps.mjs: 1 decisão(ões) na ALLOWLIST",
        },
      ],
    })
    const v = summarize(facts({ declaredDebt: vencida }))
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    expect(v.blockers).toEqual([])
    expect(v.unknowns.join(" ")).toContain("200 dia(s)")
    expect(v.unknowns.join(" ")).toContain("sharp")
  })

  it("decisão SEM REGISTRO → BLOQUEIA (sem data não há como envelhecer)", () => {
    const semRegistro = declaredDebtFacts({
      state: "invalid",
      invalid: [{ id: "docs/quality/x.md", why: "addedAt ausente" }],
      sources: [
        {
          id: "out-of-scope",
          listName: "OUT_OF_SCOPE_ALLOWLIST",
          owner: "scripts/check-registry-source.mjs",
          state: "invalid",
          total: 1,
          reviewDays: 180,
          aged: [],
          invalid: [{ id: "docs/quality/x.md", why: "addedAt ausente" }],
          oldest: null,
          detail: "doc",
        },
      ],
    })
    const v = summarize(facts({ declaredDebt: semRegistro }))
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.blockers.join(" ")).toContain("addedAt ausente")
  })

  it("lista ILEGÍVEL → INDETERMINADA: ausência de prova, jamais 'sem dívida'", () => {
    const ilegivel = declaredDebtFacts({
      state: "unread",
      unread: [{ id: "sigpipe", listName: "docs/quality/pipefail-sigpipe-baseline.json" }],
      sources: [
        {
          id: "sigpipe",
          listName: "docs/quality/pipefail-sigpipe-baseline.json",
          owner: "scripts/check-pipefail-sigpipe.mjs",
          state: "unread",
          total: 0,
          reviewDays: null,
          aged: [],
          invalid: [],
          oldest: null,
          detail: "JSON inválido",
        },
      ],
    })
    const v = summarize(facts({ declaredDebt: ilegivel }))
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    expect(v.blockers).toEqual([])
    expect(v.unknowns.join(" ")).toContain("NÃO pôde ser lida")
    expect(v.unknowns.join(" ")).toContain("docs/quality/pipefail-sigpipe-baseline.json")
  })

  it("fato AUSENTE do relatório → INDETERMINADA, dizendo o que ficou fora (nunca omitir)", () => {
    const { declaredDebt: _omitido, ...semFato } = facts()
    const v = summarize(semFato as never)
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    expect(v.unknowns.join(" ")).toContain("não está declarada no relatório")
  })

  it("--no-declared-debt aparece dito, em vez de a idade sumir calada", () => {
    const v = summarize(facts({ skippedDeclaredDebt: true }))
    expect(v.unknowns.join(" ")).toContain("--no-declared-debt")
    expect(v.unproven.join(" ")).toContain("IDADE da dívida declarada")
  })

  it("o peso vem das funções do FATO (fonte única com o relatório)", () => {
    // As duas funções são o que o `summarize` consulta: uma segunda regra aqui
    // divergiria da que a seção 6/7 imprime. O fato LIMPO não pesa em nada; a
    // fonte VENCIDA vira dúvida, e a SEM REGISTRO vira bloqueio.
    expect(declaredDebtBlockers(declaredDebtFacts())).toEqual([])
    expect(declaredDebtUnknowns(declaredDebtFacts())).toEqual([])
    const vencida = declaredDebtFacts({
      state: "aged",
      aged: [{ id: "sharp", days: 200, limit: 180 }],
      sources: [
        {
          id: "unused-deps",
          listName: "ALLOWLIST",
          owner: "scripts/check-unused-deps.mjs",
          state: "aged",
          total: 1,
          reviewDays: 180,
          aged: [{ id: "sharp", addedAt: "2026-01-01", days: 200, limit: 180 }],
          invalid: [],
          oldest: { id: "sharp", addedAt: "2026-01-01", days: 200 },
          detail: "scripts/check-unused-deps.mjs: 1 decisão(ões) na ALLOWLIST",
        },
      ],
    })
    expect(declaredDebtBlockers(vencida)).toEqual([])
    expect(declaredDebtUnknowns(vencida).length).toBeGreaterThan(0)
    const semRegistro = declaredDebtFacts({
      state: "invalid",
      invalid: [{ id: "sharp", why: "addedAt ausente" }],
      sources: [
        {
          id: "unused-deps",
          listName: "ALLOWLIST",
          owner: "scripts/check-unused-deps.mjs",
          state: "invalid",
          total: 1,
          reviewDays: 180,
          aged: [],
          invalid: [{ id: "sharp", why: "addedAt ausente" }],
          oldest: null,
          detail: "scripts/check-unused-deps.mjs: 1 decisão(ões) na ALLOWLIST",
        },
      ],
    })
    expect(declaredDebtBlockers(semRegistro).length).toBeGreaterThan(0)
  })

  it("readDeclaredDebt mede o checkout de verdade e NUNCA confunde lista ilegível com sem dívida", () => {
    // O caminho de PROGRAMA (erro do coletor) é o único que a rede de segurança
    // pega: o coletor devolve `unread` na fonte para lista ilegível, e um erro de
    // programa não pode virar "está tudo bem".
    const quebrado = readDeclaredDebt({
      cwd: process.cwd(),
      deps: {
        collect: () => {
          throw new Error("baseline corrompido")
        },
      },
    })
    expect(quebrado.state).toBe("unread")
    expect(quebrado.aged).toEqual([])
    expect(quebrado.error).toContain("baseline corrompido")

    // E o caminho real: o repositório mede o próprio fato (este é o dado que o
    // relatório publica e que a issue consome).
    const real = readDeclaredDebt({ cwd: process.cwd() })
    expect(["proven", "sem-divida", "aged", "invalid", "unread"]).toContain(real.state)
    expect(real.sources.map((s: { listName: string }) => s.listName)).toContain("ALLOWLIST")
  })
})

// ── readMirrors: gravidade diferente por espelho ──────────────────────────

describe("readMirrors — os espelhos, contra o valor DECLARADO (fonte única do guard)", () => {
  /** Árvore mínima com os dois espelhos e, opcionalmente, o env de um host. */
  function mirrorTree({
    actrc = "1.3.14",
    template = "1.3.14",
    host = null,
    registry = "ghcr.io",
    namespace = "severinno",
  }: {
    actrc?: string
    template?: string
    host?: string | null
    registry?: string
    namespace?: string
  } = {}): string {
    const dir = makeDir()
    const envBody = (version: string, registryValue = registry, namespaceValue = namespace) =>
      `IMAGE_REGISTRY=${registryValue}\nIMAGE_NAMESPACE=${namespaceValue}\nBUN_VERSION=${version}\n`
    writeFileSync(
      join(dir, ".actrc"),
      `--var IMAGE_REGISTRY=${registry}\n--var BUN_VERSION=${actrc}\n`,
    )
    mkdirSync(join(dir, "deploy"), { recursive: true })
    writeFileSync(join(dir, "deploy", "env.gitea.example"), envBody(template))
    if (host !== null) {
      writeFileSync(join(dir, "deploy", ".env.gitea"), envBody(host))
    }
    return dir
  }

  /** Os valores das demais variáveis comparadas — o que os fixtures declaram. */
  const IMAGE_VARS = { IMAGE_REGISTRY: "ghcr.io", IMAGE_NAMESPACE: "severinno" }

  it("batendo com os VALORES das três variáveis → nem bloqueio nem dúvida", () => {
    expect(
      readMirrors(mirrorTree(), { expected: "1.3.14", expectedVars: IMAGE_VARS }),
    ).toMatchObject({
      actrc: "1.3.14",
      env: "1.3.14",
      expected: "1.3.14",
      expectedVars: { BUN_VERSION: "1.3.14", ...IMAGE_VARS },
      blockers: [],
      unknowns: [],
    })
  })

  it("variável SEM valor passado → dúvida NOMINAL (existência não passa por valor)", () => {
    // Regressão do buraco que esta extensão fecha: as variáveis da imagem
    // ficavam só com a checagem de existência do guard estático. Sem o valor
    // delas, o veredito não pode sair limpo — e tem de dizer QUAL ficou de fora.
    const r = readMirrors(mirrorTree(), { expected: "1.3.14" })
    expect(r.blockers).toEqual([])
    expect(r.unknowns).toHaveLength(1)
    expect(r.unknowns[0]).toContain("o VALOR de IMAGE_REGISTRY, IMAGE_NAMESPACE")
    expect(r.unknowns[0]).toContain("--expected-var IMAGE_REGISTRY=<valor>")
    expect(r.unknowns[0]).toContain("--expected-var IMAGE_NAMESPACE=<valor>")
  })

  it("drift de IMAGE_REGISTRY/IMAGE_NAMESPACE no env da forja → BLOQUEIO (a label puxa de outro lugar)", () => {
    const r = readMirrors(mirrorTree({ namespace: "outro-ns" }), {
      expected: "1.3.14",
      expectedVars: IMAGE_VARS,
    })
    expect(r.blockers).toHaveLength(1)
    expect(r.blockers[0]).toContain("deploy/env.gitea.example define IMAGE_NAMESPACE='outro-ns'")
    expect(r.blockers[0]).toContain("vars.IMAGE_NAMESPACE='severinno'")
    // O `bump-bun.sh` só escreve a VERSÃO: mandá-lo aqui resolveria uma
    // variável e deixaria a outra.
    expect(r.blockers[0]).not.toContain("bump-bun.sh")
    expect(
      (r.mirrors as { drift?: string[] }[]).every((m) => m.drift?.includes("IMAGE_NAMESPACE")),
    ).toBe(true)
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
    const r = readMirrors(mirrorTree({ host: "1.3.14" }), {
      expected: "1.3.14",
      expectedVars: IMAGE_VARS,
    })
    expect(r.blockers).toEqual([])
    expect(r.unknowns).toEqual([])
    expect((r.mirrors as { deployed: boolean }[]).some((m) => m.deployed)).toBe(true)
  })

  it("envPath apontando um arquivo INEXISTENTE não estoura (a ausência é da seção da imagem)", () => {
    const dir = mirrorTree()
    const r = readMirrors(dir, {
      expected: "1.3.14",
      expectedVars: IMAGE_VARS,
      envPath: join(dir, "deploy", ".env.gitea"),
    })
    expect(r.blockers).toEqual([])
    expect(r.unknowns).toEqual([])
  })

  it(".actrc divergente DO VALOR → dúvida com remédio concreto (é o act local, não a forja)", () => {
    const r = readMirrors(mirrorTree({ actrc: "1.3.10" }), {
      expected: "1.3.14",
      expectedVars: IMAGE_VARS,
    })
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
    expect(text).toContain("5/7  Espelhos das variáveis da imagem")
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
    expect(text).toContain("deploy/env.gitea.example (template comitado): BUN_VERSION=1.3.13")
    expect(text).toContain("❌")
  })

  it("a seção 4 imprime o GATE do bring-up com a EVIDÊNCIA por forja", () => {
    // A seção 4 não pode parar na prova: "a prova roda" e "o merge é obrigado a
    // passar por ela" são perguntas diferentes, e a segunda é a que decide.
    const text = render(
      facts({
        bringUpGate: {
          state: "proven",
          job: BRING_UP_GATE_JOB,
          script: "scripts/prove-runner-image-gate.mjs",
          forges: [
            {
              forge: "gitea",
              workflow: ".gitea/workflows/ci.yml",
              command: "node scripts/prove-runner-image-gate.mjs",
              detail:
                "gitea: 'bring-up-proof' em .gitea/workflows/ci.yml roda 'node scripts/prove-runner-image-gate.mjs'",
            },
          ],
          violations: [],
          detail: "o gate do bring-up esta no contrato de merge das 1 forja(s)",
          remedies: ["ci/required-checks.json: devolva o job"],
        },
      }),
    )
    expect(text).toContain("4/7  Prova do bloqueio")
    expect(text).toContain(
      `GATE do bring-up (job '${BRING_UP_GATE_JOB}' no contrato de merge): proven`,
    )
    expect(text).toContain("roda 'node scripts/prove-runner-image-gate.mjs'")
    // Provado não imprime remédio (o remédio é do que está quebrado).
    expect(text).not.toContain("devolva o job")
  })

  it("o gate VIOLADO aparece com o remédio, mesmo quando a verificação de gates foi pulada", () => {
    // O gate responde outra pergunta — puladar gates não pode esconder um
    // contrato que deixou de exigir o job.
    const text = render(
      facts({
        skippedGateContracts: true,
        gateContracts: null,
        bringUpGate: {
          state: "violated",
          job: BRING_UP_GATE_JOB,
          script: "scripts/prove-runner-image-gate.mjs",
          forges: [
            {
              forge: "gitea",
              workflow: ".gitea/workflows/ci.yml",
              command: null,
              detail: `gitea: o contrato de merge NAO exige o job '${BRING_UP_GATE_JOB}'`,
            },
          ],
          violations: [`gitea: o contrato de merge NAO exige o job '${BRING_UP_GATE_JOB}'`],
          detail: `gitea: o contrato de merge NAO exige o job '${BRING_UP_GATE_JOB}'`,
          remedies: ["ci/required-checks.json: devolva o job a lista da forja"],
        },
      }),
    )
    expect(text).toContain("gates CORE pulada por --ci")
    expect(text).toContain("no contrato de merge): violated")
    expect(text).toContain("NAO exige o job")
    expect(text).toContain("devolva o job a lista da forja")
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
    const res = run("--no-guards", "--no-compose-render", "--no-protection", "--expected")
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

// ── o PERFIL --ci: o recorte que roda no job `guards`, a cada PR ─────────
//
// O doctor passou a rodar TAMBÉM no job que decide o merge (o `guards`), para o
// VALOR das repository variables ser conferido a cada PR em vez de só no cron
// semanal. O que muda é o ESCOPO — e é isso que precisa ser provado: que o
// perfil reduz as SETE seções que um runner de PR não prova, que ele NÃO baixa a
// régua do que ficou dentro, e que o relatório NOMEIA o que saiu.

describe("perfil --ci — o recorte local, com a régua inteira", () => {
  it("as sete seções do perfil são exatamente as que um PR não prova", () => {
    // A lista É o contrato. `guards` é o job que chama o doctor (rodar a bateria
    // aqui seria recursão). `proof` NÃO entra aqui: a prova é a defesa em
    // profundidade contra recursão (NESTED_GUARD_ENV) e o corte do ciclo
    // (DOCTOR_SCRIPT) — sem ela o veredito diz "sem prova" sem nunca ter
    // tentado. As outras sete precisam de rede, credencial ou o estado do HOST.
    expect([...CI_PROFILE_SKIPS].sort()).toEqual(
      [
        "guards",
        "protection",
        "runnerLabels",
        "imageContract",
        "registryProbe",
        "openDebt",
        "gateContractsCheck",
      ].sort(),
    )
  })

  it("desliga as sete e PRESERVA o render do compose (local, barato e exigido pela imagem)", () => {
    const opts = parseArgs(["--ci"]) as unknown as Record<string, unknown>
    expect(opts.ciProfile).toBe(true)
    for (const name of CI_PROFILE_SKIPS) expect(opts[name], name).toBe(false)
    expect(opts.composeRender).toBe(true)
    expect(opts.error).toBeNull()
  })

  it("sem --ci nada é desligado (o perfil é explícito, não um default novo)", () => {
    const opts = parseArgs([]) as unknown as Record<string, unknown>
    expect(opts.ciProfile).toBe(false)
    for (const name of CI_PROFILE_SKIPS) expect(opts[name], name).toBe(true)
  })

  it("o veredito NOMEIA o perfil no topo do não-provado (não parece flag esquecida no YAML)", () => {
    const v = summarize(facts({ ciProfile: true, skippedGuards: true }))
    expect(v.unproven[0]).toContain("PERFIL --ci")
    expect(v.unproven[0]).toContain("cron")
    // As oito linhas de skip continuam lá: o perfil é um atalho, não um silêncio.
    expect(v.unproven.join(" ")).toContain("pulados por --no-guards")
  })

  it("o CLI aceita --ci e sai com o perfil declarado no relatório", () => {
    const dir = forgeFixture()
    const res = spawnSync(
      process.execPath,
      [
        join(ROOT, "scripts", "forge-doctor.mjs"),
        "--ci",
        "--json",
        "--expected",
        "1.3.14",
        "--expected-var",
        "IMAGE_REGISTRY=ghcr.io",
        "--expected-var",
        "IMAGE_NAMESPACE=severinno",
      ],
      { cwd: dir, encoding: "utf8", timeout: 60_000 },
    )
    // 2 (INDETERMINADA) é o resultado NORMAL do perfil: o que ficou fora é
    // declarado, e nenhuma violação foi encontrada. 0 (PRONTA) seria mentira —
    // o perfil não prova o registry, a proteção nem o HOST.
    expect(res.status, `${res.stdout}\n${res.stderr}`).toBe(2)
    const report = JSON.parse(res.stdout)
    expect(report.facts.ciProfile).toBe(true)
    expect(report.verdict.blockers).toEqual([])
    expect(report.verdict.unproven[0]).toContain("PERFIL --ci")
    // O GATE do bring-up é fato do relatório (e do JSON): a fixture é uma forja
    // COMPLETA, então ele sai `proven` — um contrato sem o job seria BLOQUEIO.
    expect(report.facts.bringUpGate.state).toBe("proven")
    expect(report.facts.bringUpGate.job).toBe(BRING_UP_GATE_JOB)
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

// ── o PRÉ-REQUISITO 0 do bring-up: exigido, nomeado e com o remédio ─────────
//
// O `deploy/gitea-up.sh` RECUSA a subida quando o env do host não espelha o
// template comitado. O doctor já MEDIA isso (a metade host × template da
// interpolação do compose); o que estes testes prendem é que ele passou a
// NOMEAR o pré-requisito, a dizer o COMANDO que o reproduz e o REMÉDIO — e que
// o fato é DERIVADO dessa medição, nunca uma segunda sonda da mesma pergunta.

describe("deriveBringUpEnv — o pré-requisito 0, derivado da medição do compose", () => {
  /** O env do host divergiu: as violações viajam no fato, e a comparação sabe os dois arquivos. */
  const diverged = {
    state: "violated",
    violations: ["deploy/.env.gitea: 'IMAGE_NAMESPACE' DIVERGE do template comitado"],
    detail: "1 divergencia(s)",
    hostCompare: {
      state: "diverged",
      detail: `1 divergencia(s) entre o env do HOST (deploy/.env.gitea) e o template comitado (${GITEA_ENV_MIRROR})`,
      host: "deploy/.env.gitea",
      template: GITEA_ENV_MIRROR,
    },
  }

  it("em sincronia → provado, e o fato diz que a subida PASSA pelo pré-requisito 0", () => {
    const r = deriveBringUpEnv({
      state: "proven",
      hostCompare: {
        state: "in-sync",
        detail: "host x template em sincronia: 4 variavel(is)",
        host: "deploy/.env.gitea",
        template: GITEA_ENV_MIRROR,
      },
    })
    expect(r.state).toBe("proven")
    expect(r.refuses).toBe(false)
    expect(r.detail).toContain(GITEA_BRING_UP)
  })

  it("divergente → violado, COM RECUSA, e o comando nomeia os DOIS arquivos comparados", () => {
    const r = deriveBringUpEnv(diverged)
    expect(r.state).toBe("violated")
    expect(r.refuses).toBe(true)
    expect(r.detail).toContain("RECUSA")
    expect(r.detail).toContain(GITEA_BRING_UP)
    // Reproduzível: quem lê o relatório cola este comando e vê o mesmo veredito.
    expect(r.command).toBe(
      `${ENV_MIRROR_CHECK} --host deploy/.env.gitea --template ${GITEA_ENV_MIRROR}`,
    )
    // O REMÉDIO sai junto do diagnóstico: sem ele o operador volta a corrigir a mão.
    expect(r.remedies.join(" ")).toContain(`${ENV_MIRROR_CHECK} --patch`)
    expect(r.remedies.join(" ")).toContain(`${ENV_MIRROR_CHECK} --fix`)
    // Uma medição, dois papéis: o fato DECLARA de onde leu (e não faz uma sonda própria).
    expect(r.readsFrom).toBe("compose.hostCompare")
  })

  it("sem o env do host AQUI → não coberto, com o comando de descoberta (o do host onde ele existe)", () => {
    const r = deriveBringUpEnv({
      state: "proven",
      hostCompare: { state: "absent", detail: "o env do HOST (deploy/.env.gitea) nao existe" },
    })
    expect(r.state).toBe("absent")
    expect(r.refuses).toBe(false)
    expect(r.command).toBe(ENV_MIRROR_CHECK)
    expect(r.detail).toContain("nao foi coberto")
    expect(r.detail).toContain(ENV_MIRROR_CHECK)
  })

  it("sem a stack da forja neste checkout → não se aplica (cobrar o env de quem não tem a stack seria inventar problema)", () => {
    const r = deriveBringUpEnv({
      state: "absent",
      violations: [],
      detail: `${GITEA_COMPOSE} nao existe neste checkout`,
      hostCompare: { state: "absent", detail: "a stack nao existe neste checkout" },
    })
    expect(r.state).toBe("not-applicable")
    expect(r.detail).toContain(GITEA_COMPOSE)
  })

  it("seção pulada → 'skipped' (a omissão é declarada, nunca silenciosa)", () => {
    const r = deriveBringUpEnv({
      state: "skipped",
      hostCompare: { state: "skipped", detail: "pulada" },
    })
    expect(r.state).toBe("skipped")
  })

  it("sem estado na comparação → 'unavailable', e o comando continua no detalhe", () => {
    const r = deriveBringUpEnv({ state: "unavailable", hostCompare: { state: "" } })
    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain(ENV_MIRROR_CHECK)
  })

  it("sem o fato do compose → 'not-applicable' (um fato montado à mão não vira bloqueio fantasma)", () => {
    expect(deriveBringUpEnv().state).toBe("not-applicable")
  })
})

describe("summarize — o pré-requisito 0 no veredito", () => {
  const bringUpDiverged = {
    state: "violated",
    violations: ["deploy/.env.gitea: 'IMAGE_NAMESPACE' DIVERGE do template comitado"],
    detail: "1 divergencia(s)",
    hostCompare: {
      state: "diverged",
      detail: "1 divergencia(s) entre o env do HOST e o template comitado",
      host: "deploy/.env.gitea",
      template: GITEA_ENV_MIRROR,
    },
  }

  it("divergente → BLOQUEIA, e a linha do pré-requisito diz que é CONSEQUÊNCIA da divergência (não um 2º problema)", () => {
    const v = summarize(facts({ compose: bringUpDiverged }))
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    const text = v.blockers.join("\n")
    // A violação em si (a mesma função do guard) continua sendo a linha de bloqueio…
    expect(text).toContain("IMAGE_NAMESPACE")
    // …e o pré-requisito entra como CONSEQUÊNCIA dela, com o comando e o remédio.
    expect(text).toContain("por causa da divergencia acima")
    expect(text).toContain(GITEA_BRING_UP)
    expect(text).toContain(`${ENV_MIRROR_CHECK} --host deploy/.env.gitea`)
    expect(text).toContain("--fix")
    expect(v.blockers).toHaveLength(2)
  })

  it("sem o env do host → INDETERMINADA, nomeando o pré-requisito, o comando e o lugar onde rodá-lo", () => {
    const v = summarize(
      facts({
        compose: {
          state: "proven",
          violations: [],
          detail: "3 fases ok",
          hostCompare: { state: "absent", detail: "o env do HOST (deploy/.env.gitea) nao existe" },
        },
      }),
    )
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    const text = v.unknowns.join("\n")
    expect(text).toContain("env do HOST nao foi comparado")
    expect(text).toContain("PRE-REQUISITO 0")
    expect(text).toContain(ENV_MIRROR_CHECK)
    expect(text).toContain("rode-o no host onde o arquivo existe")
  })

  it("em sincronia → não rebaixa: a cobertura do pré-requisito 0 não pode custar um falso alarme", () => {
    expect(summarize(facts()).verdict).toBe(VERDICT.READY)
  })

  it("checkout sem a stack → nada cobrado (nem bloqueio, nem dúvida)", () => {
    const v = summarize(
      facts({
        compose: {
          state: "absent",
          violations: [],
          detail: "nada a interpolar",
          hostCompare: { state: "absent", detail: "a stack nao existe neste checkout" },
        },
      }),
    )
    expect(v.verdict).toBe(VERDICT.READY)
    expect(v.unknowns.join(" ")).not.toContain("PRE-REQUISITO 0")
  })

  it("o relatório mostra a linha do pré-requisito 0 com o ESTADO e o COMANDO (na seção dos espelhos)", () => {
    const lines: string[] = []
    const f = facts({ compose: bringUpDiverged })
    renderReport({ facts: f, verdict: summarize(f) }, { emit: (s = "") => lines.push(s) })
    const text = lines.join("\n")
    expect(text).toContain(`PRE-REQUISITO 0 do ${GITEA_BRING_UP}`)
    expect(text).toContain("violated")
    expect(text).toContain(`${ENV_MIRROR_CHECK} --host deploy/.env.gitea`)
    expect(text).toContain(`${ENV_MIRROR_CHECK} --fix`)
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

// ── O GATE do bring-up: o contrato EXIGE, e o job RODA a prova ────────────

/**
 * Raiz com o CONTRATO real e as DUAS pipelines reais, mutáveis.
 *
 * Por que o contrato real e não um sintético: a pergunta do fato é sobre ESTE
 * repositório (a prova é a `bring-up-proof`, o pipeline é o de merge) — uma
 * fixture inventada provaria a fixture.
 */
function gateRoot(
  mutate: {
    dropJobFromManifest?: string
    run?: string | null
    renameJobIn?: string
    dropWorkflow?: string
    dropForge?: string
  } = {},
): string {
  const dir = makeDir()
  const manifest = JSON.parse(readFileSync(join(ROOT, REQUIRED_CHECKS_MANIFEST), "utf8")) as {
    forges: Record<string, { workflow: string; jobs: string[] }>
  }
  for (const [forge, cfg] of Object.entries(manifest.forges)) {
    if (forge === mutate.dropForge) delete manifest.forges[forge]
    else if (mutate.dropJobFromManifest) {
      cfg.jobs = cfg.jobs.filter((j) => j !== mutate.dropJobFromManifest)
    }
  }
  mkdirSync(join(dir, "ci"), { recursive: true })
  writeFileSync(join(dir, REQUIRED_CHECKS_MANIFEST), JSON.stringify(manifest, null, 2))

  for (const cfg of Object.values(manifest.forges)) {
    if (cfg.workflow === mutate.dropWorkflow) continue
    let text = readFileSync(join(ROOT, cfg.workflow), "utf8")
    if (mutate.run !== undefined) {
      const anchor = "run: node scripts/prove-runner-image-gate.mjs"
      expect(text, "a linha do gate mudou de forma — atualize a mutação").toContain(anchor)
      text = text.replace(anchor, `run: ${mutate.run}`)
    }
    if (cfg.workflow === mutate.renameJobIn) {
      text = text.replace(`\n  ${BRING_UP_GATE_JOB}:`, "\n  bring-up-proof-renomeado:")
    }
    mkdirSync(join(dir, dirname(cfg.workflow)), { recursive: true })
    writeFileSync(join(dir, cfg.workflow), text)
  }
  return dir
}

describe("readBringUpGate — o gate do bring-up no contrato de merge", () => {
  it("o repositório real: as DUAS forjas exigem o gate, o job roda a prova E a branch protection o registra", () => {
    const r = readBringUpGate({ cwd: ROOT })
    // Sem protection passado, registered é null (a proteção não foi lida).
    expect(r.state).toBe("proven")
    expect(r.job).toBe(BRING_UP_GATE_JOB)
    expect(r.forges.map((f) => f.forge).sort()).toEqual(["gitea", "github"])
    // A evidência é a linha `run:` — não o rótulo do job nem o `name:` exibido.
    for (const f of r.forges) {
      expect(f.command).toBe("node scripts/prove-runner-image-gate.mjs")
      expect(f.registered).toBeNull()
    }
    expect(r.violations).toEqual([])
  })

  it("gate no contrato E protection em sincronia → proven, com registered=true por forja", () => {
    const r = readBringUpGate({
      cwd: ROOT,
      protection: {
        state: "in-sync",
        detail: "main exige os 23 check(s) do manifesto",
        forges: [
          { forge: "gitea", state: "in-sync", missing: [], extra: [], branches: [] },
          { forge: "github", state: "in-sync", missing: [], extra: [], branches: [] },
        ],
      },
    })
    expect(r.state).toBe("proven")
    expect(r.detail).toContain("branch protection o registra")
    for (const f of r.forges) expect(f.registered).toBe(true)
  })

  it("gate no contrato MAS protection em drift com o gate MISSING → violated", () => {
    const r = readBringUpGate({
      cwd: ROOT,
      protection: {
        state: "drift",
        detail: "gitea: falta(m) 'bring-up-proof'",
        forges: [
          { forge: "gitea", state: "drift", missing: ["bring-up-proof"], extra: [], branches: [] },
          { forge: "github", state: "in-sync", missing: [], extra: [], branches: [] },
        ],
      },
    })
    expect(r.state).toBe("violated")
    expect(r.violations.join(" ")).toContain("NAO o registra")
    expect(r.violations.join(" ")).toContain("gitea")
    expect(r.forges.find((f) => f.forge === "gitea")?.registered).toBe(false)
    expect(r.forges.find((f) => f.forge === "github")?.registered).toBe(true)
  })

  it("gate no contrato MAS protection unavailable → unavailable (não pode provar o registro)", () => {
    const r = readBringUpGate({
      cwd: ROOT,
      protection: {
        state: "unavailable",
        detail: "token sem permissao de administracao",
        forges: [
          { forge: "gitea", state: "unavailable", missing: null, extra: [], branches: [] },
          { forge: "github", state: "unavailable", missing: null, extra: [], branches: [] },
        ],
      },
    })
    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("branch protection REGISTRADA nao foi lida")
    for (const f of r.forges) expect(f.registered).toBeNull()
  })

  it("contrato que deixa de EXIGIR o job → violado, nomeando a forja", () => {
    const r = readBringUpGate({ cwd: gateRoot({ dropJobFromManifest: BRING_UP_GATE_JOB }) })
    expect(r.state).toBe("violated")
    // As DUAS forjas, uma linha cada: uma prova que roda e não é exigida deixa o
    // merge livre exatamente onde ele acontece.
    expect(r.violations).toHaveLength(2)
    expect(r.violations.join(" ")).toContain("NAO exige o job")
    expect(r.violations.join(" ")).toContain("gitea")
    expect(r.violations.join(" ")).toContain("github")
    // O remédio é o do MANIFESTO (a fonte), não um "suba a prova na mão".
    expect(r.remedies.join(" ")).toContain(REQUIRED_CHECKS_MANIFEST)
  })

  it("job exigido que deixou de RODAR a prova → violado (gate decorativo)", () => {
    const r = readBringUpGate({ cwd: gateRoot({ run: "echo ok" }) })
    expect(r.state).toBe("violated")
    expect(r.violations.every((v) => v.includes("gate decorativo"))).toBe(true)
    expect(r.forges.every((f) => f.command === null)).toBe(true)
  })

  it("job RENOMEADO numa forja → violado só naquela (a outra segue provada)", () => {
    const dir = gateRoot({ renameJobIn: ".gitea/workflows/ci.yml" })
    const r = readBringUpGate({ cwd: dir })
    expect(r.state).toBe("violated")
    const gitea = r.forges.find((f) => f.forge === "gitea")
    const github = r.forges.find((f) => f.forge === "github")
    expect(gitea?.command).toBeNull()
    expect(gitea?.detail).toContain("check:required-checks")
    expect(github?.command).toBe("node scripts/prove-runner-image-gate.mjs")
  })

  it("pipeline exigida ausente do checkout → 'unavailable' (nunca 'proven')", () => {
    const r = readBringUpGate({ cwd: gateRoot({ dropWorkflow: ".gitea/workflows/ci.yml" }) })
    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("ausente deste checkout")
  })

  it("raiz com UMA forja: o fato é POR FORJA (a outra não é presumida)", () => {
    const r = readBringUpGate({ cwd: gateRoot({ dropForge: "github" }) })
    expect(r.state).toBe("proven")
    expect(r.forges.map((f) => f.forge)).toEqual(["gitea"])
  })

  it("manifesto sem forja nenhuma → 'unavailable' com o motivo (nunca 'proven')", () => {
    const r = readBringUpGate({
      cwd: ROOT,
      contract: {
        forges: [],
        failures: [`${REQUIRED_CHECKS_MANIFEST}: nenhuma forja declarada`],
        unknown: null,
      },
    })
    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("nao declara forja nenhuma")
    expect(r.detail).toContain("nenhuma forja declarada")
  })

  it("o contrato RECEBIDO é o que vale (uma leitura do manifesto, uma resposta)", () => {
    // `diagnose` passa o contrato já lido: se o fato relesse o manifesto, ele
    // teria a própria verdade sobre os jobs obrigatórios — as duas divergiriam
    // no dia em que alguém editasse o arquivo no meio da execução.
    const r = readBringUpGate({
      cwd: ROOT,
      contract: {
        forges: [
          {
            forge: "gitea",
            workflow: MERGE_OWNER_PIPELINE,
            jobs: 1,
            jobIds: [BRING_UP_GATE_JOB],
            exists: true,
          },
        ],
        failures: [],
        unknown: null,
      },
    })
    expect(r.state).toBe("proven")
    expect(r.forges.map((f) => f.forge)).toEqual(["gitea"])
  })
})

// ── o contrato de CADA gate CORE: a régua é da INVARIANTE, e o comando é do JOB ─

/**
 * Fixture FIEL às duas pipelines REAIS (uma por forja), não uma pipeline só
 * repetida: cada job roda o comando que ele roda lá.
 *
 * POR QUE ISTO EXISTE: a fixture antiga (`pipeline()`) escrevia uma pipeline só
 * e a repetia para as duas forjas, então o fato podia acusar o repositório REAL
 * de violações que a suíte nunca viu — um fixture que arruma a realidade que o
 * teste deveria medir não mede nada.
 *
 * O lint é o caso onde a fidelidade tem CONTEÚDO: até esta passada cada forja
 * rodava o seu próprio comando (a Gitea `bun run lint` = `eslint .`; o GitHub o
 * par prettier+eslint inline), e era essa diferença que fazia o mesmo commit
 * passar no merge de uma e ser rejeitado na outra. Hoje as duas rodam o MESMO
 * `bun run lint`, e é isso que a fixture declara — o parâmetro `lintDoGithub`
 * existe para o CONTROLE reproduzir a régua própria e exigir a violação.
 */
const GITHUB_PIPELINE = ".github/workflows/pr-check.yml"

function twoForgeFixture(opts: { semComandoDoGate?: string; lintDoGithub?: string } = {}): string {
  const sem = opts.semComandoDoGate ?? null
  // O comando do gate de lint da forja do GitHub. O default é o MESMO da Gitea
  // (`bun run lint`): a régua é da invariante, não da forja. O parâmetro existe
  // para o CONTROLE reproduzir a régua própria que a assimetria antiga
  // legitimava (eslint inline, sem prettier) e exigir a violação.
  const lintGithub = opts.lintDoGithub ?? "bun run lint"
  const dir = makeDir()
  mkdirSync(join(dir, ".gitea", "workflows"), { recursive: true })
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true })
  mkdirSync(join(dir, "ci"), { recursive: true })

  // O job `guards` da Gitea roda as invariantes CORE que ali moram: cada uma
  // declara a sua régua e cada uma tem de ser medida — o dedup por jobId
  // conferia só a primeira da lista e dava as outras por cobertas. Os comandos
  // aqui são os CANÔNICOS (o `command` de cada invariante): `node scripts/x.mjs`
  // com os MESMOS argumentos do espelho do GitHub.
  const guardCommands: [string, string][] = [
    ["ts-nocheck", "bun run check:ts-nocheck"],
    ["required-checks", "node scripts/check-required-checks.mjs"],
    ["registry-source", "node scripts/check-registry-source.mjs"],
    ["runner-base", "node scripts/check-runner-base.mjs"],
    ["forge-workflow-scope", "node scripts/check-forge-workflow-scope.mjs"],
    ["forge-parity", "node scripts/check-forge-parity.mjs"],
    ["script-headers", "node scripts/check-script-headers.mjs"],
    ["prove-docs", "node scripts/check-prove-docs.mjs"],
    ["pipefail-sigpipe", "node scripts/check-pipefail-sigpipe.mjs"],
    // As nove que passaram a ser invocadas pela MESMA linha canônica do
    // espelho dentro do job `guards` (antes rodavam na forja por outra forma,
    // ou não rodavam): o manifesto EXIGE o job `guards` para cada uma delas, e
    // o fato tem de medir a régua de cada uma — não a do vizinho.
    ["doctor-ci", "node scripts/check-doctor-ci.mjs"],
    ["workflow-refs", "node scripts/check-workflow-refs.mjs --pkg-internal"],
    ["bun-audit", "node scripts/check-bun-audit-baseline.mjs"],
    ["hooks-symmetry", "node scripts/check-hooks-symmetry.mjs"],
    ["secret-leaks", "node scripts/rotate-secrets.mjs --check"],
    ["seed-hooks", "node scripts/check-seed-hooks.mjs"],
    ["sentinel-producer", "node scripts/check-sentinel-producer.mjs"],
    ["bun-mirror", "node scripts/check-bun-mirror.mjs"],
    ["no-setup-bun", "node scripts/check-no-setup-bun.mjs"],
    ["hook-ci-parity", "node scripts/check-hook-ci-parity.mjs"],
    ["hook-commands", "node scripts/check-hook-commands.mjs"],
    ["job-deps", "node scripts/check-job-deps.mjs"],
    ["workflow-run-syntax", "node scripts/check-workflow-run-syntax.mjs"],
    ["merge-latency", "node scripts/merge-latency.mjs --check"],
  ]
  writeFileSync(
    join(dir, MERGE_OWNER_PIPELINE),
    [
      "on:",
      "  pull_request:",
      "jobs:",
      `  ${FORGE_GUARDS_JOB}:`,
      "    steps:",
      "      - run: bun install --frozen-lockfile",
      ...guardCommands.flatMap(([nome, cmd]) =>
        nome === sem ? [] : [`      - name: ${nome}`, `        run: ${cmd}`],
      ),
      `  ${BRING_UP_GATE_JOB}:`,
      "    steps:",
      "      - run: node scripts/prove-runner-image-gate.mjs",
      "  typecheck:",
      "    steps:",
      "      - run: bun run typecheck",
      "  lint:",
      "    steps:",
      "      - run: bun run lint",
      "  test:",
      "    steps:",
      "      - run: bun run test:run",
      "",
    ].join("\n"),
  )
  writeFileSync(
    join(dir, GITHUB_PIPELINE),
    [
      "on:",
      "  pull_request:",
      "jobs:",
      "  secrets-guard:",
      "    steps:",
      "      - run: node scripts/rotate-secrets.mjs --check",
      "  workflow-refs-guard:",
      "    steps:",
      "      - run: node scripts/check-workflow-refs.mjs --pkg-internal",
      // O gate de paridade hook↔CI roda nas DUAS forjas (o veredito local e o
      // do merge são dois conjuntos de comandos em dois arquivos).
      "      - run: node scripts/check-hook-ci-parity.mjs",
      // O gate da classe SIGPIPE roda nas DUAS forjas; na fixture ele vive no
      // job que carrega os guards node-puros do GitHub (como no repositório).
      "      - run: node scripts/check-pipefail-sigpipe.mjs",
      // A SINTAXE do corpo `run:` — o outro guard node-puro de workflow, no
      // MESMO job do espelho (e pelo mesmo literal da forja).
      "      - run: node scripts/check-workflow-run-syntax.mjs",
      // A LATÊNCIA DE MERGE do dono do merge: o MESMO comando nas duas forjas
      // (o `--check` julga a forja que mergeia, venha de onde vier).
      "      - run: node scripts/merge-latency.mjs --check",
      "  pii-allowlist-guard:",
      "    steps:",
      '      - run: bash scripts/setup-bun-ci.sh "${{ vars.BUN_VERSION }}"',
      "      - run: bun run check:pii-allowlist",
      "      - run: bun run check:pii-gate",
      `  ${BRING_UP_GATE_JOB}:`,
      "    steps:",
      "      - run: node scripts/prove-runner-image-gate.mjs",
      "  typecheck:",
      "    steps:",
      "      - run: bun run typecheck",
      // O job REAL: o MESMO comando do job `lint` da Gitea — o par
      // (prettier + eslint zero) mora no script `lint` do package.json, e a
      // forja não tem régua própria. Um comando inline aqui seria a assimetria
      // de volta.
      "  lint-guard:",
      "    steps:",
      '      - run: bash scripts/setup-bun-ci.sh "${{ vars.BUN_VERSION }}"',
      "      - run: bun install --frozen-lockfile",
      "      - name: Check lint (prettier + eslint zero)",
      `        run: ${lintGithub}`,
      // O job REAL de testes: um passo cujo RÓTULO contém "check" ANTES do
      // passo que roda a suíte — o rótulo não pode sequestrar a régua.
      "  check:",
      "    steps:",
      "      - run: bun install --frozen-lockfile",
      // O rótulo REAL do repositório, montado em pedaços: escrito inteiro aqui,
      // a própria diretiva (o comentário que desliga o typecheck do arquivo)
      // apareceria no texto deste arquivo e o `check:ts-nocheck` acusaria ESTE
      // teste. O alvo do teste é o rótulo conter "check" — e é isso que a
      // concatenação preserva.
      `      - name: "Guard: no ${["@ts", "-", "nocheck"].join("")} in non-generated files"`,
      "        run: bun run check:ts-nocheck",
      ...(sem === "tests" ? [] : ["      - name: Unit tests", "        run: bun run test:run"]),
      "",
    ].join("\n"),
  )
  writeFileSync(
    join(dir, REQUIRED_CHECKS_MANIFEST),
    JSON.stringify({
      version: 1,
      branches: ["main"],
      forges: {
        gitea: {
          workflow: MERGE_OWNER_PIPELINE,
          jobs: [FORGE_GUARDS_JOB, BRING_UP_GATE_JOB, "typecheck", "lint", "test"],
        },
        github: {
          workflow: GITHUB_PIPELINE,
          jobs: [
            "secrets-guard",
            "workflow-refs-guard",
            "pii-allowlist-guard",
            BRING_UP_GATE_JOB,
            "typecheck",
            "lint-guard",
            "check",
          ],
        },
      },
    }),
  )
  return dir
}

/** O retorno do `.mjs` chega como `object`: o teste estreita o que ele lê. */
type GateContractResult = {
  invariantId: string
  jobId: string
  state: string
  violations: string[]
  forges: { forge: string; command: string | null }[]
}

function contractResults(dir: string): GateContractResult[] {
  return readAllGateContracts({ cwd: dir, contract: readContract(dir) })
    .results as unknown as GateContractResult[]
}

/**
 * A proteção de uma forja que NÃO foi lida: `missing: null` (nunca `[]` — lista
 * vazia é "tudo registrado") e o estado dizendo POR QUÊ.
 */
const protecao = (forge: string, state: string) => ({
  forge,
  state,
  desired: 0,
  branches: [],
  missing: null,
  extra: null,
  ...(state === "unsupported" ? { unsupported: true } : {}),
})

// ── a proteção NÃO LIDA não pode virar "registrado" ────────────────────────
//
// O DEFEITO MEDIDO, e por isso este bloco existe: o cruzamento dos gates CORE
// com a proteção fazia `pf.missing ?? []`, transformando "não li" (null) em
// lista vazia — e lista vazia é "tudo registrado". Com as DUAS forjas sem
// proteção lida, o relatório publicava **50 gates CORE "provado(s)", 0 "não
// conferido(s)"**, com o aviso de "não foi lida" impresso na linha de cima. É a
// classe de defeito que este repositório persegue: "não consegui ler" virando
// "está tudo lá".

describe("a branch protection que NÃO foi lida deixa o gate NÃO CONFERIDO (jamais 'proven')", () => {
  it("nenhum gate CORE sai 'proven' quando a proteção das duas forjas não foi lida", () => {
    const dir = twoForgeFixture()
    const r = readAllGateContracts({
      cwd: dir,
      contract: readContract(dir),
      protection: {
        state: "unavailable",
        forges: [protecao("gitea", "unavailable"), protecao("github", "unavailable")],
      },
    })
    expect(r.results.length).toBeGreaterThan(0)
    // NENHUM contrato pode sair "proven": o que a proteção não confirmou não
    // pode aparecer como registrado (os `violated` deste fixture são de outros
    // defeitos, plantados de propósito — o que este teste mede é a ausência de
    // "proven").
    expect(r.results.some((x) => x.state === "proven")).toBe(false)
    expect(r.allProven).toBe(false)
    const naoConferidos = r.results.filter((x) => x.state === "unavailable")
    expect(naoConferidos.length).toBeGreaterThan(0)
    expect(naoConferidos[0].detail).toContain("branch protection de gitea, github não foi lida")
  })

  it("uma forja em sincronia e a outra não lida: só a lida conta (o `registered` é POR forja)", () => {
    const dir = twoForgeFixture()
    const r = readAllGateContracts({
      cwd: dir,
      contract: readContract(dir),
      protection: {
        state: "unavailable",
        forges: [
          { ...protecao("gitea", "unavailable"), missing: [] },
          protecao("github", "unavailable"),
        ],
      },
    })
    // O contrato que cobre AS DUAS forjas não pode sair "proven" — era AQUI que
    // o defeito aparecia, porque só o caso "todas nulas" era tratado e a metade
    // lida liberava a afirmação sobre a não lida.
    const dois = r.results.find((x) => x.forges.length === 2)!
    const giteaEntry = dois.forges.find((f) => f.forge === "gitea") as {
      registered: boolean | null
    }
    const githubEntry = dois.forges.find((f) => f.forge === "github") as {
      registered: boolean | null
    }
    expect(giteaEntry.registered).toBe(true)
    expect(githubEntry.registered).toBeNull()
    expect(dois.state).toBe("unavailable")
    expect(dois.detail).toContain("a branch protection de github não foi lida")
    // E o contrato que só declara a forja LIDA segue medido: a ausência de
    // leitura de uma forja não contamina a outra.
    const so = r.results.find((x) => x.forges.length === 1 && x.forges[0].forge === "gitea")!
    expect(so.state).not.toBe("unavailable")
  })

  it("a forja que NÃO SUPORTA diz ISSO — e não 'não foi lida' (as ações são diferentes)", () => {
    const dir = twoForgeFixture()
    const r = readAllGateContracts({
      cwd: dir,
      contract: readContract(dir),
      protection: {
        state: "unsupported",
        forges: [protecao("gitea", "unsupported"), protecao("github", "unsupported")],
      },
    })
    expect(r.results[0].state).toBe("unavailable")
    expect(r.results[0].detail).toContain("NÃO SUPORTA branch protection")
    expect(r.results[0].detail).toContain("o merge daquele lado não tem portão")
    expect(r.allProven).toBe(false)
  })
})

describe("readAllGateContracts — o job EXIGIDO roda a régua da INVARIANTE, a MESMA nas duas forjas", () => {
  it("a régua é UMA: as duas forjas rodam o MESMO `bun run lint`", () => {
    const lint = contractResults(twoForgeFixture()).filter((x) => x.invariantId === "lint")
    expect(lint.map((x) => x.jobId).sort()).toEqual(["lint", "lint-guard"])
    expect(lint.map((x) => x.state)).toEqual(["proven", "proven"])
    // E o COMANDO é o mesmo dos dois lados — é isto que impede o merge de ser
    // liberado pela régua mais fraca de uma das forjas.
    for (const c of lint) expect(c.forges.map((f) => f.command)).toEqual(["bun run lint"])
  })

  it("o `script` do contrato é DERIVADO do comando canônico (o campo já foi o do bring-up)", () => {
    // O defeito encontrado: o `base` do contrato copiava `PROOF_SCRIPT`, então
    // TODO gate publicava no `--json` o script do bring-up — e um consumidor do
    // relatório lia "o script do gate de lint é prove-runner-image-gate.mjs".
    expect(scriptOfCommand(/^node scripts\/prove-pre-commit-in-runner\.mjs$/m)).toBe(
      "scripts/prove-pre-commit-in-runner.mjs",
    )
    expect(scriptOfCommand(/^bun run typecheck$/)).toBe("typecheck")
    expect(scriptOfCommand(/^bun run test:run$/m)).toBe("test:run")
    expect(scriptOfCommand(/^node scripts\/rotate-secrets\.mjs --check$/m)).toBe(
      "scripts/rotate-secrets.mjs",
    )
    expect(scriptOfCommand(undefined)).toBeNull()
    // No contrato REAL: nenhum gate fica sem script, e dois gates diferentes não
    // podem publicar o MESMO (que era o sintoma do copia-e-cola).
    const scripts = coreGateContracts().map((c) => scriptOfCommand(c.expectedCommand))
    expect(scripts.filter((s) => s === null)).toEqual([])
    expect(new Set(scripts).size).toBeGreaterThan(5)
  })

  it("CONTROLE: uma forja com régua PRÓPRIA (só eslint, sem prettier) é VIOLAÇÃO", () => {
    // A assimetria que este fato passou a PROIBIR, reproduzida no formato que
    // ela tinha: o GitHub rodando `eslint . --max-warnings 0` inline enquanto a
    // Gitea rodava o script do repo. O fato tem de acusar — sem isso, a régua
    // poderia voltar a divergir sem ninguém ver.
    const dir = twoForgeFixture({ lintDoGithub: "npx eslint . --max-warnings 0" })
    const lint = contractResults(dir).filter((x) => x.invariantId === "lint")
    const github = lint.find((x) => x.jobId === "lint-guard")!
    expect(github.state).toBe("violated")
    expect(github.violations[0]).toContain("npx eslint . --max-warnings 0")
    // O OUTRO lado segue provado: a violação é do comando, não do fixture.
    expect(lint.find((x) => x.jobId === "lint")!.state).toBe("proven")
    expect(readAllGateContracts({ cwd: dir, contract: readContract(dir) }).allProven).toBe(false)
  })

  it("a forja que NÃO declara o job não vira violação (isso é do check:forge-parity)", () => {
    const dir = twoForgeFixture()
    const r = readAllGateContracts({ cwd: dir, contract: readContract(dir) })
    // `lint-guard` só existe no manifesto do GitHub: a conferência da Gitea
    // acusava "a forja gitea NÃO exige o job 'lint-guard'" — e o mesmo ao
    // contrário para `lint`. Nenhuma das duas é violação deste fato.
    const giteaOnly = contractResults(dir).find(
      (x) => x.invariantId === "lint" && x.jobId === "lint",
    )!
    expect(giteaOnly.forges.map((f) => f.forge)).toEqual(["gitea"])
    expect(r.violations.filter((v) => v.includes("NÃO exige o job"))).toEqual([])
  })

  it("um passo com 'check' no RÓTULO não sequestra o comando do gate", () => {
    const testes = contractResults(twoForgeFixture()).find(
      (x) => x.invariantId === "tests" && x.jobId === "check",
    )!
    expect(testes.state).toBe("proven")
    expect(testes.forges[0].command).toBe("bun run test:run")
  })

  it("CONTROLE: sem o comando da régua, o fato acusa o gate trocado (o teste tem dentes)", () => {
    const dir = twoForgeFixture({ semComandoDoGate: "tests" })
    const testes = contractResults(dir).find(
      (x) => x.invariantId === "tests" && x.jobId === "check",
    )!
    expect(testes.state).toBe("violated")
    // A violação NOMEIA a linha que o job realmente executa.
    expect(testes.violations[0]).toContain("bun run check:ts-nocheck")
    expect(readAllGateContracts({ cwd: dir, contract: readContract(dir) }).allProven).toBe(false)
  })

  it("cada invariante que compartilha o job 'guards' tem a SUA régua medida", () => {
    const dir = twoForgeFixture()
    const noMesmoJob = contractResults(dir).filter((x) => x.jobId === FORGE_GUARDS_JOB)
    // VINTE E TRÊS invariantes CORE vivem no mesmo job `guards`: nove que sempre
    // estiveram ali, dez que passaram a ser invocadas pela MESMA linha canônica
    // do espelho (antes rodavam na forja por outra forma, ou não rodavam), a da
    // SINTAXE do corpo `run:`, a da LATÊNCIA de merge, a dos COMANDOS DOS HOOKS
    // e a das DEPENDÊNCIAS DOS JOBS (a última a entrar). Deduplicando pelo job,
    // vinte e duas ficariam fora da lista de contratos e apareceriam como
    // cobertas sem nunca terem sido medidas.
    expect(noMesmoJob.length).toBe(23)
    expect(new Set(noMesmoJob.map((x) => x.invariantId)).size).toBe(23)
    expect(noMesmoJob.every((x) => x.state === "proven")).toBe(true)
    // E cada uma responde pela SUA remoção — não pela do vizinho.
    const semRequired = twoForgeFixture({ semComandoDoGate: "required-checks" })
    const r2 = contractResults(semRequired)
    const pick = (id: string) =>
      r2.find((x) => x.invariantId === id && x.jobId === FORGE_GUARDS_JOB)!
    expect(pick("required-checks").state).toBe("violated")
    expect(pick("ts-nocheck").state).toBe("proven")
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

  it("a forja que NÃO SUPORTA o recurso → estado PRÓPRIO (não 'unavailable': não é falta de canal)", () => {
    // MEDIDO no GitHub deste repositório: com token de ADMINISTRAÇÃO, o GET e o
    // PATCH do branch protection respondem 403 'Upgrade to GitHub Pro or make
    // this repository public'. O aplicador marca isso como `unsupported`, e o
    // doctor não pode tratar como "não consegui ler": o efeito é diferente — o
    // merge daquela forja não tem portão nenhum, e nenhum token resolve.
    const r = readProtection({
      forges: ["github"],
      run: stub({
        status: 1,
        stdout: applierJson({
          forge: "github",
          errors: [
            {
              forge: "github",
              message:
                "GitHub GET /repos/o/r/branches/main/protection/required_status_checks → HTTP 403: " +
                '{"message":"Upgrade to GitHub Pro or make this repository public to enable this feature."} ' +
                "— a FORJA NÃO SUPORTA branch protection neste repositório",
              unsupported: true,
            },
          ],
        }),
      }) as never,
    })
    expect(r.state).toBe("unsupported")
    const github = r.forges[0] as { state: string; unsupported?: boolean; missing: unknown }
    expect(github.state).toBe("unsupported")
    expect(github.unsupported).toBe(true)
    // E o `missing` continua sendo "não li" (null), NUNCA lista vazia: lista
    // vazia é "tudo registrado", o oposto do que este estado diz.
    expect(github.missing).toBeNull()
  })

  it("`unsupported` DOMINA `unavailable` no agregado, e não é drift (não há o que consertar com um comando)", () => {
    const run = ((_bin: string, args: string[]) => {
      const forge = forgeOf(args)
      if (forge === "github") {
        return {
          status: 1,
          stdout: applierJson({
            forge,
            errors: [{ forge, message: "403 Upgrade to GitHub Pro", unsupported: true }],
          }),
          stderr: "",
          signal: null,
        }
      }
      return { status: 0, stdout: applierJson({ forge }), stderr: "", signal: null }
    }) as never
    const r = readProtection({ forges: ["gitea", "github"], run })
    expect(r.state).toBe("unsupported")
    expect(r.detail).toContain("github: 403 Upgrade to GitHub Pro")
    // Nenhum bloqueio: a limitação do plano acenderia o veredito em todo run
    // para sempre, e um veredito que sempre acende não bloqueia nada.
    expect(protectionBlockers(r)).toEqual([])
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
        gitea: {
          workflow: MERGE_OWNER_PIPELINE,
          jobs: ["guards", BRING_UP_GATE_JOB, "typecheck", "lint", "test"],
        },
        github: {
          workflow: MERGE_OWNER_PIPELINE,
          jobs: ["guards", BRING_UP_GATE_JOB, "typecheck", "lint-guard", "check"],
        },
      },
    }),
  )
  writeFileSync(join(dir, ".actrc"), "--var IMAGE_REGISTRY=ghcr.io\n--var BUN_VERSION=1.3.14\n")
  writeFileSync(
    join(dir, "deploy", "env.gitea.example"),
    "IMAGE_REGISTRY=ghcr.io\nIMAGE_NAMESPACE=severinno\nBUN_VERSION=1.3.14\n",
  )
  writeFileSync(
    join(dir, "deploy", ".env.gitea"),
    "IMAGE_REGISTRY=ghcr.io\nIMAGE_NAMESPACE=severinno\nBUN_VERSION=1.3.14\n",
  )
  return dir
}

describe("diagnose — fluxo completo com dependências dubladas", () => {
  /** Mock de readAllGateContracts: devolve "proven" para todos os gates CORE.
   * O teste de "um gate vermelho" sobrescreve isto. */
  const allGatesProven = {
    readAllGateContracts: () => ({
      results: [],
      allProven: true,
      violations: [],
    }),
  }
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

  /**
   * E o mesmo para o BOARD: a `list` dublê responde "nenhuma dívida aberta" sem
   * `gh`, sem API e sem credencial. Sem isto o diagnóstico iria à rede de
   * VERDADE, e o teste que fala do veredito passaria a depender de a máquina ter
   * (ou não ter) um `gh` autenticado.
   *
   * Os estados da leitura em si (aberta, ilegível, caducada) têm os próprios
   * testes, em forge-doctor-open-debt.test.ts.
   */
  const debtClear = { list: async () => [] }

  it("forja completa e registry 200 → PRONTA", async () => {
    const dir = forgeFixture()
    const { facts } = await diagnose({
      gateContractsDeps: allGatesProven,
      cwd: dir,
      envFile: "deploy/.env.gitea",
      expected: "1.3.14",
      // O veredito PRONTA exige o VALOR de TODAS as variáveis que o compose
      // consome: sem as duas da imagem, a prontidão ficaria apoiada na
      // existência delas (é o buraco que esta extensão fecha).
      expectedVars: { IMAGE_REGISTRY: "ghcr.io", IMAGE_NAMESPACE: "severinno" },
      run: passRun,
      imageDeps: { fetchImpl: async () => oci(200) },
      imageRefsDeps: refsProven,
      runnerLabelsDeps: labelsProven,
      githubRunnerLabelsDeps: githubLabelsProven,
      proofDeps: proofHolds,
      imageContractDeps: imageContractProven,
      protectionDeps: protectionInSync,
      openDebtDeps: debtClear,
      // O CONTRATO LOCAL inteiro: o `cwd` deste fluxo é uma fixture SEM `.husky/`,
      // onde as três partes da leitura real saem INDISPONÍVEIS (e com razão — não
      // há o que provar nem o que ler). O FLUXO aqui é o do veredito, então o
      // contrato entra dublado, como todos os outros fatos; a leitura REAL tem
      // teste próprio (`o contrato local é UM fato só`, sobre o checkout).
      ...localProofsProven,
    })
    // O fato do board existe SEMPRE (mesmo vazio): um `diagnose` que esquecesse
    // de montá-lo faria a dívida aberta sumir do veredito em silêncio.
    expect(facts.openDebt.state).toBe("clear")
    expect(summarize(facts).verdict, JSON.stringify(summarize(facts).blockers)).toBe(VERDICT.READY)
  })

  it("os DOIS fatos que perguntam a identidade custam UMA ida ao registry", async () => {
    // A prova de que o cache está REALMENTE no caminho: nada aqui injeta
    // `imageRefsDeps.probe` nem `imageContractDeps.resolveIdentity` (que
    // SUBSTITUIRIAM o probe e tornariam a contagem inútil) — o único ponto de
    // injeção é o probe CRU, para contar. O fato das referências pergunta com
    // timeout de 20s e o do contrato com o default do probe: se o timeout
    // entrasse na chave, aqui seriam DUAS idas e a otimização seria DECORATIVA.
    //
    // O contrato precisa chegar até a consulta: sem `digest` injetado (é o
    // digest que ele viria a resolver) e com o bloco do Dockerfile REAL como
    // `text` (é o que ele tenta provar).
    const seen: string[] = []
    const identityProbe = async (ref: string, opts: { timeoutMs?: number } = {}) => {
      seen.push(`${ref}@${opts.timeoutMs ?? "default"}`)
      return { state: "proven", digest: "sha256:abc", version: "1.3.14", detail: "dublê" }
    }
    const { digest: _ignored, ...contractDeps } = imageContractProven
    const { facts } = await diagnose({
      gateContractsDeps: allGatesProven,
      cwd: forgeFixture(),
      envFile: "deploy/.env.gitea",
      expected: "1.3.14",
      run: passRun,
      imageDeps: { fetchImpl: async () => oci(200) },
      runnerLabelsDeps: labelsProven,
      githubRunnerLabelsDeps: githubLabelsProven,
      proofDeps: proofHolds,
      imageContractDeps: contractDeps,
      protectionDeps: protectionInSync,
      openDebtDeps: debtClear,
      identityProbe,
    })
    expect(seen).toHaveLength(1)
    // E os DOIS fatos de fato consumiram a resposta (senão o teste passaria com
    // um fato que nem chegou a perguntar).
    expect(facts.imageRefs.items.length).toBeGreaterThan(0)
    expect(facts.imageContract.ref).toBeTruthy()
    expect(facts.imageContract.state).not.toBe("unavailable")
  })

  /**
   * O PERFIL `--ci` no fluxo completo — e o dublê faltando é a prova: nenhuma
   * seção de rede/credencial/HOST recebe dublê aqui (nem `protectionDeps`, nem
   * `runnerLabelsDeps`, nem `githubRunnerLabelsDeps`, nem `proofDeps`, nem
   * `imageContractDeps`, nem `openDebtDeps`). Se o perfil deixasse alguma delas
   * ligada, o `diagnose` iria à rede/token de verdade — e o teste que fala do
   * veredito passaria a depender da máquina, que é o que os dublês existem para
   * evitar.
   */
  const ciProfileArgs = () =>
    Object.fromEntries(CI_PROFILE_SKIPS.map((name) => [name, false])) as Record<string, boolean>

  it("perfil --ci: com o valor injetado e os espelhos em sincronia → INDETERMINADA e ZERO bloqueios", async () => {
    const { facts } = await diagnose({
      gateContractsDeps: allGatesProven,
      cwd: forgeFixture(),
      envFile: "deploy/.env.gitea",
      ...ciProfileArgs(),
      ciProfile: true,
      expected: "1.3.14",
      expectedVars: { IMAGE_REGISTRY: "ghcr.io", IMAGE_NAMESPACE: "severinno" },
      run: passRun,
      imageRefsDeps: refsProven,
      ...localProofsProven,
    })
    const v = summarize(facts)
    expect(v.blockers, JSON.stringify(v.blockers)).toEqual([])
    // Não é PRONTA: o perfil não prova o registry, a proteção registrada nem o
    // HOST — e dizer PRONTA com isso em aberto é o defeito que o doctor existe
    // para não cometer.
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    expect(v.unproven[0]).toContain("PERFIL --ci")
  })

  it("perfil --ci: uma variável DIVERGENTE bloqueia o PR (o espelho velho não passa)", async () => {
    const { facts } = await diagnose({
      gateContractsDeps: allGatesProven,
      cwd: forgeFixture(),
      envFile: "deploy/.env.gitea",
      ...ciProfileArgs(),
      ciProfile: true,
      expected: "1.3.14",
      expectedVars: { IMAGE_REGISTRY: "ghcr.io", IMAGE_NAMESPACE: "outro" },
      run: passRun,
      imageRefsDeps: refsProven,
    })
    const v = summarize(facts)
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    // O bloqueio nomeia a variável E o arquivo — um aviso que não diz QUAL
    // espelho drifta não é acionável.
    expect(v.blockers.join(" ")).toContain("IMAGE_NAMESPACE")
    expect(v.blockers.join(" ")).toContain("env.gitea.example")
  })

  it("registry 404 na tag → BLOQUEADA, mesmo com todos os guards verdes", async () => {
    const dir = forgeFixture()
    const { facts } = await diagnose({
      gateContractsDeps: allGatesProven,
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
      openDebtDeps: debtClear,
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
      gateContractsDeps: allGatesProven,
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
      openDebtDeps: debtClear,
    })
    const v = summarize(facts)
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.blockers.join(" ")).toContain("runner do GITHUB")
    expect(v.blockers.join(" ")).toContain("setup-github-runner.sh")
  })

  it("--no-runner-labels NÃO consulta a API do GitHub e rebaixa o veredito", async () => {
    const dir = forgeFixture()
    const { facts } = await diagnose({
      gateContractsDeps: allGatesProven,
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
      openDebtDeps: debtClear,
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
      args.some((a) => a.includes("check-bun-mirror"))
        ? { status: 1, stdout: "", stderr: "❌ violação", signal: null }
        : passRun()
    const { facts } = await diagnose({
      gateContractsDeps: allGatesProven,
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
      openDebtDeps: debtClear,
    })
    const v = summarize(facts)
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.blockers[0]).toContain("check-bun-mirror")
  })

  it("check:required-checks vermelho BLOQUEIA pelo contrato (e não só pelos gates)", async () => {
    const dir = forgeFixture({ pipelineContent: pipeline({ guardLines: [], extraJob: true }) })
    const failing = () => ({ status: 1, stdout: "", stderr: "manifesto divergente", signal: null })
    const { facts } = await diagnose({
      gateContractsDeps: allGatesProven,
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
      openDebtDeps: debtClear,
    })
    const v = summarize(facts)
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.blockers.some((b) => b.includes("check:required-checks"))).toBe(true)
  })

  it("--no-guards não executa gate nenhum e rebaixa o veredito", async () => {
    const dir = forgeFixture()
    let calls = 0
    const { facts } = await diagnose({
      gateContractsDeps: allGatesProven,
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
      openDebtDeps: debtClear,
    })
    // Só o gate do CONTRATO roda; a bateria é pulada.
    expect(calls).toBe(1)
    expect(facts.guards.results).toEqual([])
    expect(summarize(facts).verdict).toBe(VERDICT.UNKNOWN)
  })

  it("prova VIOLADA → BLOQUEADA mesmo com a imagem presente e todos os guards verdes", async () => {
    const dir = forgeFixture()
    const { facts } = await diagnose({
      gateContractsDeps: allGatesProven,
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
      openDebtDeps: debtClear,
    })
    const v = summarize(facts)
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.blockers.join(" ")).toContain("PROVA do bloqueio")
  })

  it("--ci desliga a prova e rebaixa o veredito (falsa segurança é o alvo)", async () => {
    const dir = forgeFixture()
    let called = 0
    const { facts } = await diagnose({
      gateContractsDeps: allGatesProven,
      cwd: dir,
      envFile: "deploy/.env.gitea",
      expected: "1.3.14",
      ciProfile: true,
      proof: false,
      run: passRun,
      imageDeps: { fetchImpl: async () => oci(200) },
      imageRefsDeps: refsProven,
      runnerLabelsDeps: labelsProven,
      githubRunnerLabelsDeps: githubLabelsProven,
      protectionDeps: protectionInSync,
      openDebtDeps: debtClear,
      imageContractDeps: imageContractProven,
      ...localProofsProven,
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
      gateContractsDeps: allGatesProven,
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
      openDebtDeps: debtClear,
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
      gateContractsDeps: allGatesProven,
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
      openDebtDeps: debtClear,
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
      gateContractsDeps: allGatesProven,
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
      openDebtDeps: debtClear,
    })
    const v = summarize(f)
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.blockers.join(" ")).toContain("falta(m) 'Repo Guards'")
  })

  it("sem credencial de administração a forja NÃO é declarada em sincronia (INDETERMINADA)", async () => {
    const dir = forgeFixture()
    const { facts: f } = await diagnose({
      gateContractsDeps: allGatesProven,
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
      openDebtDeps: debtClear,
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
      gateContractsDeps: allGatesProven,
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
      openDebtDeps: debtClear,
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
      gateContractsDeps: allGatesProven,
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
      openDebtDeps: debtClear,
    })
    expect(called).toBe(0)
    expect(f.protection.state).toBe("skipped")
    expect(summarize(f).verdict).toBe(VERDICT.UNKNOWN)
    expect(summarize(f).unproven[0]).toContain("--no-protection")
  })

  /**
   * A dívida do board, dublada: uma issue ABERTA da auditoria reversa do README,
   * aberta há 43 dias no relógio fixo do teste.
   */
  const debtWithReadme = {
    list: async ({ label }: { label: string }) =>
      label === "readme-drift"
        ? [
            {
              number: 12,
              title: "Alvo morto na tabela de scripts",
              body: "corpo\n<!-- readme-drift:file:slug:label -->",
              comments: [],
              createdAt: "2026-08-01T00:00:00Z",
            },
          ]
        : [],
    now: () => Date.parse("2026-09-13T00:00:00Z"),
  }

  it("dívida ABERTA no board rebaixa o veredito mesmo com TODO o resto verde", async () => {
    const dir = forgeFixture()
    const { facts } = await diagnose({
      gateContractsDeps: allGatesProven,
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
      openDebtDeps: debtWithReadme,
    })
    const v = summarize(facts)
    // NÃO bloqueia — uma issue aberta não prova que a forja falha em bloquear o
    // merge. Mas não deixa PRONTA: o repositório já sabe daquela dívida.
    expect(v.blockers).toEqual([])
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    // O número e a IDADE são o que faz a dívida esquecida ser acionável.
    expect(v.unknowns.join(" ")).toContain("#12")
    expect(v.unknowns.join(" ")).toContain("43 dia(s)")
    expect(v.unknowns.join(" ")).toContain("readme-drift")
  })

  it("a issue do assunto que o doctor MEDE vem com a medição ao lado (caducidade)", async () => {
    const dir = forgeFixture()
    const { facts } = await diagnose({
      gateContractsDeps: allGatesProven,
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
      // A proteção está EM SINCRONIA agora — e a issue de drift continua aberta:
      // é esse cruzamento que revela a dívida que mente.
      protectionDeps: protectionInSync,
      openDebtDeps: {
        list: async ({ forge, label }: { forge: string; label: string }) =>
          forge === "gitea" && label === "required-checks-drift"
            ? [
                {
                  number: 7,
                  title: "Branch protection divergiu",
                  body: "<!-- required-checks-drift:QUJD -->",
                  comments: [],
                  createdAt: "2026-09-12T00:00:00Z",
                },
              ]
            : [],
        now: () => Date.parse("2026-09-13T00:00:00Z"),
      },
    })
    const item = facts.openDebt.items[0] as { stale: boolean | null; staleDetail: string }
    expect(item.stale).toBe(true)
    expect(item.staleDetail).toContain("EM SINCRONIA")
    expect(summarize(facts).unknowns.join(" ")).toContain("CADUCADA")
  })

  it("--no-open-debt NÃO lê o board e rebaixa o veredito", async () => {
    const dir = forgeFixture()
    const { facts } = await diagnose({
      gateContractsDeps: allGatesProven,
      cwd: dir,
      envFile: "deploy/.env.gitea",
      expected: "1.3.14",
      openDebt: false,
      run: passRun,
      imageDeps: { fetchImpl: async () => oci(200) },
      imageRefsDeps: refsProven,
      runnerLabelsDeps: labelsProven,
      githubRunnerLabelsDeps: githubLabelsProven,
      proofDeps: proofHolds,
      imageContractDeps: imageContractProven,
      protectionDeps: protectionInSync,
      openDebtDeps: {
        list: async () => {
          throw new Error("o board não pode ser lido com --no-open-debt")
        },
      },
    })
    expect(facts.openDebt.state).toBe("skipped")
    expect(facts.skippedOpenDebt).toBe(true)
    const v = summarize(facts)
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    expect(v.unknowns.join(" ")).toContain("--no-open-debt")
    expect(v.unproven.join(" ")).toContain("dívida aberta no board")
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

// ── a bateria CONCORRENTE: mais rápida, com o MESMO significado ───────────
//
// O doctor passou a rodar os gates em paralelo (o teto do tempo vira o gate mais
// lento, não a soma). Paralelismo é onde o resultado costuma mudar sem ninguém
// ver: por isso o que se prova aqui NÃO é "ficou rápido", é que a ORDEM da
// bateria, o LIMITE, o ISOLAMENTO de falha e o caminho do dublê continuam
// valendo — o paralelismo não pode alterar o SIGNIFICADO de um gate.

describe("runGatesConcurrent — o paralelismo não muda o significado da bateria", () => {
  const gate = (label: string, command: string | null = "bun run check:x") => ({ label, command })

  it("devolve na ORDEM DA BATERIA, ainda que a CONCLUSÃO seja ao contrário", async () => {
    // O primeiro gate é o mais LENTO e o último o mais rápido: a ordem de
    // conclusão é o inverso da ordem da bateria. Se o resultado fosse empilhado
    // por chegada, cada saída passaria a ser atribuída ao gate ERRADO — e o
    // relatório mentiria sem falhar.
    const delays: Record<string, number> = { lento: 40, medio: 20, rapido: 0 }
    const res = await runGatesConcurrent([gate("lento"), gate("medio"), gate("rapido")], {
      concurrency: 3,
      gateAsync: async (g: { label: string }) => {
        await new Promise((r) => setTimeout(r, delays[g.label]))
        return { gate: g.label, code: 0, seconds: 0 }
      },
    })
    expect(res.map((r) => r.gate)).toEqual(["lento", "medio", "rapido"])
  })

  it("respeita o LIMITE (não abre um processo por gate)", async () => {
    let inFlight = 0
    let peak = 0
    const seen: string[] = []
    const gates = Array.from({ length: 9 }, (_, i) => gate(`g${i}`))
    const res = await runGatesConcurrent(gates, {
      concurrency: 3,
      gateAsync: async (g: { label: string }) => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        seen.push(g.label)
        await new Promise((r) => setTimeout(r, 5))
        inFlight -= 1
        return { gate: g.label, code: 0, seconds: 0 }
      },
    })
    expect(peak).toBe(3)
    expect(inFlight).toBe(0)
    expect(seen).toHaveLength(9)
    expect(res).toHaveLength(9)
    // A ordem final continua sendo a da bateria, não a de conclusão.
    expect(res.map((r) => r.gate)).toEqual(gates.map((g) => g.label))
  })

  it("um gate que ESTOURA vira NÃO VERIFICADO e não derruba os outros", async () => {
    // Um spawn que falha (interpretador ausente, dublê que rejeita) não pode
    // derrubar a bateria inteira: `code: null` é o estado que o veredito já
    // sabe ler como "não deu para saber", nunca como "passou".
    const res = await runGatesConcurrent([gate("bom"), gate("explode"), gate("outro")], {
      gateAsync: async (g: { label: string }) => {
        if (g.label === "explode") throw new Error("spawn falhou")
        return { gate: g.label, code: 0, seconds: 0 }
      },
    })
    expect(res.map((r) => r.gate)).toEqual(["bom", "explode", "outro"])
    expect(res[0].code).toBe(0)
    expect(res[1].code).toBeNull()
    expect(res[1].error).toContain("não foi possível executar o gate")
    expect(res[1].error).toContain("spawn falhou")
    expect(res[2].code).toBe(0)
  })

  it("o DEFAULT de concorrência é conservador (não é 'um por core')", () => {
    // Os gates são processos `bun`/`node` que já usam vários cores cada um:
    // abrir um por core satura a máquina e piora o wall time. O default precisa
    // caber num runner compartilhado — e ser maior que 1 para de fato paralelizar.
    expect(DEFAULT_GATE_CONCURRENCY).toBe(4)
    expect(DEFAULT_GATE_CONCURRENCY).toBeGreaterThan(1)
  })

  it("bateria vazia → vazio; bateria menor que o limite → roda inteira", async () => {
    expect(await runGatesConcurrent([])).toEqual([])
    const res = await runGatesConcurrent([gate("só")], {
      concurrency: 0,
      gateAsync: async (g: { label: string }) => ({ gate: g.label, code: 0, seconds: 0 }),
    })
    expect(res).toHaveLength(1)
    expect(res[0].gate).toBe("só")
  })

  it("com `run` INJETADO desvia para o caminho SEQUENCIAL (o dublê manda)", async () => {
    // O dublê dos testes é síncrono e observa a ORDEM e o NÚMERO de chamadas.
    // Paralelizar isso não traria ganho e mudaria o que os testes veem — então
    // o `run` injetado mantém o contrato antigo e o `gateAsync` não é tocado.
    const calls: unknown[][] = []
    let asyncTouched = false
    const run = (...args: unknown[]) => {
      calls.push(args)
      return { status: 0, stdout: "", stderr: "" }
    }
    const res = await runGatesConcurrent(
      [gate("a", "bun run check:a"), gate("b", "bun run check:b")],
      {
        run,
        gateAsync: async (g: { label: string }) => {
          asyncTouched = true
          return { gate: g.label, code: 0, seconds: 0 }
        },
      },
    )
    expect(res.map((r) => r.gate)).toEqual(["a", "b"])
    expect(res.every((r) => r.code === 0)).toBe(true)
    expect(calls).toHaveLength(2)
    expect(asyncTouched).toBe(false)
  })

  it("o mesmo gate: `runGate` (sync) e `runGateAsync` (async) produzem o MESMO shape", async () => {
    // Se o shape divergisse entre os dois caminhos, o veredito passaria a
    // depender de QUAL caminho rodou — otimização virando mudança de contrato.
    // Um gate que FALHA de propósito exercita justamente o ramo com `tail`.
    const bad = gate("falha", "bun run check:nao-existe-mesmo")
    const syncRes = runGate(bad, { timeoutS: 30 })
    const asyncRes = await runGateAsync(bad, { timeoutS: 30 })
    expect(Object.keys(asyncRes).sort()).toEqual(Object.keys(syncRes).sort())
    expect(asyncRes.gate).toBe(syncRes.gate)
    expect(asyncRes.code).toBe(syncRes.code)
    expect(asyncRes.code).not.toBe(0)
    expect(asyncRes.tail).toBeTruthy()
  })

  it("gate sem a linha `run:` → NÃO VERIFICADO (não executa o rótulo cru)", async () => {
    const syncRes = runGate(gate("sem-linha", null))
    const asyncRes = await runGateAsync(gate("sem-linha", null))
    expect(syncRes.code).toBeNull()
    expect(asyncRes.code).toBeNull()
    expect(syncRes.error).toContain("não achei a linha 'run:'")
    expect(asyncRes.error).toBe(syncRes.error)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// DEFESA EM PROFUNDIDADE contra recursão: o doctor recusa quando
// FORGE_DOCTOR_NESTED está definido (env) OU --proof-nested é passado (argv)
// — a dublagem (DOCTOR_SCRIPT) é o corte primário, mas este guard é a segunda
// camada. Os DOIS canais cobrem quem não controla o ambiente do filho.
// ═══════════════════════════════════════════════════════════════════════════

describe("NESTED_GUARD_ENV — defesa em profundidade contra recursão", () => {
  const DOCTOR = join(ROOT, "scripts/forge-doctor.mjs")

  it("${NESTED_GUARD_ENV} definido → exit 3, erro de recursão no stderr", () => {
    const res = spawnSync(process.execPath, [DOCTOR, "--help"], {
      cwd: ROOT,
      env: { ...process.env, [NESTED_GUARD_ENV]: "1" },
      encoding: "utf8",
      timeout: 10_000,
    })
    // Exit 3 = detecção de recursão (diferente de 0=help, 1=bloqueada, 2=indeterminada)
    expect(res.status).toBe(NESTED_GUARD_EXIT)
    expect(res.stderr).toContain("DETECTADO RECURSAO")
    expect(res.stderr).toContain(NESTED_GUARD_ENV)
    // O relatório da recursão vai para o MESMO canal do veredito (stdout), com o
    // fato nomeado — antes ele saía 3 e a causa vivia só no stderr, e o 3 é o
    // mesmo código de uso inválido (não dava para distinguir os dois).
    expect(res.stdout).toContain("RECURSÃO DETECTADA")
    expect(res.stdout).toContain(NESTED_GUARD_ENV)
    // ...mas o doctor NÃO processou o --help: a USAGE não foi impressa.
    expect(res.stdout).not.toContain("sai como JSON")
  })

  it("${NESTED_GUARD_ENV} ausente → doctor funciona normalmente (help)", () => {
    const env = { ...process.env }
    delete env[NESTED_GUARD_ENV]
    const res = spawnSync(process.execPath, [DOCTOR, "--help"], {
      cwd: ROOT,
      env,
      encoding: "utf8",
      timeout: 10_000,
    })
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("forge-doctor")
    expect(res.stderr).toBe("")
  })

  it("flag ${NESTED_GUARD_FLAG} no argv → MESMA defesa (exit 3), sem depender do env", () => {
    // O canal do argv: a env var fica AUSENTE de propósito, para provar que a
    // defesa não depende de quem chamou ter controlado o ambiente do filho.
    const env = { ...process.env }
    delete env[NESTED_GUARD_ENV]
    const res = spawnSync(process.execPath, [DOCTOR, NESTED_GUARD_FLAG, "--help"], {
      cwd: ROOT,
      env,
      encoding: "utf8",
      timeout: 10_000,
    })
    expect(res.status).toBe(NESTED_GUARD_EXIT)
    expect(res.stderr).toContain("DETECTADO RECURSAO")
    expect(res.stderr).toContain(NESTED_GUARD_FLAG)
    // O relatório de recursão sai em stdout e NOMEIA o canal que marcou:
    expect(res.stdout).toContain("RECURSÃO DETECTADA")
    expect(res.stdout).toContain("canal argv")
    expect(res.stdout).not.toContain("sai como JSON")
  })

  it("--json → o relatório de recursão sai como DADOS (mesmo canal do veredito)", () => {
    const env = { ...process.env }
    delete env[NESTED_GUARD_ENV]
    const res = spawnSync(process.execPath, [DOCTOR, NESTED_GUARD_FLAG, "--json"], {
      cwd: ROOT,
      env,
      encoding: "utf8",
      timeout: 10_000,
    })
    expect(res.status).toBe(NESTED_GUARD_EXIT)
    const report = JSON.parse(res.stdout)
    expect(report.verdict.verdict).toBe("bloqueada")
    expect(report.facts.nestedGuard.state).toBe("fired")
    expect(report.facts.nestedGuard.channels).toEqual([
      { channel: "argv", name: NESTED_GUARD_FLAG },
    ])
    // O bloqueador NOMEIA a recursão: é o que o consumidor da prontidão lê.
    expect(report.verdict.blockers.join(" ")).toContain("RECURSAO")
    expect(report.verdict.unproven.join(" ")).toContain("NENHUMA")
  })

  it("nestedGuardReport é puro e nomeia o(s) canal(is) que marcaram a recursão", () => {
    const viaEnv = nestedGuardReport({ env: { [NESTED_GUARD_ENV]: "1" }, argv: [] })
    expect(viaEnv.facts.nestedGuard.channels).toEqual([{ channel: "env", name: NESTED_GUARD_ENV }])
    expect(viaEnv.verdict.verdict).toBe("bloqueada")

    const viaArgv = nestedGuardReport({ env: {}, argv: [NESTED_GUARD_FLAG] })
    expect(viaArgv.facts.nestedGuard.channels).toEqual([
      { channel: "argv", name: NESTED_GUARD_FLAG },
    ])

    // Os DOIS canais ao mesmo tempo aparecem os dois (não escolhe um).
    const ambos = nestedGuardReport({
      env: { [NESTED_GUARD_ENV]: "1" },
      argv: [NESTED_GUARD_FLAG],
    })
    expect(ambos.facts.nestedGuard.channels).toHaveLength(2)
    expect(ambos.facts.nestedGuard.exit).toBe(NESTED_GUARD_EXIT)
  })

  it("isNestedDoctorInvocation cobre os DOIS canais (env OU flag) e só eles", () => {
    // Pura e injetável: a regra vive num lugar só e o `main` só a consome.
    expect(isNestedDoctorInvocation({ env: { [NESTED_GUARD_ENV]: "1" }, argv: [] })).toBe(true)
    expect(isNestedDoctorInvocation({ env: {}, argv: [NESTED_GUARD_FLAG] })).toBe(true)
    expect(isNestedDoctorInvocation({ env: {}, argv: [] })).toBe(false)
    // Var DEFINIDA mas VAZIA não marca (mesma semântica de antes: `""` é falsy).
    expect(isNestedDoctorInvocation({ env: { [NESTED_GUARD_ENV]: "" }, argv: [] })).toBe(false)
    // Um argv que não contém a flag exata (ex.: prefixo) também não marca.
    expect(isNestedDoctorInvocation({ env: {}, argv: ["--proof-nested-x"] })).toBe(false)
  })

  it("constantes exportadas: env var E flag têm os nomes esperados", () => {
    expect(NESTED_GUARD_ENV).toBe("FORGE_DOCTOR_NESTED")
    expect(NESTED_GUARD_FLAG).toBe("--proof-nested")
  })

  it("o relatório NORMAL declara a defesa ARMADA e por quais canais (existência, não só disparo)", () => {
    // O `nestedGuardReport` só existe quando o guard dispara: sem este fato, o
    // veredito de uma forja saudável não diria NADA sobre a defesa — se o
    // `isNestedDoctorInvocation` saísse do caminho quente, o relatório ficaria
    // idêntico e a prontidão não mudaria uma linha.
    const armed = recursionGuardFacts()
    expect(armed.state).toBe("armed")
    expect(armed.channels).toEqual([
      { channel: "env", name: NESTED_GUARD_ENV },
      { channel: "argv", name: NESTED_GUARD_FLAG },
    ])
    expect(armed.armed).toEqual({ env: true, argv: true })
    expect(armed.exit).toBe(NESTED_GUARD_EXIT)
    expect(armed.remedies).toEqual([])
    expect(armed.detail).toContain("não foi marcada por nenhum deles")
    // O estado do disparo é OUTRO: os três estados do mesmo fato não se
    // confundem (`fired` disparou, `armed`/`disarmed` são sobre a DEFESA).
    expect(nestedGuardReport().facts.nestedGuard.state).toBe("fired")
  })

  it("desarmado em QUALQUER canal é DESARMADO, e nomeia o canal que não responde", () => {
    // A sonda é a MESMA função do caminho quente — aqui ela é injetada para
    // exercitar o canal que deixou de responder (é a mutação que o fato existe
    // para pegar: metade da defesa caindo sem o relatório mudar).
    const soEnv = recursionGuardFacts({
      probe: (io) => Boolean(io?.env?.[NESTED_GUARD_ENV]),
    })
    expect(soEnv.state).toBe("disarmed")
    expect(soEnv.armed).toEqual({ env: true, argv: false })
    expect(soEnv.detail).toContain(NESTED_GUARD_FLAG)
    expect(soEnv.detail).toContain("PELA METADE")
    expect(soEnv.remedies.join(" ")).toContain(NESTED_GUARD_ENV)

    const nenhum = recursionGuardFacts({ probe: () => false })
    expect(nenhum.state).toBe("disarmed")
    expect(nenhum.armed).toEqual({ env: false, argv: false })
  })

  it("o relatório IMPRESSO declara o fato: armado (✅ + canais) e desarmado (❌ + remédio)", () => {
    const render = (f: ReturnType<typeof facts>) => {
      const lines: string[] = []
      renderReport({ facts: f, verdict: summarize(f) }, { emit: (s = "") => lines.push(s) })
      return lines.join("\n")
    }

    const armado = render(facts())
    expect(armado).toContain("guard de recursão: armed")
    expect(armado).toContain(NESTED_GUARD_ENV)
    expect(armado).toContain(NESTED_GUARD_FLAG)

    const desarmado = render(facts({ nestedGuard: recursionGuardFacts({ probe: () => false }) }))
    expect(desarmado).toContain("guard de recursão: disarmed")
    expect(desarmado).toContain("PELA METADE")
    // O remédio viaja com a violação: a linha do ❌ sozinha não diz o que fazer.
    expect(desarmado).toContain("isNestedDoctorInvocation")

    // Sem o fato, o relatório DIZ que não está declarado — em vez de omitir a
    // seção (o silêncio é o que faria a defesa sumir sem ninguém ver).
    const semFato = render(facts({ nestedGuard: undefined }))
    expect(semFato).toContain("guard de recursão: NÃO declarado no relatório")
  })

  it("DESARMADO bloqueia o veredito; AUSENTE não vira 'pronta' por omissão", () => {
    const v = summarize(facts({ nestedGuard: recursionGuardFacts({ probe: () => false }) }))
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.blockers.join(" ")).toContain("guard de recursao esta DESARMADO")

    // Sem o fato, o veredito NÃO cobre a defesa: dizer "pronta" sobre o que não
    // foi olhado é a falsa segurança que este comando existe para não produzir.
    const semFato = summarize(facts({ nestedGuard: undefined }))
    expect(semFato.verdict).toBe(VERDICT.UNKNOWN)
    expect(semFato.unknowns.join(" ")).toContain("não está declarado no relatório")

    // ... e ARMADO não acrescenta nada (fato provado, não ruído).
    const armado = summarize(facts())
    expect(armado.verdict).toBe(VERDICT.READY)
    expect(armado.unknowns.join(" ")).not.toContain("guard de recursão")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// `defaults: run:` NÃO é comando do job
//
// O contrato de merge pergunta "o job RODA o comando esperado?". A resposta
// vinha de qualquer linha `run:` do job — inclusive da declaracao de shell
// default, que nao roda nada. `defaults: {run: bun run check:x}` fazia o doctor
// AFIRMAR que o job executava o gate, e a prontidao para bloquear o merge saia
// de uma declaracao.
// ─────────────────────────────────────────────────────────────────────────────

describe("gateRunLine/firstRunLine — a declaracao `defaults.run` nao e comando", () => {
  const job = (linhas: string[]) =>
    ["  guardas:", "    runs-on: ubuntu-latest", ...linhas].join("\n").split("\n")

  it("`firstRunLine` pula a declaracao e acha o comando do PASSO", () => {
    const lines = job([
      "    defaults:",
      "      run: bun run check:fantasma",
      "    steps:",
      "      - run: bun run test:run",
    ])
    expect(firstRunLine(lines)).toBe("bun run test:run")
  })

  it("`firstRunLine` devolve null quando so ha a declaracao (job sem passo)", () => {
    const lines = job(["    defaults:", "      run: bun run check:fantasma"])
    expect(firstRunLine(lines)).toBeNull()
  })

  it("`gateRunLine` nao casa o rotulo dentro da declaracao", () => {
    const lines = job([
      "    defaults:",
      "      run: node scripts/check-workflow-refs.mjs --pkg-internal",
      "    steps:",
      "      - run: echo nada",
    ])
    expect(gateRunLine(lines, "workflow-refs")).toBeNull()
  })

  it("a forma em BLOCO (`run:` com `shell:`) tambem nao e comando", () => {
    const lines = job([
      "    defaults:",
      "      run:",
      "        shell: bash",
      "    steps:",
      "      - run: echo ok",
    ])
    expect(firstRunLine(lines)).toBe("echo ok")
  })
})

describe("readShellInheritance — a herança de shell de CADA workflow", () => {
  /** O módulo é .mjs (JS): o teste tipa só o que consome do fato. */
  type FatoHeranca = {
    state: string
    workflows: {
      file: string
      state: string
      detail: string
      counts: Record<string, number> | null
      premissas: {
        scope: string
        job: string | null
        shell: string
        line: number
        passos: number
      }[]
      ilegiveis: { scope: string; job: string | null; shell: string; line: number }[]
    }[]
    totals: Record<string, number>
    violations: string[]
    detail: string
    error: string | null
  }
  const heranca = (opts: Record<string, unknown> = {}) =>
    readShellInheritance(opts) as unknown as FatoHeranca

  /** Uma árvore de fixture com UM workflow (o conteúdo é do teste). */
  const tree = (conteudo: string, caminho = ".gitea/workflows/ci.yml") => {
    const root = makeDir()
    mkdirSync(join(root, dirname(caminho)), { recursive: true })
    writeFileSync(join(root, caminho), conteudo)
    return root
  }

  /** A régua EXPLÍCITA: um shell declarado sem `-o pipefail` não liga o modo. */
  const SEM_PIPEFAIL = "bash -e {0}"

  it("mede de ONDE vem o shell de cada passo: o passo, o `defaults:` do job, o do arquivo, o RUNNER", () => {
    // O que o guard diz em prosa e o veredito de prontidão não tinha como cobrar:
    // CADA passo tem uma FONTE de shell, e a quarta — o runner — é uma PREMISSA
    // que não é deste repositório.
    // DOIS arquivos porque a fonte é do ESCOPO: o `defaults:` do ARQUIVO vale
    // para todos os jobs DELE — um só arquivo com default no topo não conseguiria
    // ter, ao mesmo tempo, um passo que cai no default do runner.
    const root = tree(
      [
        "on:",
        "  push:",
        "jobs:",
        "  a:",
        "    defaults:",
        "      run:",
        `        shell: ${SEM_PIPEFAIL}`,
        "    steps:",
        "      - run: echo do-default-do-job",
        "      - name: com shell no passo",
        "        shell: bash",
        "        run: echo do-passo",
        "  b:",
        "    steps:",
        "      - run: echo do-runner",
        "",
      ].join("\n"),
    )
    writeFileSync(
      join(root, ".gitea/workflows/outro.yml"),
      [
        "on:",
        "  push:",
        "defaults:",
        "  run:",
        `    shell: ${SEM_PIPEFAIL}`,
        "jobs:",
        "  a:",
        "    steps:",
        "      - run: echo do-default-do-arquivo",
        "",
      ].join("\n"),
    )
    const f = heranca({ cwd: root })
    expect(f.state).toBe("proven")
    expect(f.totals).toMatchObject({
      workflows: 2,
      steps: 4,
      porDefaultDoJob: 1,
      porDefaultDoArquivo: 1,
      noPasso: 1,
      peloRunner: 1,
      premissas: 0,
      ilegiveis: 0,
    })
    // `shell: bash -e {0}` NÃO liga o pipefail (é uma régua explícita): o passo
    // continua no mesmo contexto, e a declaração não vira premissa mudada.
    expect(f.workflows.every((w) => w.state === "proven")).toBe(true)
    expect(f.detail).toContain("pelo default do RUNNER")
  })

  it("`describeShellScope` nomeia o escopo — a MESMA prosa na violação e no relatório", () => {
    expect(describeShellScope({ scope: "workflow", job: null })).toBe("workflow inteiro")
    expect(describeShellScope({ scope: "job", job: "guards" })).toBe("job `guards`")
  })

  it("`defaults: run: shell: bash` → VIOLADO, nomeando o escopo e os passos reclassificados", () => {
    const root = tree(
      [
        "on:",
        "  push:",
        "defaults:",
        "  run:",
        "    shell: bash",
        "jobs:",
        "  a:",
        "    steps:",
        "      - run: echo um",
        "      - run: echo dois",
        "",
      ].join("\n"),
    )
    const f = heranca({ cwd: root })
    expect(f.state).toBe("violated")
    expect(f.workflows[0].premissas[0]).toMatchObject({
      scope: "workflow",
      job: null,
      shell: "bash",
      passos: 2,
    })
    expect(f.violations[0]).toContain("workflow inteiro")
    expect(f.violations[0]).toContain("LIGA o pipefail para 2 passo(s)")
    // A premissa mudada não fica só no relatório do guard: ela BLOQUEIA.
    const v = summarize(facts({ shellInheritance: f }))
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(shellInheritanceBlockers(f)[0]).toContain("HERANCA DE SHELL")
  })

  it("a forma INLINE é VIOLAÇÃO (fail-closed): não ler não é o mesmo que não haver", () => {
    const root = tree(
      [
        "on:",
        "  push:",
        "jobs:",
        "  a:",
        "    defaults: {run: {shell: bash}}",
        "    steps:",
        "      - run: echo um",
        "",
      ].join("\n"),
    )
    const f = heranca({ cwd: root })
    expect(f.state).toBe("violated")
    expect(f.violations[0]).toContain("FORMA INLINE")
    expect(f.violations[0]).toContain("NÃO foi lida")
    expect(f.workflows[0].ilegiveis[0]).toMatchObject({ job: "a" })
  })

  it("arquivo ILEGÍVEL → `unread`, e a dúvida diz QUAL arquivo (nunca 'nenhum shell declarado')", () => {
    const root = tree("on:\n  push:\njobs: {}\n")
    const f = heranca({
      cwd: root,
      deps: {
        readFile: () => {
          throw new Error("EACCES")
        },
      },
    })
    expect(f.state).toBe("unread")
    expect(f.totals.unread).toBe(1)
    const v = summarize(facts({ shellInheritance: f }))
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    expect(v.unknowns.some((u) => u.includes("NAO foi lida"))).toBe(true)
  })

  it("o fato AUSENTE do relatório → INDETERMINADA, dizendo o que ficou fora", () => {
    const v = summarize(facts({ shellInheritance: undefined }))
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    expect(shellInheritanceUnknowns(undefined)[0]).toContain("herança de shell")
  })

  it("o doctor e o GUARD medem a MESMA coisa (a leitura é a do guard, não uma segunda)", () => {
    // A prova de que não existem duas leituras do mesmo YAML: os contadores do
    // guard (`scanRoot`) e os do fato do doctor, sobre a MESMA árvore.
    const root = tree(
      [
        "on:",
        "  push:",
        "jobs:",
        "  a:",
        "    steps:",
        "      - run: echo um",
        "        shell: bash",
        "      - run: |",
        "          echo dois",
        "  b:",
        "    steps:",
        "      - run: echo tres",
        "",
      ].join("\n"),
    )
    const f = heranca({ cwd: root })
    // O `scanned` do guard é um objeto de contadores (módulo .mjs): o teste o
    // tipa como o mapa que ele é.
    const g = scanRoot(root).scanned as unknown as Record<string, number>
    expect(f.totals.steps).toBe(g.runStepsComPipefail + g.runStepsSemPipefail)
    expect(f.totals.peloRunner).toBe(g.passosDoRunner)
    expect(f.totals.noPasso).toBe(g.passosComShellNoPasso)
    expect(f.totals.porDefaultDoJob + f.totals.porDefaultDoArquivo).toBe(
      g.passosComDefaultDeclarado,
    )
  })

  it("a seção 7/7 imprime a origem por workflow, a violação e o remédio", () => {
    const root = tree(
      [
        "on:",
        "  push:",
        "defaults:",
        "  run:",
        "    shell: bash",
        "jobs:",
        "  a:",
        "    steps:",
        "      - run: echo um",
        "",
      ].join("\n"),
    )
    const f = heranca({ cwd: root })
    const linhas: string[] = []
    renderReport(
      { facts: facts({ shellInheritance: f }), verdict: summarize(facts({ shellInheritance: f })) },
      { emit: (s = "") => linhas.push(s) },
    )
    const texto = linhas.join("\n")
    expect(texto).toContain("7/7  Herança de shell dos workflows")
    expect(texto).toContain(".gitea/workflows/ci.yml")
    expect(texto).toContain("origem: 0 pelo RUNNER")
    expect(texto).toContain("LIGA o pipefail para 1 passo(s) sem `shell:`")
    expect(texto).toContain("a premissa não é herdada, é DITA")
    expect(texto).toContain("declare `shell: bash` em cada passo afetado")
  })
})

// ── a prova do bloqueio LOCAL (o pre-commit × o corpo `run:` quebrado) ────

/** O fato do doctor com a prova INJETADA — é assim que os três estados são medidos
 * sem depender do hook do checkout (a prova REAL tem teste próprio, abaixo). */
const prova = (saida: unknown) =>
  readPreCommitBlock({
    // O cast é DELIBERADO: metade destes casos injeta uma saída que a prova real
    // nunca devolveria (nada, `{}`, sem estado) — é o fail-closed do fato que
    // está sendo medido.
    deps: { prove: (() => saida) as (opts: { root: string }) => object },
  })

describe("a prova do bloqueio LOCAL como FATO do relatório", () => {
  it("o estado da prova vira o estado do FATO (proven/violated/unavailable)", () => {
    expect(
      prova({ state: "proven", detail: "bloqueou", evidence: { a: 1 }, remedies: ["r"] }).state,
    ).toBe("proven")
    expect(prova({ state: "violated", detail: "passou", evidence: null, remedies: [] }).state).toBe(
      "violated",
    )
    const ind = prova({ state: "unavailable", detail: "sem git", evidence: null, remedies: [] })
    expect(ind.state).toBe("unavailable")
    // O detalhe e os remédios ATRAVESSAM: o relatório tem de dizer o motivo que a
    // prova deu, e não um "não provado" genérico que ninguém consegue acionar.
    expect(ind.detail).toBe("sem git")
  })

  it("uma prova que não devolve estado é INDISPONÍVEL, nunca verde", () => {
    for (const saida of [undefined, null, {}, { detail: "sem estado" }]) {
      const f = prova(saida)
      expect(f.state).toBe("unavailable")
      expect(f.detail).toContain("nao devolveu estado")
    }
  })

  it("um erro na prova é INDISPONÍVEL, com a mensagem do erro no detalhe", () => {
    const f = readPreCommitBlock({
      deps: {
        prove: (): object => {
          throw new Error("git ausente")
        },
      },
    })
    expect(f.state).toBe("unavailable")
    expect(f.detail).toContain("git ausente")
  })

  it("VIOLADO bloqueia o veredito; INDISPONÍVEL vira falta de prova NOMEADA", () => {
    const violado = facts({
      localContract: localContractFacts({
        links: {
          "pre-commit": { state: "violated", detail: "o defeito entrou em HEAD", remedies: [] },
        },
      }),
    })
    const v1 = summarize(violado)
    expect(v1.verdict).toBe(VERDICT.BLOCKED)
    expect(v1.blockers.some((b) => b.includes("PRE-COMMIT nao bloqueia"))).toBe(true)
    expect(localContractBlockers(violado.localContract)[0]).toContain("indice")

    const indeterminado = facts({
      localContract: localContractFacts({
        links: { "pre-commit": { state: "unavailable", detail: "sem git no PATH", remedies: [] } },
      }),
    })
    const v2 = summarize(indeterminado)
    expect(v2.verdict).toBe(VERDICT.UNKNOWN)
    expect(v2.unknowns.some((u) => u.includes("bloqueio LOCAL do pre-commit"))).toBe(true)
    expect(v2.unknowns.some((u) => u.includes("sem git no PATH"))).toBe(true)
    // Nem bloqueio nem dúvida no caminho FELIZ: o veredito não pode ficar mais
    // caro por causa do fato único.
    expect(localContractBlockers(localContractFacts())).toEqual([])
    expect(localContractUnknowns(localContractFacts())).toEqual([])
    expect(summarize(facts()).verdict).not.toBe(VERDICT.UNKNOWN)
  })

  it("o fato AUSENTE do relatório é falta de prova (mesma disciplina do resto)", () => {
    const v = summarize(facts({ localContract: undefined }))
    expect(v.verdict).toBe(VERDICT.UNKNOWN)
    expect(localContractUnknowns(undefined)[0]).toContain("CONTRATO LOCAL")
  })

  it("pular por --no-pre-commit-proof vira falta de prova DENTRO do fato, e o relatório DIZ", () => {
    const pulado = localContractFacts({
      links: { "pre-commit": { state: "skipped", detail: "pulada por --no-pre-commit-proof" } },
    })
    const fPulado = facts({ localContract: pulado })
    const v = summarize(fPulado)
    // O skip é uma parte do MESMO assunto: o veredito o lê do fato (não de uma
    // flag paralela) e o nomeia.
    expect(localContractUnknowns(pulado).join(" ")).toContain("--no-pre-commit-proof")
    const linhas: string[] = []
    renderReport({ facts: fPulado, verdict: v }, { emit: (s = "") => linhas.push(s) })
    expect(linhas.join("\n")).toContain("prova do bloqueio LOCAL pulada por --no-pre-commit-proof")
    expect(v.verdict).toBe(VERDICT.UNKNOWN) // as outras seções do fixture continuam
  })

  it("a seção 4/7 imprime o estado, a evidência das DUAS metades e quem cobra", () => {
    const f = {
      state: "proven",
      detail: "recusou o quebrado e deixou entrar o controle",
      evidence: {
        defeito: { status: 1, objetosDeCommit: 0, headExiste: false },
        controle: { status: 0, objetosDeCommit: 1 },
      },
      remedies: [],
    }
    const linhas: string[] = []
    const fProvado = facts({ localContract: localContractFacts({ links: { "pre-commit": f } }) })
    renderReport(
      { facts: fProvado, verdict: summarize(fProvado) },
      {
        emit: (s = "") => linhas.push(s),
      },
    )
    const texto = linhas.join("\n")
    expect(texto).toContain("4/7  Prova do bloqueio")
    expect(texto).toContain("prova do bloqueio LOCAL (pre-commit): proven")
    expect(texto).toContain("defeito no índice: exit 1, 0 objeto(s) de commit, HEAD ausente")
    expect(texto).toContain("CONTROLE com o corpo fechado: exit 0, 1 objeto(s)")
    expect(texto).toContain("quem cobra: o PRÓPRIO hook")
  })

  it("VIOLADO aparece na seção com o remédio (o que devolver ao hook)", () => {
    const linhas: string[] = []
    const fViolado = facts({
      localContract: localContractFacts({
        links: {
          "pre-commit": {
            state: "violated",
            detail: "o corpo quebrado foi GRAVADO em HEAD",
            evidence: { defeito: { status: 0, objetosDeCommit: 1, headExiste: true } },
            remedies: ["o pre-commit tem de rodar o guard do ÍNDICE"],
          },
        },
      }),
    })
    renderReport(
      { facts: fViolado, verdict: summarize(fViolado) },
      { emit: (s = "") => linhas.push(s) },
    )
    const texto = linhas.join("\n")
    expect(texto).toContain("prova do bloqueio LOCAL (pre-commit): violated")
    expect(texto).toContain("o pre-commit tem de rodar o guard do ÍNDICE")
  })
})

describe("a prova REAL do bloqueio local (executada, não lida)", () => {
  it("no repositório, o corpo `run:` quebrado no índice NÃO vira commit (e o controle vira)", () => {
    const r = proveCommitBlocks()
    expect(r.state).toBe("proven")
    expect(r.evidence!.defeito.objetosDeCommit).toBe(0)
    expect(r.evidence!.defeito.headExiste).toBe(false)
    expect(r.evidence!.controle!.status).toBe(0)
    expect(r.evidence!.controle!.objetosDeCommit).toBe(1)
    // E o FATO do doctor é a mesma medição: o doctor não reimplementa a prova.
    expect(readPreCommitBlock().state).toBe("proven")
  })

  it("SENSIBILIDADE: tirar o guard do hook muda o veredito (provado → violado)", () => {
    const src = hookSource() ?? ""
    expect(src).toContain(GUARD_COMMAND)
    const r = proveCommitBlocks({
      hookSourceTexto: src.replace(GUARD_COMMAND, "# mutação do teste"),
    })
    expect(r.state).toBe("violated")
    expect(r.evidence!.defeito.headExiste).toBe(true)
    expect(r.evidence!.defeito.conteudoEmHead).toBe("igual ao corpo quebrado")
    expect(r.detail).toContain("não executa mais")
  })

  it("INDISPONÍVEL: um checkout sem o hook não é verde (diz o que faltou)", () => {
    const r = readPreCommitBlock({ cwd: makeDir(), deps: {} })
    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("não existe neste checkout")
    expect(r.remedies.length).toBeGreaterThan(0)
  })
})

// ── a prova do bloqueio do PUSH (o outro elo do contrato local) ───────────

/** O fato do doctor com a prova do push INJETADA (os três estados sem rodar git). */
const provaPush = (saida: unknown) =>
  readPrePushBlock({
    deps: { prove: (() => saida) as (opts: { root: string }) => object },
  })

describe("a prova do bloqueio do PUSH como FATO do relatório", () => {
  it("o estado da prova vira o estado do FATO (proven/violated/unavailable)", () => {
    expect(provaPush({ state: "proven", detail: "bloqueou", evidence: null }).state).toBe("proven")
    expect(provaPush({ state: "violated", detail: "chegou", evidence: null }).state).toBe(
      "violated",
    )
    const ind = provaPush({ state: "unavailable", detail: "sem bun", evidence: null })
    expect(ind.state).toBe("unavailable")
    expect(ind.detail).toBe("sem bun")
  })

  it("uma prova que não devolve estado é INDISPONÍVEL, nunca verde", () => {
    for (const saida of [undefined, null, {}, { detail: "sem estado" }]) {
      const f = provaPush(saida)
      expect(f.state).toBe("unavailable")
      expect(f.detail).toContain("nao devolveu estado")
    }
  })

  it("uma prova que ESTOURA é INDISPONÍVEL nomeando o erro", () => {
    const f = readPrePushBlock({
      deps: {
        prove: (): object => {
          throw new Error("git ausente")
        },
      },
    })
    expect(f.state).toBe("unavailable")
    expect(f.detail).toContain("git ausente")
  })

  it("VIOLADO bloqueia o veredito; INDISPONÍVEL vira falta de prova NOMEADA", () => {
    const violado = facts({
      localContract: localContractFacts({
        links: {
          "pre-push": { state: "violated", detail: "2 objetos chegaram ao remoto", remedies: [] },
        },
      }),
    })
    const v1 = summarize(violado)
    expect(v1.verdict).toBe(VERDICT.BLOCKED)
    expect(v1.blockers.some((b) => b.includes("PRE-PUSH nao bloqueia"))).toBe(true)
    expect(localContractBlockers(violado.localContract)[0]).toContain("VERMELHA")

    const indeterminado = facts({
      localContract: localContractFacts({
        links: { "pre-push": { state: "unavailable", detail: "sem bun no PATH", remedies: [] } },
      }),
    })
    const v2 = summarize(indeterminado)
    expect(v2.verdict).toBe(VERDICT.UNKNOWN)
    expect(v2.unknowns.some((u) => u.includes("bloqueio do PUSH nao foi provado"))).toBe(true)
    expect(v2.unknowns.some((u) => u.includes("sem bun no PATH"))).toBe(true)
    // Nem bloqueio nem dúvida no caminho FELIZ.
    expect(localContractBlockers(localContractFacts())).toEqual([])
    expect(localContractUnknowns(localContractFacts())).toEqual([])
    expect(summarize(facts()).verdict).not.toBe(VERDICT.UNKNOWN)
  })

  it("pular por --no-pre-push-proof vira falta de prova DENTRO do fato, e o relatório DIZ", () => {
    const fPulado = facts({
      localContract: localContractFacts({
        links: { "pre-push": { state: "skipped", detail: "pulada por --no-pre-push-proof" } },
      }),
    })
    const linhas: string[] = []
    renderReport(
      { facts: fPulado, verdict: summarize(fPulado) },
      { emit: (s = "") => linhas.push(s) },
    )
    const texto = linhas.join("\n")
    expect(texto).toContain("prova do bloqueio do PUSH pulada por --no-pre-push-proof")
    expect(summarize(fPulado).unproven.join("\n")).toContain("prova do bloqueio do PUSH")
  })

  it("no recorte do merge (`--ci`) um elo local NÃO provado BLOQUEIA (o gate não fica verde por omissão)", () => {
    // O portão do PR traduz 0 e 2 do doctor em 0 (verde), porque INDETERMINADA é
    // o estado NORMAL do recorte (token, smoke e HOST ficam para o cron). Sem
    // esta exigência, apagar o `.husky/pre-push` — ou ficar sem `bun` no PATH —
    // levava o fato a `unavailable` → INDETERMINADA → merge verde, com a
    // promessa do push deixando de existir. Aqui os dois elos só precisam de
    // git/bash/bun, então "não deu para provar" é elo quebrado.
    const semCommit = facts({
      ciProfile: true,
      localContract: localContractFacts({
        links: { "pre-commit": { state: "unavailable", detail: "sem git no PATH", remedies: [] } },
      }),
    })
    const vCommit = summarize(semCommit)
    expect(vCommit.verdict).toBe(VERDICT.BLOCKED)
    expect(vCommit.blockers.join("\n")).toContain("bloqueio do PRE-COMMIT")
    expect(vCommit.blockers.join("\n")).toContain("recorte do merge")

    const semPush = facts({
      ciProfile: true,
      localContract: localContractFacts({
        links: { "pre-push": { state: "unavailable", detail: "sem bun no PATH", remedies: [] } },
      }),
    })
    const vPush = summarize(semPush)
    expect(vPush.verdict).toBe(VERDICT.BLOCKED)
    expect(vPush.blockers.join("\n")).toContain("bloqueio do PRE-PUSH")

    // A FLAG não esconde o elo no recorte do merge: pular a prova aqui seria,
    // na prática, tirá-la de cena do contrato — e o skip continua sendo um
    // `unproven` declarado (a decisão não desaparece do relatório).
    const pulado = facts({
      ciProfile: true,
      localContract: localContractFacts({
        links: { "pre-push": { state: "skipped", detail: "pulada por --no-pre-push-proof" } },
      }),
    })
    expect(summarize(pulado).verdict).toBe(VERDICT.BLOCKED)
    expect(summarize(pulado).unproven.join("\n")).toContain("prova do bloqueio do PUSH")

    // E FORA do recorte NADA MUDA: no perfil completo a falta de prova segue
    // INDETERMINADA — é o veredito honesto quando o doctor também olha o HOST.
    const completo = facts({
      localContract: localContractFacts({
        links: { "pre-push": { state: "unavailable", detail: "sem bun no PATH", remedies: [] } },
      }),
    })
    expect(summarize(completo).verdict).toBe(VERDICT.UNKNOWN)
  })

  it("a seção 4/7 imprime o estado, a evidência das DUAS metades e quem cobra", () => {
    const linhas: string[] = []
    const fProvado = facts({
      localContract: localContractFacts({
        links: {
          "pre-push": {
            state: "proven",
            detail: "recusou o vermelho e deixou chegar o verde",
            evidence: {
              defeito: { status: 1, refs: [], objetosNoRemoto: 0, invocacoes: 1 },
              controle: { status: 0, refs: ["refs/heads/main"], objetosNoRemoto: 2, invocacoes: 2 },
            },
            remedies: [],
          },
        },
      }),
    })
    renderReport(
      { facts: fProvado, verdict: summarize(fProvado) },
      { emit: (s = "") => linhas.push(s) },
    )
    const texto = linhas.join("\n")
    expect(texto).toContain("prova do bloqueio do PUSH (pre-push): proven")
    expect(texto).toContain("árvore vermelha: exit 1, 0 ref(s) e 0 objeto(s) no remoto")
    expect(texto).toContain("CONTROLE com a árvore verde: exit 0, refs/heads/main (2 objeto(s))")
    expect(texto).toContain("quem cobra: o PRÓPRIO hook (.husky/pre-commit e .husky/pre-push)")
  })

  it("VIOLADO aparece na seção com o remédio (o que devolver ao hook)", () => {
    const linhas: string[] = []
    const fViolado = facts({
      localContract: localContractFacts({
        links: {
          "pre-push": {
            state: "violated",
            detail: "2 objetos e 1 ref chegaram ao remoto",
            evidence: { defeito: { status: 0, refs: ["refs/heads/main"], objetosNoRemoto: 2 } },
            remedies: ["o pre-push tem de rodar o typecheck da ÁRVORE"],
          },
        },
      }),
    })
    renderReport(
      { facts: fViolado, verdict: summarize(fViolado) },
      { emit: (s = "") => linhas.push(s) },
    )
    const texto = linhas.join("\n")
    expect(texto).toContain("prova do bloqueio do PUSH (pre-push): violated")
    expect(texto).toContain("o pre-push tem de rodar o typecheck da ÁRVORE")
  })

  it("o LIMITE do gate local (o `--no-verify`) é declarado como parte do MESMO fato", () => {
    const lc = readLocalContract({})
    expect(lc.bypass.state).toBe("proven")
    // As DUAS metades da medida, na evidência: o contorno CHEGOU ao remoto (com
    // o hook sem rodar) e o gate do CI reprovou o conteúdo clonado.
    const ev = lc.bypass.evidence as {
      controle: { objetosNoRemoto: number; invocacoes: number | null }
      contorno: {
        status: number
        refs: string[]
        objetosNoRemoto: number
        invocacoes: number | null
        arg: string
      }
      ci: { comando: string; status: number; conteudoNoClone: string }
    }
    expect(ev.controle.objetosNoRemoto).toBe(0)
    expect(ev.contorno.status).toBe(0)
    expect(ev.contorno.arg).toBe("--no-verify")
    expect(ev.contorno.refs.length).toBeGreaterThan(0)
    expect(ev.contorno.objetosNoRemoto).toBeGreaterThan(0)
    // O hook NÃO rodou no push contornado: as invocações são as do controle.
    expect(ev.contorno.invocacoes).toBe(ev.controle.invocacoes)
    expect(ev.ci.status).not.toBe(0)
    expect(ev.ci.conteudoNoClone).toContain("ERRO_DE_TIPO")
    // E o agregado do fato inclui o limite (ele é uma parte como as outras).
    expect(lc.state).toBe("proven")
  })

  it("o limite VIOLADO bloqueia: o defeito passa pelo hook E pelo CI (não há rede depois)", () => {
    const f = facts({
      localContract: localContractFacts({
        bypass: {
          state: "violated",
          detail: "o --no-verify leva a árvore ao remoto E o gate do CI não reprova o que chegou",
          remedies: ["o job do gate saiu do contrato de merge"],
        },
      }),
    })
    const v = summarize(f)
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.blockers.join("\n")).toContain("o LIMITE do gate local foi medido como VIOLADO")
    // A forja que barra é NOMEADA (do CORE_INVARIANTS, não de uma lista à mão).
    expect(v.blockers.join("\n")).toContain("github: 'typecheck'")
    expect(v.blockers.join("\n")).toContain("gitea: 'typecheck'")
  })

  it("o limite não MEDIDO: no --ci BLOQUEIA (ele só precisa do mesmo fixture dos elos)", () => {
    const semMedida = localContractFacts({
      bypass: { state: "unavailable", detail: "bun nao resolve no PATH", remedies: [] },
    })
    // Fora do recorte do merge: falta de prova NOMEADA, veredito INDETERMINADA.
    expect(localContractUnknowns(semMedida as never).join("\n")).toContain("nao foi MEDIDO")
    const f = facts({ localContract: semMedida })
    expect(summarize(f).verdict).toBe(VERDICT.UNKNOWN)
    expect(summarize(f).blockers).toEqual([])
    // No recorte do merge: o veredito sem a parte que diz QUEM barra é bloqueio.
    const vCi = summarize(facts({ ciProfile: true, localContract: semMedida }))
    expect(vCi.verdict).toBe(VERDICT.BLOCKED)
    expect(vCi.blockers.join("\n")).toContain(
      "o LIMITE do gate local nao foi medido no recorte do merge",
    )
  })

  it("sem a parte do limite no fato, o veredito declara o que NÃO cobre (fail-closed)", () => {
    const semParte = localContractFacts({ bypass: null })
    expect(localContractUnknowns(semParte as never).join("\n")).toContain(
      "o LIMITE do gate local (o `git push --no-verify` contorna o hook) não está declarado",
    )
    const vCi = summarize(facts({ ciProfile: true, localContract: semParte }))
    expect(vCi.verdict).toBe(VERDICT.BLOCKED)
    expect(vCi.blockers.join("\n")).toContain("state 'ausente do relatório'")
  })

  it("a seção 4/7 imprime o limite e QUEM BARRA o defeito depois do hook", () => {
    const linhas: string[] = []
    const f = facts({ localContract: localContractFacts() })
    renderReport({ facts: f, verdict: summarize(f) }, { emit: (s = "") => linhas.push(s) })
    const texto = linhas.join("\n")
    expect(texto).toContain("limite (git push --no-verify): proven")
    expect(texto).toContain("contorno: exit 0, refs/heads/main, 2 objeto(s) no remoto")
    expect(texto).toContain(
      "quem barra: 'bun run typecheck' sobre o conteúdo CLONADO do remoto → exit 1",
    )
    // E o "NÃO CUBRE" diz, em texto, o que o gate local não é.
    expect(summarize(f).unproven.join("\n")).toContain("o LIMITE do gate LOCAL")
    expect(summarize(f).unproven.join("\n")).toContain("não é barreira contra quem o desliga")
  })
})

// ── O CONTRATO LOCAL: UM fato só (os dois elos + o que cada hook roda) ──────

/**
 * O que a consolidação existe para garantir: o veredito tem UM lugar para o
 * assunto "contrato local" — os dois elos EXECUTADOS e os comandos que cada
 * hook RODA viajam no MESMO fato, e é dele (e só dele) que saem o bloqueio, a
 * falta de prova e as linhas do relatório.
 */
describe("o contrato local é UM fato só", () => {
  it("o fato declara os dois elos E os comandos de cada hook (no repositório real)", () => {
    const lc = readLocalContract({})
    expect(LOCAL_LINKS).toEqual(["pre-commit", "pre-push"])
    for (const elo of LOCAL_LINKS) {
      expect(lc.links[elo].state).toBe("proven")
      const hook = lc.commands.hooks[`.husky/${elo}`]
      expect(hook.elo).toBe(elo)
      expect(hook.commands.length).toBeGreaterThan(0)
      expect(hook.unresolved).toEqual([])
    }
    // TODOS os hooks do `.husky/` entram (o pedido é "os comandos que cada hook
    // roda"): um hook extra com caminho quebrado é o mesmo defeito.
    expect(Object.keys(lc.commands.hooks).length).toBeGreaterThanOrEqual(2)
    expect(lc.state).toBe("proven")
    expect(lc.commands.state).toBe("proven")
  })

  it("a régua dos comandos é a do `check-hook-commands` (não uma segunda leitura)", () => {
    const doFato = readHookCommands({})
    const doGate = analyzeHookCommands({ root: process.cwd() })
    // O `analyze` devolve `infra: true` sem o resto quando não consegue ler: a
    // leitura TEM de ter funcionado, senão as comparações abaixo seriam entre
    // dois vazios (e passariam).
    expect(doGate.infra).toBe(false)
    const comandosDoGate = doGate.comandos ?? []
    const hooksDoGate = doGate.hooks ?? []
    const violacoesDoGate = doGate.violacoes ?? []
    expect(comandosDoGate.length).toBeGreaterThan(0)
    const total = Object.values(doFato.hooks).reduce((soma, h) => soma + h.commands.length, 0)
    // A MESMA pergunta, a mesma resposta: o fato não inventa comandos nem perde
    // nenhum — e o conjunto de hooks julgados é o mesmo.
    expect(total).toBe(comandosDoGate.length)
    expect(Object.keys(doFato.hooks).sort()).toEqual([...hooksDoGate].sort())
    expect(doFato.state).toBe(violacoesDoGate.length === 0 ? "proven" : "violated")
  })

  it("o agregado é o PIOR estado das partes (violated > unavailable > skipped > proven)", () => {
    expect(aggregateLocalState(["proven", "proven"])).toBe("proven")
    expect(aggregateLocalState(["proven", "skipped"])).toBe("skipped")
    expect(aggregateLocalState(["skipped", "unavailable"])).toBe("unavailable")
    expect(aggregateLocalState(["unavailable", "violated"])).toBe("violated")
    // Estado que ninguém conhece não ganha veredito mais VERDE que "não medido".
    expect(aggregateLocalState(["inventado"])).toBe("inventado")
    expect(
      localContractFacts({
        hooks: { ".husky/pre-commit": { ...HOOKS_PROVEN[".husky/pre-commit"], state: "violated" } },
      }).state,
    ).toBe("violated")
  })

  it("um comando do hook que NÃO resolve BLOQUEIA, e o relatório nomeia arquivo e linha", () => {
    const quebrado: HookDoFato = {
      ...HOOKS_PROVEN[".husky/pre-commit"],
      state: "violated",
      detail: "1 de 10 comando(s) NAO resolvem — um passo que nunca roda",
      unresolved: [
        {
          arquivo: ".husky/pre-commit",
          linha: 12,
          comando: "node scripts/nao-existe.mjs --staged",
          motivo: "caminho `scripts/nao-existe.mjs` nao existe no repositorio",
        },
      ],
    }
    const f = facts({
      localContract: localContractFacts({ hooks: { ".husky/pre-commit": quebrado } }),
    })
    const v = summarize(f)
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.blockers.join("\n")).toContain("NUNCA roda")
    expect(v.blockers.join("\n")).toContain("scripts/nao-existe.mjs")
    const linhas: string[] = []
    renderReport({ facts: f, verdict: v }, { emit: (s = "") => linhas.push(s) })
    const texto = linhas.join("\n")
    expect(texto).toContain("o que o .husky/pre-commit RODA")
    expect(texto).toContain("scripts/nao-existe.mjs")
  })

  it("no recorte do merge a metade dos comandos também é EXIGIDA (não é só o elo)", () => {
    const semComandos = facts({
      ciProfile: true,
      localContract: localContractFacts({
        hooks: {
          ".husky/pre-commit": {
            ...HOOKS_PROVEN[".husky/pre-commit"],
            state: "unavailable",
            detail: "nenhum comando julgado",
          },
        },
      }),
    })
    const v = summarize(semComandos)
    expect(v.verdict).toBe(VERDICT.BLOCKED)
    expect(v.blockers.join("\n")).toContain("nao foram CONFERIDOS no recorte do merge")
    expect(v.blockers.join("\n")).toContain(".husky/pre-commit")
  })

  it("a flag do elo não sai do fato: o `skipped` viaja DENTRO dele", () => {
    const lc = readLocalContract({
      executed: { "pre-commit": false, "pre-push": true },
      deps: {
        prePush: {
          prove: () => ({ state: "proven", detail: "dublada pelo teste", evidence: null }),
        },
      },
    })
    expect(lc.links["pre-commit"].state).toBe("skipped")
    expect(lc.links["pre-commit"].detail).toContain("--no-pre-commit-proof")
    expect(lc.links["pre-push"].state).toBe("proven")
    expect(lc.state).toBe("skipped")
    // E o veredito lê a falta de prova DAÍ (não há flag paralela para consultar).
    const f = facts({ localContract: lc })
    expect(summarize(f).unknowns.join("\n")).toContain("--no-pre-commit-proof")
    expect(summarize(f).verdict).toBe(VERDICT.UNKNOWN)
  })

  it("SEM os comandos declarados, o fato não fica verde (fail-closed)", () => {
    const semParte = localContractFacts()
    const semComandos = {
      ...semParte,
      commands: { state: "unavailable", detail: "nao pode ser lido", hooks: {}, unattributed: [] },
    }
    const f = facts({ localContract: semComandos })
    const v = summarize(f)
    expect(v.unknowns.join("\n")).toContain("os comandos que os hooks RODAM")
    // E no recorte do merge isso é elo quebrado, não dúvida.
    const vCi = summarize(facts({ ciProfile: true, localContract: semComandos }))
    expect(vCi.verdict).toBe(VERDICT.BLOCKED)
  })
})

describe("a prova REAL do bloqueio do push (executada, não lida)", () => {
  it("no repositório, a árvore VERMELHA não chega ao remoto (e a verde chega)", () => {
    const r = provePushBlocks()
    expect(r.state).toBe("proven")
    expect(r.evidence!.defeito.refs).toEqual([])
    expect(r.evidence!.defeito.objetosNoRemoto).toBe(0)
    expect(r.evidence!.defeito.invocacoes).toBeGreaterThan(0)
    expect(r.evidence!.controle!.status).toBe(0)
    expect(r.evidence!.controle!.refs).toEqual(["refs/heads/main"])
    // E o FATO do doctor é a mesma medição: o doctor não reimplementa a prova.
    expect(readPrePushBlock().state).toBe("proven")
  })

  it("SENSIBILIDADE: tirar o typecheck de NENHUMA invocação muda o veredito (provado → violado)", () => {
    const src = pushHookSource() ?? ""
    expect(src).toContain(TYPECHECK_COMMAND)
    // O VEREDITO NOVO, medido e não suposto: tirar SÓ a linha canônica da fase 2
    // não abre mais o buraco. O fast path do smart-skip captura a saída (o
    // veredito é o do typecheck, não o do `head` que filtrou), então o defeito
    // continua barrado por ele — defesa em profundidade.
    const soFase2 = src.replace(`\n${TYPECHECK_COMMAND}\n`, "\n")
    expect(soFase2).not.toBe(src)
    expect(provePushBlocks({ hookSourceTexto: soFase2 }).state).toBe("proven")
    // O buraco abre quando o hook deixa de JULGAR a árvore: nenhuma das duas
    // invocações. `true` no lugar do comando mantém a sintaxe válida, de modo
    // que a mutação não sai vermelha por PARSING.
    const r = provePushBlocks({
      hookSourceTexto: src.replaceAll(TYPECHECK_COMMAND, "true"),
    })
    expect(r.state).toBe("violated")
    expect(r.evidence!.defeito.objetosNoRemoto).toBeGreaterThan(0)
  })

  it("INDISPONÍVEL: um checkout sem o hook não é verde (diz o que faltou)", () => {
    const r = readPrePushBlock({ cwd: makeDir(), deps: {} })
    expect(r.state).toBe("unavailable")
    expect(r.detail).toContain("não existe neste checkout")
    expect(r.remedies.length).toBeGreaterThan(0)
  })
})
