/**
 * check-bun-mirror-prisma-key.test.ts
 *
 * Teste da key `prisma-` REAL de .github/workflows/seed-guards.yml contra o
 * guard check-bun-mirror.mjs.
 *
 * POR QUE EXISTE: a auditoria de cache keys (README, tabela "Cobertura das
 * cache keys") verificou as keys por grep. Este teste trava a key REAL do
 * workflow em código: parseia o seed-guards.yml com js-yaml (a fonte — não
 * uma fixture copiada), extrai as 4 keys `prisma-` (key + restore-keys) e
 * prova dois contratos:
 *
 *   1. O ESTADO REAL passa no guard — toda key extraída referencia
 *      `${{ vars.BUN_VERSION }}` e `checkCacheKeyLine` retorna null (sem
 *      violação) para as linhas reais do arquivo.
 *   2. REGRESSÃO É PEGA — remover a versão do Bun de uma key real (mutação:
 *      `prisma-${{ hashFiles(...) }}` em vez de `prisma-${{ vars.BUN_VERSION }}-${{ hashFiles(...) }}`)
 *      faz o guard FALHAR (violação "sem a fonte única") tanto no nível de
 *      linha (checkCacheKeyLine) quanto no scan completo de um diretório
 *      (checkCacheKeys com o arquivo mutado).
 *
 * Isto protege contra dois drifts silenciosos:
 *   - o workflow mudar a key para um literal (prisma-1.3.14-...) — o guard
 *     global já pega, mas este teste trava a key REAL no repositório;
 *   - alguém REMOVER a versão da key real esperando passar — o teste falha
 *     o PR com a mensagem exata do guard.
 *
 * js-yaml é dep transitiva SEM @types — a declaração ambiente global vive em
 * js-yaml.d.ts (mesmo diretório; .d.ts no escopo do módulo causaria TS2665).
 */

import { describe, it, expect } from "vitest"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import yaml from "js-yaml"

import {
  checkCacheKeyLine,
  checkCacheKeys,
  DEFAULT_CACHE_KEY_RULES,
} from "../../../scripts/check-bun-mirror.mjs"

const CWD = process.cwd()
const WF_PATH = join(CWD, ".github", "workflows", "seed-guards.yml")
if (!existsSync(WF_PATH)) {
  // Mensagem clara em vez do stack trace cru do readFileSync — ajuda quando o
  // workflow for renomeado/removido (o teste trava a key REAL do repositório).
  throw new Error(
    `seed-guards.yml não encontrado em ${WF_PATH} — o teste trava a key prisma- real; se o workflow foi renomeado, atualize WF_PATH`,
  )
}
const RAW = readFileSync(WF_PATH, "utf8")
const DOC = yaml.load(RAW) as unknown

/**
 * Caminha recursivamente pelo doc YAML do workflow e coleta TODOS os objetos
 * de step com `key` string iniciando em `prisma-` — devolve o par
 * { key, restoreKeys } de cada bloco actions/cache do client Prisma.
 * Não depende de nomes de job/step (robusto a renomeações).
 */
function collectPrismaBlocks(
  node: unknown,
  out: { key: string; restoreKeys: string | null }[] = [],
): {
  key: string
  restoreKeys: string | null
}[] {
  if (Array.isArray(node)) {
    for (const n of node) collectPrismaBlocks(n, out)
    return out
  }
  if (node !== null && typeof node === "object") {
    const obj = node as Record<string, unknown>
    if (typeof obj.key === "string" && obj.key.startsWith("prisma-")) {
      out.push({
        key: obj.key,
        restoreKeys: typeof obj["restore-keys"] === "string" ? obj["restore-keys"] : null,
      })
    }
    for (const v of Object.values(obj)) collectPrismaBlocks(v, out)
  }
  return out
}

describe("key prisma- REAL de seed-guards.yml vs check-bun-mirror", () => {
  it("parseia o workflow e extrai as 4 keys prisma- reais (key + restore-keys)", () => {
    const blocks = collectPrismaBlocks(DOC)
    // 4 jobs seed E2E (prod/dev/migrate × ...) — cada um com 1 bloco prisma;
    // o contrato mínimo é 4 blocos (auditado em 08/2026)
    expect(blocks.length).toBeGreaterThanOrEqual(4)
    for (const b of blocks) {
      expect(b.key.startsWith("prisma-")).toBe(true)
      // Se um futuro bloco prisma omitir restore-keys, falha CLARO (não com
      // erro de tipo confuso de toMatch(null))
      if (b.restoreKeys !== null) expect(b.restoreKeys).toMatch(/^prisma-/)
    }
  })

  it("estado REAL passa no guard — toda key referencia ${{ vars.BUN_VERSION }}", () => {
    const blocks = collectPrismaBlocks(DOC)
    expect(blocks.length).toBeGreaterThanOrEqual(4)
    for (const b of blocks) {
      expect(b.key).toContain("${{ vars.BUN_VERSION }}")
      expect(b.restoreKeys).toContain("${{ vars.BUN_VERSION }}")
    }

    // As linhas reais do arquivo não geram violação no checkCacheKeyLine —
    // prova o contrato na FONTE (linha por linha, como o scan global faz).
    let violations = 0
    for (const [i, line] of RAW.split("\n").entries()) {
      if (line.includes("key: prisma-") || line.includes("restore-keys: prisma-")) {
        expect(
          checkCacheKeyLine("seed-guards.yml", i + 1, line, DEFAULT_CACHE_KEY_RULES()),
        ).toBeNull()
        violations++
      }
    }
    // 4 key + 4 restore-keys reais no arquivo
    expect(violations).toBeGreaterThanOrEqual(8)
  })

  it("REGRESSÃO: remover a versão do Bun da key real → checkCacheKeyLine falha", () => {
    const blocks = collectPrismaBlocks(DOC)
    expect(blocks.length).toBeGreaterThanOrEqual(4)

    for (const b of blocks) {
      // Mutação: `prisma-${{ vars.BUN_VERSION }}-${{ hashFiles(...) }}`
      // → `prisma-${{ hashFiles(...) }}` (versão removida)
      const mutatedKey = b.key.replace("${{ vars.BUN_VERSION }}-", "")
      const v = checkCacheKeyLine(
        "seed-guards.yml",
        1,
        `          key: ${mutatedKey}`,
        DEFAULT_CACHE_KEY_RULES(),
      )
      expect(v).not.toBeNull()
      expect(v).toContain("sem a fonte única")

      if (b.restoreKeys) {
        const mutatedRestore = b.restoreKeys.replace("${{ vars.BUN_VERSION }}-", "")
        const vr = checkCacheKeyLine(
          "seed-guards.yml",
          1,
          `          restore-keys: ${mutatedRestore}`,
          DEFAULT_CACHE_KEY_RULES(),
        )
        expect(vr).not.toBeNull()
        expect(vr).toContain("sem a fonte única")
      }
    }
  })

  it("REGRESSÃO: workflow com as keys mutadas → checkCacheKeys reporta TODAS (integração)", () => {
    // Copia o workflow real para um diretório temporário e remove a versão
    // das keys prisma- — o scan global deve reportar violação para CADA linha
    // (4 key + 4 restore-keys), como o CI faria antes do merge.
    const mutated = RAW.replaceAll("prisma-${{ vars.BUN_VERSION }}-", "prisma-")
    const dir = mkdtempSync(join(tmpdir(), "cbm-prisma-"))
    const wfDir = join(dir, "workflows")
    mkdirSync(wfDir)
    writeFileSync(join(wfDir, "seed-guards.yml"), mutated)
    try {
      const violations = checkCacheKeys(wfDir, DEFAULT_CACHE_KEY_RULES())
      // 4 key: prisma- + 4 restore-keys: prisma- — todas sem versão
      expect(violations.length).toBeGreaterThanOrEqual(8)
      for (const v of violations) {
        expect(v).toContain("sem a fonte única")
        expect(v).toContain("prisma-")
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("REGRESSÃO: key real com versão LITERAL (prisma-1.3.14-...) → guard falha", () => {
    // Mesmo que o valor venha da key real, um literal no lugar da variável é
    // violação (trocar a variável não invalidaria o cache) — contrato 7.
    const blocks = collectPrismaBlocks(DOC)
    expect(blocks.length).toBeGreaterThanOrEqual(1)
    const literal = blocks[0].key.replace("${{ vars.BUN_VERSION }}", "1.3.14")
    const v = checkCacheKeyLine(
      "seed-guards.yml",
      1,
      `          key: ${literal}`,
      DEFAULT_CACHE_KEY_RULES(),
    )
    expect(v).not.toBeNull()
    expect(v).toContain("prisma-1.3.14-")
  })
})
