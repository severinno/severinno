"use client"

import * as React from "react"
import { Camera, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { useUpload } from "@/lib/use-upload"

type Props = {
  currentUrl?: string | null
  onUploaded: (url: string) => void
  type?: string
  className?: string
  size?: "sm" | "md" | "lg"
}

export function PhotoUpload({
  currentUrl,
  onUploaded,
  type = "avatar",
  className,
  size = "md",
}: Props) {
  const { upload, uploading } = useUpload()
  const inputRef = React.useRef<HTMLInputElement>(null)

  const sizeClasses = size === "sm" ? "size-16" : size === "lg" ? "size-32" : "size-24"

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith("image/")) {
      toast.error("Selecione uma imagem")
      return
    }
    const url = await upload(file, type)
    if (url) onUploaded(url)
    if (inputRef.current) inputRef.current.value = ""
  }

  return (
    <div className={cn("relative", sizeClasses, className)}>
      <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className={cn(
          "border-muted-foreground/30 hover:border-primary relative flex size-full items-center justify-center overflow-hidden rounded-full border-2 border-dashed transition-all",
        )}
      >
        {currentUrl ? (
          <img src={currentUrl} alt="" className="size-full object-cover" />
        ) : (
          <Camera className="text-muted-foreground size-5" />
        )}
        {uploading && (
          <div className="bg-background/60 absolute inset-0 flex items-center justify-center rounded-full">
            <Loader2 className="size-5 animate-spin" />
          </div>
        )}
      </button>
    </div>
  )
}
