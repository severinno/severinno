"use client"

import { useState, useCallback } from "react"
import { toast } from "sonner"
import { compressImageFile } from "@/lib/client-image-compression"

export function useUpload() {
  const [uploading, setUploading] = useState(false)

  const upload = useCallback(async (file: File, type = "avatar"): Promise<string | null> => {
    setUploading(true)
    try {
      let fileToUpload = file
      if (file.type.startsWith("image/") && file.type !== "image/svg+xml") {
        try {
          fileToUpload = await compressImageFile(file, {
            maxWidth: 1920,
            maxHeight: 1080,
            quality: 0.82,
          })
        } catch {
          fileToUpload = file
        }
      }

      const form = new FormData()
      form.append("file", fileToUpload)
      form.append("type", type)

      const res = await fetch("/api/upload", {
        method: "POST",
        body: form,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }))
        throw new Error(err.error ?? "Upload failed")
      }

      const data = await res.json()
      return data.url
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erro ao fazer upload"
      toast.error(msg)
      return null
    } finally {
      setUploading(false)
    }
  }, [])

  return { upload, uploading }
}
