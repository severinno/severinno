/**
 * api-stream.ts — Streaming responses (Chunked Transfer) para APIs de alta volumetria.
 *
 * Permite descarregar coleções massivas de dados (JSON Array, NDJSON e CSV)
 * diretamente de cursores assíncronos ou geradores para o cliente HTTP,
 * mantendo o consumo de memória (V8 heap) constante O(1) e eliminando estouros de RAM.
 */

import { formatCSVLine } from "./streaming-exporter"

export interface StreamJsonOptions extends ResponseInit {
  pretty?: boolean
}

/**
 * Cria uma resposta HTTP com Transfer-Encoding: chunked transmitindo um array JSON válido.
 * Formato gerado:
 * [
 * {"id": 1, ...},
 * {"id": 2, ...}
 * ]
 */
export function streamJsonArray<T>(
  generator: AsyncIterable<T> | Iterable<T>,
  options?: StreamJsonOptions,
): Response {
  const encoder = new TextEncoder()
  const pretty = options?.pretty ?? false
  const indent = pretty ? "  " : ""
  const newline = pretty ? "\n" : ""

  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(`[${newline}`))
        let first = true

        for await (const item of generator) {
          if (!first) {
            controller.enqueue(encoder.encode(`,${newline}`))
          }
          first = false
          const jsonStr = pretty ? JSON.stringify(item, null, 2) : JSON.stringify(item)
          controller.enqueue(encoder.encode(`${indent}${jsonStr}`))
        }

        controller.enqueue(encoder.encode(`${newline}]\n`))
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })

  return new Response(stream, {
    ...options,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
      ...(options?.headers || {}),
    },
  })
}

/**
 * Cria uma resposta HTTP transmitindo Newline Delimited JSON (NDJSON).
 * Cada item é serializado em sua própria linha terminada em `\n`.
 */
export function streamNdjson<T>(
  generator: AsyncIterable<T> | Iterable<T>,
  init?: ResponseInit,
): Response {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const item of generator) {
          controller.enqueue(encoder.encode(JSON.stringify(item) + "\n"))
        }
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })

  return new Response(stream, {
    ...init,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
      ...(init?.headers || {}),
    },
  })
}

/**
 * Cria uma resposta HTTP transmitindo CSV RFC 4180 com UTF-8 BOM e delimitador configurável.
 */
export function streamCsv(
  headers: string[],
  rowsGenerator: AsyncIterable<unknown[]> | Iterable<unknown[]>,
  options?: { delimiter?: string; filename?: string },
): Response {
  const delimiter = options?.delimiter ?? ";"
  const encoder = new TextEncoder()
  const BOM = "\uFEFF"

  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(BOM + formatCSVLine(headers, delimiter)))
        for await (const row of rowsGenerator) {
          controller.enqueue(encoder.encode(formatCSVLine(row, delimiter)))
        }
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })

  const filename = options?.filename ?? `export-${new Date().toISOString().slice(0, 10)}.csv`

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-cache, no-transform",
    },
  })
}
