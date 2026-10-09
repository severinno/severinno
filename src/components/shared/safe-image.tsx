import Image from "next/image"
import { generateShimmerSvg } from "@/lib/image-optimization"

/**
 * SafeImage — next/image com fallback para URLs não-otimizáveis
 * e suporte nativo a LQIP Shimmer para eliminar CLS (Cumulative Layout Shift).
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
  blur?: boolean
  blurDataURL?: string
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
  blur,
  blurDataURL,
}: SafeImageProps) {
  if (!isOptimizable(src)) {
     
    return (
      <img
        src={src}
        alt={alt}
        className={`h-full w-full object-cover ${className ?? ""}`.trim()}
        loading={loading}
      />
    )
  }

  const hasBlur = blur || !!blurDataURL
  const effectiveBlurUrl = blurDataURL ?? (blur ? generateShimmerSvg() : undefined)

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      className={className}
      priority={priority}
      loading={loading}
      placeholder={hasBlur ? "blur" : "empty"}
      blurDataURL={effectiveBlurUrl}
      unoptimized={unoptimized ?? process.env.NODE_ENV === "test"}
    />
  )
}

export { SafeImage }
