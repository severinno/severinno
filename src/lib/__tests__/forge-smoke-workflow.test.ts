/**
 * forge-smoke-workflow.test.ts
 *
 * Trava o contrato do smoke test MANUAL da forja
 * (.gitea/workflows/forge-smoke.yml) — o workflow que prova, no RUNTIME do
 * act_runner, as tres premissas de ambiente que nenhum guard estatico enxerga:
 *
 *   1. o contexto `vars` hidrata (repository variable BUN_VERSION);
 *   2. `uses: ./.github/actions/setup-bun` resolve (composite local);
 *   3. o runtime instalado e exatamente o da variable.
 *
 * Valida QUATRO coisas:
 *
 *   1. Estrutura + triggers — YAML parseia (js-yaml) e o snapshot congela a
 *      estrutura. O trigger tem que ser SO `workflow_dispatch`: um job de
 *      dispatch nunca reporta status num PR, entao exigi-lo como required check
 *      travaria todo PR para sempre (mesma invariante travada para o workflow
 *      de drift no required-checks-manifest.test.ts).
 *   2. Nao pode virar required check — assercao contra o manifesto REAL
 *      (ci/required-checks.json): o contexto "Forge Smoke" nao pode aparecer na
 *      lista de jobs exigidos da forja.
 *   3. Fonte unica do Bun — as funcoes do proprio guard (check-bun-mirror.mjs)
 *      rodam sobre o conteudo REAL: env resolvendo de vars.BUN_VERSION, nenhum
 *      literal de versao e o call site do composite passando o input.
 *   4. Auto-prova das provas — os scripts dos passos 1 e 3 sao EXTRAIDOS do YAML
 *      e EXECUTADOS com bash num ambiente controlado (var vazia, `bun` falso no
 *      PATH). Um diagnostico que nunca falhou nao diagnostica nada: se o passo 1
 *      deixar de detectar `vars` vazio, este teste quebra.
 *
 * Uso:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/forge-smoke-workflow.test.ts
 *
 * NOTA: snapshot de estrutura — para REGENERAR apos mudanca INTENCIONAL do
 * workflow: npx vitest run ... -u (o snapshot captura a estrutura parsed, nao o
 * texto bruto; comentarios e formatacao nao o invalidam).
 */

import { describe, it, expect, afterAll } from "vitest"
import { readFileSync, writeFileSync, mkdtempSync, chmodSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import yaml from "js-yaml"
import { resolveBash } from "./helpers/bash-resolver"
import {
  BUN_VERSION_VAR,
  checkNoLiteralBunVersion,
  checkSetupBunCallSites,
  extractEnvVersion,
} from "../../../scripts/check-bun-mirror.mjs"

// js-yaml é dep transitiva SEM @types — a declaração ambiente mínima vive em
// js-yaml.d.ts (mesmo diretório; .d.ts global, não inline, para evitar TS2665).

const CWD = process.cwd()
const FORGE_WF_DIR = join(CWD, ".gitea", "workflows")
const WF_PATH = join(FORGE_WF_DIR, "forge-smoke.yml")

const content = readFileSync(WF_PATH, "utf8")
const parsed = yaml.load(content) as {
  name?: string
  on?: Record<string, unknown>
  env?: Record<string, unknown>
  jobs?: Record<
    string,
    {
      name?: string
      steps?: { name?: string; id?: string; run?: string; uses?: string; if?: string }[]
    }
  >
}

const steps = parsed.jobs?.smoke?.steps ?? []

/** Script `run:` de um passo, pelo `name:` — o contrato do passo é o texto. */
function stepRun(name: string): string {
  const step = steps.find((s) => s.name === name)
  if (!step?.run) throw new Error(`passo '${name}' não encontrado (ou sem run:) no workflow`)
  return step.run
}

/** Diretórios temporários criados pelos testes — limpos no afterAll. */
const tempDirs: string[] = []
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

/**
 * Cria um `bun` FALSO no PATH com a versão pedida. Permite provar a Prova 3 sem
 * depender do runtime real: o script compara `bun --version` com $BUN_VERSION, e
 * é essa comparação (não o Bun em si) que está sob teste.
 */
function fakeBunDir(version: string): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-smoke-bun-"))
  tempDirs.push(dir)
  const bin = join(dir, "bun")
  writeFileSync(bin, `#!/usr/bin/env bash\necho ${version}\n`)
  chmodSync(bin, 0o755)
  return dir
}

/**
 * Caminho ABSOLUTO do bash. Necessário porque um dos testes roda com um PATH
 * sem `bun` (para provar o guard de `command -v`): se o bash em si fosse
 * resolvido pelo PATH, o spawn falharia com ENOENT (status null) antes de o
 * script rodar — e o teste mediria o erro errado.
 */
const BASH_BIN = (() => {
  const resolved = resolveBash()
  if (resolved.includes("/") || resolved.includes("\\")) return resolved
  const out = spawnSync(resolved, ["-c", "command -v bash"], { encoding: "utf8" }).stdout ?? ""
  return out.trim() || resolved
})()

/** Executa o script de um passo com bash e um env controlado. */
function runStep(script: string, env: Record<string, string>) {
  return spawnSync(BASH_BIN, ["-c", script], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  })
}

// ── 1. Estrutura e triggers ──────────────────────────────────────────────

describe("forge-smoke.yml — sintaxe YAML + snapshot", () => {
  it("parseia como YAML válido e casa com o snapshot da estrutura", () => {
    expect(parsed).toMatchSnapshot()
  })

  it("job único 'smoke' com os passos das provas + relatório", () => {
    expect(Object.keys(parsed.jobs ?? {})).toEqual(["smoke"])
    const names = steps.map((s) => s.name)
    expect(names).toContain("Prova 1 — vars.BUN_VERSION resolve")
    expect(names).toContain("Prova 2 — composite local resolve e executa")
    expect(names).toContain("Prova 3 — runtime == vars.BUN_VERSION")
    expect(names).toContain("Prova 4 — install congelado + guard node-puro")
    expect(names).toContain("Report runner toolchain")
  })

  it("trigger: SOMENTE workflow_dispatch (nada de push/pull_request/schedule)", () => {
    // É diagnóstico, não gate: um job que só roda por dispatch nunca reporta
    // status num PR. Se este arquivo passar a rodar em PR, ele vira candidato a
    // required check — e um required check que não roda não falha, ele ESPERA.
    expect(Object.keys(parsed.on ?? {})).toEqual(["workflow_dispatch"])
  })

  it("o relatório roda sempre (if: always()) — senão a falha vem sem contexto", () => {
    const report = steps.find((s) => s.name === "Report runner toolchain")
    expect(report?.if).toBe("always()")
  })
})

// ── 2. Não pode virar required check ─────────────────────────────────────

describe("forge-smoke.yml — não pode ser exigido no merge", () => {
  it("o contexto 'Forge Smoke' não está no manifesto de required checks", () => {
    const manifest = JSON.parse(readFileSync(join(CWD, "ci", "required-checks.json"), "utf8")) as {
      forges?: Record<string, { jobs?: string[] }>
    }
    const required = Object.values(manifest.forges ?? {}).flatMap((f) => f.jobs ?? [])
    expect(required).not.toContain("Forge Smoke")
  })
})

// ── 3. Fonte única do Bun (funções do próprio guard, no arquivo real) ────

describe("forge-smoke.yml — fonte única do Bun", () => {
  it("env.BUN_VERSION referencia a repository variable", () => {
    expect(extractEnvVersion(content)).toBe(BUN_VERSION_VAR)
  })

  it("nenhum literal de versão do Bun no arquivo", () => {
    expect(checkNoLiteralBunVersion(FORGE_WF_DIR)).toEqual([])
  })

  it("o call site do composite passa bun-version (e nenhum oven-sh/setup-bun)", () => {
    expect(checkSetupBunCallSites(FORGE_WF_DIR)).toEqual([])
    expect(content).toContain("uses: ./.github/actions/setup-bun")
    // Só linhas EXECUTÁVEIS importam — o header cita oven-sh/setup-bun em prosa.
    const executable = content
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n")
    expect(executable).not.toContain("oven-sh/setup-bun")
  })
})

// ── 4. Auto-prova: as provas falham de verdade ───────────────────────────

describe("forge-smoke.yml — as provas detectam a falha que anunciam", () => {
  it("Prova 1: falha com vars vazio, apontando a variable, e passa com valor", () => {
    const script = stepRun("Prova 1 — vars.BUN_VERSION resolve")

    const empty = runStep(script, { BUN_VERSION: "" })
    expect(empty.status).toBe(1)
    expect(`${empty.stdout}${empty.stderr}`).toContain("vars.BUN_VERSION chegou VAZIO")

    const ok = runStep(script, { BUN_VERSION: "1.3.14", IMAGE_REGISTRY: "ghcr.io" })
    expect(ok.status).toBe(0)
    expect(ok.stdout).toContain("✅ vars.BUN_VERSION = 1.3.14")
  })

  it("Prova 3: falha com runtime divergente e passa quando bate com a variable", () => {
    const script = stepRun("Prova 3 — runtime == vars.BUN_VERSION")

    const divergent = runStep(script, {
      BUN_VERSION: "1.3.14",
      PATH: `${fakeBunDir("9.9.9")}:${process.env.PATH ?? ""}`,
    })
    expect(divergent.status).toBe(1)
    expect(`${divergent.stdout}${divergent.stderr}`).toContain("runtime divergente")
    expect(`${divergent.stdout}${divergent.stderr}`).toContain("9.9.9")

    const matching = runStep(script, {
      BUN_VERSION: "1.3.14",
      PATH: `${fakeBunDir("1.3.14")}:${process.env.PATH ?? ""}`,
    })
    expect(matching.status).toBe(0)
    expect(matching.stdout).toContain("✅ bun 1.3.14 == vars.BUN_VERSION")
  })

  it("Prova 3: falha quando o bun não está no PATH (setup não concluiu)", () => {
    const script = stepRun("Prova 3 — runtime == vars.BUN_VERSION")
    // PATH sem bun: aponta para um diretório vazio — o guard de `command -v`
    // tem que disparar ANTES da comparação de versão. O bash é invocado pelo
    // caminho absoluto (BASH_BIN) justamente para não depender deste PATH.
    const emptyDir = mkdtempSync(join(tmpdir(), "forge-smoke-nopath-"))
    tempDirs.push(emptyDir)
    const res = runStep(script, { BUN_VERSION: "1.3.14", PATH: emptyDir })
    expect(res.status).toBe(1)
    expect(`${res.stdout}${res.stderr}`).toContain("bun nao esta no PATH")
  })
})
