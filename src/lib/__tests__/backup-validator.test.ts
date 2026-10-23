import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import zlib from "zlib"
import { createHash } from "crypto"
import {
  formatBytes,
  inspectBackupFile,
  analyzeSqlSchemaSample,
  runAutomatedBackupAudit,
} from "../backup-validator"

const { mockSendAlertWebhook } = vi.hoisted(() => ({
  mockSendAlertWebhook: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/alert-webhook", () => ({
  sendAlertWebhook: mockSendAlertWebhook,
}))

vi.mock("@/lib/logger", () => {
  const instance: any = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => instance),
  }
  return { default: instance, logger: instance }
})

describe("backup-validator — Validação de Integridade e Shadow Restore", () => {
  let tempDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-test-"))
  })

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  it("formata bytes para formatos legíveis corretamente", () => {
    expect(formatBytes(500)).toBe("500 B")
    expect(formatBytes(2048)).toBe("2.00 KB")
    expect(formatBytes(1024 * 1024 * 5)).toBe("5.00 MB")
    expect(formatBytes(1024 * 1024 * 1024 * 2.5)).toBe("2.50 GB")
  })

  it("detecta cabeçalho gzip e valida SHA-256 de um arquivo de backup", async () => {
    const rawSql = 'CREATE TABLE "User" (id text); CREATE TABLE "Booking" (id text);'
    const compressed = zlib.gzipSync(Buffer.from(rawSql))
    const dumpPath = path.join(tempDir, "severinno_20261016_040000.sql.gz")
    fs.writeFileSync(dumpPath, compressed)

    // Escreve sidecar .sha256
    const calculatedHash = createHash("sha256").update(compressed).digest("hex")
    fs.writeFileSync(`${dumpPath}.sha256`, `${calculatedHash}  ${path.basename(dumpPath)}\n`)

    const info = await inspectBackupFile(dumpPath)

    expect(info.exists).toBe(true)
    expect(info.isGzip).toBe(true)
    expect(info.hasSha256File).toBe(true)
    expect(info.sha256Valid).toBe(true)
    expect(info.calculatedSha256).toBe(calculatedHash)
  })

  it("detecta arquivo com SHA-256 adulterado", async () => {
    const compressed = zlib.gzipSync(Buffer.from("SELECT 1;"))
    const dumpPath = path.join(tempDir, "severinno_corrupted.sql.gz")
    fs.writeFileSync(dumpPath, compressed)

    // Hash divergente
    fs.writeFileSync(
      `${dumpPath}.sha256`,
      `ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff  dump.sql.gz\n`,
    )

    const info = await inspectBackupFile(dumpPath)
    expect(info.sha256Valid).toBe(false)
  })

  it("analisa o schema SQL identificando tabelas críticas e extensão PostGIS", () => {
    const sampleSql = `
      CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;
      CREATE TABLE public."User" (id text PRIMARY KEY);
      CREATE TABLE public."Booking" (id text, price numeric);
      CREATE TABLE public."Payment" (id text, amount numeric);
      CREATE TABLE public."Service" (id text, title text);
    `

    const analysis = analyzeSqlSchemaSample(sampleSql)

    expect(analysis.hasPostgisExtension).toBe(true)
    expect(analysis.tablesFound).toContain("User")
    expect(analysis.tablesFound).toContain("Booking")
    expect(analysis.tablesFound).toContain("Payment")
    expect(analysis.tablesFound).toContain("Service")
    expect(analysis.missingCriticalTables).toContain("Review")
  })

  it("executa auditoria completa de diretório de backups e reporta sucesso", async () => {
    const rawSql = 'CREATE TABLE "User" (id text);'
    const compressed = zlib.gzipSync(Buffer.from(rawSql))
    const dumpPath = path.join(tempDir, "severinno_20261016_040000.sql.gz")
    fs.writeFileSync(dumpPath, compressed)

    const hash = createHash("sha256").update(compressed).digest("hex")
    fs.writeFileSync(`${dumpPath}.sha256`, `${hash}  severinno_20261016_040000.sql.gz\n`)

    const report = await runAutomatedBackupAudit({
      backupDir: tempDir,
      dispatchAlerts: false,
    })

    expect(report.ok).toBe(true)
    expect(report.latestBackup).toBe(dumpPath)
    expect(report.fileInfo?.sha256Valid).toBe(true)
    expect(report.message).toContain("Backup íntegro e validado")
  })

  it("dispara alerta quando nenhum arquivo de backup é encontrado", async () => {
    const report = await runAutomatedBackupAudit({
      backupDir: tempDir,
      dispatchAlerts: true,
    })

    expect(report.ok).toBe(false)
    expect(report.message).toContain("Nenhum arquivo de backup do Severinno")
    expect(mockSendAlertWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "CRITICAL",
        metric: "backup_file_missing",
      }),
    )
  })
})
