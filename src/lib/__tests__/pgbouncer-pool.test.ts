import { describe, it, expect } from "vitest"
import {
  buildPgBouncerDatabaseUrl,
  auditDatabaseUrlForPgBouncer,
  isQueryTransactionPoolingSafe,
} from "../pgbouncer-pool"

describe("pgbouncer-pool", () => {
  it("converte DATABASE_URL direta para porta 6432 com pgbouncer=true e connection_limit=20", () => {
    const raw = "postgresql://user:pass@187.127.16.136:5432/severinno?schema=public"
    const converted = buildPgBouncerDatabaseUrl(raw)

    expect(converted).toContain(":6432")
    expect(converted).toContain("pgbouncer=true")
    expect(converted).toContain("connection_limit=20")
  })

  it("audita corretamente uma URL que ainda está conectada direto na 5432", () => {
    const directUrl = "postgresql://user:pass@localhost:5432/severinno"
    const audit = auditDatabaseUrlForPgBouncer(directUrl)

    expect(audit.isConfigured).toBe(false)
    expect(audit.port).toBe(5432)
    expect(audit.warnings.length).toBeGreaterThan(0)
    expect(audit.recommendedUrl).toContain(":6432")
  })

  it("aprova URL já configurada com PgBouncer", () => {
    const validUrl = "postgresql://user:pass@localhost:6432/severinno?pgbouncer=true"
    const audit = auditDatabaseUrlForPgBouncer(validUrl)

    expect(audit.isConfigured).toBe(true)
    expect(audit.port).toBe(6432)
    expect(audit.hasPgBouncerParam).toBe(true)
  })

  it("detecta comandos SQL inseguros para modo transaction pooling", () => {
    const listen = isQueryTransactionPoolingSafe("LISTEN order_events;")
    expect(listen.isSafe).toBe(false)
    expect(listen.requiresDirectUrl).toBe(true)

    const session = isQueryTransactionPoolingSafe("SET SESSION TIMEZONE TO 'UTC';")
    expect(session.isSafe).toBe(false)

    const normal = isQueryTransactionPoolingSafe(
      "SELECT id, name FROM users WHERE role = 'PROVIDER';",
    )
    expect(normal.isSafe).toBe(true)
  })
})
