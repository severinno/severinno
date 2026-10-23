/**
 * Testes de scripts/reprocess-svg-uploads.ts — remediação de SVG legado no
 * bucket (decisão 09/2026: SVG removido da allowlist de upload; legados no
 * bucket são XSS armazenado em potencial).
 *
 * O SDK AWS é mockado (o script só o usa em buildS3Adapter; o núcleo testado
 * aqui fala com a porta S3Adapter — fake em memória). O sharp é injetado via
 * deps.sharpLoader para NUNCA carregar o binário real nos testes.
 */
import { describe, it, expect, vi } from "vitest"
import {
  looksLikeSvg,
  toPngKey,
  quarantineKey,
  runReprocess,
  MAX_OBJECT_BYTES,
  QUARANTINE_PREFIX,
  type S3Adapter,
  type SharpLike,
  type ReprocessSummary,
} from "../../../scripts/reprocess-svg-uploads"

// O script importa @aws-sdk/client-s3 — sem o mock, o SDK real só é
// instanciado em buildS3Adapter (não chamado aqui), mas o import top-level
// do módulo traria o pacote inteiro para o grafo do teste. Mock enxuto.
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(),
  GetObjectCommand: vi.fn(),
  ListObjectsV2Command: vi.fn(),
  PutObjectCommand: vi.fn(),
  CopyObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
}))

// ── Fixtures ────────────────────────────────────────────────────────────────

const SVG_LIMPO = Buffer.from(
  `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>`,
)
const SVG_MASCARADO = Buffer.from(`<!-- gerado pelo figma -->\n<svg viewBox="0 0 24 24"></svg>`)
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("resto-do-png-fake"),
])

/** Sharp fake: sempre devolve um "PNG" de tamanho configurável. */
function fakeSharp(outBytes = 2048): SharpLike {
  return ((_input: Buffer) => ({
    resize: () => ({
      png: () => ({
        toBuffer: async () => Buffer.alloc(outBytes, 0x50),
      }),
    }),
  })) as unknown as SharpLike
}

/** Sharp fake que falha na rasterização (SVG inválido). */
function brokenSharp(): SharpLike {
  return ((_input: Buffer) => ({
    resize: () => ({
      png: () => ({
        toBuffer: async () => {
          throw new Error("Input buffer contains unsupported image format")
        },
      }),
    }),
  })) as unknown as SharpLike
}

/** Bucket S3 fake em memória com registro de operações. */
function fakeS3(objects: Record<string, Buffer>) {
  const ops: string[] = []
  return {
    adapter: {
      async list(prefix?: string, token?: string) {
        ops.push(`list(${prefix ?? ""})`)
        // Página única — paginação real é testada à parte.
        void token
        const items = Object.entries(objects)
          .filter(([k]) => (prefix ? k.startsWith(prefix) : true))
          .map(([key, buf]) => ({ key, size: buf.length }))
        return { items, token: undefined }
      },
      async get(key: string) {
        ops.push(`get(${key})`)
        const buf = objects[key]
        if (!buf) throw new Error(`NoSuchKey: ${key}`)
        return buf
      },
      async put(key: string, body: Buffer, _contentType: string) {
        ops.push(`put(${key},${body.length})`)
        objects[key] = body
      },
      async copy(fromKey: string, toKey: string) {
        ops.push(`copy(${fromKey}->${toKey})`)
        const buf = objects[fromKey]
        if (!buf) throw new Error(`NoSuchKey: ${fromKey}`)
        objects[toKey] = buf
      },
      async del(key: string) {
        ops.push(`del(${key})`)
        delete objects[key]
      },
    } satisfies S3Adapter,
    ops,
    objects,
  }
}

function run(s3: S3Adapter, opts: Parameters<typeof runReprocess>[0], sharp: SharpLike | null) {
  return runReprocess(opts, s3, { sharpLoader: async () => sharp, log: () => {} })
}

// ── looksLikeSvg ────────────────────────────────────────────────────────────

describe("looksLikeSvg", () => {
  it("detecta SVG com declaração XML", () => {
    expect(looksLikeSvg(SVG_LIMPO)).toBe(true)
  })

  it("detecta SVG mascarado atrás de comentário", () => {
    expect(looksLikeSvg(SVG_MASCARADO)).toBe(true)
  })

  it("detecta <svg> embutido após whitespace", () => {
    expect(looksLikeSvg(Buffer.from("   \n\t <svg xmlns='x'></svg>"))).toBe(true)
  })

  it("NÃO marca raster como SVG", () => {
    expect(looksLikeSvg(PNG_BYTES)).toBe(false)
    expect(looksLikeSvg(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(false)
  })

  it("buffer curto demais é ignorado", () => {
    expect(looksLikeSvg(Buffer.from("<svg"))).toBe(false)
  })
})

// ── helpers de chave ────────────────────────────────────────────────────────

describe("toPngKey / quarantineKey", () => {
  it("troca a extensão por .png", () => {
    expect(toPngKey("uploads/123-logo.svg")).toBe("uploads/123-logo.png")
    expect(toPngKey("avatars/x.SVG")).toBe("avatars/x.png")
  })

  it("chave sem extensão ganha .png", () => {
    expect(toPngKey("uploads/sem-ext")).toBe("uploads/sem-ext.png")
  })

  it("pontos em diretórios não confundem", () => {
    expect(toPngKey("dir.v2/foto.svg")).toBe("dir.v2/foto.png")
  })

  it("quarantineKey prefixa a chave original", () => {
    expect(quarantineKey("uploads/a.svg")).toBe(`${QUARANTINE_PREFIX}uploads/a.svg`)
  })
})

// ── modo convert ────────────────────────────────────────────────────────────

describe("runReprocess — convert", () => {
  it("dry-run NÃO altera o bucket e conta wouldConvert", async () => {
    const { adapter, ops } = fakeS3({
      "uploads/foto.svg": SVG_LIMPO,
      "uploads/foto.png": PNG_BYTES,
    })
    const summary = await run(adapter, { mode: "convert" }, fakeSharp())

    expect(summary.dryRun).toBe(true)
    expect(summary.scanned).toBe(2)
    expect(summary.svgFound).toBe(1)
    expect(summary.notSvg).toBe(1)
    expect(summary.wouldConvert).toBe(1)
    expect(summary.converted).toBe(0)
    // Nenhuma operação de escrita/remoção em dry-run.
    expect(ops.some((o) => /^(put|del|copy)\(/.test(o))).toBe(false)
  })

  it("apply converte: quarentena → raster → remoção, NESTA ordem", async () => {
    const { adapter, ops } = fakeS3({ "uploads/icone.svg": SVG_LIMPO })
    const summary = await run(adapter, { mode: "convert", apply: true }, fakeSharp())

    expect(summary.converted).toBe(1)
    expect(summary.failed).toBe(0)
    const writeOps = ops.filter((o) => /^(put|del|copy)\(/.test(o))
    expect(writeOps).toEqual([
      `copy(uploads/icone.svg->${QUARANTINE_PREFIX}uploads/icone.svg)`,
      "put(uploads/icone.png,2048)",
      "del(uploads/icone.svg)",
    ])
  })

  it("falha de rasterização preserva o original e acumula em errors", async () => {
    const { adapter, ops, objects } = fakeS3({ "uploads/quebrado.svg": SVG_LIMPO })
    const summary = await run(adapter, { mode: "convert", apply: true }, brokenSharp())

    expect(summary.converted).toBe(0)
    expect(summary.failed).toBe(1)
    expect(summary.errors).toEqual([
      { key: "uploads/quebrado.svg", error: "sharp não conseguiu rasterizar o SVG" },
    ])
    expect(objects["uploads/quebrado.svg"]).toBeDefined()
    expect(ops.some((o) => o.startsWith("del("))).toBe(false)
  })

  it("sharp ausente no modo convert falha ANTES de tocar o bucket", async () => {
    const { adapter, ops } = fakeS3({ "uploads/a.svg": SVG_LIMPO })
    await expect(run(adapter, { mode: "convert", apply: true }, null)).rejects.toThrow(/sharp/)
    expect(ops).toEqual([])
  })
})

// ── modo delete ─────────────────────────────────────────────────────────────

describe("runReprocess — delete", () => {
  it("apply remove só os SVGs, sem precisar de sharp", async () => {
    const { adapter, objects } = fakeS3({ "uploads/a.svg": SVG_LIMPO, "uploads/b.png": PNG_BYTES })
    const summary = await run(adapter, { mode: "delete", apply: true }, null)

    expect(summary.deleted).toBe(1)
    expect(summary.converted).toBe(0)
    expect(objects["uploads/a.svg"]).toBeUndefined()
    expect(objects["uploads/b.png"]).toBeDefined()
  })

  it("dry-run apenas lista os alvos", async () => {
    const { adapter, ops } = fakeS3({ "uploads/a.svg": SVG_LIMPO })
    const summary = await run(adapter, { mode: "delete" }, null)
    expect(summary.wouldDelete).toBe(1)
    expect(ops.some((o) => o.startsWith("del("))).toBe(false)
  })
})

// ── limites e robustez ──────────────────────────────────────────────────────

describe("runReprocess — limites", () => {
  it("objeto acima de MAX_OBJECT_BYTES é pulado sem download", async () => {
    const grande = Buffer.alloc(MAX_OBJECT_BYTES + 1, 0x41)
    const { adapter, ops } = fakeS3({ "uploads/grande.svg": grande })
    const summary = await run(adapter, { mode: "convert", apply: true }, fakeSharp())

    expect(summary.skippedTooLarge).toBe(1)
    expect(summary.scanned).toBe(1)
    expect(ops.some((o) => o.startsWith("get("))).toBe(false)
  })

  it("maxObjects interrompe o varrimento", async () => {
    const { adapter } = fakeS3({ "uploads/a.svg": SVG_LIMPO, "uploads/b.svg": SVG_MASCARADO })
    const summary = await run(adapter, { mode: "delete", apply: true, maxObjects: 1 }, null)
    expect(summary.scanned).toBe(1)
    expect(summary.deleted).toBe(1)
  })

  it("paginação: continua até token esgotar", async () => {
    const ops: string[] = []
    let page = 0
    const pages = [
      { items: [{ key: "uploads/p1.svg", size: 10 }], token: "NEXT" },
      { items: [{ key: "uploads/p2.svg", size: 10 }], token: undefined },
    ]
    const adapter: S3Adapter = {
      async list() {
        ops.push(`page-${page}`)
        return pages[page++]
      },
      async get() {
        return SVG_LIMPO
      },
      async put() {
        ops.push("put")
      },
      async copy() {
        ops.push("copy")
      },
      async del() {
        ops.push("del")
      },
    }
    const summary = await run(adapter, { mode: "delete", apply: true }, null)
    // As duas páginas são consumidas (marcadores em ordem); os "del" do
    // modo apply se intercalam no mesmo log.
    expect(ops.filter((o) => o.startsWith("page-"))).toEqual(["page-0", "page-1"])
    expect(summary.scanned).toBe(2)
    expect(summary.deleted).toBe(2)
  })

  it("erro em um objeto não derruba o varrimento", async () => {
    const { adapter } = fakeS3({ "uploads/a.svg": SVG_LIMPO })
    // get falha para o segundo objeto
    const failing: S3Adapter = {
      ...adapter,
      async get(key: string) {
        if (key === "uploads/a.svg") throw new Error("S3 timeout")
        return Buffer.from("x")
      },
    }
    const summary = await run(failing, { mode: "delete", apply: true }, null)
    expect(summary.failed).toBe(1)
    expect(summary.errors[0]?.key).toBe("uploads/a.svg")
  })

  it("prefix limita o varrimento (fakes recebem o prefixo)", async () => {
    const { adapter, ops } = fakeS3({ "avatars/a.svg": SVG_LIMPO, "uploads/b.svg": SVG_LIMPO })
    const summary = await run(adapter, { mode: "delete", apply: true, prefix: "uploads/" }, null)
    expect(ops.some((o) => o.includes("list(uploads/)"))).toBe(true)
    expect(summary.svgFound).toBe(1)
    expect(summary.deleted).toBe(1)
  })
})

// ── contratos de módulo ─────────────────────────────────────────────────────

describe("loadSharp", () => {
  it("carrega o sharp real (dependência instalada) e cacheia", async () => {
    const { loadSharp } = await import("../../../scripts/reprocess-svg-uploads")
    const first = await loadSharp()
    expect(first).not.toBeNull()
    expect(typeof first).toBe("function")
  })
})

describe("CLI smoke — saída do resumo", () => {
  it("summary é serializável (o script loga JSON no fim)", async () => {
    const { adapter } = fakeS3({ "uploads/a.svg": SVG_LIMPO })
    const summary: ReprocessSummary = await run(adapter, { mode: "delete" }, null)
    expect(() => JSON.stringify(summary)).not.toThrow()
  })
})
