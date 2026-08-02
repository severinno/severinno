/**
 * check-actrc-sync.test.ts
 *
 * Testes do guard PERIÓDICO do espelho local do act (.actrc) vs a repository
 * variable BUN_VERSION do GitHub (scripts/check-actrc-sync.mjs).
 *
 * O guard estático scripts/check-bun-mirror.mjs valida que o .actrc DEFINE
 * BUN_VERSION (existe a linha `--var BUN_VERSION=...`), mas NÃO pode conferir
 * se o VALOR bate com a variável do GitHub — impossível estaticamente (a
 * variável remota só existe em runtime no Actions). Este guard compara os
 * DOIS e emite `::warning::` (NÃO-bloqueante) se divergirem: o job semanal
 * `actrc-sync` do benchmark-weekly.yml passa o valor real de vars.BUN_VERSION
 * via --expected e o script lê o .actrc do working tree.
 *
 * Cobre:
 *   - extractActrcBunVersion (linha --var BUN_VERSION=, aspas, comentário,
 *     ausente)
 *   - actrcSyncWarnings (em sincronia = zero avisos; divergência = aviso com
 *     ambos os valores; .actrc sem BUN_VERSION = aviso fail-closed)
 *   - CLI (--expected/--actrc/--fail, exit 0 aviso / 1 fail / 2 uso inválido)
 *
 * Sem rede: as funções recebem o conteúdo diretamente; os testes CLI usam
 * spawnSync com arquivos temporários.
 */

import { describe, it, expect, afterAll } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { extractActrcBunVersion, actrcSyncWarnings } from "../../../scripts/check-actrc-sync.mjs"

// Caminho do módulo para os testes CLI (spawn do node). Usa process.cwd()
// (raiz do projeto no vitest) — NÃO usar fileURLToPath(new URL(...)): o
// import.meta.url do vitest não tem scheme file.
const MODULE_PATH = join(process.cwd(), "scripts", "check-actrc-sync.mjs")

const tmpDirs: string[] = []

function makeTmpActrc(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "check-actrc-sync-"))
  tmpDirs.push(dir)
  const p = join(dir, ".actrc")
  writeFileSync(p, content)
  return p
}

afterAll(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ── fixtures (.actrc) ─────────────────────────────────────────────────────

const ACTRC_1_3_14 = `# .actrc — espelho local da repository variable
--var BUN_VERSION=1.3.14
`

const ACTRC_1_4_0 = `# .actrc — espelho local da repository variable
--var BUN_VERSION=1.4.0
`

const ACTRC_QUOTED = `--var BUN_VERSION="1.3.14"
`

const ACTRC_WITHOUT_BUN = `# .actrc sem a linha BUN_VERSION
--var OTHER=foo
`

const ACTRC_EMPTY = ``

// Comentário que CONTÉM o padrão --var BUN_VERSION= ANTES da linha real — a
// regex ancorada ao início da linha não pode ser enganada pelo comentário.
const ACTRC_COMMENT_DECOY = `# exemplo: --var BUN_VERSION=2.0 (desatualizado)
--var BUN_VERSION=1.3.14
`

// ── extractActrcBunVersion ────────────────────────────────────────────────

describe("extractActrcBunVersion", () => {
  it("extrai o valor de '--var BUN_VERSION=1.3.14'", () => {
    expect(extractActrcBunVersion(ACTRC_1_3_14)).toBe("1.3.14")
  })

  it("tolera aspas em volta do valor", () => {
    expect(extractActrcBunVersion(ACTRC_QUOTED)).toBe("1.3.14")
  })

  it("ignora comentário que CONTÉM o padrão antes da linha real (regex ancorada)", () => {
    expect(extractActrcBunVersion(ACTRC_COMMENT_DECOY)).toBe("1.3.14")
  })

  it("retorna null se o .actrc não definir BUN_VERSION", () => {
    expect(extractActrcBunVersion(ACTRC_WITHOUT_BUN)).toBeNull()
    expect(extractActrcBunVersion(ACTRC_EMPTY)).toBeNull()
  })
})

// ── actrcSyncWarnings ─────────────────────────────────────────────────────

describe("actrcSyncWarnings", () => {
  it("em sincronia (.actrc == vars.BUN_VERSION) → zero avisos", () => {
    expect(actrcSyncWarnings("1.3.14", "1.3.14")).toEqual([])
  })

  it("divergência → aviso com AMBOS os valores (actrc vs vars.BUN_VERSION)", () => {
    const w = actrcSyncWarnings("1.4.0", "1.3.14")
    expect(w.length).toBe(1)
    expect(w[0]).toContain("1.4.0")
    expect(w[0]).toContain("1.3.14")
    expect(w[0]).toContain("vars.BUN_VERSION")
  })

  it(".actrc sem BUN_VERSION (null) → aviso fail-closed com o valor esperado", () => {
    const w = actrcSyncWarnings(null, "1.3.14")
    expect(w.length).toBe(1)
    expect(w[0]).toContain("NÃO define BUN_VERSION")
    expect(w[0]).toContain("1.3.14")
  })
})

// ── modo CLI (spawn do módulo, sem rede) ───────────────────────────────────

describe("modo CLI (spawn do módulo)", () => {
  it("em sincronia → exit 0 e mensagem de PASS", () => {
    const p = makeTmpActrc(ACTRC_1_3_14)
    const res = spawnSync(process.execPath, [MODULE_PATH, "--expected", "1.3.14", "--actrc", p], {
      encoding: "utf8",
    })
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("✅ .actrc em sincronia")
    expect(res.stdout).not.toContain("::warning::")
  })

  it("divergência → exit 0 (aviso NÃO-bloqueante) com ::warning:: e ambos os valores", () => {
    const p = makeTmpActrc(ACTRC_1_4_0)
    const res = spawnSync(process.execPath, [MODULE_PATH, "--expected", "1.3.14", "--actrc", p], {
      encoding: "utf8",
    })
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("::warning::")
    expect(res.stdout).toContain("1.4.0")
    expect(res.stdout).toContain("1.3.14")
  })

  it("divergência com --fail → exit 1 (modo estrito, para validação local/CI)", () => {
    const p = makeTmpActrc(ACTRC_1_4_0)
    const res = spawnSync(
      process.execPath,
      [MODULE_PATH, "--expected", "1.3.14", "--actrc", p, "--fail"],
      { encoding: "utf8" },
    )
    expect(res.status).toBe(1)
    expect(res.stdout).toContain("::warning::")
  })

  it("sem --expected → exit 2 com mensagem de uso", () => {
    const p = makeTmpActrc(ACTRC_1_3_14)
    const res = spawnSync(process.execPath, [MODULE_PATH, "--actrc", p], { encoding: "utf8" })
    expect(res.status).toBe(2)
    expect(res.stderr).toContain("--expected")
  })

  it("--expected VAZIO (variável ausente no repo — expressão não definida vira '') → exit 0 com ::warning:: de variável não configurada", () => {
    const p = makeTmpActrc(ACTRC_1_3_14)
    const res = spawnSync(process.execPath, [MODULE_PATH, "--expected", "", "--actrc", p], {
      encoding: "utf8",
    })
    expect(res.status).toBe(0)
    expect(res.stdout).toContain("::warning::")
    expect(res.stdout).toContain("vars.BUN_VERSION NÃO configurada")
  })

  it("--expected VAZIO + --fail → exit 1 (a ausência da variável é o drift mais grave; modo estrito falha igual à divergência)", () => {
    const p = makeTmpActrc(ACTRC_1_3_14)
    const res = spawnSync(
      process.execPath,
      [MODULE_PATH, "--expected", "", "--actrc", p, "--fail"],
      { encoding: "utf8" },
    )
    expect(res.status).toBe(1)
    expect(res.stdout).toContain("::warning::")
    expect(res.stdout).toContain("vars.BUN_VERSION NÃO configurada")
  })

  it(".actrc inexistente → exit 2", () => {
    const res = spawnSync(
      process.execPath,
      [MODULE_PATH, "--expected", "1.3.14", "--actrc", "/nope/.actrc"],
      { encoding: "utf8" },
    )
    expect(res.status).toBe(2)
    expect(res.stderr).toContain("não encontrado")
  })
})
