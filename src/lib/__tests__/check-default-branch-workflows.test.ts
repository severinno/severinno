/**
 * check-default-branch-workflows.test.ts
 *
 * Testes do scripts/check-default-branch-workflows.mjs — o guard que valida
 * que os workflows de MEDIÇÃO de CI (ex.: seed-guards.yml) EXISTEM na branch
 * DEFAULT do repositório, prevenindo o falso estado 'pendente de medição'
 * (o gh run list responde '404: workflow not found on the default branch'
 * quando o workflow NÃO foi mergeado — o bloqueio real é o MERGE, não a
 * falta de run).
 *
 * Cobre (padrão dos testes de guards — funções puras + CLI real):
 *   1. extractDefaultBranch — extrai a branch default do payload de
 *      `gh api repos/X`; null quando ausente/inválida.
 *   2. classifyExistenceCheck — classifica o resultado do gh contents API:
 *      status 0 → exists; status 1 + '404' no stderr → missing; qualquer
 *      outro → { error } (infra fail-closed).
 *   3. CLI real — spawn de `node scripts/check-default-branch-workflows.mjs`
 *      com --fixture-dir (fixtures determinísticos, mesma classe do
 *      --jobs-file do measure-mutation-timing.mjs):
 *      - fixture com workflows presentes → exit 0 + relatório allPresent;
 *      - fixture com workflow AUSENTE → exit 1 (GATE) com a causa raiz
 *        explícita (merge, não falta de run);
 *      - --warn-only com ausente → exit 0 + ::warning::;
 *      - fixture quebrado (default-branch.txt ilegível / .json inválido)
 *        → exit 2 (infra);
 *      - sem argumentos válidos → exit 2 (uso);
 *      - --help → exit 0 com a doc de exit codes;
 *      - --default-branch override evita a chamada gh (usado no CI).
 *
 * Uso:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-default-branch-workflows.test.ts
 */

import { describe, it, expect } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  extractDefaultBranch,
  classifyExistenceCheck,
  DEFAULT_MEASUREMENT_WORKFLOWS,
} from "../../../scripts/check-default-branch-workflows.mjs"

const SCRIPT = join(process.cwd(), "scripts", "check-default-branch-workflows.mjs")

/** Cria um fixture-dir com branch + existência por workflow. */
function writeFixture({
  branch = "release/v0.4.0",
  present = ["seed-guards.yml"],
  broken = null,
}: {
  branch?: string
  present?: string[]
  broken?: "branch" | "json" | null
}) {
  const dir = mkdtempSync(join(tmpdir(), "default-branch-guard-"))
  if (broken === "branch") {
    // default-branch.txt ausente → infra
  } else {
    writeFileSync(join(dir, "default-branch.txt"), branch)
  }
  if (broken === "json") {
    writeFileSync(join(dir, "seed-guards.yml.json"), "não é json")
  } else {
    for (const file of DEFAULT_MEASUREMENT_WORKFLOWS) {
      writeFileSync(join(dir, `${file}.json`), JSON.stringify({ exists: present.includes(file) }))
    }
  }
  return dir
}

function runCli(args: string[]) {
  // stdout E stderr unidos (o erro de uso/infra vai para stderr; o relatório
  // para stdout) — o teste asserta o conteúdo visível independente do canal.
  // GITHUB_REPOSITORY limpo do env: o default de --repo vem da env e um
  // valor herdado tornaria o teste 'sem argumentos' NÃO-determinístico
  // (o script spawnaria gh contra um repo real).
  const env = { ...process.env, GITHUB_REPOSITORY: "" }
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env })
  return { status: res.status ?? -1, stdout: `${res.stdout ?? ""}${res.stderr ?? ""}` }
}

// ── 1. extractDefaultBranch (função pura) ──────────────────────────────

describe("extractDefaultBranch", () => {
  it("extrai a branch default do payload de gh api repos/X", () => {
    expect(extractDefaultBranch({ default_branch: "release/v0.4.0" })).toBe("release/v0.4.0")
    expect(extractDefaultBranch({ default_branch: "main" })).toBe("main")
  })

  it("retorna null quando default_branch ausente, vazio ou shape errado", () => {
    expect(extractDefaultBranch({})).toBeNull()
    expect(extractDefaultBranch({ default_branch: "" })).toBeNull()
    expect(extractDefaultBranch({ default_branch: 42 })).toBeNull()
    expect(extractDefaultBranch(null)).toBeNull()
    expect(extractDefaultBranch(undefined)).toBeNull()
  })
})

// ── 2. classifyExistenceCheck (função pura) ────────────────────────────

describe("classifyExistenceCheck", () => {
  it("status 0 → exists (workflow presente na branch)", () => {
    expect(classifyExistenceCheck(0, "")).toEqual({ exists: true })
  })

  it("status 1 + '404' no stderr → missing (workflow ausente — o gh devolve 404 com exit 1)", () => {
    expect(classifyExistenceCheck(1, "HTTP 404: Not Found")).toEqual({ exists: false })
    expect(classifyExistenceCheck(1, "gh: Not Found (HTTP 404)")).toEqual({ exists: false })
  })

  it("status 1 SEM 404 → infra ({ error } — o mecanismo de verificação quebrou, não é 'ausente')", () => {
    const r = classifyExistenceCheck(1, "gh: rate limit exceeded (HTTP 403)") as { error: string }
    expect(r.error).toBeDefined()
    expect(r.error).toContain("gh api falhou")
  })

  it("status null (spawn falhou) → infra", () => {
    const r = classifyExistenceCheck(null, "") as { error: string }
    expect(r.error).toBeDefined()
    expect(r.error).toContain("gh indisponível")
  })
})

// ── 3. CLI real (spawn com --fixture-dir) ──────────────────────────────

describe("check-default-branch-workflows.mjs CLI", () => {
  it("fixture com todos os workflows presentes → exit 0 e relatório allPresent", () => {
    const dir = writeFixture({})
    try {
      const { status, stdout } = runCli(["--fixture-dir", dir])
      expect(status).toBe(0)
      const report = JSON.parse(stdout)
      expect(report.allPresent).toBe(true)
      expect(report.missing).toEqual([])
      expect(report.defaultBranch).toBe("release/v0.4.0")
      expect(report.workflows).toEqual([{ file: "seed-guards.yml", exists: true }])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("fixture com workflow AUSENTE → exit 1 (GATE) com a causa raiz explícita (MERGE, não falta de run)", () => {
    const dir = writeFixture({ present: [] })
    try {
      const { status, stdout } = runCli(["--fixture-dir", dir])
      expect(status).toBe(1)
      expect(stdout).toContain("AUSENTE")
      expect(stdout).toContain("release/v0.4.0")
      expect(stdout).toContain("seed-guards.yml")
      // A mensagem distingue o bloqueio REAL (workflow não mergeado) do
      // sintoma (404 do gh run list) — é isso que este guard adiciona.
      expect(stdout).toContain("MERGE")
      expect(stdout).toContain("404")
      const report = JSON.parse(stdout.match(/\{[\s\S]*\}/)![0])
      expect(report.allPresent).toBe(false)
      expect(report.missing).toEqual(["seed-guards.yml"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("--warn-only com workflow ausente → exit 0 com ::warning:: (alerta não-bloqueante)", () => {
    const dir = writeFixture({ present: [] })
    try {
      const { status, stdout } = runCli(["--fixture-dir", dir, "--warn-only"])
      expect(status).toBe(0)
      expect(stdout).toContain("::warning::")
      const report = JSON.parse(stdout.replace(/^::warning::.*\n/, ""))
      expect(report.allPresent).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("--default-branch override é aceito sem fixture-branch (usado no CI — evita a chamada gh)", () => {
    const dir = mkdtempSync(join(tmpdir(), "default-branch-guard-br-"))
    try {
      // Sem default-branch.txt no fixture: o --default-branch substitui.
      writeFileSync(join(dir, "seed-guards.yml.json"), JSON.stringify({ exists: true }))
      const { status, stdout } = runCli(["--fixture-dir", dir, "--default-branch", "main"])
      expect(status).toBe(0)
      const report = JSON.parse(stdout)
      expect(report.defaultBranch).toBe("main")
      expect(report.allPresent).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("--workflow repetível valida múltiplos alvos (ex.: seed-guards + e2e-cache)", () => {
    const dir = mkdtempSync(join(tmpdir(), "default-branch-guard-multi-"))
    try {
      writeFileSync(join(dir, "default-branch.txt"), "main")
      writeFileSync(join(dir, "seed-guards.yml.json"), JSON.stringify({ exists: true }))
      writeFileSync(join(dir, "e2e-cache.yml.json"), JSON.stringify({ exists: false }))
      const { status, stdout } = runCli([
        "--fixture-dir",
        dir,
        "--workflow",
        "seed-guards.yml",
        "--workflow",
        "e2e-cache.yml",
      ])
      expect(status).toBe(1)
      const report = JSON.parse(stdout.match(/\{[\s\S]*\}/)![0])
      expect(report.missing).toEqual(["e2e-cache.yml"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("fixture sem default-branch.txt → exit 2 (infra — mecanismo de verificação quebrou)", () => {
    const dir = writeFixture({ broken: "branch" })
    try {
      const { status, stdout } = runCli(["--fixture-dir", dir])
      expect(status).toBe(2)
      expect(stdout).toContain("infra")
      expect(stdout).toContain("default-branch.txt")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("fixture com .json inválido → exit 2 (infra)", () => {
    const dir = writeFixture({ broken: "json" })
    try {
      const { status, stdout } = runCli(["--fixture-dir", dir])
      expect(status).toBe(2)
      expect(stdout).toContain("infra")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("sem argumentos → exit 2 (uso inválido — sem repo nem fixture o script NÃO spawna gh)", () => {
    const { status, stdout } = runCli([])
    expect(status).toBe(2)
    expect(stdout).toContain("exija --repo (ou GITHUB_REPOSITORY env) OU --fixture-dir")
  })

  it("--help → exit 0 e documenta os 3 exit codes", () => {
    const { status, stdout } = runCli(["--help"])
    expect(status).toBe(0)
    expect(stdout).toContain("Exit codes:")
    expect(stdout).toContain("0 — todos os workflows de medição existem")
    expect(stdout).toContain("1 — pelo menos um workflow ausente")
    expect(stdout).toContain("2 — falha de infra")
  })

  it("--json salva o relatório em arquivo além do stdout", () => {
    const dir = writeFixture({})
    const outFile = join(dir, "report.json")
    try {
      const { status, stdout } = runCli(["--fixture-dir", dir, "--json", outFile])
      expect(status).toBe(0)
      const saved = JSON.parse(readFileSync(outFile, "utf8"))
      expect(saved.allPresent).toBe(true)
      expect(JSON.parse(stdout)).toEqual(saved)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("--workflow com valor que não é .yml → exit 2 (uso inválido)", () => {
    const { status, stdout } = runCli(["--workflow", "seed-guards.txt"])
    expect(status).toBe(2)
    expect(stdout).toContain("--workflow deve ser um arquivo .yml")
  })
})
