import Image from "next/image"

/**
 * SafeImage — next/image com fallback para URLs não-otimizáveis.
 *
 * blob:/data: URLs (preview local de upload) não podem passar pelo
 * otimizador /_next/image; URLs http(s) (S3/CDN/MinIO) são otimizadas
 * com AVIF/WebP + srcset.
 */

type SafeImageProps = {
  src: string
  alt: string
  sizes?: string
  className?: string
  priority?: boolean
  loading?: "lazy" | "eager"
  unoptimized?: boolean
}

function isOptimizable(src: string): boolean {
  if (!src) return false
  if (src.startsWith("blob:") || src.startsWith("data:")) return false
  if (src.startsWith("/")) return true
  try {
    const parsed = new URL(src)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

function SafeImage({
  src,
  alt,
  sizes = "(max-width: 768px) 100vw, 50vw",
  className,
  priority,
  loading,
  unoptimized,
}: SafeImageProps) {
  if (!isOptimizable(src)) {
    // eslint-disable-next-line @next/next/no-img-element -- non-optimizable (blob/data/relative without /) URL
    return <img src={src} alt={alt} className={className} loading={loading} />
  }
  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      className={className}
      priority={priority}
      loading={loading}
      unoptimized={unoptimized ?? process.env.NODE_ENV === "test"}
    />
  )
}

export { SafeImage }
