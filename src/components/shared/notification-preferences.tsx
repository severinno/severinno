"use client"

import * as React from "react"
import {
  Bell,
  Smartphone,
  MessageSquare,
  Mail,
  Volume2,
  Moon,
  Save,
  CheckCircle2,
  Loader2,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import { PageTransition } from "@/components/shared/page-transition"

type CategoryPreference = {
  type: string
  label: string
  description: string
  pushEnabled: boolean
  emailEnabled: boolean
  whatsappEnabled: boolean
  soundEnabled: boolean
}

type QuietHours = {
  enabled: boolean
  start: string
  end: string
}

export function NotificationPreferences() {
  const [preferences, setPreferences] = React.useState<CategoryPreference[]>([])
  const [quietHours, setQuietHours] = React.useState<QuietHours>({
    enabled: false,
    start: "22:00",
    end: "08:00",
  })
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    queueMicrotask(() => {
      async function loadPreferences() {
        try {
          const res = await fetch("/api/users/notification-preferences")
          if (!res.ok) throw new Error("Falha ao carregar preferências")
          const data = await res.json()
          if (data.preferences) setPreferences(data.preferences)
          if (data.quietHours) setQuietHours(data.quietHours)
        } catch {
          toast.error("Não foi possível carregar as preferências de notificação.")
        } finally {
          setLoading(false)
        }
      }
      void loadPreferences()
    })
  }, [])

  const handleToggle = (
    index: number,
    channel: "pushEnabled" | "emailEnabled" | "whatsappEnabled" | "soundEnabled",
  ) => {
    setPreferences((prev) => {
      const updated = [...prev]
      updated[index] = {
        ...updated[index],
        [channel]: !updated[index][channel],
      }
      return updated
    })
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch("/api/users/notification-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences, quietHours }),
      })

      if (!res.ok) throw new Error("Falha ao salvar")
      toast.success("Preferências de notificação salvas com sucesso!", {
        icon: <CheckCircle2 className="h-5 w-5 text-emerald-500" />,
      })
    } catch {
      toast.error("Erro ao salvar preferências. Tente novamente.")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="text-primary h-8 w-8 animate-spin" />
      </div>
    )
  }

  return (
    <PageTransition className="mx-auto max-w-4xl space-y-6">
      {/* Quiet Hours Card */}
      <Card className="border-border/60 shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-purple-500/10 p-2.5 text-purple-600 dark:text-purple-400">
                <Moon className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-lg">Modo "Não Perturbe"</CardTitle>
                <CardDescription>
                  Pausa sons e mensagens automáticas durante horários de descanso.
                </CardDescription>
              </div>
            </div>
            <Switch
              checked={quietHours.enabled}
              onCheckedChange={(checked) =>
                setQuietHours((prev) => ({ ...prev, enabled: checked }))
              }
            />
          </div>
        </CardHeader>
        {quietHours.enabled && (
          <CardContent className="pt-0">
            <div className="grid max-w-md grid-cols-1 gap-4 pt-2 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="quiet-start" className="text-muted-foreground text-xs">
                  Início do silêncio
                </Label>
                <Input
                  id="quiet-start"
                  type="time"
                  value={quietHours.start}
                  onChange={(e) => setQuietHours((prev) => ({ ...prev, start: e.target.value }))}
                  className="bg-background"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quiet-end" className="text-muted-foreground text-xs">
                  Fim do silêncio
                </Label>
                <Input
                  id="quiet-end"
                  type="time"
                  value={quietHours.end}
                  onChange={(e) => setQuietHours((prev) => ({ ...prev, end: e.target.value }))}
                  className="bg-background"
                />
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Category Preferences Card */}
      <Card className="border-border/60 shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 text-primary rounded-xl p-2.5">
              <Bell className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-lg">Canais de Notificação</CardTitle>
              <CardDescription>
                Escolha por onde deseja ser avisado para cada tipo de evento.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {preferences.map((item, idx) => (
            <div
              key={item.type}
              className="border-border/50 bg-muted/20 hover:bg-muted/40 space-y-4 rounded-xl border p-4 transition-all"
            >
              <div>
                <h4 className="text-foreground text-sm font-semibold">{item.label}</h4>
                <p className="text-muted-foreground text-xs">{item.description}</p>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1 sm:grid-cols-4">
                {/* Push */}
                <label className="border-border/40 bg-background/50 hover:bg-background flex cursor-pointer items-center justify-between rounded-lg border p-2.5">
                  <span className="flex items-center gap-2 text-xs font-medium">
                    <Smartphone className="h-4 w-4 text-blue-500" />
                    App / Push
                  </span>
                  <Switch
                    checked={item.pushEnabled}
                    onCheckedChange={() => handleToggle(idx, "pushEnabled")}
                  />
                </label>

                {/* WhatsApp */}
                <label className="border-border/40 bg-background/50 hover:bg-background flex cursor-pointer items-center justify-between rounded-lg border p-2.5">
                  <span className="flex items-center gap-2 text-xs font-medium">
                    <MessageSquare className="h-4 w-4 text-emerald-500" />
                    WhatsApp
                  </span>
                  <Switch
                    checked={item.whatsappEnabled}
                    onCheckedChange={() => handleToggle(idx, "whatsappEnabled")}
                  />
                </label>

                {/* Email */}
                <label className="border-border/40 bg-background/50 hover:bg-background flex cursor-pointer items-center justify-between rounded-lg border p-2.5">
                  <span className="flex items-center gap-2 text-xs font-medium">
                    <Mail className="h-4 w-4 text-amber-500" />
                    E-mail
                  </span>
                  <Switch
                    checked={item.emailEnabled}
                    onCheckedChange={() => handleToggle(idx, "emailEnabled")}
                  />
                </label>

                {/* Sound */}
                <label className="border-border/40 bg-background/50 hover:bg-background flex cursor-pointer items-center justify-between rounded-lg border p-2.5">
                  <span className="flex items-center gap-2 text-xs font-medium">
                    <Volume2 className="h-4 w-4 text-purple-500" />
                    Sons
                  </span>
                  <Switch
                    checked={item.soundEnabled}
                    onCheckedChange={() => handleToggle(idx, "soundEnabled")}
                  />
                </label>
              </div>
            </div>
          ))}

          <div className="border-border/50 flex justify-end border-t pt-4">
            <Button onClick={handleSave} disabled={saving} className="gap-2 px-6 shadow-sm">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Salvando..." : "Salvar Alterações"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </PageTransition>
  )
}

export default NotificationPreferences
