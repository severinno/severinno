/**
 * s3-timeout.test.ts
 *
 * Hang protection do cliente S3 (src/lib/s3.ts):
 *   - S3_REQUEST_TIMEOUT_MS — request inteira sem resposta (default 30s),
 *     aplicado como abortSignal no client.send (o requestTimeout do config
 *     é no-op no SDK v3.1090.0 — verificado empiricamente).
 *
 * Segue o padrão do realtime-client.test.ts: um serviço que aceita TCP mas
 * nunca responde. Aqui o servidor é TCP REAL (node:net) e o cliente é o SDK
 * REAL (@aws-sdk/client-s3, NÃO mockado) apontado para ele — se o
 * requestTimeout não estivesse wireado no requestHandler, o uploadToS3
 * penduraria para sempre.
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
  "S3_REQUEST_TIMEOUT_MS",
] as const

afterEach(() => {
  for (const k of S3_ENVS) delete process.env[k]
})

describe("S3 hang protection (TCP aceita, nunca responde)", () => {
  it(
    "uploadToS3 não trava quando o S3 aceita TCP mas nunca responde " +
      "(requestTimeout aborta a request)",
    async () => {
      const { server, port, sockets } = await startHangingS3Server()
      try {
        // O SDK real lê o endpoint/credenciais do env na criação do client.
        process.env.S3_ENDPOINT = `http://127.0.0.1:${port}`
        process.env.S3_REGION = "us-east-1"
        process.env.S3_ACCESS_KEY = "test-key"
        process.env.S3_SECRET_KEY = "test-secret"
        process.env.S3_BUCKET = "test-bucket"
        // Timeout curto: request aborta em 150ms em vez de esperar para sempre.
        process.env.S3_REQUEST_TIMEOUT_MS = "150"

        // Importa o módulo real (NÃO mocka o SDK) após o env estar pronto.
        const { uploadToS3 } = await import("@/lib/s3")

        const started = Date.now()
        const error = await uploadToS3(Buffer.from("test data"), "foto.jpg").then(
          () => null,
          (e: unknown) => e,
        )
        const elapsed = Date.now() - started

        // uploadToS3 engole o erro do SDK e rethrow a mensagem amigável.
        expect(error).not.toBeNull()
        expect((error as Error).message).toBe("Falha ao fazer upload do arquivo")
        // Bounded: requestTimeout 150ms × retries do SDK (default 3), nunca
        // "para sempre".
        expect(elapsed).toBeLessThan(5_000)
      } finally {
        cleanupHangingServer(server, sockets)
      }
    },
  )
})
