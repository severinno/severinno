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
  sizes: string
  className?: string
}

function isLocalPreview(src: string) {
  return src.startsWith("blob:") || src.startsWith("data:")
}

function SafeImage({ src, alt, sizes, className }: SafeImageProps) {
  if (isLocalPreview(src)) {
    // eslint-disable-next-line @next/next/no-img-element -- blob/data URLs cannot go through the next/image optimizer
    return <img src={src} alt={alt} className={className} />
  }
  return <Image src={src} alt={alt} fill sizes={sizes} className={className} />
}

export { SafeImage }
