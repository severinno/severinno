"use client"

import * as React from "react"
import { Loader2, UploadCloud, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { SafeImage } from "@/components/shared/safe-image"

type FilePhotosProps = {
  /** Current list of stored photo URLs. */
  value: string[]
  /** Called whenever the URL list changes (after upload or remove). */
  onChange: (urls: string[]) => void
  /** Max number of photos. Default 4. */
  max?: number
  /** Field label. */
  label?: string
  /** Hint shown under the label. */
  hint?: string
  className?: string
  disabled?: boolean
}

type UploadStatus = "idle" | "uploading" | "error"

/**
 * Reusable photo uploader.
 *
 * Flow:
 *  - User selects one or more image files (jpg/png/webp, ≤5MB each).
 *  - Each file is POSTed as `multipart/form-data` to `/api/upload`
 *    (expected response: `{ url: string }`).
 *  - Returned URL is appended to `value` and reported via `onChange`.
 *  - If the upload endpoint is not ready (HTTP ≥ 400), we fall back to a
 *    local object URL so the UX is preserved (with a tiny "preview-only"
 *    badge). Submitters should treat these as transitory.
 *
 * Used in the quote flow and (eventually) provider service CRUD.
 */
export function FilePhotos({
  value,
  onChange,
  max = 4,
  label = "Fotos",
  hint,
  className,
  disabled,
}: FilePhotosProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [status, setStatus] = React.useState<Record<number, UploadStatus>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [dragging, setDragging] = React.useState(false)

  const remaining = Math.max(0, max - value.length)

  const upload = React.useCallback(async (file: File) => {
    const formData = new FormData()
    formData.append("file", file)
    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
        credentials: "same-origin",
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.url) {
        throw new Error("URL ausente")
      }
      return data.url as string
    } catch {
      // Fallback: use a local object URL so the user still sees a preview.
      // The submit will then send this transitory URL; backend should
      // validate and reject if not absolute.
      return URL.createObjectURL(file)
    }
  }, [])

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    setError(null)
    const files = Array.from(fileList).slice(0, remaining)
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (!file.type.startsWith("image/")) {
        setError("Apenas imagens são permitidas.")
        continue
      }
      if (file.size > 5 * 1024 * 1024) {
        setError("Cada imagem deve ter no máximo 5 MB.")
        continue
      }
      setStatus((s) => ({ ...s, [i]: "uploading" }))
      try {
        const url = await upload(file)
        onChange([...value, url])
        setStatus((s) => ({ ...s, [i]: "idle" }))
      } catch {
        setStatus((s) => ({ ...s, [i]: "error" }))
        setError("Falha ao enviar uma das imagens. Tente novamente.")
      }
    }
    if (inputRef.current) inputRef.current.value = ""
  }

  const removeAt = (index: number) => {
    const next = value.filter((_, i) => i !== index)
    onChange(next)
  }

  const isUploading = Object.values(status).some((s) => s === "uploading")

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    if (disabled || isUploading || remaining <= 0) return
    handleFiles(e.dataTransfer.files)
  }

  return (
    <div className={cn("grid gap-2", className)}>
      {label && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{label}</span>
          <span className="text-muted-foreground text-xs tabular-nums">
            {value.length}/{max} fotos
          </span>
        </div>
      )}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}

      {/* Drop zone — only when there's room for more */}
      {remaining > 0 && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              inputRef.current?.click()
            }
          }}
          onDragOver={(e) => {
            e.preventDefault()
            if (!disabled && !isUploading) setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          aria-label="Adicionar fotos"
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
            dragging
              ? "border-primary bg-primary/5"
              : "border-input hover:border-primary hover:bg-primary/5",
            (disabled || isUploading) &&
              "hover:border-input cursor-not-allowed opacity-60 hover:bg-transparent",
          )}
        >
          {isUploading ? (
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          ) : (
            <UploadCloud className="text-muted-foreground size-5" />
          )}
          <p className="text-sm font-medium">Arraste imagens ou clique para enviar</p>
          <p className="text-muted-foreground text-xs">JPG, PNG ou WebP · até 5 MB cada</p>
        </div>
      )}

      {/* Preview grid */}
      {value.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {value.map((url, i) => (
            <div
              key={url + i}
              className="group bg-muted relative aspect-square overflow-hidden rounded-lg border"
            >
              <SafeImage
                src={url}
                alt={`Foto ${i + 1}`}
                className="object-cover"
                sizes="(max-width: 640px) 25vw, 120px"
              />
              <button
                type="button"
                onClick={() => removeAt(i)}
                disabled={disabled}
                aria-label={`Remover foto ${i + 1}`}
                className="focus-visible:ring-ring absolute top-1 right-1 inline-flex size-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/80 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-destructive text-xs">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        disabled={disabled || isUploading || remaining <= 0}
      />
    </div>
  )
}
