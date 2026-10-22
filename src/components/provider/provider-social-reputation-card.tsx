"use client"

import * as React from "react"
import {
  Check,
  Copy,
  ExternalLink,
  MessageCircle,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  UserCheck,
} from "lucide-react"
import { toast } from "sonner"

import { triggerHaptic } from "@/lib/haptics"
import { playCoinSound } from "@/lib/sounds"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

export type ProviderSocialReputationCardProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider: {
    id: string
    name: string
    slug?: string | null
    avatarUrl?: string | null
    bio?: string | null
    rating?: number
    reviewCount?: number
    completedBookings?: number
    categoryTitle?: string
    city?: string
    verified?: boolean
  }
}

function getInitials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("")
}

export function ProviderSocialReputationCard({
  open,
  onOpenChange,
  provider,
}: ProviderSocialReputationCardProps) {
  const [copiedLink, setCopiedLink] = React.useState(false)
  const [copiedBio, setCopiedBio] = React.useState(false)

  const profileUrl = React.useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://severinno.com"
    const identifier = provider.slug || provider.id
    return `${origin}/u/${identifier}`
  }, [provider.slug, provider.id])

  const rating = Number(provider.rating ?? 5.0).toFixed(1)
  const reviewCount = provider.reviewCount ?? 0
  const completedCount = provider.completedBookings ?? 0
  const city = provider.city || "Governador Valadares, MG"

  const shareText = React.useMemo(() => {
    return [
      `⭐ *${provider.name}* — Prestador Especialista em ${city}`,
      provider.categoryTitle ? `🔧 Serviços: ${provider.categoryTitle}` : "",
      `🛡️ Avaliação: ${rating} estrelas (${reviewCount} avaliações)`,
      `🤝 Mais de ${completedCount > 0 ? completedCount : "dezenas de"} serviços concluídos com sucesso.`,
      `🔒 Pagamento seguro via PIX Custódia na plataforma Severinno.`,
      ``,
      `👉 Veja minhas avaliações e agende com segurança:`,
      profileUrl,
    ]
      .filter(Boolean)
      .join("\n")
  }, [provider.name, city, provider.categoryTitle, rating, reviewCount, completedCount, profileUrl])

  const handleCopyLink = async () => {
    triggerHaptic("selection")
    try {
      await navigator.clipboard.writeText(profileUrl)
      playCoinSound()
      setCopiedLink(true)
      toast.success("Link do perfil público copiado com sucesso!")
      setTimeout(() => setCopiedLink(false), 2500)
    } catch {
      toast.error("Não foi possível copiar o link.")
    }
  }

  const handleCopyBioText = async () => {
    triggerHaptic("selection")
    try {
      await navigator.clipboard.writeText(shareText)
      playCoinSound()
      setCopiedBio(true)
      toast.success("Mensagem de apresentação copiada para a área de transferência!")
      setTimeout(() => setCopiedBio(false), 2500)
    } catch {
      toast.error("Não foi possível copiar o texto.")
    }
  }

  const handleShareWhatsApp = () => {
    triggerHaptic("success")
    const waUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`
    window.open(waUrl, "_blank", "noopener,noreferrer")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md gap-5 rounded-2xl p-5 sm:p-6"
        data-testid="reputation-dialog"
      >
        <DialogHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Share2 className="size-4" />
            </span>
            <DialogTitle className="text-base font-bold sm:text-lg">
              Cartão de Reputação &amp; Prova Social
            </DialogTitle>
          </div>
          <DialogDescription className="text-muted-foreground text-xs">
            Compartilhe seu selo de confiança e avaliações no WhatsApp ou redes sociais para
            conquistar novos clientes.
          </DialogDescription>
        </DialogHeader>

        {/* Visual Bento Preview Card */}
        <div
          data-testid="reputation-card-preview"
          className="via-background to-background relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/[0.07] p-4.5 shadow-sm dark:border-emerald-500/25 dark:from-emerald-950/20"
        >
          {/* Subtle decorative glow */}
          <div className="pointer-events-none absolute -top-12 -right-12 size-36 rounded-full bg-emerald-500/10 blur-2xl" />

          {/* Provider Profile Header */}
          <div className="relative flex items-center gap-3.5">
            <div className="relative">
              <Avatar className="size-14 ring-2 ring-emerald-500/30">
                <AvatarImage src={provider.avatarUrl || undefined} alt={provider.name} />
                <AvatarFallback className="bg-emerald-600 text-sm font-bold text-white">
                  {getInitials(provider.name)}
                </AvatarFallback>
              </Avatar>
              <div
                title="Prestador Verificado"
                className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full bg-emerald-600 text-white shadow-xs"
              >
                <UserCheck className="size-3" />
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <h3 className="text-foreground truncate text-sm font-bold sm:text-base">
                  {provider.name}
                </h3>
              </div>
              <p className="truncate text-xs font-medium text-emerald-700 dark:text-emerald-400">
                {provider.categoryTitle || "Especialista em Serviços Residenciais"}
              </p>
              <p className="text-muted-foreground text-[11px]">{city}</p>
            </div>
          </div>

          {/* Social Proof Stats Grid */}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="border-border/50 bg-card/60 flex flex-col items-center justify-center rounded-xl border p-2.5 text-center shadow-2xs">
              <div className="flex items-center gap-1 text-amber-500">
                <Star className="size-4 fill-amber-400 text-amber-500" />
                <span className="text-foreground text-sm font-black tabular-nums">{rating}</span>
              </div>
              <span className="text-muted-foreground mt-0.5 text-[10px] font-medium">
                {reviewCount === 1
                  ? "1 avaliação 5 estrelas"
                  : `${reviewCount} avaliações 5 estrelas`}
              </span>
            </div>

            <div className="border-border/50 bg-card/60 flex flex-col items-center justify-center rounded-xl border p-2.5 text-center shadow-2xs">
              <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <Sparkles className="size-4" />
                <span className="text-foreground text-sm font-black tabular-nums">
                  {completedCount > 0 ? `${completedCount}+` : "100%"}
                </span>
              </div>
              <span className="text-muted-foreground mt-0.5 text-[10px] font-medium">
                Serviços com entrega garantida
              </span>
            </div>
          </div>

          {/* Platform Escrow Guarantee Trust Banner */}
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-emerald-800 dark:text-emerald-300">
            <ShieldCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span className="text-[11px] leading-tight font-medium">
              Garantia Severinno: Pagamento seguro do cliente retido em custódia até o término do
              serviço.
            </span>
          </div>
        </div>

        {/* 1-Touch Action Buttons */}
        <div className="space-y-2">
          <Button
            type="button"
            onClick={handleShareWhatsApp}
            className="h-10 w-full gap-2 rounded-xl bg-[#25D366] font-semibold text-white shadow-sm transition-all hover:bg-[#20ba5a] active:scale-98"
          >
            <MessageCircle className="size-4" />
            Compartilhar no WhatsApp
          </Button>

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleCopyLink}
              className="border-border/70 h-9 gap-1.5 rounded-xl text-xs font-medium transition-all active:scale-95"
            >
              {copiedLink ? (
                <>
                  <Check className="size-3.5 text-emerald-600" />
                  Copiado!
                </>
              ) : (
                <>
                  <Copy className="size-3.5" />
                  Copiar Link
                </>
              )}
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={handleCopyBioText}
              className="border-border/70 h-9 gap-1.5 rounded-xl text-xs font-medium transition-all active:scale-95"
            >
              {copiedBio ? (
                <>
                  <Check className="size-3.5 text-emerald-600" />
                  Texto Copiado!
                </>
              ) : (
                <>
                  <ExternalLink className="size-3.5" />
                  Copiar Texto
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
