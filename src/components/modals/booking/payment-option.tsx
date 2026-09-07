import * as React from "react"
import { Check } from "lucide-react"
import { Label } from "@/components/ui/label"
import { RadioGroupItem } from "@/components/ui/radio-group"
import { cn } from "@/lib/utils"

export function PaymentOption({
  value,
  title,
  description,
  icon: Icon,
  selected,
}: {
  value: string
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  selected: boolean
}) {
  return (
    <Label
      htmlFor={`pay-${value}`}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 transition-all",
        selected
          ? "border-emerald-600 bg-emerald-50/50 ring-1 ring-emerald-600 dark:bg-emerald-950/30"
          : "hover:bg-accent/40 hover:border-emerald-400/50",
      )}
    >
      <RadioGroupItem value={value} id={`pay-${value}`} className="sr-only" />
      <Icon className={cn("size-4", selected ? "text-emerald-600" : "text-muted-foreground")} />
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-tight font-medium">{title}</p>
        <p className="text-muted-foreground text-[10px] leading-tight">{description}</p>
      </div>
      {selected && <Check className="size-3.5 shrink-0 text-emerald-600" />}
    </Label>
  )
}
