/**
 * seed-e2e-count.test.ts
 *
 * Testes unitários para scripts/seed-e2e-count.ts — a DERIVAÇÃO dos counts
 * de checks dos E2Es de seed (fonte da verdade, nunca literais).
 *
 * A derivação soma 3 contribuições para cada E2E:
 *   1. Sites de asserção no source (`expect(`/`ok(`/`bad(`/`rep.expect(`)
 *   2. Expansão de loops dirigidos por dados (settings + Object.entries)
 *   3. Helpers compartilhados: validateTree (59), validateUsers (13, dev),
 *      assertPatchedUpdatePlan (PLAN_ASSERT_COUNT = 3)
 *
 * O teste-chave: deriveExpectedChecks reproduz EXATAMENTE os counts
 * documentados nos workflows reais (lidos via extractDocumentedCounts +
 * SCAN_FILES — sem literais hardcoded) — se uma asserção for
 * adicionada/removida sem atualizar os comentários dos workflows, este
 * teste falha com arquivo:linha e o guard estático (check-e2e-counts.mjs)
 * também. (Histórico: o teste antigo hardcodava prod=115/dev=162 e ficou
 * stale quando o cenário 10 levou prod a 123 — a integração abaixo fecha o gap.)
 *
 * Mutation test (describe no final): prova o contrato "ajusta sozinho" —
 * injeta/remove asserções numa CÓPIA do source (via sourceOverride, o mesmo
 * padrão do SEED_SPEC_PATCH) e valida que o count sobe/desce na proporção
 * exata SEM edição manual de nenhum número.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/seed-e2e-count.test.ts
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  countAssertSites,
  countCountsTypeFields,
  dataLoopExpansions,
  deriveExpectedChecks,
} from "../../../scripts/seed-e2e-count"
import { validateTreeCheckCount, validateUsersCheckCount } from "../../../scripts/seed-e2e-common"
import { PLAN_ASSERT_COUNT } from "../../../scripts/seed-e2e-utils"
import { extractDocumentedCounts, SCAN_FILES } from "../../../scripts/check-e2e-counts.mjs"

const PROD_SRC = readFileSync(join(process.cwd(), "scripts", "test-seed-prod-e2e.ts"), "utf8")
const DEV_SRC = readFileSync(join(process.cwd(), "scripts", "test-seed-dev-e2e.ts"), "utf8")

// ── countAssertSites ─────────────────────────────────────────────────────

describe("countAssertSites", () => {
  it("conta sites de asserção (expect/ok/bad/rep.expect) ignorando comentários", () => {
    const src = `// expect(1) — comentário ignorado
      /* expect(2) ok(3) bad(4) — bloco ignorado */
      expect(true)
      ok("a")
      bad("b")
      rep.expect(true, "c")
      const x = "texto sem chamada de asserção"
    `
    expect(countAssertSites(src)).toBe(4)
  })

  it("não conta palavras sem a chamada (ex.: EXPECTED_TOTAL, expect em texto)", () => {
    const src = `export const EXPECTED_TOTAL = 5
      const s = "isto não é uma expectativa"
    `
    expect(countAssertSites(src)).toBe(0)
  })

  it("source vazio → 0", () => {
    expect(countAssertSites("")).toBe(0)
  })
})

// ── countCountsTypeFields ────────────────────────────────────────────────

describe("countCountsTypeFields", () => {
  it("conta os campos do type Counts do E2E dev (10 tabelas)", () => {
    expect(countCountsTypeFields(DEV_SRC)).toBe(10)
  })

  it("retorna 0 quando não há type Counts multi-linha", () => {
    expect(countCountsTypeFields("type Counts = { a: number }")).toBe(0)
    expect(countCountsTypeFields("sem type aqui")).toBe(0)
  })
})

// ── dataLoopExpansions ───────────────────────────────────────────────────

describe("dataLoopExpansions", () => {
  it("prod: settings (8) + 1 loop de Object.entries sobre Counts de 3 campos (2) = 10", () => {
    // O cenário 10 (SEED_SPEC_PATCH JSON quebrado) adicionou um loop
    // Object.entries sobre o Counts de 3 campos (categories/settings/users).
    expect(dataLoopExpansions(PROD_SRC, "prod")).toBe(10)
  })

  it("dev: settings (8) + 3 loops de Object.entries × (10-1) = 27 → 35", () => {
    expect(dataLoopExpansions(DEV_SRC, "dev")).toBe(35)
  })

  it("fonte sem loops → 0", () => {
    expect(dataLoopExpansions("const a = 1", "prod")).toBe(0)
  })
})

// ── Helpers compartilhados ───────────────────────────────────────────────

describe("helpers compartilhados (validateTree/validateUsers/plan)", () => {
  it("validateTreeCheckCount = 59 (1 + 3 levels + 27×2 + 1)", () => {
    expect(validateTreeCheckCount()).toBe(59)
  })

  it("validateUsersCheckCount = 13 (1 + 9 emails + 3 roles)", () => {
    expect(validateUsersCheckCount()).toBe(13)
  })

  it("PLAN_ASSERT_COUNT = 3 (assertPatchedUpdatePlan)", () => {
    expect(PLAN_ASSERT_COUNT).toBe(3)
  })
})

// ── deriveExpectedChecks × counts DOCUMENTADOS (integração real) ─────────
// O teste-chave: a derivação DEVE reproduzir exatamente os counts
// documentados nos MESMOS arquivos que o guard check-e2e-counts.mjs escaneia
// (SCAN_FILES — pr-check.yml, seed-guards.yml, validate-seed-guards-
// matrix-local.sh). Nenhum literal hardcoded: se a derivação quebrar (novo
// cenário, novo loop, helper com asserções) sem atualizar os comentários dos
// workflows, este teste falha com arquivo:linha — o PR não passa. O guard
// estático (check-e2e-counts.mjs) valida o mesmo vínculo por outra via.
//
// History: o teste antigo hardcodava prod=115/dev=162 e ficou STALE quando o
// cenário 10 levou prod a 123 — o guard passava, mas o unit test não
// acompanhava. A integração abaixo elimina os literais: os counts esperados
// vêm dos workflows reais via extractDocumentedCounts.

describe("deriveExpectedChecks reproduz os counts documentados (fonte da verdade)", () => {
  // Extrai os counts documentados dos arquivos REAIS (mesma lista do guard)
  const documented = SCAN_FILES.flatMap((rel) =>
    extractDocumentedCounts(readFileSync(join(process.cwd(), rel), "utf8")).map((d) => ({
      ...d,
      file: rel,
    })),
  )

  it("encontra counts documentados para AMBOS os alvos (não-vácuo)", () => {
    const targets = new Set(documented.map((d) => d.target))
    expect(targets.has("prod")).toBe(true)
    expect(targets.has("dev")).toBe(true)
  })

  it("cada count documentado bate com deriveExpectedChecks do alvo", () => {
    // Deriva UMA vez por alvo (evita recomputar lendo os E2Es a cada site).
    const expected = {
      prod: deriveExpectedChecks("prod"),
      dev: deriveExpectedChecks("dev"),
    }
    for (const d of documented) {
      const target = d.target as keyof typeof expected
      expect(
        expected[target],
        `${d.file}:${d.line} documenta ${target}=${d.count}, mas a derivação calcula ${expected[target]}`,
      ).toBe(d.count)
    }
  })

  it("piso de sites documentados por alvo (contra drift da extração)", () => {
    // O teste de integração acima só valida os counts que a extração
    // ENCONTRA — se um padrão do extractDocumentedCounts for silenciosamente
    // derrubado por reformatação (ex.: o ternary da matrix ou um header), o
    // conjunto documentado encolhe e o loop passa com menos sites. Este piso
    // (medido: prod=8, dev=6 sites nos SCAN_FILES) falha o teste quando um
    // site documentado some — é a proteção contra drift da EXTRAÇÃO, que nem
    // o anchor nem o loop capturam.
    const prodSites = documented.filter((d) => d.target === "prod").length
    const devSites = documented.filter((d) => d.target === "dev").length
    expect(
      prodSites,
      `piso prod violado: esperado ≥ 8 sites documentados, extração encontrou ${prodSites}`,
    ).toBeGreaterThanOrEqual(8)
    expect(
      devSites,
      `piso dev violado: esperado ≥ 6 sites documentados, extração encontrou ${devSites}`,
    ).toBeGreaterThanOrEqual(6)
  })

  it("sanidade: prod=123 e dev=162 no estado atual (anchor do valor)", () => {
    // Âncora explícita do valor ATUAL da derivação. NÃO é contra drift da
    // extração (isso é o piso acima) — é para forçar atualização COORDENADA:
    // se a derivação mudar legitimamente (novo cenário), os comentários dos
    // workflows E este anchor devem ser atualizados juntos — o teste falha de
    // propósito até que ambos estejam sincronizados, com mensagem explicando
    // o contrato.
    expect(
      deriveExpectedChecks("prod"),
      "anchor prod desatualizado: atualize os comentários dos workflows e este anchor juntos (derivação legítima mudou)",
    ).toBe(123)
    expect(
      deriveExpectedChecks("dev"),
      "anchor dev desatualizado: atualize os comentários dos workflows e este anchor juntos (derivação legítima mudou)",
    ).toBe(162)
  })
})

// ── MUTATION TEST — o contrato "ajusta sozinho" ──────────────────────────
// Prova que a derivação acompanha o CÓDIGO sem edição manual: injeta uma
// asserção extra numa CÓPIA do source do E2E (via sourceOverride — mesmo
// padrão do SEED_SPEC_PATCH, que injeta um patch no spec sem editar o repo)
// e valida que o count sobe/desce na proporção exata (+1 por site, +N-1 por
// expansão de loop, +0 para comentário). Se a derivação quebrar (contar
// errado), este teste falha ANTES de qualquer drift silencioso no CI.

describe("mutation — a derivação ajusta sozinha (contrato SEED_SPEC_PATCH)", () => {
  it("injetar 1 asserção expect() no E2E prod → count sobe +1 (123→124-style)", () => {
    const anchor = 'console.log("  ── Guard (recusa fora de produção) ──")'
    // Precondição explícita: se o E2E refatorar o anchor, a falha diz QUAL
    // anchor quebrou (o expect(mutated).not.toBe seria genérico demais).
    expect(PROD_SRC).toContain(anchor)
    const mutated = PROD_SRC.replace(anchor, `${anchor}\n  expect(true, "mutation")`)
    expect(mutated).not.toBe(PROD_SRC)
    expect(deriveExpectedChecks("prod", mutated)).toBe(deriveExpectedChecks("prod") + 1)
  })

  it("injetar 1 asserção ok() no E2E dev → count sobe +1 (162→163-style)", () => {
    const anchor = 'console.log("  ── Guard (recusa em NODE_ENV=production, sem escrita) ──")'
    expect(DEV_SRC).toContain(anchor)
    const mutated = DEV_SRC.replace(anchor, `${anchor}\n  ok("mutation")`)
    expect(mutated).not.toBe(DEV_SRC)
    expect(deriveExpectedChecks("dev", mutated)).toBe(deriveExpectedChecks("dev") + 1)
  })

  it("injetar rep.expect() no E2E prod → count sobe +1 (4º padrão do countAssertSites)", () => {
    // rep.expect é o 4º padrão do countAssertSites (expect/ok/bad/rep.expect)
    const anchor = "await db.$disconnect()"
    expect(PROD_SRC).toContain(anchor)
    const mutated = PROD_SRC.replace(anchor, `${anchor}\n  rep.expect(true, "mutation")`)
    expect(mutated).not.toBe(PROD_SRC)
    expect(deriveExpectedChecks("prod", mutated)).toBe(deriveExpectedChecks("prod") + 1)
  })

  it("injetar 2 asserções (expect + bad) → count sobe +2 sem edição manual", () => {
    const mutated = PROD_SRC + '\n  expect(true, "mut1")\n  bad("mut2")'
    expect(deriveExpectedChecks("prod", mutated)).toBe(deriveExpectedChecks("prod") + 2)
  })

  it("injetar loop Object.entries com expect → +1 site + (campos-1) expansão", () => {
    // Prod: +1 site (expect no loop) + 1 loop × (3 campos - 1) = +3 total.
    // O loop injetado NUNCA é executado — a derivação é regex sobre o source,
    // não runtime; counts/v são só texto (não precisam existir no escopo).
    const fields = countCountsTypeFields(PROD_SRC)
    const mutated =
      PROD_SRC +
      '\n  for (const [k, v] of Object.entries(counts)) {\n    expect(v, "mut-loop")\n  }'
    expect(deriveExpectedChecks("prod", mutated)).toBe(
      deriveExpectedChecks("prod") + 1 + (fields - 1),
    )
  })

  it("asserção em COMENTÁRIO não conta (+0)", () => {
    const mutated = PROD_SRC + '\n  // expect(true, "mut-comentario")'
    expect(deriveExpectedChecks("prod", mutated)).toBe(deriveExpectedChecks("prod"))
  })

  it("remover 1 asserção real → count desce -1", () => {
    // Anchor real (linha 121 do prod E2E) — comentar remove exatamente 1 site
    const anchor = "  expect(refuse.status !== 0"
    expect(PROD_SRC).toContain(anchor)
    const mutated = PROD_SRC.replace(anchor, `  // ${anchor.trimStart()}`)
    expect(mutated).not.toBe(PROD_SRC)
    expect(deriveExpectedChecks("prod", mutated)).toBe(deriveExpectedChecks("prod") - 1)
  })
})
