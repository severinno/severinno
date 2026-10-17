"use client"

/**
 * ReviewDialog — modal for submitting a review after a service is completed.
 *
 * Uses StarRatingInput + comment textarea. Submits POST /api/reviews with
 * { bookingId, rating, comment }. On success: toast + invalidate bookings
 * queries (so the row updates with the review attached).
 */

import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, Star, ShieldCheck, Camera, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { apiPost } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { StarRatingInput } from "@/components/modals/star-rating"
import { cn } from "@/lib/utils"

const QUICK_COMPLIMENTS = [
  "Pontual no horário",
  "Caprichoso no acabamento",
  "Preço justo",
  "Deixou tudo limpo",
  "Muito educado",
  "Recomendo em GV",
]

export type ReviewDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  booking: {
    id: string
    service?: { title?: string } | null
    provider?: { id?: string; name?: string; avatarUrl?: string | null } | null
  } | null
  onSubmitted?: () => void
}

export function ReviewDialog({ open, onOpenChange, booking, onSubmitted }: ReviewDialogProps) {
  const qc = useQueryClient()
  const [rating, setRating] = React.useState(0)
  const [comment, setComment] = React.useState("")
  const [beforePhotoUrl, setBeforePhotoUrl] = React.useState("")
  const [afterPhotoUrl, setAfterPhotoUrl] = React.useState("")

  // Reset when the dialog reopens or the booking changes (adjust state during render)
  const [prevOpen, setPrevOpen] = React.useState(open)
  const [prevBookingId, setPrevBookingId] = React.useState(booking?.id ?? null)
  if (open && (prevOpen !== open || prevBookingId !== (booking?.id ?? null))) {
    setPrevOpen(open)
    setPrevBookingId(booking?.id ?? null)
    setRating(0)
    setComment("")
    setBeforePhotoUrl("")
    setAfterPhotoUrl("")
  }

  const submit = useMutation({
    mutationFn: () =>
      apiPost("/api/reviews", {
        bookingId: booking?.id,
        rating,
        comment: comment.trim() || undefined,
        beforePhotoUrl: beforePhotoUrl.trim() || undefined,
        afterPhotoUrl: afterPhotoUrl.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success("Avaliação enviada. Obrigado pelo seu feedback!")
      qc.invalidateQueries({ queryKey: ["bookings"] })
      qc.invalidateQueries({ queryKey: ["reviews"] })
      qc.invalidateQueries({ queryKey: ["client", "reviews"] })
      qc.invalidateQueries({ queryKey: ["client", "dashboard"] })
      onSubmitted?.()
      onOpenChange(false)
    },
    onError: (e: { message?: string }) => {
      toast.error(e?.message || "Não foi possível enviar sua avaliação.")
    },
  })

  const provider = booking?.provider
  const providerInitials = (provider?.name ?? "")
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()

  const toggleCompliment = (item: string) => {
    setComment((prev) => {
      if (prev.includes(item)) {
        return prev
          .replace(new RegExp(`(^|,\\s*)${item}`, "g"), "")
          .replace(/^,\s*/, "")
          .trim()
      }
      const clean = prev.trim()
      return clean ? `${clean}, ${item}` : item
    })
  }

  const canSubmit = rating >= 1 && !submit.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Avaliar serviço</DialogTitle>
          <DialogDescription>
            Conte como foi sua experiência. Sua avaliação é pública e ajuda outros clientes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Provider / service summary */}
          <div className="bg-muted/30 flex items-center gap-3 rounded-lg border p-3">
            <Avatar className="size-10">
              {provider?.avatarUrl ? (
                <AvatarImage src={provider.avatarUrl} alt={provider.name ?? ""} />
              ) : null}
              <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                {providerInitials || "?"}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{provider?.name ?? "Prestador"}</p>
              <p className="text-muted-foreground truncate text-xs">
                {booking?.service?.title ?? "Serviço"}
              </p>
            </div>
          </div>

          {/* Rating */}
          <div className="space-y-2">
            <Label>Sua nota</Label>
            <div className="flex items-center gap-3 rounded-lg border p-3">
              <StarRatingInput value={rating} onChange={setRating} size={32} name="rating" />
              {rating === 0 ? (
                <span className="text-muted-foreground ml-auto text-xs">
                  Selecione de 1 a 5 estrelas
                </span>
              ) : (
                <span className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-amber-600">
                  <Star className="size-4 fill-amber-400 text-amber-400" />
                  {rating}.0
                </span>
              )}
            </div>
          </div>

          {/* Quick compliment pills */}
          {rating >= 3 && (
            <div className="space-y-1.5">
              <span className="text-muted-foreground flex items-center gap-1 text-[11px] font-semibold">
                <Sparkles className="size-3 text-amber-500" />
                Destaques da experiência (clique para adicionar):
              </span>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_COMPLIMENTS.map((item) => {
                  const selected = comment.includes(item)
                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => toggleCompliment(item)}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[11px] font-medium transition-all active:scale-97",
                        selected
                          ? "bg-emerald-600 text-white shadow-xs"
                          : "border-border/70 bg-muted/40 text-muted-foreground border hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-300",
                      )}
                    >
                      {item}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Comment */}
          <div className="space-y-2">
            <Label htmlFor="review-comment">Comentário (opcional)</Label>
            <Textarea
              id="review-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Conte os detalhes da sua experiência com este prestador…"
              rows={4}
              maxLength={1000}
            />
            <p className="text-muted-foreground text-right text-xs tabular-nums">
              {comment.length}/1000
            </p>
          </div>

          {/* Fotos de Antes & Depois (Prova Social) */}
          <div className="border-border/60 bg-muted/20 space-y-3 rounded-lg border p-3">
            <div className="flex items-center gap-1.5">
              <Camera className="text-primary size-4" />
              <Label className="text-xs font-semibold">
                Fotos do Serviço (Antes & Depois - Opcional)
              </Label>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <span className="text-muted-foreground text-[11px] font-medium">
                  Foto de Antes (URL)
                </span>
                <Input
                  placeholder="https://exemplo.com/antes.jpg"
                  value={beforePhotoUrl}
                  onChange={(e) => setBeforePhotoUrl(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground text-[11px] font-medium">
                  Foto de Depois (URL)
                </span>
                <Input
                  placeholder="https://exemplo.com/depois.jpg"
                  value={afterPhotoUrl}
                  onChange={(e) => setAfterPhotoUrl(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>
          </div>

          {/* Selo Prova Social Verificada */}
          <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="size-4 shrink-0 text-emerald-500" />
            <span>Sua avaliação recebe o selo oficial de Serviço Verificado</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submit.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => submit.mutate()} disabled={!canSubmit} className="gap-2">
            {submit.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Enviar avaliação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
