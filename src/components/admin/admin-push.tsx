"use client"

/**
 * AdminPushNotifications — Dashboard unificado de notificações push.
 *
 * Arquitetura Modular:
 *   - PushSendTab      → Envio manual imediato + agendamento no modal
 *   - PushScheduledTab → Agendamentos futuros + tabela de status + cancelamento
 *   - PushWebhooksTab  → Regras de webhook de eventos automáticos + templates
 *   - PushAnalyticsTab → Métricas de entrega, CTR e tendências
 */

import * as React from "react"
import { Send, CalendarClock, Webhook, BarChart3 } from "lucide-react"

import { cn } from "@/lib/utils"
import { PushSendTab, PushScheduledTab, PushWebhooksTab, PushAnalyticsTab } from "./push"

type TabId = "send" | "scheduled" | "webhooks" | "analytics"

const TABS: Array<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }> =
  [
    { id: "send", label: "Enviar manual", icon: Send },
    { id: "scheduled", label: "Agendadas", icon: CalendarClock },
    { id: "webhooks", label: "Webhooks de Eventos", icon: Webhook },
    { id: "analytics", label: "Analytics", icon: BarChart3 },
  ]

export function AdminPushNotifications() {
  const [activeTab, setActiveTab] = React.useState<TabId>("send")

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      {/* Tab navigation */}
      <div
        className="flex gap-1 rounded-lg border p-1"
        role="tablist"
        aria-label="Modo do dashboard de notificações"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <tab.icon className="size-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content views */}
      {activeTab === "send" && <PushSendTab onScheduleSuccess={() => setActiveTab("scheduled")} />}
      {activeTab === "scheduled" && <PushScheduledTab />}
      {activeTab === "webhooks" && <PushWebhooksTab />}
      {activeTab === "analytics" && <PushAnalyticsTab />}
    </div>
  )
}

export default AdminPushNotifications
