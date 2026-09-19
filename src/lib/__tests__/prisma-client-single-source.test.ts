/**
 * Guard: o client do Prisma tem UMA fonte de verdade.
 *
 * Falha real (encontrada e corrigida em 09/2026): o repositório versionava
 * `src/generated/prisma` — 25 arquivos, ~42k linhas — gerados por uma versão
 * ANTIGA do schema, ao lado do client que o Prisma realmente gera em
 * `node_modules/.prisma/client` (a partir de `prisma/schema.prisma`).
 *
 * O artefato congelado não era só redundante, era DIVERGENTE: exportava o enum
 * `UserRole`, enquanto o schema atual (renomeado para `Role`) faz o client vivo
 * exportar `Role`. Uma rota compilava **apenas** por causa do arquivo morto —
 * então rodar `prisma generate` com o schema atual (em qualquer build limpo)
 * quebraria o typecheck. Nenhum CI pegava isso, porque o `check-ts-nocheck`
 * exclui `src/generated/` como código de vendor.
 *
 * Esta trava fecha a lacuna: output gerado que ninguém regenera é dívida
 * silenciosa, não otimização.
 */

import { describe, it, expect } from "vitest"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const SCHEMA_PATH = "prisma/schema.prisma"

// Montado em pedaços de propósito: o literal completo apareceria neste próprio
// arquivo e o teste se auto-detectaria como infrator.
const STALE_IMPORT = "@" + "/generated/prisma"

/** Caminho canônico do output gerado quando o generator não declara `output`. */
const DEFAULT_OUTPUT_DIR = "src/generated"

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) collectSourceFiles(path, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(path)
  }
  return out
}

function generatorBlocks(schema: string): string[] {
  return [...schema.matchAll(/generator\s+\w+\s*\{([^}]*)\}/g)].map((match) => match[1])
}

describe("Prisma: fonte única do client gerado", () => {
  it("nenhum arquivo de src/ importa de um client gerado versionado", () => {
    const offenders = collectSourceFiles("src").filter((file) =>
      readFileSync(file, "utf8").includes(STALE_IMPORT),
    )

    expect(
      offenders,
      `Import de client gerado versionado em: ${offenders.join(", ")}. ` +
        "Importe os tipos/enums de `@prisma/client` — é o que `prisma generate` " +
        "(prisma/schema.prisma) produz e mantém em sincronia.",
    ).toEqual([])
  })

  it("não existe diretório de output gerado abandonado em src/", () => {
    // Se algum dia um generator declarar `output` apontando para cá, este teste
    // é o lugar de registrar a decisão (e o `check-ts-nocheck` precisa deixar de
    // excluir o diretório, porque aí ele passa a ser código do projeto).
    const schema = readFileSync(SCHEMA_PATH, "utf8")
    const generatorsWithOutput = generatorBlocks(schema).filter((block) => /output\s*=/.test(block))

    if (generatorsWithOutput.length > 0) {
      // Contrato positivo: se há output declarado, ele precisa existir de fato.
      // Um `output` declarado e ausente = build depende de artefato local.
      const declared = generatorsWithOutput
        .map((block) => block.match(/output\s*=\s*"([^"]+)"/)?.[1])
        .filter((value): value is string => Boolean(value))
      for (const output of declared) {
        const resolved = output.startsWith(".") ? output : `./${output}`
        expect(
          existsSync(resolved),
          `Generator declara output "${resolved}" que não existe — rode \`bun run db:generate\`.`,
        ).toBe(true)
      }
      return
    }

    expect(
      existsSync(DEFAULT_OUTPUT_DIR),
      `${DEFAULT_OUTPUT_DIR}/ existe sem nenhum generator declarando esse output: ` +
        "é artefato órfão que ninguém regenera (a causa do drift UserRole→Role). " +
        "O client vem de node_modules/.prisma via `bun run db:generate`.",
    ).toBe(false)
  })

  it("o schema tem exatamente um generator e ele alimenta @prisma/client", () => {
    const schema = readFileSync(SCHEMA_PATH, "utf8")
    const generators = generatorBlocks(schema)

    expect(generators).toHaveLength(1)
    // Sem `output`, o Prisma escreve em node_modules/.prisma/client — exatamente
    // o que `import ... from "@prisma/client"` resolve em todo o src/.
    expect(generators[0]).toMatch(/provider\s*=\s*"(prisma-client-js|prisma-client)"/)
    expect(generators[0]).not.toMatch(/output\s*=/)
  })
})
