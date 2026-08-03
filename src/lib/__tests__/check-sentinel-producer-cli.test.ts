/**
 * check-sentinel-producer-cli.test.ts
 *
 * Teste de INTEGRAÇÃO do main() do guard scripts/check-sentinel-producer.mjs:
 * spawna a CLI REAL (process.execPath — robusto no Windows) contra um repo
 * TEMPORÁRIO (fixture .github/workflows + scripts/), validando o CONTRATO DE
 * EXIT CODES do guard generalizado produtor↔sentinel:
 *
 *   exit 0 — sentinel grep -Fq com produtor emitindo a string (cadeia
 *            .sh→.py resolvida) OU produtor inline no próprio workflow
 *   exit 1 — sentinel ausente do produtor (frase reformulada) com mensagem
 *            apontando workflow:linha, sentinel e o produtor
 *   exit 1 — produtor não resolvível (sem script nem inline) — fail-closed
 *   exit 1 — múltiplos sentinels, um sem produtor (falha lista TODOS)
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/check-sentinel-producer-cli.test.ts
 */

import { describe, it, expect, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

const SCRIPT = resolve(process.cwd(), "scripts/check-sentinel-producer.mjs")
const tmpDirs: string[] = []

/** Cria um repo fixture em disco com os arquivos dados (rel → content). */
function makeRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "csp-cli-"))
  tmpDirs.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(dirname(abs), { recursive: true }) // dirs aninhados (.github/workflows)
    writeFileSync(abs, content, "utf8")
  }
  return dir
}

/** Roda a CLI real com cwd=<dir> e retorna {status, stdout, stderr}. */
function runCli(dir: string): { status: number; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: "utf8" })
  return { status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" }
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("check-sentinel-producer.mjs CLI (main)", () => {
  it("exit 0 — sentinel com produtor .sh→.py resolvido (cadeia delegada)", () => {
    const dir = makeRepo({
      ".github/workflows/wf.yml": [
        "jobs:",
        "  x:",
        "    steps:",
        "      - run: |",
        "          bash scripts/audit-blob-crlf-history.sh --all-text | tee all-text-report.txt",
        "          if grep -Fq 'com CRLF' all-text-report.txt; then",
        "            echo found",
        "          fi",
      ].join("\n"),
      "scripts/audit-blob-crlf-history.sh":
        'PY_SCRIPT="$SCRIPT_DIR/audit_blob_crlf_history.py"\nexec "$PY" "$PY_SCRIPT"',
      "scripts/audit_blob_crlf_history.py": 'print("bloco(s) com CRLF no histórico")',
    })
    const res = runCli(dir)
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("✅")
  })

  it("exit 1 — sentinel ausente do produtor, com workflow:linha + sentinel + produtor", () => {
    const dir = makeRepo({
      ".github/workflows/wf.yml": [
        "jobs:",
        "  x:",
        "    steps:",
        "      - run: |",
        "          bash scripts/audit-blob-crlf-history.sh --all-text | tee all-text-report.txt",
        "          if grep -Fq 'com CRLF' all-text-report.txt; then",
        "            echo found",
        "          fi",
      ].join("\n"),
      "scripts/audit-blob-crlf-history.sh":
        'PY_SCRIPT="$SCRIPT_DIR/audit_blob_crlf_history.py"\nexec "$PY" "$PY_SCRIPT"',
      "scripts/audit_blob_crlf_history.py": 'print("blocos afetados no histórico")', // sentinel SUMIU
    })
    const res = runCli(dir)
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("wf.yml:6")
    expect(res.stderr).toContain("'com CRLF'")
    expect(res.stderr).toContain("audit_blob_crlf_history.py")
    expect(res.stderr).toContain("sentinel ausente do produtor")
  })

  it("exit 1 — produtor não resolvível (sem script nem inline) — fail-closed", () => {
    const dir = makeRepo({
      ".github/workflows/wf.yml": [
        "jobs:",
        "  x:",
        "    steps:",
        "      - run: |",
        "          cat algo.txt > report.txt",
        "          if grep -Fq 'com CRLF' report.txt; then",
        "            echo found",
        "          fi",
      ].join("\n"),
    })
    const res = runCli(dir)
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("produtor não resolvível")
  })

  it("exit 0 — produtor inline no workflow (echo 'S' > file + grep do mesmo)", () => {
    const dir = makeRepo({
      ".github/workflows/wf.yml": [
        "jobs:",
        "  x:",
        "    steps:",
        "      - run: |",
        "          echo 'achado fantasma' > report.txt",
        "          if grep -Fq 'achado fantasma' report.txt; then",
        "            echo found",
        "          fi",
      ].join("\n"),
    })
    const res = runCli(dir)
    expect(res.status).toBe(0)
  })

  it("exit 0 — script produtor SEM o sentinel + echo inline na MESMA produção satisfaz (3a)", () => {
    const dir = makeRepo({
      ".github/workflows/wf.yml": [
        "jobs:",
        "  x:",
        "    steps:",
        "      - run: |",
        "          bash scripts/ok.sh > report.txt",
        "          echo 'achado fantasma' >> report.txt",
        "          if grep -Fq 'achado fantasma' report.txt; then",
        "            echo found",
        "          fi",
      ].join("\n"),
      "scripts/ok.sh": 'echo "outro texto"', // script NÃO emite o sentinel
    })
    const res = runCli(dir)
    expect(res.status).toBe(0)
  })

  it("exit 1 — script produtor SEM sentinel + linha com script QUE PASSA o sentinel como ARGUMENTO (não é produtor inline)", () => {
    const dir = makeRepo({
      ".github/workflows/wf.yml": [
        "jobs:",
        "  x:",
        "    steps:",
        "      - run: |",
        "          bash scripts/ok.sh 'achado fantasma' > report.txt",
        "          if grep -Fq 'achado fantasma' report.txt; then",
        "            echo found",
        "          fi",
      ].join("\n"),
      "scripts/ok.sh": 'echo "$1"', // o arg é ecoado, mas o guard não pode provar — fail-closed
    })
    const res = runCli(dir)
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("'achado fantasma'")
  })

  it("exit 1 — múltiplos sentinels: um válido + um cego → falha lista o cego (e só ele)", () => {
    const dir = makeRepo({
      ".github/workflows/wf.yml": [
        "jobs:",
        "  x:",
        "    steps:",
        "      - run: |",
        "          bash scripts/ok.sh | tee ok.txt",
        "          if grep -Fq 'emitido' ok.txt; then",
        "            echo ok",
        "          fi",
        "          cat in.txt > cego.txt",
        "          if grep -Fq 'fantasma' cego.txt; then",
        "            echo fantasma",
        "          fi",
      ].join("\n"),
      "scripts/ok.sh": 'echo "emitido aqui"',
    })
    const res = runCli(dir)
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("'fantasma'")
    expect(res.stderr).not.toContain("'emitido'")
    expect(res.stderr).toContain("1 sentinel(s)")
  })

  it("exit 0 — sem workflows (repo vazio) é trivialmente pass", () => {
    const dir = makeRepo({})
    const res = runCli(dir)
    expect(res.status).toBe(0)
  })
})
