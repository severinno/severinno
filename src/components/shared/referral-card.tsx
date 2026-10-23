"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Copy, Check, Gift, MessageCircle, Loader2 } from "lucide-react"
import { apiGet } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import type { ReferralStats } from "@/lib/referral"

export function ReferralCard() {
  const [copied, setCopied] = React.useState(false)

  const { data, isLoading } = useQuery<{ ok: boolean; stats: ReferralStats }>({
    queryKey: ["referral", "stats"],
    queryFn: () => apiGet<{ ok: boolean; stats: ReferralStats }>("/api/referral"),
  })

  const stats = data?.stats

  const handleCopyLink = () => {
    if (!stats?.inviteLink) return
    navigator.clipboard.writeText(stats.inviteLink)
    setCopied(true)
    toast.success("Link de indicação copiado para a área de transferência! 📋")
    setTimeout(() => setCopied(false), 2500)
  }

  const handleWhatsAppShare = () => {
    if (!stats?.whatsappShareUrl) return
    window.open(stats.whatsappShareUrl, "_blank", "noopener,noreferrer")
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex h-48 items-center justify-center">
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-primary/20 from-primary/5 via-background to-background overflow-hidden bg-gradient-to-br shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-primary/10 text-primary rounded-lg p-2">
              <Gift className="size-5" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">Indique e Ganhe</CardTitle>
              <CardDescription className="text-xs">
                Convide amigos e ganhe +50 pontos no Clube de Fidelidade no primeiro serviço
              </CardDescription>
            </div>
          </div>
          {stats?.tierBonusTitle && (
            <span className="border-primary/20 bg-primary/10 text-primary rounded-full border px-2.5 py-0.5 text-xs font-medium">
              {stats.tierBonusTitle}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Referral Link Box */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="bg-muted/40 flex flex-1 items-center justify-between rounded-lg border px-3 py-2 font-mono text-xs">
            <span className="text-muted-foreground truncate">{stats?.inviteLink}</span>
            <span className="text-foreground ml-2 font-bold">{stats?.code}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyLink}
              className="gap-1.5 text-xs font-medium"
            >
              {copied ? (
                <Check className="size-3.5 text-emerald-500" />
              ) : (
                <Copy className="size-3.5" />
              )}
              {copied ? "Copiado!" : "Copiar Link"}
            </Button>
            <Button
              size="sm"
              onClick={handleWhatsAppShare}
              className="gap-1.5 bg-emerald-600 text-xs font-medium text-white hover:bg-emerald-700"
            >
              <MessageCircle className="size-3.5" />
              WhatsApp
            </Button>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-3 border-t pt-3 text-center">
          <div>
            <div className="text-foreground text-lg font-bold">{stats?.totalInvites ?? 0}</div>
            <div className="text-muted-foreground text-[11px]">Convites Enviados</div>
          </div>
          <div>
            <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
              {stats?.activeFriends ?? 0}
            </div>
            <div className="text-muted-foreground text-[11px]">Amigos Ativos</div>
          </div>
          <div>
            <div className="text-primary text-lg font-bold">+{stats?.pointsEarned ?? 0}</div>
            <div className="text-muted-foreground text-[11px]">Pontos Conquistados</div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
