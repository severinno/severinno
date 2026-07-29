"use client"

import * as React from "react"
import { Bell, Smartphone, MessageCircle, Shield, Info } from "lucide-react"
import { cn } from "@/lib/utils"
import { isPushSupported, useMobileOS, useStandaloneMode } from "./pwa-setup"

type Platform = "ios" | "android" | "desktop" | null

/**
 * Mobile Push Guide — mostra instruções específicas para ativar notificações
 * push no celular, com fallback para WhatsApp quando Web Push não é suportado
 * (ex: iOS Safari sem PWA, desktop sem service worker).
 *
 * Usado dentro do painel de configurações do usuário.
 */
export function MobilePushGuide() {
  const os = useMobileOS()
  const standalone = useStandaloneMode()
  const pushSupported = isPushSupported()
  const [expanded, setExpanded] = React.useState(false)

  const isMobile = os === "ios" || os === "android"
  if (!isMobile) return null // Desktop já tem PushToggle no header

  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between p-4 text-left"
      >
        <div className="flex items-center gap-3">
          <Smartphone className="size-5 text-emerald-600" />
          <div>
            <p className="text-sm font-semibold">
              Notificações no celular
            </p>
            <p className="text-xs text-muted-foreground">
              {pushSupported
                ? "Seu dispositivo suporta notificações push"
                : "Ative pelo WhatsApp como alternativa"}
            </p>
          </div>
        </div>
        <Info className="size-4 text-muted-foreground shrink-0" />
      </button>

      {expanded && (
        <div className="border-t px-4 pb-4 pt-3 space-y-3">
          {/* Web Push disponível */}
          {pushSupported && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Bell className="size-4 text-emerald-600" />
                <span className="font-medium">Web Push</span>
              </div>

              {os === "ios" && standalone !== "standalone" && (
                <div className="ml-6 space-y-1 rounded-lg bg-muted/50 p-3 text-xs">
                  <p className="font-medium text-amber-600">
                    ⚠️ Notificações no iOS
                  </p>
                  <p>
                    O Safari no iPhone só recebe notificações push se o app
                    estiver instalado na Tela de Início (PWA).
                  </p>
                  <ol className="mt-1 list-decimal pl-4 space-y-0.5 text-muted-foreground">
                    <li>
                      Toque em <strong>Compartilhar</strong> (📤) no Safari
                    </li>
                    <li>
                      Role e toque em{" "}
                      <strong>Adicionar à Tela de Início</strong>
                    </li>
                    <li>
                      Adicione e depois ative as notificações no sino 🔔
                    </li>
                  </ol>
                </div>
              )}

              {os === "android" && (
                <div className="ml-6 text-xs text-muted-foreground">
                  <p>
                    ✅ Notificações push funcionam no Chrome Android. Toque
                    no sino 🔔 no topo da página para ativar.
                  </p>
                </div>
              )}

              {standalone === "standalone" && (
                <div className="ml-6 text-xs text-emerald-600">
                  <p>
                    ✅ App instalado! As notificações push chegam mesmo com
                    o app fechado.
                  </p>
                </div>
              )}

              <div className="ml-6 flex items-center gap-2 text-xs text-muted-foreground">
                <Shield className="size-3" />
                <span>
                  Criptografadas ponta-a-ponta via VAPID. Nenhum dado pessoal
                  é compartilhado com terceiros.
                </span>
              </div>
            </div>
          )}

          {/* WhatsApp como fallback */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <MessageCircle className="size-4 text-emerald-600" />
              <span className="font-medium">WhatsApp (fallback)</span>
            </div>
            <div className="ml-6 text-xs text-muted-foreground space-y-1">
              <p>
                Se as notificações push não funcionarem no seu dispositivo,
                você pode receber avisos importantes via WhatsApp.
              </p>
              <p>
                Basta manter seu número de WhatsApp atualizado no seu perfil
                e ativar a opção nas preferências de notificação.
              </p>
            </div>
          </div>

          {/* Comparativo */}
          <div className="rounded-lg bg-muted/30 p-3 text-xs">
            <p className="font-medium mb-1">📊 Comparativo de canais</p>
            <div className="grid grid-cols-3 gap-2 text-center mt-2">
              <div className="space-y-1">
                <p className="font-semibold text-emerald-600">Push</p>
                <p className="text-muted-foreground">Imediato</p>
                <p className="text-muted-foreground">Grátis</p>
                <p className="text-muted-foreground">Criptografado</p>
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-blue-600">WhatsApp</p>
                <p className="text-muted-foreground">Imediato</p>
                <p className="text-muted-foreground">Grátis*</p>
                <p className="text-muted-foreground">Criptografado</p>
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-amber-600">SMS</p>
                <p className="text-muted-foreground">2-5s</p>
                <p className="text-muted-foreground">Pago</p>
                <p className="text-muted-foreground">Não criptografado</p>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              * WhatsApp Messenger é gratuito. Consumo de dados móveis pode
              ser cobrado pela operadora.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * MobilePushStatus — badge simples indicando o status das notificações
 * no dispositivo atual (renderless se for desktop).
 */
export function MobilePushStatus() {
  const os = useMobileOS()
  const standalone = useStandaloneMode()
  const [subscribed, setSubscribed] = React.useState(false)

  React.useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(!!sub))
      .catch(() => {})
  }, [])

  if (!os) return null

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <div
        className={cn(
          "size-2 rounded-full",
          subscribed ? "bg-emerald-500" : "bg-muted-foreground/30",
        )}
      />
      <span>
        {standalone === "standalone"
          ? subscribed
            ? "Push ativo (PWA)"
            : "Push inativo"
          : subscribed
            ? "Push ativo (navegador)"
            : "Push desativado"}
      </span>
    </div>
  )
}
