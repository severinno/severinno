/**
 * Client-Side Image Compression Utility
 *
 * Compresses images in the browser using HTML5 Canvas before uploading
 * to S3/MinIO. Reduces 5MB-15MB camera photos to ~400KB-800KB without
 * external heavy dependencies, dramatically speeding up uploads on mobile.
 */

export type CompressionOptions = {
  /** Maximum width or height in pixels. Default: 1600 */
  maxDimension?: number
  /** JPEG quality between 0.1 and 1.0. Default: 0.82 */
  quality?: number
  /** Output MIME type. Default: "image/jpeg" */
  mimeType?: string
}

/**
 * Compresses an image File or Blob using HTML5 Canvas.
 * Non-image files (e.g., PDFs) are returned untouched.
 */
export async function compressImageFile(
  file: File,
  options: CompressionOptions = {},
): Promise<File> {
  // If not an image or if running on server side, return as-is
  if (typeof window === "undefined" || !file.type.startsWith("image/")) {
    return file
  }

  // SVGs are vector; don't rasterize/compress
  if (file.type === "image/svg+xml") {
    return file
  }

  const { maxDimension = 1600, quality = 0.82, mimeType = "image/jpeg" } = options

  return new Promise((resolve) => {
    const reader = new FileReader()

    reader.onload = (event) => {
      const img = new Image()

      img.onload = () => {
        let { width, height } = img

        // If image is already smaller than maxDimension and file is < 1MB, skip
        if (width <= maxDimension && height <= maxDimension && file.size < 1024 * 1024) {
          resolve(file)
          return
        }

        // Scale proportionally
        if (width > height) {
          if (width > maxDimension) {
            height = Math.round((height * maxDimension) / width)
            width = maxDimension
          }
        } else {
          if (height > maxDimension) {
            width = Math.round((width * maxDimension) / height)
            height = maxDimension
          }
        }

        const canvas = document.createElement("canvas")
        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext("2d")
        if (!ctx) {
          resolve(file)
          return
        }

        // Optional smooth scaling
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = "high"

        ctx.drawImage(img, 0, 0, width, height)

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file)
              return
            }

            // If compressed is somehow larger than original, keep original
            if (blob.size >= file.size) {
              resolve(file)
              return
            }

            const newFileName = file.name.replace(/\.[^/.]+$/, ".jpg")
            const compressedFile = new File([blob], newFileName, {
              type: mimeType,
              lastModified: Date.now(),
            })

            resolve(compressedFile)
          },
          mimeType,
          quality,
        )
      }

      img.onerror = () => resolve(file)
      img.src = event.target?.result as string
    }

    reader.onerror = () => resolve(file)
    reader.readAsDataURL(file)
  })
}
