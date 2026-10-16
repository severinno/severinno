import { describe, it, expect } from "vitest"
import { streamJsonArray, streamNdjson, streamCsv } from "../api-stream"

describe("api-stream", () => {
  describe("streamJsonArray", () => {
    it("converte generator em array JSON válido", async () => {
      async function* generateItems() {
        yield { id: 1, name: "Alpha" }
        yield { id: 2, name: "Beta" }
        yield { id: 3, name: "Gamma" }
      }

      const response = streamJsonArray(generateItems())
      expect(response.headers.get("Content-Type")).toContain("application/json")

      const text = await response.text()
      const parsed = JSON.parse(text)
      expect(parsed).toEqual([
        { id: 1, name: "Alpha" },
        { id: 2, name: "Beta" },
        { id: 3, name: "Gamma" },
      ])
    })

    it("lida corretamente com generator vazio", async () => {
      async function* emptyGenerator() {
        // empty
      }

      const response = streamJsonArray(emptyGenerator())
      const text = await response.text()
      const parsed = JSON.parse(text)
      expect(parsed).toEqual([])
    })
  })

  describe("streamNdjson", () => {
    it("emite registros linha a linha em NDJSON", async () => {
      async function* generateLogs() {
        yield { event: "click", ts: 100 }
        yield { event: "purchase", ts: 200 }
      }

      const response = streamNdjson(generateLogs())
      expect(response.headers.get("Content-Type")).toContain("application/x-ndjson")

      const text = await response.text()
      const lines = text.trim().split("\n")
      expect(lines).toHaveLength(2)
      expect(JSON.parse(lines[0])).toEqual({ event: "click", ts: 100 })
      expect(JSON.parse(lines[1])).toEqual({ event: "purchase", ts: 200 })
    })
  })

  describe("streamCsv", () => {
    it("emite CSV com UTF-8 BOM e headers", async () => {
      const headers = ["ID", "Nome", "Valor"]
      async function* generateRows() {
        yield ["1", "Serviço A", "150,00"]
        yield ["2", "Serviço B", "280,00"]
      }

      const response = streamCsv(headers, generateRows(), { delimiter: ";" })
      expect(response.headers.get("Content-Type")).toContain("text/csv")
      expect(response.headers.get("Content-Disposition")).toContain("attachment;")

      const buf = new Uint8Array(await response.arrayBuffer())
      // UTF-8 BOM is 0xEF, 0xBB, 0xBF
      expect(buf[0]).toBe(0xef)
      expect(buf[1]).toBe(0xbb)
      expect(buf[2]).toBe(0xbf)

      const text = new TextDecoder().decode(buf)
      expect(text).toContain("ID;Nome;Valor")
      expect(text).toContain("1;Serviço A;150,00")
      expect(text).toContain("2;Serviço B;280,00")
    })
  })
})
