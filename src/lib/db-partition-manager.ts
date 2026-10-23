/**
 * db-partition-manager.ts — Gerenciador de Particionamento Declarativo & Retenção de Tabelas Quentes
 *
 * Automatiza a manutenção de tabelas com inserção contínua no PostgreSQL
 * (WhatsAppMessageLog, PushSendLog, WebhookExecutionLog), gerando partições mensais
 * e políticas de rotação (rolling retention) para manter queries O(1) e evitar inchaço de disco.
 */

export interface PartitionPlan {
  tableName: string
  partitionName: string
  year: number
  month: number
  startDate: string
  endDate: string
  ddl: string
}

export interface HotTableStats {
  tableName: string
  rowCount: number
  tableSizeBytes: number
  tableSizeFormatted: string
  indexSizeBytes: number
  indexSizeFormatted: string
  totalSizeBytes: number
  totalSizeFormatted: string
  partitionCount?: number
}

export const MONITORED_HOT_TABLES = [
  "WhatsAppMessageLog",
  "PushSendLog",
  "WebhookExecutionLog",
] as const

export type MonitoredHotTable = (typeof MONITORED_HOT_TABLES)[number]

/**
 * Formata bytes em string humanamente legível (KB, MB, GB).
 */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/**
 * Gera DDL SQL para criação de partição declarativa mensal no PostgreSQL.
 */
export function generateMonthlyPartitionSql(
  tableName: string,
  year: number,
  month: number, // 1 a 12
): PartitionPlan {
  const monthStr = month < 10 ? `0${month}` : `${month}`
  const partitionName = `${tableName}_y${year}_m${monthStr}`

  // Data de início (primeiro dia do mês às 00:00:00Z)
  const startDate = `${year}-${monthStr}-01 00:00:00+00`

  // Data de término (primeiro dia do mês seguinte às 00:00:00Z)
  let nextYear = year
  let nextMonth = month + 1
  if (nextMonth > 12) {
    nextYear += 1
    nextMonth = 1
  }
  const nextMonthStr = nextMonth < 10 ? `0${nextMonth}` : `${nextMonth}`
  const endDate = `${nextYear}-${nextMonthStr}-01 00:00:00+00`

  const ddl = `CREATE TABLE IF NOT EXISTS "${partitionName}" PARTITION OF "${tableName}" FOR VALUES FROM ('${startDate}') TO ('${endDate}');`

  return {
    tableName,
    partitionName,
    year,
    month,
    startDate,
    endDate,
    ddl,
  }
}

/**
 * Gera plano de partições antecipadas para os próximos N meses.
 */
export function generateRollingPartitionsPlan(
  tableName: string,
  monthsAhead = 3,
  referenceDate: Date = new Date(),
): PartitionPlan[] {
  const plans: PartitionPlan[] = []
  const startYear = referenceDate.getUTCFullYear()
  const startMonth = referenceDate.getUTCMonth() + 1 // 1-indexed

  for (let offset = 0; offset <= monthsAhead; offset++) {
    let year = startYear
    let month = startMonth + offset

    while (month > 12) {
      year += 1
      month -= 12
    }

    plans.push(generateMonthlyPartitionSql(tableName, year, month))
  }

  return plans
}

/**
 * Gera comando seguro de expurgo para retenção de logs antigos.
 */
export function generateRetentionPruneSql(
  tableName: string,
  retentionDays = 90,
  referenceDate: Date = new Date(),
): { cutoffDate: string; sql: string } {
  const cutoff = new Date(referenceDate.getTime() - retentionDays * 24 * 60 * 60 * 1000)
  const cutoffDate = cutoff.toISOString()

  // Usa DELETE com WHERE indexado em createdAt
  const sql = `DELETE FROM "${tableName}" WHERE "createdAt" < '${cutoffDate}';`

  return {
    cutoffDate,
    sql,
  }
}

/**
 * Consulta de diagnóstico de tamanho e bloat de tabelas quentes.
 */
export function generateTableStatsQuery(tableNames: readonly string[]): string {
  const tableList = tableNames.map((t) => `'${t}'`).join(", ")
  return `
    SELECT
      relname AS "tableName",
      n_live_tup AS "rowCount",
      pg_table_size(C.oid) AS "tableSizeBytes",
      pg_indexes_size(C.oid) AS "indexSizeBytes",
      pg_total_relation_size(C.oid) AS "totalSizeBytes"
    FROM pg_class C
    LEFT JOIN pg_namespace N ON (N.oid = C.relnamespace)
    LEFT JOIN pg_stat_user_tables S ON (S.relid = C.oid)
    WHERE nspname = 'public' AND relname IN (${tableList})
    ORDER BY pg_total_relation_size(C.oid) DESC;
  `.trim()
}
