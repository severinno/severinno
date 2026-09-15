/**
 * check-forge-parity.test.ts
 *
 * Testes de scripts/check-forge-parity.mjs — paridade de gates entre a forja
 * dona do merge (Gitea/Forgejo) e o espelho do GitHub, E a COMPLETUDE da
 * classificação.
 *
 * POR QUE a completude é o ponto: a primeira versão do guard comparava as
 * pipelines contra uma lista CORE escrita à mão. A lista tinha 10 itens; o
 * pr-check.yml executava ~30 gates. Os ~20 restantes eram INVISÍVEIS e o guard
 * passava verde — dando a impressão de que a forja bloqueava o merge quando
 * faltavam lá a auditoria de dependências, a baseline de segredos e o guard de
 * hooks de seed. Um guard que dá falsa segurança é pior que guard nenhum:
 * converte "não verificado" em "parece verificado".
 *
 * O teste trava as três direções:
 *   - gate sem classificação é violação (nada de gate invisível);
 *   - invariante do CORE ausente numa pipeline é violação;
 *   - classificação GITHUB_ONLY que na verdade RODA na forja é violação (razão
 *     que envelheceu vira mentira).
 *
 * Execução focada:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-forge-parity.test.ts
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  CORE_INVARIANTS,
  GITHUB_ONLY,
  PIPELINES,
  classifyGate,
  discoverGates,
  executableLines,
  findParityViolations,
  missingInvariants,
} from "../../../scripts/check-forge-parity.mjs"

/**
 * Linhas com o comando REAL de CADA invariante do CORE (uma por invariante).
 * Lista-golden: quando o CORE ganha um invariante, o teste falha até a linha
 * correspondente aparecer aqui — o mesmo contrato do required-checks.
 */
const REAL_LINES = [
  "      - run: bunx tsc --noEmit",
  "      - run: bun run lint",
  "      - run: bun run test:unit",
  "      - run: bun run check:ts-nocheck",
  "      - run: bun run check:pii-allowlist",
  "      - run: bun run check:pii-gate",
  "      - run: bun run check:required-checks",
  "      - run: node scripts/check-script-headers.mjs",
  "      - run: node scripts/check-pipefail-sigpipe.mjs",
  "      - run: bun run check:prove-docs",
  "      - run: bun run check:registry-source",
  "      - run: bun run check:runner-base",
  "      - run: bun scripts/check-workflow-refs.mjs --pkg-internal",
  "      - run: bun run check:forge-workflow-scope",
  "      - run: bun run check:bun-audit-baseline",
  "      - run: bun scripts/rotate-secrets.mjs --check",
  "      - run: bun run check:seed-hooks",
  "      - run: bun run check:sentinel-producer",
  "      - run: bun run check:bun-mirror",
  "      - run: bun run check:no-setup-bun",
  "      - run: bun run check:forge-parity",
  "      - run: bun scripts/check-hooks-symmetry.mjs",
  "      - run: bun scripts/check-doctor-ci.mjs",
  "      - run: node scripts/prove-runner-image-gate.mjs",
]

/** Pipeline sintética que executa TODOS os invariantes do CORE. */
const REALISTIC = REAL_LINES.join("\n")

/** A mesma pipeline sem as linhas que contêm qualquer dos fragmentos. */
function without(...fragments: string[]): string {
  return REAL_LINES.filter((line) => !fragments.some((f) => line.includes(f))).join("\n")
}

describe("executableLines", () => {
  it("descarta linha de comentário e linha vazia", () => {
    expect(executableLines(["# check:pii-allowlist", "", "   ", "run: bun run lint"])).toEqual([
      "run: bun run lint",
    ])
  })

  it("remove comentário inline preservando o código", () => {
    expect(executableLines(["  packages: read # check:pii-gate"])).toEqual(["  packages: read"])
  })
})

describe("discoverGates", () => {
  it("a lista golden cobre exatamente um gate por invariante do CORE", () => {
    const gates = discoverGates(REALISTIC)
    expect(gates).toHaveLength(CORE_INVARIANTS.length)
    // Cada invariante tem exatamente um gate casando (sem buraco e sem sobra).
    for (const inv of CORE_INVARIANTS) {
      expect(gates.filter((g) => inv.matches.test(g))).toHaveLength(1)
    }
  })

  it("descobre script, entry, typecheck e workflow reutilizável", () => {
    const gates = discoverGates(
      [
        "- run: node scripts/check-seed-hooks.mjs",
        "- run: bun run check:pii-allowlist",
        "- run: bunx tsc --noEmit",
        "uses: ./.github/workflows/seed-guards.yml",
      ].join("\n"),
    )
    expect(gates).toContain("scripts/check-seed-hooks.mjs")
    expect(gates).toContain("bun run check:pii-allowlist")
    expect(gates).toContain("tsc --noEmit")
    expect(gates).toContain("uses: ./.github/workflows/seed-guards.yml")
  })

  it("NÃO trata plumbing como gate (não declara verificação)", () => {
    const gates = discoverGates(
      [
        "- run: bun install --frozen-lockfile",
        "- run: bun run db:generate",
        "- run: bun run build",
      ].join("\n"),
    )
    expect(gates).toEqual([])
  })

  it("promove a gate o comando com `--check` mesmo sem prefixo de verificação", () => {
    // `rotate-secrets` não segue a convenção check-/validate-/audit-.
    expect(discoverGates("- run: node scripts/rotate-secrets.mjs --check")).toContain(
      "scripts/rotate-secrets.mjs",
    )
  })

  it("ignora gates comentados (o guard protege o que EXECUTA)", () => {
    expect(discoverGates("# - run: bun run check:seed-hooks")).toEqual([])
  })
})

describe("classifyGate", () => {
  it("classifica o guard real e o seu test-mutation de forma DIFERENTE", () => {
    expect(classifyGate("scripts/check-bun-audit-baseline.mjs")).toBe("core")
    // O test-mutation-* é o TESTE do guard: roda só onde o mutation roda.
    expect(classifyGate("scripts/test-mutation-bun-audit-baseline.sh")).toBe("github-only")
  })

  it("classifica isenções com razão escrita", () => {
    expect(classifyGate("uses: ./.github/workflows/seed-guards.yml")).toBe("github-only")
    expect(classifyGate("scripts/check-unused-deps.mjs")).toBe("github-only")
  })

  it("devolve null para gate não classificado (é o que vira violação)", () => {
    expect(classifyGate("scripts/check-alguma-coisa-nova.mjs")).toBeNull()
  })

  it("o gate do doctor é CORE, e os scripts do CRON (doctor/publicador) não são gates", () => {
    expect(classifyGate("scripts/check-doctor-ci.mjs")).toBe("core")
    // O doctor é o motor e o publicador é do cron: nenhum dos dois é um gate de
    // PR — se alguém os chamar numa pipeline, a descoberta acusa NÃO
    // CLASSIFICADO em vez de deixar passar como se fosse o gate.
    expect(classifyGate("scripts/forge-doctor.mjs")).toBeNull()
    expect(classifyGate("scripts/forge-doctor-issue.mjs")).toBeNull()
  })

  it("toda isenção tem uma razão não trivial", () => {
    for (const entry of GITHUB_ONLY) {
      expect(entry.reason.length, `isenção '${entry.id}' sem razão útil`).toBeGreaterThan(30)
    }
  })
})

describe("missingInvariants", () => {
  it("reconhece os comandos reais das duas forjas (sintaxes diferentes)", () => {
    expect(missingInvariants(REALISTIC)).toEqual([])
  })

  it("reconhece o alias com ':' (bun run check:foo)", () => {
    expect(missingInvariants("run: bun run check:workflow-refs:internal")).not.toContain(
      "workflow-refs",
    )
  })

  it("detecta o invariante ausente", () => {
    expect(missingInvariants(without("ts-nocheck"))).toEqual(["ts-nocheck"])
  })

  it("NÃO conta a prosa como gate rodando (comentário não é execução)", () => {
    const onlyComments = CORE_INVARIANTS.map((inv) => `# rode bun run check:${inv.id}`).join("\n")
    expect(missingInvariants(onlyComments)).toHaveLength(CORE_INVARIANTS.length)
  })
})

describe("findParityViolations", () => {
  const io = (files: Record<string, string | null>) => (path: string) => files[path] ?? null

  it("aprova quando as duas pipelines executam o CORE", () => {
    expect(
      findParityViolations(io({ [PIPELINES[0].file]: REALISTIC, [PIPELINES[1].file]: REALISTIC })),
    ).toEqual([])
  })

  it("reprova apontando a pipeline, a forja e o papel (dona do merge vs espelho)", () => {
    const v = findParityViolations(
      io({
        [PIPELINES[0].file]: without("registry-source"),
        [PIPELINES[1].file]: REALISTIC,
      }),
    )
    expect(v).toHaveLength(1)
    expect(v[0]).toContain(PIPELINES[0].file)
    expect(v[0]).toContain("gitea")
    expect(v[0]).toContain("dona do merge")
    expect(v[0]).toContain("registry-source")
  })

  it("reprova GATE NÃO CLASSIFICADO — o buraco que a lista à mão não via", () => {
    const v = findParityViolations(
      io({
        [PIPELINES[0].file]: REALISTIC,
        [PIPELINES[1].file]: `${REALISTIC}\n      - run: node scripts/check-recem-criado.mjs`,
      }),
    )
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("check-recem-criado")
    expect(v[0]).toContain("NAO CLASSIFICADO")
    // A mensagem precisa dizer o que fazer, não só que falhou.
    expect(v[0]).toContain("GITHUB_ONLY")
  })

  it("reprova classificação GITHUB_ONLY que na verdade RODA na forja (razão stale)", () => {
    const v = findParityViolations(
      io({
        [PIPELINES[0].file]: `${REALISTIC}\n      - run: node scripts/check-unused-deps.mjs`,
        [PIPELINES[1].file]: REALISTIC,
      }),
    )
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("classificado como GITHUB_ONLY")
    expect(v[0]).toContain("RODA aqui")
  })

  it("NÃO exige na forja os gates isentos de GitHub", () => {
    const v = findParityViolations(
      io({
        [PIPELINES[0].file]: REALISTIC,
        [PIPELINES[1].file]: `${REALISTIC}\n      - run: scripts/audit-blob-crlf-history.sh`,
      }),
    )
    expect(v).toEqual([])
  })

  it("reprova o espelho do GitHub quando é ele que perde o gate", () => {
    const v = findParityViolations(io({ [PIPELINES[0].file]: REALISTIC, [PIPELINES[1].file]: "" }))
    expect(v).toHaveLength(CORE_INVARIANTS.length)
    expect(v.every((m) => m.includes(PIPELINES[1].file) && m.includes("espelho"))).toBe(true)
  })

  it("reprova pipeline declarada que não existe (arquivo fantasma no guard)", () => {
    const v = findParityViolations(io({ [PIPELINES[0].file]: REALISTIC }))
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("nao existe")
  })
})

describe("repositório real", () => {
  const read = (path: string) => {
    const full = join(process.cwd(), path)
    return existsSync(full) ? readFileSync(full, "utf8") : null
  }

  it("classificação completa e paridade do CORE mantidas", () => {
    expect(findParityViolations(read)).toEqual([])
  })

  it("a forja é declarada como dona do merge (o desenho não pode inverter sozinho)", () => {
    expect(PIPELINES.filter((p) => p.mergeOwner)).toHaveLength(1)
    expect(PIPELINES.find((p) => p.mergeOwner)?.forge).toBe("gitea")
  })

  // MUTAÇÃO: o gate `bring-up-proof` (a prova do PRÉ-REQUISITO 0) é o que roda o
  // bring-up REAL contra um env divergente. Ele não pode sair de UMA pipeline em
  // silêncio — e é aqui que o "em silêncio" é fechado: o guard que o descobre é o
  // mesmo que o exige nas duas. A mutação opera sobre o TEXTO REAL do ci.yml (não
  // sobre a fixture), então renomear/reapontar o passo também cai nesta rede.
  it("MUTAÇÃO: remover o gate do bring-up da forja vira drift de CORE (não passa em silêncio)", () => {
    const forge = read(PIPELINES[0].file)
    const mirror = read(PIPELINES[1].file)
    expect(forge, "o ci.yml da forja sumiu — a mutação não tem onde operar").not.toBeNull()
    expect(mirror).not.toBeNull()

    const gate = /^\s*run: node scripts\/prove-runner-image-gate\.mjs\s*$/m
    expect(forge, "o passo do gate mudou de forma — atualize a mutação").toMatch(gate)
    const mutated = forge!.replace(gate, "        # mutação: o gate do bring-up foi removido")

    const readFiles = (files: Record<string, string | null>) => (path: string) =>
      files[path] ?? null
    const violations = findParityViolations(
      readFiles({ [PIPELINES[0].file]: mutated, [PIPELINES[1].file]: mirror }),
    )
    expect(violations.join(" | ")).toContain("bring-up-env-gate-proof")
    // E o diagnóstico é ACIONÁVEL: nomeia a pipeline, o papel e o porquê.
    expect(violations.join(" | ")).toContain(PIPELINES[0].file)
    expect(violations.join(" | ")).toContain("dona do merge")
  })

  it("todo gate descoberto no repositório real está classificado", () => {
    const unclassified: string[] = []
    for (const pipeline of PIPELINES) {
      const content = read(pipeline.file)
      if (content === null) continue
      for (const gate of discoverGates(content)) {
        if (classifyGate(gate) === null) unclassified.push(`${pipeline.file}: ${gate}`)
      }
    }
    expect(unclassified).toEqual([])
  })
})
