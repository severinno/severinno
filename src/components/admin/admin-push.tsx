"use client"

/**
 * AdminPushNotifications — Dashboard para envio manual de push notifications,
 * agendamento futuro, e gestão de webhooks de eventos automáticos.
 *
 * Uses extracted sub-components from ./push/ directory.
 */

import * as React from "react"
import { Send, CalendarClock, Webhook, BarChart3 } from "lucide-react"
import { cn } from "@/lib/utils"
import { PushSendTab, PushScheduledTab, PushWebhooksTab, PushAnalyticsTab } from "./push"

export function AdminPushNotifications() {
  const [activeTab, setActiveTab] = React.useState<"send" | "scheduled" | "webhooks" | "analytics">(
    "send",
  )

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      {/* ── Tab navigation ──────────────────────────────────────── */}
      <div
        className="flex gap-1 rounded-lg border p-1"
        role="tablist"
        aria-label="Modo do dashboard"
      >
        {[
          { id: "send" as const, label: "Enviar manual", icon: Send },
          { id: "scheduled" as const, label: "Agendadas", icon: CalendarClock },
          { id: "webhooks" as const, label: "Webhooks de Eventos", icon: Webhook },
          { id: "analytics" as const, label: "Analytics", icon: BarChart3 },
        ].map((tab) => (
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

      {/* ── Tab content ─────────────────────────────────────────── */}
      {activeTab === "send" && <PushSendTab />}
      {activeTab === "scheduled" && <PushScheduledTab />}
      {activeTab === "webhooks" && <PushWebhooksTab />}
      {activeTab === "analytics" && <PushAnalyticsTab />}
    </div>
  )
}
