"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, ToasterProps } from "sonner"
import { CheckCircle2, AlertCircle, AlertTriangle, Info, Loader2, X } from "lucide-react"

const Toaster = ({
  position = "top-center",
  closeButton = true,
  richColors = true,
  duration = 4000,
  visibleToasts = 4,
  ...props
}: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position={position}
      closeButton={closeButton}
      richColors={richColors}
      duration={duration}
      visibleToasts={visibleToasts}
      className="toaster group"
      icons={{
        success: (
          <CheckCircle2 className="size-4.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        ),
        error: <AlertCircle className="size-4.5 shrink-0 text-rose-600 dark:text-rose-400" />,
        warning: <AlertTriangle className="size-4.5 shrink-0 text-amber-600 dark:text-amber-400" />,
        info: <Info className="size-4.5 shrink-0 text-sky-600 dark:text-sky-400" />,
        loading: <Loader2 className="text-primary size-4.5 shrink-0 animate-spin" />,
        close: <X className="size-3.5" />,
      }}
      toastOptions={{
        closeButtonAriaLabel: "Fechar notificação",
        classNames: {
          toast:
            "group toast font-medium border text-xs sm:text-sm select-none transition-all duration-200",
          title: "font-semibold text-xs sm:text-sm leading-snug tracking-tight",
          description: "text-xs opacity-90 leading-relaxed mt-0.5",
          actionButton:
            "rounded-lg text-xs font-semibold px-2.5 py-1.5 shadow-2xs hover:opacity-90 transition-opacity",
          cancelButton:
            "rounded-lg text-xs font-medium px-2.5 py-1.5 hover:opacity-90 transition-opacity",
          closeButton: "toast-close-btn",
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
export default Toaster
