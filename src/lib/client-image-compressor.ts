/**
 * client-image-compressor.ts — Client-Side Fast Image Compressor & WebP Converter
 *
 * Compresses 10MB-15MB mobile camera photos into lightweight ~200KB WebP images
 * before network upload, saving user mobile data and server bandwidth.
 *
 * Runs client-side (OffscreenCanvas / Canvas API) with graceful server fallback.
 */

export interface CompressionOptions {
  maxWidth?: number
  maxHeight?: number
  quality?: number // 0.1 to 1.0 (default 0.82)
  outputFormat?: "image/webp" | "image/jpeg" | "image/png"
}

export interface CompressionResult {
  originalSizeBytes: number
  compressedSizeBytes: number
  compressionRatioPercent: number
  width: number
  height: number
  format: string
  dataUrl?: string
}

const DEFAULT_OPTIONS: Required<CompressionOptions> = {
  maxWidth: 1920,
  maxHeight: 1920,
  quality: 0.82,
  outputFormat: "image/webp",
}

/**
 * Calculates new width & height keeping the original aspect ratio
 */
export function calculateProportionalDimensions(
  origWidth: number,
  origHeight: number,
  maxWidth: number = 1920,
  maxHeight: number = 1920
): { width: number; height: number } {
  if (origWidth <= 0 || origHeight <= 0) {
    return { width: maxWidth, height: maxHeight }
  }

  let width = origWidth
  let height = origHeight

  if (width > maxWidth) {
    height = Math.round((height * maxWidth) / width)
    width = maxWidth
  }

  if (height > maxHeight) {
    width = Math.round((width * maxHeight) / height)
    height = maxHeight
  }

  return { width, height }
}

/**
 * Formats byte size into human readable string (KB / MB)
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/**
 * Compresses an image File or Blob in the browser environment
 */
export async function compressImageFile(
  file: File | Blob,
  options: CompressionOptions = {}
): Promise<Blob> {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  if (typeof window === "undefined" || !window.createImageBitmap) {
    // In Node / Server test environment, return original
    return file
  }

  const bitmap = await createImageBitmap(file)
  const { width, height } = calculateProportionalDimensions(
    bitmap.width,
    bitmap.height,
    opts.maxWidth,
    opts.maxHeight
  )

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext("2d")
  if (!ctx) return file

  ctx.drawImage(bitmap, 0, 0, width, height)

  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        resolve(blob || file)
      },
      opts.outputFormat,
      opts.quality
    )
  })
}

/**
 * Simulates and calculates expected compression metrics for given dimensions and size
 */
export function computeCompressionMetrics(
  originalBytes: number,
  origWidth: number,
  origHeight: number,
  options: CompressionOptions = {}
): CompressionResult {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const { width, height } = calculateProportionalDimensions(
    origWidth,
    origHeight,
    opts.maxWidth,
    opts.maxHeight
  )

  // WebP compression approximation: ~0.15 bytes per pixel at 0.82 quality
  const pixelCount = width * height
  const estimatedBytes = Math.round(pixelCount * 0.18 * opts.quality)
  const compressedSizeBytes = Math.min(originalBytes, Math.max(15000, estimatedBytes))

  const saved = Math.max(0, originalBytes - compressedSizeBytes)
  const compressionRatioPercent = Number(((saved / originalBytes) * 100).toFixed(1))

  return {
    originalSizeBytes: originalBytes,
    compressedSizeBytes,
    compressionRatioPercent,
    width,
    height,
    format: opts.outputFormat,
  }
}
