"use client"

import { useState, useCallback } from "react"
import { toast } from "sonner"

export function useUpload() {
  const [uploading, setUploading] = useState(false)

  const upload = useCallback(async (file: File, type = "avatar"): Promise<string | null> => {
    setUploading(true)
    try {
      const form = new FormData()
      form.append("file", file)
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
