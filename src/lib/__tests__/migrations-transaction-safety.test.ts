/**
 * migrations-transaction-safety.test.ts
 *
 * O incidente que este guard existe para impedir (16/10 → 23/10/2026):
 * `20261016180000_add_conditional_partial_indexes` abria com
 * `CREATE INDEX CONCURRENTLY`, e o Prisma Migrate roda cada migration dentro de
 * UMA transação — `CONCURRENTLY` não roda em bloco de transação. O resultado não
 * foi um PR vermelho: foi a produção parada. A migration falhou em 100% dos
 * bancos, ficou com `finished_at` nulo em `_prisma_migrations`, e a partir dali
 * TODO `prisma migrate deploy` saía com P3009 — as migrations seguintes
 * (incluindo `20261022180000_add_offline_evidence`) nunca aplicaram, e o
 * pipeline de deploy morreu no passo `Migrate Database` por 7 dias.
 *
 * POR QUE UM TESTE E NÃO UM GATE DE YAML: a classe do defeito é ESTÁTICA — o
 * texto da migration já diz se ela pode ou não rodar em transação. Um job que
 * aplica o histórico num banco vazio provaria o mesmo, mas HOJE ele seria
 * vermelho por um motivo ANTERIOR a este defeito: a história não é reaplicável
 * de zero (`20260726130000_add_denormalized_triggers` usa `User."avgRating"`,
 * coluna que só nasce em `20260813200000_native_enums_and_postgis_sync` — ordem
 * de dependência invertida). Um gate que nasce vermelho não protege nada; o
 * conserto da história é trabalho próprio, com o próprio veredito. Este teste
 * roda no job `Tests` (contexto obrigatório do merge), em milissegundos, e
 * nomeia arquivo + instrução.
 *
 * O QUE ELE JULGA (e o que NÃO julga):
 *   - julga: instrução que o Postgres recusa dentro de transação — as que
 *     quebram a migration inteira e deixam a linha sem `finished_at`;
 *   - NÃO julga: se a migration aplica (isso é do `migrate deploy`), nem
 *     ordem/drift entre migrations — seria outra régua, e hoje ela reprovaria
 *     por dívida pré-existente (ver acima).
 *
 * Os COMENTÁRIOS são removidos antes da varredura: o SQL desta casa explica as
 * decisões no próprio arquivo, e a explicação do `CONCURRENTLY` (a que este
 * guard tornou obrigatória) cita a palavra proibida de propósito.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const MIGRATIONS = join(RAIZ, "prisma", "migrations")

/**
 * Remover comentários SEM mexer em string: o SQL das migrations tem literais
 * (`'PENDING'`, `'providers'`) e um apóstrofo dentro de literal não pode ser
 * confundido com comentário.
 *
 * O caminho é um único passo pelo texto, alternando entre "fora de literal" e
 * "dentro de literal": `--` e `/*` só abrem comentário FORA de literal. O que
 * sobra é o SQL que o Postgres realmente executa.
 */
export function semComentarios(sql: string): string {
  let saida = ""
  let i = 0
  let dentroDeLiteral = false
  while (i < sql.length) {
    const c = sql[i]!
    if (dentroDeLiteral) {
      saida += c
      // `''` é escape de apóstrofo dentro do literal: consome os dois.
      if (c === "'" && sql[i + 1] === "'") {
        saida += "'"
        i += 2
        continue
      }
      if (c === "'") dentroDeLiteral = false
      i += 1
      continue
    }
    if (c === "'") {
      dentroDeLiteral = true
      saida += c
      i += 1
      continue
    }
    if (c === "-" && sql[i + 1] === "-") {
      const fim = sql.indexOf("\n", i)
      i = fim === -1 ? sql.length : fim
      continue
    }
    if (c === "/" && sql[i + 1] === "*") {
      const fim = sql.indexOf("*/", i + 2)
      i = fim === -1 ? sql.length : fim + 2
      saida += " "
      continue
    }
    saida += c
    i += 1
  }
  return saida
}

/**
 * As instruções que o Postgres recusa dentro de transação e que, num arquivo de
 * migration do Prisma, deixam a linha sem `finished_at` (P3009 para todo mundo
 * depois). A lista é deliberadamente CURTA e cada entrada tem a razão escrita:
 * ampliar sem razão transformaria o guard em ruído.
 */
export const PROIBIDAS = [
  {
    id: "index-concurrently",
    re: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i,
    why: "CREATE INDEX CONCURRENTLY não roda em bloco de transação (SQLSTATE 25001) — foi exatamente o P3009 de 16/10/2026",
  },
  {
    id: "reindex-concurrently",
    re: /\bREINDEX\s+(?:\([^)]*\)\s*)?(?:TABLE\s+|INDEX\s+|SCHEMA\s+|DATABASE\s+|SYSTEM\s+)?CONCURRENTLY\b/i,
    why: "REINDEX CONCURRENTLY tem a mesma restrição (fora de transação)",
  },
  {
    id: "vacuum",
    re: /^\s*VACUUM\b/im,
    why: "VACUUM não roda em bloco de transação — é manutenção, não migration",
  },
  {
    id: "create-drop-database",
    re: /^\s*(?:CREATE|DROP)\s+DATABASE\b/im,
    why: "CREATE/DROP DATABASE não roda em bloco de transação (e a migration não escolhe o banco em que roda)",
  },
  {
    id: "alter-system",
    re: /^\s*ALTER\s+SYSTEM\b/im,
    why: "ALTER SYSTEM não roda em bloco de transação",
  },
]

/**
 * Esvaziar o CONTEÚDO dos literais mantendo as aspas — `'CREATE INDEX
 * CONCURRENTLY x'` vira `''`.
 *
 * Sem isto, um literal que CITASSE a instrução proibida (num `INSERT`, num
 * comentário de coluna gravado em tabela) seria acusado: o Postgres não executa
 * o que está entre aspas, e o guard tem de julgar o que ele executa.
 */
export function mascararLiterais(sql: string): string {
  let saida = ""
  let dentroDeLiteral = false
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]!
    if (!dentroDeLiteral) {
      saida += c
      if (c === "'") dentroDeLiteral = true
      continue
    }
    if (c === "'" && sql[i + 1] === "'") {
      i += 1
      continue
    }
    if (c === "'") {
      dentroDeLiteral = false
      saida += c
      continue
    }
  }
  return saida
}

export type Violacao = { id: string; why: string; fragmento: string }

/** As violações de UM arquivo, já sem comentários nem literais. Pura. */
export function violacoesDeTransacao(sql: string): Violacao[] {
  const limpo = mascararLiterais(semComentarios(sql))
  const achadas: Violacao[] = []
  for (const p of PROIBIDAS) {
    const m = p.re.exec(limpo)
    if (m) {
      achadas.push({
        id: p.id,
        why: p.why,
        fragmento: limpo
          .slice(m.index, m.index + m[0].length + 40)
          .split("\n")[0]!
          .trim(),
      })
    }
  }
  return achadas
}

/** Todas as migrations do repositório, na ordem do diretório. */
function migrations(): { nome: string; sql: string }[] {
  return readdirSync(MIGRATIONS)
    .filter((nome) => statSync(join(MIGRATIONS, nome)).isDirectory())
    .sort()
    .map((nome) => ({ nome, sql: readFileSync(join(MIGRATIONS, nome, "migration.sql"), "utf8") }))
}

describe("migrations do Prisma × transação do migrate", () => {
  it("o extrator de comentário não come string nem apóstrofo escapado", () => {
    expect(semComentarios("SELECT '--nao-e-comentario'")).toBe("SELECT '--nao-e-comentario'")
    expect(semComentarios("SELECT 'it''s -- dentro'")).toBe("SELECT 'it''s -- dentro'")
    expect(semComentarios("SELECT 1 -- comentario\nSELECT 2")).toBe("SELECT 1 \nSELECT 2")
    expect(mascararLiterais("SELECT 'segredo' FROM t")).toBe("SELECT '' FROM t")
    expect(semComentarios("/* bloco\n de comentario */SELECT 3")).toBe(" SELECT 3")
  })

  it("reprova CONCURRENTLY e aceita o mesmo índice sem ele", () => {
    const comConcurrently = violacoesDeTransacao(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_x ON "User" (id);',
    )
    expect(comConcurrently.map((v) => v.id)).toEqual(["index-concurrently"])

    const semConcurrently = violacoesDeTransacao('CREATE INDEX IF NOT EXISTS idx_x ON "User" (id);')
    expect(semConcurrently).toEqual([])
  })

  it("não acusa a palavra dentro de comentário nem dentro de literal", () => {
    expect(violacoesDeTransacao("-- CREATE INDEX CONCURRENTLY idx_x ON t (id);")).toEqual([])
    expect(violacoesDeTransacao("/* VACUUM; */ SELECT 1;")).toEqual([])
    expect(violacoesDeTransacao("INSERT INTO t VALUES ('CREATE INDEX CONCURRENTLY x');")).toEqual(
      [],
    )
  })

  it("detecta as outras instruções fora de transação", () => {
    expect(violacoesDeTransacao('VACUUM ANALYZE "User";').map((v) => v.id)).toEqual(["vacuum"])
    expect(violacoesDeTransacao("CREATE DATABASE outro;").map((v) => v.id)).toEqual([
      "create-drop-database",
    ])
    expect(violacoesDeTransacao("ALTER SYSTEM SET work_mem = '64MB';").map((v) => v.id)).toEqual([
      "alter-system",
    ])
    expect(violacoesDeTransacao("REINDEX INDEX CONCURRENTLY idx_x;").map((v) => v.id)).toEqual([
      "reindex-concurrently",
    ])
  })

  it("nenhuma migration do repositório tem instrução fora de transação", () => {
    const todas = migrations()
    // Sanidade da varredura: se o diretório não fosse lido, a lista sairia vazia
    // e este teste seria verde por não olhar — o verde de não saber.
    expect(todas.length).toBeGreaterThan(30)

    const encontradas = todas.flatMap(({ nome, sql }) =>
      violacoesDeTransacao(sql).map((v) => `${nome}/migration.sql → ${v.id} (${v.fragmento})`),
    )
    expect(encontradas).toEqual([])
  })

  it("a migration dos índices parciais mantém os nove índices (foi corrigida, não esvaziada)", () => {
    const alvo = migrations().find(
      ({ nome }) => nome === "20261016180000_add_conditional_partial_indexes",
    )
    expect(alvo).toBeDefined()
    const sql = semComentarios(alvo!.sql)
    const indices = sql.match(/CREATE INDEX IF NOT EXISTS \w+/g) ?? []
    expect(indices).toHaveLength(9)
    expect(sql).toContain("WHERE status = 'PENDING'")
    expect(sql).toContain("WHERE role = 'PROVIDER'")
  })
})
