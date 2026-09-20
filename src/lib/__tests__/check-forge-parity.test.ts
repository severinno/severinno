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

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  CORE_INVARIANTS,
  GITHUB_ONLY,
  PIPELINES,
  canonicalCommandOf,
  classifyGate,
  defaultReadFile,
  discoverGates,
  executableLines,
  executedCommands,
  findParityViolations,
  missingInvariants,
  runCommands,
} from "../../../scripts/check-forge-parity.mjs"

/**
 * Linhas com o COMANDO CANÔNICO de cada invariante do CORE (uma por invariante).
 * Lista-golden: quando o CORE ganha um invariante, o teste falha até a linha
 * correspondente aparecer aqui — o mesmo contrato do required-checks.
 *
 * As linhas são o `command` do invariante, e são as MESMAS nas duas forjas —
 * não existe mais uma variante por lado (`bunx tsc --noEmit` aqui, `bun run
 * typecheck` ali; `test:unit` numa e `test:run` na outra).
 */
const REAL_LINES = [
  "      - run: bun run typecheck",
  "      - run: bun run lint",
  "      - run: bun run test:run",
  "      - run: bun run check:ts-nocheck",
  "      - run: bun run check:pii-allowlist",
  "      - run: bun run check:pii-gate",
  "      - run: node scripts/check-required-checks.mjs",
  "      - run: node scripts/check-script-headers.mjs",
  "      - run: node scripts/check-pipefail-sigpipe.mjs",
  "      - run: node scripts/check-prove-docs.mjs",
  "      - run: node scripts/check-registry-source.mjs",
  "      - run: node scripts/check-mirror-coverage.mjs",
  "      - run: node scripts/check-github-dependencies.mjs",
  "      - run: node scripts/check-runner-base.mjs",
  "      - run: node scripts/check-workflow-refs.mjs --pkg-internal",
  "      - run: node scripts/check-forge-workflow-scope.mjs",
  "      - run: node scripts/check-bun-audit-baseline.mjs",
  "      - run: node scripts/rotate-secrets.mjs --check",
  "      - run: node scripts/check-seed-hooks.mjs",
  "      - run: node scripts/check-sentinel-producer.mjs",
  "      - run: node scripts/check-bun-mirror.mjs",
  "      - run: node scripts/check-no-setup-bun.mjs",
  "      - run: node scripts/check-forge-parity.mjs",
  "      - run: node scripts/check-hooks-symmetry.mjs",
  "      - run: node scripts/check-hook-ci-parity.mjs",
  "      - run: node scripts/check-hook-commands.mjs",
  "      - run: node scripts/check-job-deps.mjs",
  "      - run: node scripts/check-workflow-run-syntax.mjs",
  "      - run: node scripts/check-doctor-ci.mjs",
  "      - run: node scripts/prove-runner-image-gate.mjs",
  "      - run: node scripts/prove-pre-commit-in-runner.mjs",
  "      - run: node scripts/merge-latency.mjs --check",
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

describe("o comando canônico de cada invariante", () => {
  it("toda invariante do CORE declara um `command` ancorado nas duas pontas", () => {
    // Contrato de manutenção: uma invariante nova sem `command` cairia em
    // `undefined.test` no meio do guard; sem a âncora, uma linha que apenas
    // CONTÉM o comando (um `echo` que o cita, um comentário promovido a passo)
    // passaria por ele — e a régua voltaria a ser aproximada.
    for (const inv of CORE_INVARIANTS) {
      expect(inv.command, `invariante '${inv.id}' sem command`).toBeInstanceOf(RegExp)
      expect(inv.command.source.startsWith("^"), `'${inv.id}': command sem ^`).toBe(true)
      expect(inv.command.source.endsWith("$"), `'${inv.id}': command sem $`).toBe(true)
    }
  })

  it("a forma impressa é a linha de `run:`, não o `source` do regex", () => {
    const inv = CORE_INVARIANTS.find((i) => i.id === "registry-source")!
    expect(canonicalCommandOf(inv)).toBe("node scripts/check-registry-source.mjs")
  })

  it("cada `command` casa EXATAMENTE uma linha da lista-golden (sem sobra)", () => {
    const commands = runCommands(REALISTIC)
    for (const inv of CORE_INVARIANTS) {
      const hits = commands.filter((c) => inv.command.test(c))
      expect(hits, `'${inv.id}' casou ${hits.length} comandos`).toHaveLength(1)
    }
  })
})

describe("missingInvariants", () => {
  it("reconhece os comandos canônicos das duas forjas", () => {
    expect(missingInvariants(REALISTIC)).toEqual([])
  })

  it("recusa a invocação INDIRETA e a com argumentos diferentes (a régua é o COMANDO)", () => {
    // Três formas do MESMO gate, e só a canônica conta:
    //   - pela entrada do package.json: o guard não pode comparar a entrada com
    //     o comando (isso exigiria ler o package.json e interpretar a entrada);
    //   - pelo script SEM o argumento que o canônico carrega: é o caso que
    //     liberava o merge com uma régua mais fraca;
    //   - pelo script COM o argumento: presente.
    //
    // Os fixtures são PASSOS de verdade (`- run: ...`): a régua da presença é o
    // que EXECUTA, e um passo é um item de lista do YAML — uma linha `run:`
    // solta não é um passo e o guard diria "ausente" por não haver passo algum.
    expect(missingInvariants("      - run: bun run check:workflow-refs:internal")).toContain(
      "workflow-refs",
    )
    expect(missingInvariants("      - run: node scripts/check-workflow-refs.mjs")).toContain(
      "workflow-refs",
    )
    expect(
      missingInvariants("      - run: node scripts/check-workflow-refs.mjs --pkg-internal"),
    ).not.toContain("workflow-refs")
  })

  it("o gate invocado DENTRO de `run: |` roda: a presença não depende da forma do passo", () => {
    // A divergência que a régua única fechou: `discoverGates` (rótulo) lia o
    // corpo do bloco e `runCommands` (comando) não — o MESMO arquivo dava dois
    // vereditos, e a invariante invocada só dentro de um bloco saía como
    // AUSENTE (violação falsa) enquanto o rótulo dela já estava classificado.
    const bloco = [
      "    steps:",
      "      - name: tiers",
      "        run: |",
      "          bun run typecheck",
      "          node scripts/check-registry-source.mjs",
      "",
      "      - run: node scripts/check-required-checks.mjs",
    ].join("\n")
    expect(runCommands(bloco)).toEqual(["node scripts/check-required-checks.mjs"])
    expect(executedCommands(bloco)).toEqual([
      "bun run typecheck",
      "node scripts/check-registry-source.mjs",
      "node scripts/check-required-checks.mjs",
    ])
    // O comando canônico executado no bloco SATISFAZ a invariante.
    expect(missingInvariants(bloco)).not.toContain("registry-source")
    expect(missingInvariants(bloco)).not.toContain("typecheck")
  })

  it("não confunde a CITAÇÃO do comando com a execução dele", () => {
    // Um `echo` que cita a linha canônica é uma linha de `run:` que NÃO executa
    // o gate — a âncora em `run:` mantém a citação fora da medição.
    const quoted = `      - run: echo "rode: node scripts/check-registry-source.mjs"`
    expect(missingInvariants(quoted)).toContain("registry-source")
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

// ─────────────────────────────────────────────────────────────────────────────
// `defaults: run:` NÃO é passo — a declaração de shell default não pode
// satisfazer uma invariante
//
// A invariante do CORE é medida pelo COMANDO canônico na linha de `run:`. Um
// scanner que lê qualquer `run:` do arquivo aceitava a DECLARAÇÃO de shell como
// o gate: `defaults:\n  run: node scripts/check-workflow-refs.mjs
// --pkg-internal` dizia que a pipeline rodava o guard de refs sem rodar nada, e
// a forma escalar fabricava o comando literal `bash`.
// ─────────────────────────────────────────────────────────────────────────────

describe("a declaração `defaults: run:` não é passo (o gate não pode ser forjado)", () => {
  const FORJADO = [
    "name: x",
    "on: [push]",
    "defaults:",
    "  run: node scripts/check-workflow-refs.mjs --pkg-internal",
    "jobs:",
    "  guardas:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo nada",
  ].join("\n")

  it("`runCommands` não devolve o comando da declaração", () => {
    expect(runCommands(FORJADO)).toEqual(["echo nada"])
  })

  it("`discoverGates` não descobre o gate da declaração", () => {
    expect(discoverGates(FORJADO)).toEqual([])
  })

  it("a declaração NÃO satisfaz a invariante do CORE (ela não roda)", () => {
    expect(missingInvariants(FORJADO)).toContain("workflow-refs")
  })

  it("a forma escalar (`defaults:\n  run: bash`) não vira o comando literal `bash`", () => {
    const wf = "defaults:\n  run: bash\njobs:\n  a:\n    steps:\n      - run: echo ok\n"
    expect(runCommands(wf)).toEqual(["echo ok"])
  })

  it("o `defaults:` do JOB também é declaração, não passo", () => {
    const wf = [
      "jobs:",
      "  a:",
      "    runs-on: ubuntu-latest",
      "    defaults:",
      "      run: node scripts/check-x-y-z.mjs",
      "    steps:",
      "      - run: echo ok",
    ].join("\n")
    expect(runCommands(wf)).toEqual(["echo ok"])
    expect(discoverGates(wf)).toEqual([])
  })
})

// ── a leitura da pipeline DECLARADA: ausente × não julgável ─────────────────
//
// A paridade não varre o diretório: ela lê os arquivos que PIPELINES declara. Os
// dois desfechos de "não li" têm de ser DISTINTOS — uma pipeline que existe e
// não abre não é uma forja removida, e um `null` para os dois faria o
// diagnóstico mandar procurar um arquivo que está lá.

describe("`defaultReadFile` — lido, AUSENTE ou NÃO JULGÁVEL (nunca os três como um)", () => {
  const tmpDirs: string[] = []
  afterAll(() => {
    for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function raiz(conteudo: string | Buffer): string {
    const root = mkdtempSync(join(tmpdir(), "parity-read-"))
    tmpDirs.push(root)
    mkdirSync(join(root, ".gitea", "workflows"), { recursive: true })
    writeFileSync(join(root, ".gitea", "workflows", "ci.yml"), conteudo)
    return root
  }

  it("arquivo ausente → `null` (o contrato antigo, que vira violação NOMEADA)", () => {
    const root = mkdtempSync(join(tmpdir(), "parity-vazio-"))
    tmpDirs.push(root)
    const unjudgeable: { path: string; motivo: string }[] = []
    expect(defaultReadFile(root, unjudgeable)(".gitea/workflows/ci.yml")).toBeNull()
    // Ausência NÃO é "não julgável": não há arquivo a julgar, e o chamador tem
    // a mensagem própria para esse caso.
    expect(unjudgeable).toEqual([])
  })

  it("não é UTF-8 ou não é YAML → NOMEADO, e a leitura devolve null", () => {
    const casos: [string, string | Buffer][] = [
      [
        "não é UTF-8",
        Buffer.concat([Buffer.from("on:\n  push:\njobs:\n"), Buffer.from([0xff, 0xfe])]),
      ],
      ["YAML inválido", ["on:", "  push:", "jobs:", "\ta:", ""].join("\n")],
    ]
    for (const [nome, conteudo] of casos) {
      const unjudgeable: { path: string; motivo: string }[] = []
      const ler = defaultReadFile(raiz(conteudo), unjudgeable)
      expect(ler(".gitea/workflows/ci.yml"), nome).toBeNull()
      expect(
        unjudgeable.map((u) => u.path),
        nome,
      ).toEqual([".gitea/workflows/ci.yml"])
      expect(unjudgeable[0]!.motivo, nome).toMatch(/UTF-8|YAML/)
    }
  })

  it("arquivo válido → o texto (a sonda não inventa recusa)", () => {
    const unjudgeable: { path: string; motivo: string }[] = []
    const conteudo = "on:\n  push:\njobs:\n  a:\n    steps:\n      - run: echo ok\n"
    expect(defaultReadFile(raiz(conteudo), unjudgeable)(".gitea/workflows/ci.yml")).toBe(conteudo)
    expect(unjudgeable).toEqual([])
  })
})
