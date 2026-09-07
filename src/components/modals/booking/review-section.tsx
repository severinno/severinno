import * as React from "react"
import { Pencil } from "lucide-react"

export function ReviewSection({
  label,
  onEdit,
  children,
}: {
  label: string
  onEdit: () => void
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <h4 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          {label}
        </h4>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 transition-colors hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
        >
          <Pencil className="size-3" />
          Editar
        </button>
      </div>
      {children}
    </div>
  )
}
