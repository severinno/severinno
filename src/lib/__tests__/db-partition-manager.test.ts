import { describe, it, expect } from "vitest"
import {
  generateMonthlyPartitionSql,
  generateRollingPartitionsPlan,
  generateRetentionPruneSql,
  generateTableStatsQuery,
  formatByteSize,
  MONITORED_HOT_TABLES,
} from "../db-partition-manager"

describe("db-partition-manager", () => {
  it("gera DDL de partição declarativa mensal com limites precisos de data", () => {
    const plan = generateMonthlyPartitionSql("WhatsAppMessageLog", 2026, 10)

    expect(plan.tableName).toBe("WhatsAppMessageLog")
    expect(plan.partitionName).toBe("WhatsAppMessageLog_y2026_m10")
    expect(plan.startDate).toBe("2026-10-01 00:00:00+00")
    expect(plan.endDate).toBe("2026-11-01 00:00:00+00")
    expect(plan.ddl).toContain('CREATE TABLE IF NOT EXISTS "WhatsAppMessageLog_y2026_m10"')
    expect(plan.ddl).toContain(
      "FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00')",
    )
  })

  it("trata a virada de ano corretamente no cálculo do mês seguinte (dezembro para janeiro)", () => {
    const plan = generateMonthlyPartitionSql("PushSendLog", 2026, 12)

    expect(plan.partitionName).toBe("PushSendLog_y2026_m12")
    expect(plan.startDate).toBe("2026-12-01 00:00:00+00")
    expect(plan.endDate).toBe("2027-01-01 00:00:00+00") // 2027!
  })

  it("gera plano de partições rolantes para N meses à frente incluindo virada de ano", () => {
    const refDate = new Date("2026-11-15T12:00:00Z")
    const plans = generateRollingPartitionsPlan("WebhookExecutionLog", 3, refDate)

    expect(plans.length).toBe(4) // Mês atual (11) + 3 à frente (12, 01/2027, 02/2027)
    expect(plans[0].partitionName).toBe("WebhookExecutionLog_y2026_m11")
    expect(plans[1].partitionName).toBe("WebhookExecutionLog_y2026_m12")
    expect(plans[2].partitionName).toBe("WebhookExecutionLog_y2027_m01")
    expect(plans[3].partitionName).toBe("WebhookExecutionLog_y2027_m02")
  })

  it("gera SQL de expurgo seguro por retenção de dias indexado por createdAt", () => {
    const refDate = new Date("2026-10-16T12:00:00Z")
    const prune = generateRetentionPruneSql("WhatsAppMessageLog", 90, refDate)

    expect(prune.sql).toContain('DELETE FROM "WhatsAppMessageLog" WHERE "createdAt" <')
    // 90 dias antes de 16/10 é ~18/07
    expect(prune.cutoffDate).toContain("2026-07-")
  })

  it("gera query de diagnóstico de bloat e tamanho para todas as tabelas monitoradas", () => {
    const sql = generateTableStatsQuery(MONITORED_HOT_TABLES)

    expect(sql).toContain("pg_total_relation_size")
    expect(sql).toContain("'WhatsAppMessageLog'")
    expect(sql).toContain("'PushSendLog'")
    expect(sql).toContain("'WebhookExecutionLog'")
  })

  it("formata tamanho de bytes em formato humanamente legível", () => {
    expect(formatByteSize(500)).toBe("500 B")
    expect(formatByteSize(2048)).toBe("2.0 KB")
    expect(formatByteSize(10485760)).toBe("10.0 MB")
    expect(formatByteSize(2147483648)).toBe("2.00 GB")
  })
})
