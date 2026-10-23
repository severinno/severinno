#!/usr/bin/env bun
/**
 * reprocess-svg-uploads.ts — remediação de SVG legado no bucket S3/R2/MinIO.
 *
 * Contexto (09/2026): SVG foi REMOVIDO da allowlist de upload
 * (src/lib/file-signature.ts) por ser XML ativo — pode embutir <script>,
 * onload= e <foreignObject>; servido do bucket público na mesma origem do
 * app, é XSS armazenado. Arquivos enviados ANTES do bloqueio continuam no
 * bucket — este script os reprocessa.
 *
 * Como funciona:
 *   1. Lista TODOS os objetos do bucket (paginação via ContinuationToken).
 *   2. Baixa e detecta SVG PELO CONTEÚDO (asssinatura textual — a extensão
 *      da chave não é confiável; um .jpg pode ser um SVG renomeado).
 *   3. Objetos que não são SVG: intocados. Maiores que MAX_OBJECT_BYTES:
 *      pulados (SVG legítimo nunca é tão grande; evita baixar peso morto).
 *   4. SVG encontrado:
 *        - modo `convert` (default): rasteriza com sharp → PNG; SÓ DEPOIS de
 *          rasterizar com sucesso: (a) copia o original para
 *          `quarantine/svg-legacy/<chave>` (recuperável), (b) escreve o
 *          raster na mesma chave com extensão .png e (c) remove o SVG
 *          original. Qualquer falha preserva o original no lugar.
 *        - modo `delete`: remove o objeto direto.
 *
 * Segurança do operador: por padrão roda em DRY-RUN (nenhuma escrita).
 * Só altera o bucket com `--apply`.
 *
 * Usage:
 *   bun scripts/reprocess-svg-uploads.ts                 # dry-run, converter
 *   bun scripts/reprocess-svg-uploads.ts --apply         # converter de verdade
 *   bun scripts/reprocess-svg-uploads.ts --apply --delete
 *   bun scripts/reprocess-svg-uploads.ts --prefix uploads/ --max 500
 *
 * Environment: S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET
 *              (S3_REGION opcional, default "auto").
 *
 * Exit codes: 0 = OK | 1 = erro de config/execução | 2 = concluído com falhas.
 */

import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3"

// ── Configuração ────────────────────────────────────────────────────────────

/** Limite de tamanho de objeto para baixar/avaliar (SVG legítimo nunca passa disso). */
export const MAX_OBJECT_BYTES = 15 * 1024 * 1024

/** Prefixo onde o SVG original é guardado (cópia) após conversão bem-sucedida. */
export const QUARANTINE_PREFIX = "quarantine/svg-legacy/"

/** Largura máxima do raster gerado (mantém proporção). */
export const RASTER_WIDTH = 1024

// ── Tipos ───────────────────────────────────────────────────────────────────

export interface ObjectRef {
  key: string
  size: number
}

export interface ListPage {
  items: ObjectRef[]
  /** ContinuationToken para a próxima página (undefined = fim). */
  token?: string
}

/** Porta mínima de S3 — injetável nos testes (fake adapter). */
export interface S3Adapter {
  list(prefix: string | undefined, token: string | undefined): Promise<ListPage>
  get(key: string): Promise<Buffer>
  put(key: string, body: Buffer, contentType: string): Promise<void>
  /** Cópia server-side (sem baixar) — usada para quarentena do original. */
  copy(fromKey: string, toKey: string): Promise<void>
  del(key: string): Promise<void>
}

/** Chave de quarentena: quarantine/svg-legacy/<chave original>. */
export function quarantineKey(key: string): string {
  return QUARANTINE_PREFIX + key
}

export type ReprocessMode = "convert" | "delete"

export interface ReprocessOptions {
  mode?: ReprocessMode
  /** Executa de verdade (default false = dry-run). */
  apply?: boolean
  /** Lista apenas objetos sob este prefixo (default: bucket inteiro). */
  prefix?: string
  /** Para o varrimento após N objetos avaliados (proteção/amostragem). */
  maxObjects?: number
}

export interface ReprocessSummary {
  mode: ReprocessMode
  dryRun: boolean
  scanned: number
  svgFound: number
  notSvg: number
  skippedTooLarge: number
  converted: number
  deleted: number
  wouldConvert: number
  wouldDelete: number
  failed: number
  errors: Array<{ key: string; error: string }>
}

/** Subset da API do sharp usada aqui (facilita mock nos testes). */
type SharpPipeline = {
  resize(o?: unknown): { png(): { toBuffer(): Promise<Buffer> } }
}
export type SharpLike = (input: Buffer, opts?: Record<string, unknown>) => SharpPipeline

// ── Sharp (import sob demanda — uso direto começa com este script) ─────────

let sharpCache: Promise<SharpLike | null> | null = null

/** Carrega o sharp uma única vez; null se indisponível (modo delete não precisa). */
export function loadSharp(): Promise<SharpLike | null> {
  if (!sharpCache) {
    sharpCache = import("sharp")
      .then((mod) => {
        const candidate = (mod as unknown as { default?: unknown }).default ?? mod
        return candidate as SharpLike
      })
      .catch(() => null)
  }
  return sharpCache
}

// ── Detecção por conteúdo ───────────────────────────────────────────────────

/**
 * Detecta SVG pela assinatura textual do início do buffer (espelha a
 * heurística de rejeição do file-signature.ts, inclusive `<svg` embutido
 * após comentário/whitespace — arquivos mascarados).
 */
export function looksLikeSvg(buf: Uint8Array): boolean {
  if (!buf || buf.length < 5) return false
  const head = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, 512)).trimStart()
  return (
    head.startsWith("<?xml") ||
    head.startsWith("<svg") ||
    head.startsWith("<!--") ||
    head.includes("<svg")
  )
}

/** uploads/123-logo.svg → uploads/123-logo.png; chave sem extensão ganha .png. */
export function toPngKey(key: string): string {
  const dot = key.lastIndexOf(".")
  const slash = key.lastIndexOf("/")
  const hasExt = dot > slash + 1
  return (hasExt ? key.slice(0, dot) : key) + ".png"
}

// ── Rasterização ────────────────────────────────────────────────────────────

/** Rasteriza SVG → PNG. Retorna null em qualquer falha (não propaga). */
async function rasterize(sharp: SharpLike, buf: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(buf, { density: 150 })
      .resize({
        width: RASTER_WIDTH,
        height: RASTER_WIDTH,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer()
  } catch {
    return null
  }
}

// ── Adapter S3 real ─────────────────────────────────────────────────────────

/** Monta o adapter S3 a partir do ambiente (falha listando as variáveis ausentes). */
export function buildS3Adapter(env: NodeJS.ProcessEnv = process.env): S3Adapter {
  const missing = (["S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET"] as const).filter(
    (k) => !env[k],
  )
  if (missing.length > 0) {
    throw new Error(`Variáveis de ambiente ausentes: ${missing.join(", ")}`)
  }

  const endpoint = env.S3_ENDPOINT as string
  const bucket = env.S3_BUCKET as string
  const client = new S3Client({
    endpoint,
    region: env.S3_REGION || "auto",
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY as string,
      secretAccessKey: env.S3_SECRET_KEY as string,
    },
    // R2 usa virtual-hosted style; MinIO/aws usa path style (convenção do lib/s3.ts).
    forcePathStyle: !endpoint.includes("r2.cloudflarestorage.com"),
    requestHandler: { requestTimeout: 60_000 },
  })

  return {
    async list(prefix, token) {
      const res = await client.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
      )
      return {
        items: (res.Contents ?? []).map((o) => ({ key: o.Key as string, size: o.Size ?? 0 })),
        token: res.IsTruncated ? res.NextContinuationToken : undefined,
      }
    },
    async get(key) {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      if (!res.Body) throw new Error(`objeto sem corpo: ${key}`)
      return Buffer.from(await res.Body.transformToByteArray())
    },
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
      )
    },
    async copy(fromKey, toKey) {
      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: toKey,
          CopySource: `/${bucket}/${fromKey}`,
        }),
      )
    },
    async del(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    },
  }
}

// ── Núcleo (exportado para testes) ─────────────────────────────────────────

interface ProcessContext {
  mode: ReprocessMode
  dryRun: boolean
  s3: S3Adapter
  sharp: SharpLike | null
  summary: ReprocessSummary
  log: (msg: string) => void
}

async function processObject(item: ObjectRef, ctx: ProcessContext): Promise<void> {
  const { mode, dryRun, s3, summary, log } = ctx

  if (item.size > MAX_OBJECT_BYTES) {
    summary.skippedTooLarge++
    log(`[skip] ${item.key}: objeto maior que ${MAX_OBJECT_BYTES} bytes`)
    return
  }

  const buf = await s3.get(item.key)
  if (!looksLikeSvg(buf)) {
    summary.notSvg++
    return
  }
  summary.svgFound++

  if (mode === "delete") {
    if (dryRun) {
      summary.wouldDelete++
      log(`[dry-run] removeria ${item.key}`)
      return
    }
    await s3.del(item.key)
    summary.deleted++
    log(`[removido] ${item.key}`)
    return
  }

  // modo convert — rasteriza ANTES de qualquer escrita (falha não toca o bucket)
  const png = ctx.sharp ? await rasterize(ctx.sharp, buf) : null
  if (!png || png.length === 0) {
    summary.failed++
    summary.errors.push({ key: item.key, error: "sharp não conseguiu rasterizar o SVG" })
    log(`[falha] ${item.key}: rasterização falhou — original preservado`)
    return
  }
  const pngKey = toPngKey(item.key)
  if (dryRun) {
    summary.wouldConvert++
    log(
      `[dry-run] converteria ${item.key} → ${pngKey} (${png.length} bytes); original → ${quarantineKey(item.key)}`,
    )
    return
  }
  // Ordem deliberada: (1) quarentena server-side preserva o original;
  // (2) raster substituto vai ao ar; (3) só então o SVG é removido.
  // Se (3) falhar, o objeto continua no lugar — re-executar o script é
  // idempotente (a cópia de quarentena sobrescreve; o raster é regravado).
  await s3.copy(item.key, quarantineKey(item.key))
  await s3.put(pngKey, png, "image/png")
  await s3.del(item.key)
  summary.converted++
  log(
    `[convertido] ${item.key} → ${pngKey} (${png.length} bytes); original em ${quarantineKey(item.key)}`,
  )
}

/**
 * Varre o bucket e remedia os SVGs encontrados conforme o modo.
 * Nunca lança por falha de objeto individual — acumula em summary.errors.
 */
export async function runReprocess(
  options: ReprocessOptions = {},
  s3: S3Adapter,
  deps: { sharpLoader?: () => Promise<SharpLike | null>; log?: (msg: string) => void } = {},
): Promise<ReprocessSummary> {
  const mode: ReprocessMode = options.mode ?? "convert"
  const dryRun = !options.apply
  const log = deps.log ?? ((msg: string) => console.log(msg))

  const summary: ReprocessSummary = {
    mode,
    dryRun,
    scanned: 0,
    svgFound: 0,
    notSvg: 0,
    skippedTooLarge: 0,
    converted: 0,
    deleted: 0,
    wouldConvert: 0,
    wouldDelete: 0,
    failed: 0,
    errors: [],
  }

  let sharp: SharpLike | null = null
  if (mode === "convert") {
    sharp = await (deps.sharpLoader ?? loadSharp)()
    if (!sharp) {
      throw new Error(
        'sharp indisponível — rode "bun install" ou use --delete para apenas remover os SVGs',
      )
    }
  }

  const ctx: ProcessContext = { mode, dryRun, s3, sharp, summary, log }
  const limit = options.maxObjects ?? Number.POSITIVE_INFINITY

  let token: string | undefined
  do {
    const page = await s3.list(options.prefix, token)
    for (const item of page.items) {
      if (summary.scanned >= limit) return summary
      summary.scanned++
      try {
        await processObject(item, ctx)
      } catch (err) {
        summary.failed++
        summary.errors.push({ key: item.key, error: (err as Error).message })
        log(`[falha] ${item.key}: ${(err as Error).message}`)
      }
    }
    token = page.token
  } while (token)

  log(`[svg-remediation] resumo: ${JSON.stringify(summary)}`)
  return summary
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function usage(): string {
  return [
    "Uso: bun scripts/reprocess-svg-uploads.ts [opções]",
    "",
    "Opções:",
    "  --apply        executa de verdade (padrão: dry-run, só relatório)",
    "  --delete       remove os SVGs em vez de converter para PNG",
    "  --prefix <p>   limita o varrimento a um prefixo (ex.: uploads/)",
    "  --max <n>      avalia no máximo N objetos nesta execução",
    "  -h, --help     esta ajuda",
    "",
    "Environment: S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET",
  ].join("\n")
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage())
    return 0
  }

  const mode: ReprocessMode = argv.includes("--delete") ? "delete" : "convert"
  const apply = argv.includes("--apply")
  const prefixIdx = argv.indexOf("--prefix")
  const prefix = prefixIdx >= 0 ? argv[prefixIdx + 1] : undefined
  const maxIdx = argv.indexOf("--max")
  const maxObjects = maxIdx >= 0 ? Number(argv[maxIdx + 1]) : undefined

  console.log(
    `[svg-remediation] modo=${mode} ${apply ? "APPLY" : "DRY-RUN (use --apply para executar)"}`,
  )

  const s3 = buildS3Adapter()
  const summary = await runReprocess({ mode, apply, prefix, maxObjects }, s3)
  return summary.failed > 0 ? 2 : 0
}

if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`[svg-remediation] ERRO: ${(err as Error).message}`)
      process.exit(1)
    })
}
