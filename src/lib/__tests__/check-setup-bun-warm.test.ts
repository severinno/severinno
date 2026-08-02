/**
 * check-setup-bun-warm.test.ts
 *
 * Testes do guard PERIÓDICO do tier-2 do setup-bun
 * (scripts/check-setup-bun-warm.mjs) — rede de segurança contra a regressão
 * silenciosa do cache REAL do GitHub (warm cache que volta a baixar o
 * release no tier-3).
 *
 * O job `setup-bun-warm` do benchmark-weekly.yml roda `bench-setup-bun.sh`
 * (cold→warm) e salva o JSON de medição; este guard lê o JSON e falha se o
 * run WARM (último do array) exceder o limiar (default 10s, esperado ~1-2s).
 *
 * Cobre:
 *   - extractWarmRun (run warm = último do array; null sem 2+ runs)
 *   - checkWarmCache (dentro do limiar = PASS; acima = violação; warm run
 *     com conclusion != success = violação)
 *   - CLI (--json/--max, exit 0/1/2, JSON malformado, arquivo ausente)
 *
 * Sem rede: as funções recebem o objeto JSON diretamente; os testes CLI
 * usam spawnSync com arquivos temporários.
 */

import { describe, it, expect, afterAll } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  DEFAULT_WARM_MAX_S,
  extractWarmRun,
  checkWarmCache,
} from "../../../scripts/check-setup-bun-warm.mjs"

// Caminho do módulo para os testes CLI (spawn do node). Usa process.cwd()
// (raiz do projeto no vitest) — NÃO usar fileURLToPath(new URL(...)): o
// import.meta.url do vitest não tem scheme file.
const MODULE_PATH = join(process.cwd(), "scripts", "check-setup-bun-warm.mjs")

const tmpDirs: string[] = []

function makeTmpFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "check-warm-"))
  tmpDirs.push(dir)
  const p = join(dir, "bench.json")
  writeFileSync(p, content)
  return p
}

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ── fixtures (shape do --json do bench-setup-bun.sh) ───────────────────────

const COLD_WARM_OK = {
  repo: "owner/repo",
  ref: "main",
  bun_version: "1.3.14",
  measured: "2026-08",
  runs: [
    {
      run: 1,
      duration_s: 9.8,
      tier: "tier-3 (cold download)",
      conclusion: "success",
      run_id: "111",
    },
    {
      run: 2,
      duration_s: 1.25,
      tier: "tier-2 (cache hit)",
      conclusion: "success",
      run_id: "222",
    },
  ],
}

const COLD_WARM_SLOW = {
  ...COLD_WARM_OK,
  runs: [COLD_WARM_OK.runs[0], { ...COLD_WARM_OK.runs[1], duration_s: 12.4 }],
}

const COLD_WARM_FAILED = {
  ...COLD_WARM_OK,
  runs: [COLD_WARM_OK.runs[0], { ...COLD_WARM_OK.runs[1], conclusion: "failure", run_id: "999" }],
}

const SINGLE_RUN = {
  ...COLD_WARM_OK,
  runs: [COLD_WARM_OK.runs[0]],
}

// ── DEFAULT_WARM_MAX_S ────────────────────────────────────────────────────

describe("DEFAULT_WARM_MAX_S", () => {
  it("é 10s (limiar padrão do warm cache)", () => {
    expect(DEFAULT_WARM_MAX_S).toBe(10)
  })
})

// ── extractWarmRun ────────────────────────────────────────────────────────

describe("extractWarmRun", () => {
  it("retorna o ÚLTIMO run do array (o warm do ciclo cold→warm)", () => {
    const warm = extractWarmRun(COLD_WARM_OK)
    expect(warm).not.toBeNull()
    expect(warm!.run).toBe(2)
    expect(warm!.duration_s).toBe(1.25)
  })

  it("retorna null se o JSON não tiver array runs", () => {
    expect(extractWarmRun(null)).toBeNull()
    expect(extractWarmRun(undefined)).toBeNull()
    expect(extractWarmRun({})).toBeNull()
  })

  it("retorna null se houver menos de 2 runs (sem ciclo cold→warm completo)", () => {
    expect(extractWarmRun(SINGLE_RUN)).toBeNull()
  })

  it("retorna null se o último run não tiver duration_s numérica", () => {
    const data = {
      runs: [
        COLD_WARM_OK.runs[0],
        { run: 2, duration_s: "N/A", tier: "?", conclusion: "success", run_id: "x" },
      ],
    }
    expect(extractWarmRun(data)).toBeNull()
  })
})

// ── checkWarmCache ────────────────────────────────────────────────────────

describe("checkWarmCache", () => {
  it("warm cache dentro do limiar (1.25s <= 10s) → zero violações (PASS)", () => {
    expect(checkWarmCache(COLD_WARM_OK)).toEqual([])
  })

  it("warm cache acima do limiar (12.4s > 10s) → violação apontando o número e o limiar", () => {
    const v = checkWarmCache(COLD_WARM_SLOW)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("12.4")
    expect(v[0]).toContain("10s")
    expect(v[0]).toContain("regressão do tier-2")
  })

  it("respeita --max customizado (max=5: 1.25s passa, 12.4s falha)", () => {
    expect(checkWarmCache(COLD_WARM_OK, 5)).toEqual([])
    expect(checkWarmCache(COLD_WARM_SLOW, 5).length).toBe(1)
  })

  it("warm run com conclusion != success → violação (mesmo dentro do limiar)", () => {
    const v = checkWarmCache(COLD_WARM_FAILED)
    expect(v.length).toBe(1)
    expect(v[0]).toContain("failure")
    expect(v[0]).toContain("não concluiu com success")
  })

  it("sem run warm válido (1 run, null, objeto vazio) → violação fail-closed", () => {
    expect(checkWarmCache(SINGLE_RUN).length).toBe(1)
    expect(checkWarmCache(null).length).toBe(1)
    expect(checkWarmCache({}).length).toBe(1)
  })
})

// ── modo CLI (spawn do módulo, sem rede) ───────────────────────────────────

describe("modo CLI (spawn do módulo)", () => {
  it("JSON com warm dentro do limiar → exit 0 e mensagem de PASS", () => {
    const p = makeTmpFile(JSON.stringify(COLD_WARM_OK))
    const res = spawnSync(process.execPath, [MODULE_PATH, "--json", p], { encoding: "utf8" })
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("✅ warm cache 1.25s <= 10s")
  })

  it("JSON com warm acima do limiar → exit 1 e violação em stderr", () => {
    const p = makeTmpFile(JSON.stringify(COLD_WARM_SLOW))
    const res = spawnSync(process.execPath, [MODULE_PATH, "--json", p], { encoding: "utf8" })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain("regressão do tier-2")
    expect(res.stderr).toContain("12.4")
  })

  it("--max customizado no CLI (max=2: 1.25s passa, 12.4s falha)", () => {
    const ok = makeTmpFile(JSON.stringify(COLD_WARM_OK))
    expect(
      spawnSync(process.execPath, [MODULE_PATH, "--json", ok, "--max", "2"], {
        encoding: "utf8",
      }).status,
    ).toBe(0)

    const slow = makeTmpFile(JSON.stringify(COLD_WARM_SLOW))
    const res = spawnSync(process.execPath, [MODULE_PATH, "--json", slow, "--max", "2"], {
      encoding: "utf8",
    })
    expect(res.status).toBe(1)
  })

  it("sem --json → exit 2 com mensagem de uso", () => {
    const res = spawnSync(process.execPath, [MODULE_PATH], { encoding: "utf8" })
    expect(res.status).toBe(2)
    expect(res.stderr).toContain("--json")
  })

  it("arquivo inexistente → exit 2", () => {
    const res = spawnSync(process.execPath, [MODULE_PATH, "--json", "/nope/bench.json"], {
      encoding: "utf8",
    })
    expect(res.status).toBe(2)
    expect(res.stderr).toContain("não encontrado")
  })

  it("JSON malformado → exit 2 com mensagem clara", () => {
    const p = makeTmpFile("{não é json")
    const res = spawnSync(process.execPath, [MODULE_PATH, "--json", p], { encoding: "utf8" })
    expect(res.status).toBe(2)
    expect(res.stderr).toContain("JSON inválido")
  })
})
