"use client"

/**
 * AdminWhatsApp — Gerenciamento visual da conexão WhatsApp e Evolution API v2.3.7.
 *
 * Funcionalidades:
 * 1. Monitoramento de conexão em tempo real (Conectado / Conectando / Desconectado).
 * 2. Visualizador dinâmico de QR Code ativo para pareamento imediato.
 * 3. Formulário de envio de mensagens de teste com validação.
 * 4. Painel de diagnósticos da instância, versão do Baileys e status do Webhook.
 * 5. Ações de controle (Reconectar, Desconectar/Logout, Sincronizar Webhook).
 */

import * as React from "react"
import {
  MessageSquare,
  QrCode,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Send,
  LogOut,
  Smartphone,
  ShieldCheck,
  Activity,
  Layers,
  PhoneCall,
  Loader2,
  History,
  CheckCheck,
  Clock,
  XCircle,
  Megaphone,
  Users,
  FileText,
} from "lucide-react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { apiGet, apiPost } from "@/lib/api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export type WhatsAppLogItem = {
  id: string
  phone: string
  text: string
  context: string
  status: "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED"
  messageId: string | null
  errorMessage: string | null
  createdAt: string
  sentAt: string | null
  deliveredAt: string | null
  readAt: string | null
  user?: {
    id: string
    name: string | null
    email: string | null
  } | null
}

export type WhatsAppTemplateItem = {
  id: string
  title: string
  description: string
  category: string
  variables: string[]
  defaultText: string
}

export type WhatsAppStatusResponse = {
  instance: {
    name: string
    id: string | null
    status: string
    number: string | null
    profileName: string | null
    profilePicUrl: string | null
    integration: string
    counts: { Message?: number; Contact?: number; Chat?: number }
  }
  qrcode: {
    base64?: string
    code?: string
    count?: number
  } | null
  webhook: {
    enabled: boolean
    url: string | null
    events: string[]
  }
  server: {
    url: string
    version: string
  }
  logs?: WhatsAppLogItem[]
  templates?: WhatsAppTemplateItem[]
}

export function AdminWhatsApp() {
  const queryClient = useQueryClient()
  const [testPhone, setTestPhone] = React.useState("")
  const [testMessage, setTestMessage] = React.useState(
    "Olá! Esta é uma mensagem de teste enviada diretamente pelo painel administrativo do Severinno Marketplace. ✅",
  )
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = React.useState(false)

  // Polling automático a cada 6 segundos se estiver em estado transitório
  const { data, isLoading, isFetching, refetch } = useQuery<WhatsAppStatusResponse>({
    queryKey: ["admin-whatsapp-status"],
    queryFn: () => apiGet<WhatsAppStatusResponse>("/api/admin/whatsapp"),
    refetchInterval: (query) => {
      const status = query.state.data?.instance?.status
      return status === "connecting" || status === "close" ? 6000 : 30000
    },
  })

  // Mutação: Enviar mensagem de teste
  const testMutation = useMutation({
    mutationFn: (variables: { phone: string; message: string }) =>
      apiPost<{ success: boolean; message: string; messageId?: string }>("/api/admin/whatsapp", {
        action: "test_message",
        ...variables,
      }),
    onSuccess: (res) => {
      toast.success(res.message || "Mensagem de teste enviada com sucesso!", {
        description: res.messageId ? `ID da mensagem: ${res.messageId}` : undefined,
      })
      queryClient.invalidateQueries({ queryKey: ["admin-whatsapp-status"] })
    },
    onError: (err: Error) => {
      toast.error("Falha ao enviar mensagem de teste", {
        description: err.message,
      })
    },
  })

  // Mutação: Reconectar ou reiniciar
  const restartMutation = useMutation({
    mutationFn: () =>
      apiPost<{ success: boolean; message: string }>("/api/admin/whatsapp", {
        action: "restart",
      }),
    onSuccess: () => {
      toast.success("Instância reiniciada. Aguarde atualização do QR code.")
      queryClient.invalidateQueries({ queryKey: ["admin-whatsapp-status"] })
    },
    onError: (err: Error) => {
      toast.error("Erro ao reiniciar instância", { description: err.message })
    },
  })

  // Mutação: Desconectar (Logout)
  const disconnectMutation = useMutation({
    mutationFn: () =>
      apiPost<{ success: boolean; message: string }>("/api/admin/whatsapp", {
        action: "disconnect",
      }),
    onSuccess: () => {
      toast.success("Instância desconectada com sucesso.")
      setDisconnectConfirmOpen(false)
      queryClient.invalidateQueries({ queryKey: ["admin-whatsapp-status"] })
    },
    onError: (err: Error) => {
      toast.error("Erro ao desconectar instância", { description: err.message })
    },
  })

  // Mutação: Sincronizar webhook
  const syncWebhookMutation = useMutation({
    mutationFn: () =>
      apiPost<{ success: boolean; message: string }>("/api/admin/whatsapp", {
        action: "sync_webhook",
      }),
    onSuccess: (res) => {
      toast.success(res.message || "Webhook sincronizado com sucesso!")
      queryClient.invalidateQueries({ queryKey: ["admin-whatsapp-status"] })
    },
    onError: (err: Error) => {
      toast.error("Erro ao sincronizar webhook", { description: err.message })
    },
  })

  // Estado da Campanha
  const [selectedAudience, setSelectedAudience] = React.useState<
    "ALL_ACTIVE" | "CLIENTS" | "PROVIDERS"
  >("CLIENTS")
  const [campaignMessage, setCampaignMessage] = React.useState("")
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string>("")

  // Mutação: Disparar Campanha Segmentada
  const broadcastMutation = useMutation({
    mutationFn: (variables: {
      targetAudience: "ALL_ACTIVE" | "CLIENTS" | "PROVIDERS"
      message: string
      templateId?: string
    }) =>
      apiPost<{ success: boolean; message: string; count?: number }>("/api/admin/whatsapp", {
        action: "broadcast_campaign",
        ...variables,
      }),
    onSuccess: (res) => {
      toast.success(res.message || "Campanha disparada com sucesso!")
      setCampaignMessage("")
      queryClient.invalidateQueries({ queryKey: ["admin-whatsapp-status"] })
    },
    onError: (err: Error) => {
      toast.error("Falha ao disparar campanha", { description: err.message })
    },
  })

  const status = data?.instance?.status ?? "unknown"
  const isConnected = status === "open" || status === "connected"
  const isConnecting = status === "connecting"

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full rounded-xl" />
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-80 w-full rounded-xl" />
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-12">
      {/* ── Header Card & Status ────────────────────────────────────────── */}
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-xl">
              <MessageSquare className="h-5 w-5 text-emerald-500" />
              WhatsApp Business & Evolution API
            </CardTitle>
            <CardDescription>
              Monitoramento da conexão do Baileys engine, geração de QR Code e disparos
              transacionais.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="gap-1.5"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="bg-muted/40 border-border/40 flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-11 w-11 items-center justify-center rounded-full ${
                  isConnected
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                    : isConnecting
                      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      : "bg-destructive/15 text-destructive"
                }`}
              >
                {isConnected ? (
                  <CheckCircle2 className="h-6 w-6" />
                ) : isConnecting ? (
                  <Smartphone className="h-6 w-6 animate-pulse" />
                ) : (
                  <AlertTriangle className="h-6 w-6" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-foreground font-semibold">
                    {isConnected
                      ? "Conectado e Operacional"
                      : isConnecting
                        ? "Aguardando Leitura do QR Code"
                        : "Desconectado"}
                  </span>
                  <Badge
                    variant={isConnected ? "default" : isConnecting ? "secondary" : "destructive"}
                    className={
                      isConnected
                        ? "bg-emerald-600 text-white hover:bg-emerald-700"
                        : isConnecting
                          ? "bg-amber-600 text-white hover:bg-amber-700"
                          : ""
                    }
                  >
                    {status.toUpperCase()}
                  </Badge>
                </div>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Instância:{" "}
                  <span className="text-foreground font-mono font-medium">
                    {data?.instance?.name}
                  </span>
                  {data?.instance?.number && (
                    <>
                      {" · "}Número:{" "}
                      <span className="text-foreground font-mono font-medium">
                        +{data.instance.number}
                      </span>
                    </>
                  )}
                  {data?.instance?.profileName && <> ({data.instance.profileName})</>}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => syncWebhookMutation.mutate()}
                disabled={syncWebhookMutation.isPending}
                className="gap-1.5"
              >
                <Layers className="h-4 w-4" />
                {syncWebhookMutation.isPending ? "Sincronizando..." : "Sincronizar Webhook"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => restartMutation.mutate()}
                disabled={restartMutation.isPending}
                className="gap-1.5"
              >
                <RefreshCw
                  className={`h-4 w-4 ${restartMutation.isPending ? "animate-spin" : ""}`}
                />
                Reiniciar Conexão
              </Button>
              {isConnected && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDisconnectConfirmOpen(true)}
                  disabled={disconnectMutation.isPending}
                  className="gap-1.5"
                >
                  <LogOut className="h-4 w-4" />
                  Desconectar
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Grid Principal: QR Code ou Detalhes & Teste de Disparo ───────── */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Card Esquerdo: QR Code ou Perfil Conectado */}
        {!isConnected ? (
          <Card className="border-border/60 flex flex-col justify-between shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <QrCode className="text-primary h-5 w-5" />
                Escaneie o QR Code com o WhatsApp
              </CardTitle>
              <CardDescription>
                Abra o WhatsApp no celular oficial &gt; Aparelhos conectados &gt; Conectar um
                aparelho.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center justify-center space-y-4 py-4">
              {data?.qrcode?.base64 ? (
                <div className="border-primary/20 hover:border-primary/40 relative rounded-xl border-2 bg-white p-4 shadow-md transition-all">
                  {/* Imagem do QR Code Base64 */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={data.qrcode.base64}
                    alt="WhatsApp QR Code"
                    className="h-64 w-64 object-contain"
                  />
                  {data.qrcode.count !== undefined && (
                    <div className="absolute top-2 right-2 rounded-full bg-slate-900/80 px-2 py-0.5 font-mono text-[10px] text-white">
                      #{data.qrcode.count}
                    </div>
                  )}
                </div>
              ) : (
                <div className="border-border bg-muted/20 flex h-64 w-64 flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center">
                  <Loader2 className="text-muted-foreground mb-2 h-8 w-8 animate-spin" />
                  <p className="text-foreground text-sm font-medium">Gerando QR Code...</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Aguarde a inicialização do motor Baileys.
                  </p>
                </div>
              )}

              <div className="text-muted-foreground max-w-sm space-y-1 text-center text-xs">
                <p>O QR Code expira automaticamente a cada ciclo de 20-30 segundos.</p>
                <p>Assim que pareado, a página será atualizada automaticamente.</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-border/60 flex flex-col justify-between shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Smartphone className="h-5 w-5 text-emerald-500" />
                Aparelho Pareado com Sucesso
              </CardTitle>
              <CardDescription>
                A sessão Baileys está autenticada e os tokens estão salvos no PostgreSQL/Redis.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-border/40 bg-muted/20 flex items-center gap-4 rounded-lg border p-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                  <PhoneCall className="h-7 w-7" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-foreground font-semibold">
                    {data?.instance?.profileName ?? "Severinno Marketplace"}
                  </h4>
                  <p className="text-muted-foreground font-mono text-sm">
                    +{data?.instance?.number ?? "55..."}
                  </p>
                  <Badge
                    variant="outline"
                    className="border-emerald-500/30 bg-emerald-500/5 text-xs text-emerald-600"
                  >
                    Engine Ativa · Conectado via WebSocket
                  </Badge>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="border-border/40 bg-muted/10 rounded-lg border p-3">
                  <span className="text-muted-foreground text-xs">Mensagens</span>
                  <p className="text-foreground text-lg font-bold">
                    {data?.instance?.counts?.Message ?? 0}
                  </p>
                </div>
                <div className="border-border/40 bg-muted/10 rounded-lg border p-3">
                  <span className="text-muted-foreground text-xs">Contatos</span>
                  <p className="text-foreground text-lg font-bold">
                    {data?.instance?.counts?.Contact ?? 0}
                  </p>
                </div>
                <div className="border-border/40 bg-muted/10 rounded-lg border p-3">
                  <span className="text-muted-foreground text-xs">Chats</span>
                  <p className="text-foreground text-lg font-bold">
                    {data?.instance?.counts?.Chat ?? 0}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Card Direito: Disparo de Mensagem de Teste */}
        <Card className="border-border/60 flex flex-col justify-between shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Send className="text-primary h-5 w-5" />
              Disparo de Mensagem de Teste
            </CardTitle>
            <CardDescription>
              Valide o envio em tempo real para um número de celular do Brasil (com DDD).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="test-phone-input"
                className="text-muted-foreground text-xs font-semibold tracking-wider uppercase"
              >
                Número do WhatsApp (com DDD)
              </label>
              <Input
                id="test-phone-input"
                placeholder="Ex.: 11999999999 ou 5511999999999"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                disabled={testMutation.isPending}
              />
              <p className="text-muted-foreground text-[11px]">
                O DDI 55 é inserido automaticamente caso omitido.
              </p>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="test-message-input"
                className="text-muted-foreground text-xs font-semibold tracking-wider uppercase"
              >
                Texto da Mensagem
              </label>
              <Textarea
                id="test-message-input"
                rows={4}
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                disabled={testMutation.isPending}
                className="resize-none"
              />
            </div>

            <Button
              className="w-full gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => {
                if (!testPhone.trim()) {
                  toast.error("Informe um número de telefone com DDD")
                  return
                }
                testMutation.mutate({ phone: testPhone, message: testMessage })
              }}
              disabled={testMutation.isPending || !isConnected}
            >
              {testMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {testMutation.isPending
                ? "Enviando Mensagem..."
                : !isConnected
                  ? "Aguardando Conexão para Enviar"
                  : "Disparar Mensagem de Teste"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* ── Diagnóstico & Infraestrutura ─────────────────────────────────── */}
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="text-primary h-4 w-4" />
            Diagnósticos da Stack Evolution API
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div className="border-border/40 bg-muted/20 space-y-1 rounded-lg border p-3">
              <span className="text-muted-foreground text-xs">Servidor Evolution API</span>
              <p className="text-foreground font-mono font-medium">{data?.server?.url}</p>
              <Badge variant="outline" className="text-[10px]">
                {data?.server?.version} · Baileys WS
              </Badge>
            </div>

            <div className="border-border/40 bg-muted/20 space-y-1 rounded-lg border p-3">
              <span className="text-muted-foreground text-xs">Status do Webhook</span>
              <p className="text-foreground flex items-center gap-1.5 font-medium">
                {data?.webhook?.enabled ? (
                  <ShieldCheck className="h-4 w-4 text-emerald-500" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                )}
                {data?.webhook?.enabled ? "Ativo & Autenticado" : "Inativo"}
              </p>
              <p
                className="text-muted-foreground truncate text-[11px]"
                title={data?.webhook?.url ?? ""}
              >
                {data?.webhook?.url ?? "Não configurado"}
              </p>
            </div>

            <div className="border-border/40 bg-muted/20 space-y-1 rounded-lg border p-3">
              <span className="text-muted-foreground text-xs">Eventos Subscritos</span>
              <p className="text-foreground font-mono text-xs">
                {data?.webhook?.events?.length ? `${data.webhook.events.length} eventos` : "Nenhum"}
              </p>
              <p className="text-muted-foreground text-[10px]">
                UPSERT, UPDATE, CONNECTION, QRCODE
              </p>
            </div>

            <div className="border-border/40 bg-muted/20 space-y-1 rounded-lg border p-3">
              <span className="text-muted-foreground text-xs">Circuit Breaker & Fallback</span>
              <p className="flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                evolutionBreaker (Ativo)
              </p>
              <p className="text-muted-foreground text-[10px]">
                Timeout 10s · Fallback gracioso ativo
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Campanhas & Templates Padronizados ────────────────────────── */}
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Megaphone className="text-primary h-4 w-4" />
              Campanhas Segmentadas & Catálogo de Templates
            </CardTitle>
            <CardDescription>
              Dispare comunicados em massa com segurança assíncrona (RabbitMQ) e aplique templates
              padronizados por audiência.
            </CardDescription>
          </div>
          <Badge variant="outline" className="gap-1 text-xs">
            <Users className="h-3 w-3" />
            {selectedAudience === "ALL_ACTIVE"
              ? "Todos Ativos"
              : selectedAudience === "CLIENTS"
                ? "Apenas Clientes"
                : "Apenas Prestadores"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Seletor de Templates Rápidos */}
          <div className="space-y-2">
            <label className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              Templates Padronizados
            </label>
            <div className="flex flex-wrap gap-2">
              {data?.templates?.map((t) => (
                <Button
                  key={t.id}
                  variant={selectedTemplateId === t.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setSelectedTemplateId(t.id)
                    setCampaignMessage(t.defaultText)
                  }}
                  className="gap-1.5 text-xs"
                >
                  <FileText className="h-3.5 w-3.5" />
                  {t.title}
                </Button>
              ))}
            </div>
          </div>

          {/* Segmentação & Texto */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <label className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                Público Alvo
              </label>
              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  variant={selectedAudience === "CLIENTS" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedAudience("CLIENTS")}
                  className="justify-start gap-2"
                >
                  <Users className="h-4 w-4" />
                  Clientes da Plataforma
                </Button>
                <Button
                  type="button"
                  variant={selectedAudience === "PROVIDERS" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedAudience("PROVIDERS")}
                  className="justify-start gap-2"
                >
                  <Users className="h-4 w-4" />
                  Prestadores Cadastrados
                </Button>
                <Button
                  type="button"
                  variant={selectedAudience === "ALL_ACTIVE" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedAudience("ALL_ACTIVE")}
                  className="justify-start gap-2"
                >
                  <Users className="h-4 w-4" />
                  Todos os Usuários Ativos
                </Button>
              </div>
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                Conteúdo da Mensagem da Campanha
              </label>
              <Textarea
                rows={4}
                placeholder="Escreva a mensagem da campanha ou selecione um template acima..."
                value={campaignMessage}
                onChange={(e) => setCampaignMessage(e.target.value)}
                disabled={broadcastMutation.isPending}
                className="resize-none"
              />
              <div className="flex items-center justify-between pt-1">
                <p className="text-muted-foreground text-[11px]">
                  As mensagens são enfileiradas na fila assíncrona RabbitMQ para evitar bloqueios do
                  WhatsApp.
                </p>
                <Button
                  size="sm"
                  onClick={() => {
                    if (!campaignMessage.trim()) {
                      toast.error("Informe a mensagem da campanha")
                      return
                    }
                    broadcastMutation.mutate({
                      targetAudience: selectedAudience,
                      message: campaignMessage,
                      templateId: selectedTemplateId || undefined,
                    })
                  }}
                  disabled={broadcastMutation.isPending || !isConnected}
                  className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  {broadcastMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Megaphone className="h-4 w-4" />
                  )}
                  {broadcastMutation.isPending ? "Disparando..." : "Disparar Campanha"}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Auditoria: Histórico de Disparos Recentes ───────────────────── */}
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="text-primary h-4 w-4" />
              Auditoria de Disparos Recentes (Banco de Dados)
            </CardTitle>
            <CardDescription>
              Últimas 25 mensagens transacionais processadas pelo worker assíncrono RabbitMQ e
              webhook da Evolution API.
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-xs">
            {data?.logs?.length ?? 0} registros
          </Badge>
        </CardHeader>
        <CardContent>
          {!data?.logs || data.logs.length === 0 ? (
            <div className="border-border bg-muted/10 flex flex-col items-center justify-center rounded-lg border border-dashed py-8 text-center">
              <MessageSquare className="text-muted-foreground mb-2 h-8 w-8 opacity-40" />
              <p className="text-foreground text-sm font-medium">Nenhum disparo registrado ainda</p>
              <p className="text-muted-foreground text-xs">
                As mensagens enviadas pelo sistema ou via teste aparecerão aqui em tempo real.
              </p>
            </div>
          ) : (
            <div className="border-border/40 overflow-x-auto rounded-lg border">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/50 text-muted-foreground border-b uppercase">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">Destinatário</th>
                    <th className="px-3 py-2.5 font-medium">Contexto</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium">Mensagem</th>
                    <th className="px-3 py-2.5 font-medium">Data / Envio</th>
                    <th className="px-3 py-2.5 font-medium">Entrega / Leitura</th>
                  </tr>
                </thead>
                <tbody className="divide-border/40 divide-y">
                  {data.logs.map((log) => {
                    const statusConfig = {
                      PENDING: {
                        label: "Pendente",
                        color: "bg-amber-500/10 text-amber-600 border-amber-500/20",
                        icon: Clock,
                      },
                      SENT: {
                        label: "Enviado",
                        color: "bg-blue-500/10 text-blue-600 border-blue-500/20",
                        icon: Send,
                      },
                      DELIVERED: {
                        label: "Entregue",
                        color: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20",
                        icon: CheckCheck,
                      },
                      READ: {
                        label: "Lido",
                        color: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
                        icon: CheckCheck,
                      },
                      FAILED: {
                        label: "Falhou",
                        color: "bg-destructive/10 text-destructive border-destructive/20",
                        icon: XCircle,
                      },
                    }[log.status] ?? {
                      label: log.status,
                      color: "bg-muted text-muted-foreground",
                      icon: Clock,
                    }

                    const StatusIcon = statusConfig.icon

                    return (
                      <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-3 py-2.5 font-mono font-medium">
                          +{log.phone}
                          {log.user?.name && (
                            <div className="text-muted-foreground font-sans text-[11px]">
                              {log.user.name}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {log.context}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge
                            variant="outline"
                            className={`flex w-fit items-center gap-1 text-[10px] ${statusConfig.color}`}
                          >
                            <StatusIcon className="h-3 w-3" />
                            {statusConfig.label}
                          </Badge>
                        </td>
                        <td className="max-w-xs px-3 py-2.5">
                          <p className="text-foreground truncate text-[11px]" title={log.text}>
                            {log.text}
                          </p>
                          {log.errorMessage && (
                            <p className="text-destructive text-[10px]">Erro: {log.errorMessage}</p>
                          )}
                        </td>
                        <td className="text-muted-foreground px-3 py-2.5 text-[11px] whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </td>
                        <td className="text-muted-foreground px-3 py-2.5 text-[10px] whitespace-nowrap">
                          {log.readAt ? (
                            <span className="font-medium text-emerald-600 dark:text-emerald-400">
                              Lido: {new Date(log.readAt).toLocaleTimeString("pt-BR")}
                            </span>
                          ) : log.deliveredAt ? (
                            <span>
                              Entregue: {new Date(log.deliveredAt).toLocaleTimeString("pt-BR")}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Dialog de Confirmação de Logout ─────────────────────────────── */}
      <AlertDialog open={disconnectConfirmOpen} onOpenChange={setDisconnectConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Desconectar WhatsApp?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Isso fará o logout da sessão do WhatsApp na Evolution API. As notificações
              transacionais (recibos PIX, agendamentos e orçamentos) ficarão suspensas até que um
              novo QR Code seja escaneado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => disconnectMutation.mutate()}
              className="bg-destructive hover:bg-destructive/90 text-white"
            >
              Sim, Desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
