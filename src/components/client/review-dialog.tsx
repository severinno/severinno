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
import { Loader2, Star } from "lucide-react"
import { toast } from "sonner"

import { apiPost } from "@/lib/api"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  StarRatingInput,
} from "@/components/modals/star-rating"

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

export function ReviewDialog({
  open,
  onOpenChange,
  booking,
  onSubmitted,
}: ReviewDialogProps) {
  const qc = useQueryClient()
  const [rating, setRating] = React.useState(0)
  const [comment, setComment] = React.useState("")

  // Reset when the dialog reopens for a different booking
  React.useEffect(() => {
    if (open) {
      setRating(0)
      setComment("")
    }
  }, [open, booking?.id])

  const submit = useMutation({
    mutationFn: () =>
      apiPost("/api/reviews", {
        bookingId: booking?.id,
        rating,
        comment: comment.trim() || undefined,
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

  const canSubmit = rating >= 1 && !submit.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Avaliar serviço</DialogTitle>
          <DialogDescription>
            Conte como foi sua experiência. Sua avaliação é pública e ajuda
            outros clientes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Provider / service summary */}
          <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
            <Avatar className="size-10">
              {provider?.avatarUrl ? (
                <AvatarImage
                  src={provider.avatarUrl}
                  alt={provider.name ?? ""}
                />
              ) : null}
              <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                {providerInitials || "?"}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {provider?.name ?? "Prestador"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {booking?.service?.title ?? "Serviço"}
              </p>
            </div>
          </div>

          {/* Rating */}
          <div className="space-y-2">
            <Label>Sua nota</Label>
            <div className="flex items-center gap-3 rounded-lg border p-3">
              <StarRatingInput
                value={rating}
                onChange={setRating}
                size={32}
                name="rating"
              />
              {rating === 0 ? (
                <span className="ml-auto text-xs text-muted-foreground">
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
            <p className="text-right text-xs text-muted-foreground tabular-nums">
              {comment.length}/1000
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submit.isPending}
          >
            Cancelar
          </Button>
          <Button
            onClick={() => submit.mutate()}
            disabled={!canSubmit}
            className="gap-2"
          >
            {submit.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            Enviar avaliação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
