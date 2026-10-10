"use client"

import * as React from "react"
import { Bell, BellOff, BellRing, CheckCircle2, AlertTriangle, Loader2, Send } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { usePushSubscription } from "@/hooks/use-service-worker"
import { triggerHaptic } from "@/lib/haptics"

export function PushNotificationCard({ className }: { className?: string }) {
  const {
    isSubscribed,
    isSupported,
    permission,
    loading,
    testing,
    subscribe,
    unsubscribe,
    sendTestNotification,
  } = usePushSubscription()

  const handleToggle = async (checked: boolean) => {
    if (checked) {
      triggerHaptic("selection")
      const ok = await subscribe()
      if (ok) {
        triggerHaptic("success")
        toast.success("Notificações push ativadas neste aparelho!")
      } else {
        triggerHaptic("error")
        if (permission === "denied") {
          toast.error(
            "Permissão de notificação bloqueada no navegador. Desbloqueie no ícone de cadeado na barra de endereço.",
          )
        } else {
          toast.error("Não foi possível ativar as notificações push.")
        }
      }
    } else {
      triggerHaptic("selection")
      const ok = await unsubscribe()
      if (ok) {
        toast.info("Notificações push desativadas neste aparelho.")
      }
    }
  }

  const handleTest = async () => {
    triggerHaptic("selection")
    const result = await sendTestNotification()
    if (result.ok) {
      triggerHaptic("success")
      toast.success(result.message || "Notificação de teste enviada!")
    } else {
      triggerHaptic("error")
      toast.error(result.message || "Falha ao enviar notificação de teste.")
    }
  }

  if (!isSupported) {
    return (
      <Card className={className}>
        <CardContent className="p-4">
          <div className="text-muted-foreground flex items-start gap-3">
            <BellOff className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="text-sm font-medium">Notificações Push</p>
              <p className="text-xs">
                Seu navegador atual não suporta Web Push. Para receber alertas instantâneos, instale
                o app ou acesse pelo Chrome / Edge / Safari 16.4+.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={className}>
      <CardContent className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="bg-primary/10 text-primary mt-0.5 shrink-0 rounded-lg p-2">
              {isSubscribed ? <BellRing className="size-5" /> : <Bell className="size-5" />}
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">Notificações Push no Aparelho</p>
                {isSubscribed ? (
                  <Badge className="gap-1 border-emerald-500/20 bg-emerald-500/10 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="size-3" /> Ativo
                  </Badge>
                ) : permission === "denied" ? (
                  <Badge variant="destructive" className="gap-1 text-[10px]">
                    <AlertTriangle className="size-3" /> Bloqueado
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px]">
                    Inativo
                  </Badge>
                )}
              </div>
              <p className="text-muted-foreground text-xs">
                Receba alertas instantâneos de novos agendamentos, mensagens e pagamentos mesmo com
                a tela apagada.
              </p>
              {permission === "denied" && (
                <p className="text-destructive text-xs font-medium">
                  ⚠️ Permissão negada no navegador. Clique no cadeado da barra de endereço para
                  permitir.
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 self-end sm:self-center">
            {isSubscribed && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={testing}
                className="h-8 gap-1.5 text-xs"
                title="Dispara uma notificação de teste para verificar a entrega"
              >
                {testing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Send className="size-3.5" />
                )}
                Testar
              </Button>
            )}

            <div className="flex items-center gap-2">
              {loading && <Loader2 className="text-muted-foreground size-4 animate-spin" />}
              <Switch
                checked={isSubscribed}
                disabled={loading || permission === "denied"}
                onCheckedChange={handleToggle}
                aria-label="Ativar ou desativar notificações push neste dispositivo"
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default PushNotificationCard
