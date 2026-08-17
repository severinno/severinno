/**
 * storage-timeout.test.ts
 *
 * Hang protection do storage.ts (uploadFile — S3-compatible):
 *   - S3_REQUEST_TIMEOUT_MS — request inteira sem resposta (default 30s),
 *     aplicado como abortSignal no client.send (o requestTimeout do config
 *     é no-op no SDK v3.1090.0 — verificado empiricamente).
 *
 * Mesmo padrão do s3-timeout.test.ts: servidor TCP REAL que aceita mas nunca
 * responde, SDK REAL apontado para ele. O uploadFile (storage.ts) engole o
 * erro e retorna null — sem o requestTimeout, ele penduraria para sempre.
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import net from "node:net"
import type { Server, Socket } from "node:net"

// ── TCP server que aceita conexões mas NUNCA responde (o cenário do hang) ──
function startHangingS3Server(): Promise<{ server: Server; port: number; sockets: Socket[] }> {
  return new Promise((resolve) => {
    const sockets: Socket[] = []
    const server = net.createServer((socket) => {
      sockets.push(socket)
      socket.on("error", () => {
        /* SDK abortou a conexão — ok */
      })
      // Aceita o TCP mas nunca envia nenhuma resposta HTTP.
    })
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      resolve({
        server,
        port: typeof addr === "object" && addr !== null ? addr.port : 0,
        sockets,
      })
    })
  })
}

function cleanupHangingServer(server: Server, sockets: Socket[]): void {
  for (const s of sockets) {
    try {
      s.destroy()
    } catch {
      /* ignore */
    }
  }
  server.close()
}

const S3_ENVS = [
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "S3_BUCKET",
  "S3_PUBLIC_URL",
  "S3_REQUEST_TIMEOUT_MS",
] as const

afterEach(() => {
  for (const k of S3_ENVS) delete process.env[k]
  vi.resetModules()
})

describe("storage.uploadFile hang protection (TCP aceita, nunca responde)", () => {
  it(
    "uploadFile não trava quando o S3 aceita TCP mas nunca responde " +
      "(requestTimeout aborta e retorna null)",
    async () => {
      const { server, port, sockets } = await startHangingS3Server()
      try {
        // storage.ts lê as envs em CONSTS de topo — precisa resetModules +
        // env ANTES do import dinâmico (o SDK é REAL, não mockado).
        vi.resetModules()
        process.env.S3_ENDPOINT = `http://127.0.0.1:${port}`
        process.env.S3_REGION = "us-east-1"
        process.env.S3_ACCESS_KEY = "test-key"
        process.env.S3_SECRET_KEY = "test-secret"
        process.env.S3_BUCKET = "test-bucket"
        process.env.S3_REQUEST_TIMEOUT_MS = "150"

        const { uploadFile } = await import("@/lib/storage")

        const started = Date.now()
        const result = await uploadFile(Buffer.from("x"), "photos/test.jpg", "image/jpeg")
        const elapsed = Date.now() - started

        // uploadFile engole o erro do SDK e retorna null (fallback local).
        expect(result).toBeNull()
        // Bounded: requestTimeout 150ms × retries do SDK (default 3), nunca
        // "para sempre".
        expect(elapsed).toBeLessThan(5_000)
      } finally {
        cleanupHangingServer(server, sockets)
      }
    },
  )
})
