/**
 * bench-guard-timing-rulers.test.ts
 *
 * Trava o CONTRATO das duas famílias de custo de unificação de régua que entraram
 * no mesmo benchmark do lint: o **typecheck** (o comando inteiro, com o heap,
 * dentro do script do package.json) e a **suíte** (`bun run test:run`, que INCLUI
 * `src/components/**`).
 *
 * O QUE ESTE TESTE PROTEGE (e o que a documentação publica como número):
 *   1. a RÉGUA medida é o comando canônico do invariante do CORE — não uma
 *      variação dela que só o benchmark conhece;
 *   2. a lista de call sites é DERIVADA dos workflows: uma pipeline nova que passe
 *      a rodar o comando entra na conta sozinha, e os pagantes declarados são
 *      PROVADOS contra ela (um pagante que sumiu = violação);
 *   3. as réguas ANTERIORES não podem voltar: `bunx tsc --noEmit` (sem heap) e
 *      `bun run test:unit` (a estreita) em workflow nenhum, e o heap não pode ser
 *      declarado FORA do script — um `env: NODE_OPTIONS` é a segunda régua que a
 *      unificação removeu, e ele não aparece em `runCommands`;
 *   4. o hook que só o veredito local tinha é conferido pelo CONTEÚDO do arquivo
 *      (não há `run:` de workflow para ler ali): ele roda o canônico e não roda a
 *      régua sem heap;
 *   5. a metade nova da suíte é DERIVADA do `exclude` da config unit — mudar o
 *      escopo lá muda o que o benchmark mede, sem duas fontes para divergir;
 *   6. as frases de "o que acrescentou ONDE agora roda" mudam de estado com o
 *      medido: o heap não pode ser declarado como salvador onde o default do node
 *      já basta (INDETERMINADO), nem a atribuição da suíte pode ser apresentada
 *      como fechando quando ela não fecha.
 *
 * Execução focada:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/bench-guard-timing-rulers.test.ts
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  TEST_ADDED_HALF_CMD,
  TEST_CANONICAL_CMD,
  TEST_LEGACY_CMD,
  TEST_LEGACY_CONFIG,
  TEST_UPGRADED_SITES,
  TYPECHECK_CANONICAL_CMD,
  TYPECHECK_HEAP_ADDED_AT,
  TYPECHECK_HEAP_MB,
  TYPECHECK_LEGACY_BARE_CMD,
  TYPECHECK_LEGACY_INLINE_CMD,
  TYPECHECK_UPGRADED_SITES,
  canonicalCallSites,
  compareTimings,
  excludedScopeDir,
  hookRulerFacts,
  legacyRulerFiles,
  reuseFamilies,
  testCostViolations,
  testWhatItAdded,
  typecheckCostViolations,
  typecheckWhatItAdded,
  workflowFilesMatching,
} from "../../../scripts/bench-guard-timing.mjs"

const REPO_ROOT = join(__dirname, "..", "..", "..")

const tcViolations = () =>
  typecheckCostViolations({
    sites: canonicalCallSites(TYPECHECK_CANONICAL_CMD),
    hook: hookRulerFacts(),
    heapOutside: workflowFilesMatching(/max-old-space-size/),
  })

const tsViolations = () => testCostViolations({ sites: canonicalCallSites(TEST_CANONICAL_CMD) })

// ── 1. O typecheck: a régua, o heap e onde ele agora roda ─────────────────

describe("bench-guard-timing — o custo da unificação do typecheck", () => {
  it("mede o comando CANÔNICO do invariante typecheck (a mesma fonte do CI)", () => {
    expect(TYPECHECK_CANONICAL_CMD).toBe("bun run typecheck")
  })

  it("o heap é LIDO do script do package.json — não digitado aqui", () => {
    const scripts = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).scripts
    const entry: string = scripts.typecheck

    // O contrafactual só vale se for o MESMO comando com o MESMO heap: o valor
    // sai da entry, então mudá-lo no package.json move a medição junto.
    expect(entry).toContain(`--max-old-space-size=${TYPECHECK_HEAP_MB}`)
    expect(TYPECHECK_LEGACY_INLINE_CMD).toBe(
      `NODE_OPTIONS=--max-old-space-size=${TYPECHECK_HEAP_MB} ${TYPECHECK_LEGACY_BARE_CMD}`,
    )
    expect(TYPECHECK_LEGACY_BARE_CMD).toBe("bunx tsc --noEmit")
  })

  it("deriva os call sites dos workflows: 4 em 4 pipelines", () => {
    const sites = canonicalCallSites(TYPECHECK_CANONICAL_CMD)

    expect(sites.map((s) => s.file).sort()).toEqual([
      ".gitea/workflows/ci.yml",
      ".github/workflows/ci.yml",
      ".github/workflows/pr-check.yml",
      ".github/workflows/release-deploy.yml",
    ])
    expect(sites.reduce((acc, s) => acc + s.count, 0)).toBe(4)
  })

  it("prova cada pagante declarado contra a lista medida", () => {
    const declared = new Set(canonicalCallSites(TYPECHECK_CANONICAL_CMD).map((s) => s.file))

    expect(TYPECHECK_UPGRADED_SITES.length).toBe(4)
    for (const site of TYPECHECK_UPGRADED_SITES) {
      expect(declared.has(site.file)).toBe(true)
      expect(site.where.length).toBeGreaterThan(10)
    }
  })

  it("a régua SEM heap não aparece em workflow, e o heap não volta para fora do script", () => {
    // As duas metades da segunda régua: o comando (`run:`) e o VALOR (`env:`). O
    // `env:` não aparece em `runCommands` — é por isso que a varredura de conteúdo
    // existe, e é ela que impede a unificação de se desfazer em silêncio.
    expect(legacyRulerFiles(TYPECHECK_LEGACY_BARE_CMD)).toEqual([])
    expect(workflowFilesMatching(/max-old-space-size/)).toEqual([])
    expect(tcViolations()).toEqual([])
  })

  it("o hook que só o veredito local tinha roda o canônico e não roda a régua sem heap", () => {
    const hook = hookRulerFacts()

    expect(hook.file).toBe(TYPECHECK_HEAP_ADDED_AT.file)
    expect(hook.exists).toBe(true)
    expect(hook.hasCanonical).toBe(true)
    expect(hook.hasBare).toBe(false)
    expect(TYPECHECK_HEAP_ADDED_AT.kind).toBe("hook")
  })

  it("o contrato MORDE: pagante sumido, hook sem o canônico e hook com a régua velha", () => {
    // Mutação 1: tirar da lista medida o arquivo declarado como pagante.
    const sites = canonicalCallSites(TYPECHECK_CANONICAL_CMD)
    const semAPipeline = sites.filter((s) => s.file !== TYPECHECK_UPGRADED_SITES[0].file)
    const semPagante = typecheckCostViolations({ sites: semAPipeline, hook: hookRulerFacts() })
    expect(semPagante).toHaveLength(1)
    expect(semPagante[0]).toContain(TYPECHECK_UPGRADED_SITES[0].file)

    // Mutação 2: o hook declarado como beneficiário do heap sem o comando canônico.
    const hookSemCanonico = typecheckCostViolations({
      sites,
      hook: {
        file: TYPECHECK_HEAP_ADDED_AT.file,
        exists: true,
        hasCanonical: false,
        hasBare: false,
      },
    })
    expect(hookSemCanonico).toHaveLength(1)
    expect(hookSemCanonico[0]).toContain(TYPECHECK_CANONICAL_CMD)

    // Mutação 3: a régua sem heap de volta ao hook (o vermelho que o merge não via).
    const hookComReguaVelha = typecheckCostViolations({
      sites,
      hook: { file: TYPECHECK_HEAP_ADDED_AT.file, exists: true, hasCanonical: true, hasBare: true },
    })
    expect(hookComReguaVelha).toHaveLength(1)
    expect(hookComReguaVelha[0]).toContain(TYPECHECK_LEGACY_BARE_CMD)

    // Mutação 4: o heap declarado num workflow — a segunda régua do `env:`.
    const heapFora = typecheckCostViolations({ sites, heapOutside: [".github/workflows/ci.yml"] })
    expect(heapFora).toHaveLength(1)
    expect(heapFora[0]).toContain("--max-old-space-size")
  })

  it("sem contrafactual medido o delta fica null — não vem de outra rodada", () => {
    const forma = (role: string, ms: number) => ({
      role,
      label: role,
      cmd: "x",
      ms,
      minMs: ms,
      maxMs: ms,
      runs: [{ ms, exit: 0 }],
      exit: 0,
      ok: true,
    })
    const family = {
      canonicalMs: 132_000,
      legacyMs: null,
      addedHalfMs: 60_000,
      addedPerSiteMs: null,
      addedPerFanOutMs: null,
      attributionPct: null,
      attributionMatches: null,
      forms: [forma("current", 132_000), forma("added-half", 60_000)],
    }
    // A régua estreita é OPCIONAL por wall time (~7min com maxWorkers 1), mas o
    // campo não pode ser preenchido com um número de outra rodada: null é a
    // resposta honesta, e a frase diz INDETERMINADO.
    expect(family.forms.some((f) => f.role === "legacy")).toBe(false)
    const frase = testWhatItAdded({
      addedPerSiteMs: family.addedPerSiteMs,
      addedHalfMs: family.addedHalfMs,
      upgradedSites: 1,
      scopeDir: "src/components",
    })
    expect(frase).toContain("INDETERMINADO")
    expect(frase).toContain("NAO foi medida nesta rodada")
    expect(frase).not.toContain("por rodada no call site")
  })

  it("a frase do custo muda de estado com o medido (o heap só é salvador onde o default não basta)", () => {
    const legacyBare = { exit: 134, ms: 40_000 }

    // O runner: o default do node é MENOR que o do script — a régua sem heap morre.
    const noRunner = typecheckWhatItAdded({
      addedPerSiteMs: 120,
      legacyBare,
      heapMb: 4096,
      nodeHeapLimitMb: 1400,
      upgradedSites: 4,
    })
    expect(noRunner).toContain("COMPLETAR")
    expect(noRunner).toContain("exit 134")
    expect(noRunner).toContain("+0.1s")

    // Esta máquina: o default do node já é >= o do script — a régua sem heap
    // completa, então o 134 do runner NÃO se reproduz aqui. Dizer "morre" seria
    // afirmar o que não foi medido.
    const noDesktop = typecheckWhatItAdded({
      addedPerSiteMs: 120,
      legacyBare: { exit: 0, ms: 24_000 },
      heapMb: 4096,
      nodeHeapLimitMb: 4144,
      upgradedSites: 4,
    })
    expect(noDesktop).toContain("NAO se reproduz nesta maquina")
    expect(noDesktop).toContain("INDETERMINADO")
    expect(noDesktop).not.toContain("morreu")

    // Sem medir o heap do node, o estado é INDETERMINADO — nunca "não existe".
    const semMedida = typecheckWhatItAdded({
      addedPerSiteMs: 120,
      legacyBare,
      heapMb: 4096,
      nodeHeapLimitMb: null,
      upgradedSites: 4,
    })
    expect(semMedida).toContain("INDETERMINADO")
  })
})

// ── 2. Medir em PARTES: `--merge` herda com procedência e fora do veredito ──

describe("bench-guard-timing — medir em partes (--merge)", () => {
  const emptyRun = (families: { lint?: unknown; typecheck?: unknown; tests?: unknown }) => ({
    meta: {
      tool: "bench-guard-timing",
      version: 3,
      commit: "bbbb2222",
      timestamp: "2026-09-16T10:00:00.000Z",
      reused: {},
    },
    summary: {
      totalMs: 18_600,
      lintAddedPerFanOutMs: null,
      typecheckMs: null,
      testsMs: null,
      typecheckAddedPerFanOutMs: null,
      testsAddedPerFanOutMs: null,
    },
    guards: [],
    doctor: { ms: 3000, exit: 0, ok: true },
    lint: families.lint ?? null,
    rulers: { typecheck: families.typecheck ?? null, tests: families.tests ?? null },
  })
  const previous = {
    meta: { commit: "aaaa1111", timestamp: "2026-09-15T22:00:00.000Z" },
    lint: { addedPerSiteMs: 20_800, addedPerFanOutMs: 83_200, canonicalMs: 52_000 },
    rulers: {
      typecheck: { canonicalMs: 24_000, addedPerFanOutMs: 0 },
      tests: null,
    },
  }

  it("sem arquivo anterior não há herança", () => {
    const result = emptyRun({})
    expect(reuseFamilies(result, null)).toBe(result)
  })

  it("herda só o que esta rodada NÃO mediu, com commit e timestamp de origem", () => {
    const medidos = { tests: { canonicalMs: 132_000, addedPerFanOutMs: -300_000 } }
    const merged = reuseFamilies(emptyRun(medidos), previous) as never as {
      meta: { reused: Record<string, { commit: string }> }
      lint: { canonicalMs: number } | null
      rulers: { typecheck: { canonicalMs: number } | null; tests: { canonicalMs: number } | null }
      summary: {
        lintAddedPerFanOutMs: number | null
        testsMs: number | null
        typecheckMs: number | null
      }
    }

    // O que foi medido agora fica; o que não foi, entra marcado.
    expect(merged.rulers.tests?.canonicalMs).toBe(132_000)
    expect(merged.lint?.canonicalMs).toBe(52_000)
    expect(merged.rulers.typecheck?.canonicalMs).toBe(24_000)
    expect(Object.keys(merged.meta.reused).sort()).toEqual(["lint", "typecheck"])
    expect(merged.meta.reused.lint.commit).toBe("aaaa1111")
    // A família que NÃO existia no arquivo anterior continua null — herdar
    // "nada" não pode virar herdar um número.
    expect(merged.summary.testsMs).toBe(132_000)
    expect(merged.summary.lintAddedPerFanOutMs).toBe(83_200)
  })

  it("uma família herdada fica FORA do veredito (o número é de outro momento)", () => {
    const previousFull = {
      meta: { commit: "aaaa1111", timestamp: "2026-09-15T22:00:00.000Z" },
      lint: { addedPerSiteMs: 20_800, addedPerFanOutMs: 52_000, canonicalMs: 52_000 },
      rulers: { typecheck: { canonicalMs: 24_000 }, tests: null },
    }
    const fresh = emptyRun({
      lint: { canonicalMs: 52_000, addedPerSiteMs: 20_800, addedPerFanOutMs: 52_000 },
      tests: { canonicalMs: 132_000, addedPerFanOutMs: -300_000 },
    })
    const merged = reuseFamilies(fresh, previousFull) as never as object

    const cmpFresh = compareTimings(fresh as never, null as never) as unknown as {
      forms: { kind: string }[]
      reused: string[]
    }
    const cmpMerged = compareTimings(merged as never, null as never) as unknown as {
      forms: { kind: string }[]
      reused: string[]
    }

    // Sem herança: a família do lint entra na comparação.
    const kinds = (cmp: { forms: { kind: string }[] }) => cmp.forms.map((f) => f.kind)

    expect(kinds(cmpFresh)).toContain("lint")
    expect(kinds(cmpFresh)).toContain("tests")
    expect(cmpFresh.reused).toEqual([])
    // Com herança: o typecheck saiu do veredito (o arquivo anterior o tinha, esta
    // rodada não o mediu) E é NOMEADO — regressão dele não pode ser dada como
    // ausente com base num número de ontem.
    expect(kinds(cmpMerged)).toContain("lint")
    expect(kinds(cmpMerged)).toContain("tests")
    expect(kinds(cmpMerged)).not.toContain("typecheck")
    expect(cmpMerged.reused).toEqual(["typecheck"])

    // …e quando a família herdada é a do LINT, ela sai do veredito também.
    const soTypecheck = emptyRun({ typecheck: { canonicalMs: 24_000, addedPerFanOutMs: 0 } })
    const herdado = reuseFamilies(soTypecheck, previousFull) as never as object
    const cmpHerdado = compareTimings(herdado as never, null as never) as unknown as {
      forms: { kind: string }[]
      reused: string[]
    }
    expect(kinds(cmpHerdado)).toContain("typecheck")
    expect(kinds(cmpHerdado)).not.toContain("lint")
    expect(cmpHerdado.reused).toEqual(["lint"])
  })
})

// ── 3. A suíte: a régua mais ampla e a metade que ela acrescentou ─────────

describe("bench-guard-timing — o custo da unificação da suíte", () => {
  it("mede o comando CANÔNICO do invariante tests (a régua mais AMPLA)", () => {
    expect(TEST_CANONICAL_CMD).toBe("bun run test:run")
    expect(TEST_LEGACY_CMD).toBe("bun run test:unit")
    expect(TEST_LEGACY_CMD).not.toBe(TEST_CANONICAL_CMD)
  })

  it("a metade nova é DERIVADA do exclude da config unit (uma fonte só)", () => {
    const scope = excludedScopeDir()
    const unitCfg = readFileSync(join(REPO_ROOT, TEST_LEGACY_CONFIG), "utf8")
    const appCfg = readFileSync(join(REPO_ROOT, "vitest.config.ts"), "utf8")

    // A régua estreita exclui o escopo; a ampla não. Se o `exclude` da unit mudar
    // (outro diretório, outro glob), `excludedScopeDir` acompanha e o comando da
    // metade nova passa a apontar para lá — sem cópia do escopo no benchmark.
    expect(scope).toBe("src/components")
    expect(unitCfg).toContain(`"${scope}/**/*.test.{ts,tsx}"`)
    expect(appCfg).not.toContain(`exclude: ["${scope}`)
    expect(TEST_ADDED_HALF_CMD).toBe(`bunx vitest run ${scope}`)
  })

  it("deriva os call sites dos workflows: 4 em 4 pipelines", () => {
    expect(
      canonicalCallSites(TEST_CANONICAL_CMD)
        .map((s) => s.file)
        .sort(),
    ).toEqual([
      ".gitea/workflows/ci.yml",
      ".github/workflows/ci.yml",
      ".github/workflows/pr-check.yml",
      ".github/workflows/release-deploy.yml",
    ])
  })

  it("a régua ESTREITA não pode voltar a ser veredito de merge", () => {
    // A forja já rodava a ampla; o check EXIGIDO do GitHub rodava a estreita. Se o
    // `test:unit` voltasse a um workflow, o lado mais fraco do par voltaria a ser
    // um veredito de merge — e o número publicado perderia a causa.
    expect(legacyRulerFiles(TEST_LEGACY_CMD)).toEqual([])
    expect(tsViolations()).toEqual([])
  })

  it("prova o pagante declarado e MORDE quando ele some", () => {
    const sites = canonicalCallSites(TEST_CANONICAL_CMD)
    const declared = new Set(sites.map((s) => s.file))

    // Um call site só: a forja já rodava o mais amplo; quem pagou foi o espelho.
    expect(TEST_UPGRADED_SITES.length).toBe(1)
    for (const site of TEST_UPGRADED_SITES) {
      expect(declared.has(site.file)).toBe(true)
      expect(site.where).toContain("test:unit")
    }

    const semOEspelho = sites.filter((s) => s.file !== TEST_UPGRADED_SITES[0].file)
    const violations = testCostViolations({ sites: semOEspelho })
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain(TEST_UPGRADED_SITES[0].file)
    expect(violations[0]).toContain(TEST_CANONICAL_CMD)
  })

  it("a frase do custo declara atribuição NÃO conferida quando ela não fecha", () => {
    // A atribuição fecha: o delta é (dentro da tolerância) a metade nova.
    const confere = testWhatItAdded({
      addedPerSiteMs: 200_000,
      addedHalfMs: 195_000,
      upgradedSites: 1,
      scopeDir: "src/components",
    })
    expect(confere).toContain("fecha com o delta")
    expect(confere).toContain("src/components/**")

    // Não fecha: as duas réguas diferem também em workers e setup, e o número não
    // pode ser apresentado como se fosse só a suíte de componentes.
    const naoConfere = testWhatItAdded({
      addedPerSiteMs: 40_000,
      addedHalfMs: 200_000,
      upgradedSites: 1,
      scopeDir: "src/components",
    })
    expect(naoConfere).toContain("NAO e so ela")
    expect(naoConfere).not.toContain("fecha com o delta")
  })
})
