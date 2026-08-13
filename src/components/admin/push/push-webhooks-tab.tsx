"use client"

import * as React from "react"
import { useQuery, useMutation } from "@tanstack/react-query"
import {
  Webhook,
  Plus,
  Pencil,
  Trash2,
  RotateCw,
  AlertTriangle,
  Sparkles,
  Info,
  Variable,
  Eye,
  ToggleLeft,
  ToggleRight,
  Loader2,
} from "lucide-react"

import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
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
import { toast } from "sonner"
import { cn } from "@/lib/utils"

import {
  type EventWebhookItem,
  EVENTS_LIST,
  EVENT_VARIABLES,
  WEBHOOK_TEMPLATES,
  TARGET_ROLE_OPTIONS,
} from "./types"

export function PushWebhooksTab() {
  const [whEvent, setWhEvent] = React.useState("booking.created")
  const [whTitle, setWhTitle] = React.useState("")
  const [whBody, setWhBody] = React.useState("")
  const [whUrl, setWhUrl] = React.useState("/")
  const [whRoles, setWhRoles] = React.useState<string[]>(["PROVIDER"])
  const [whEditing, setWhEditing] = React.useState<string | null>(null)
  const [confirmDeleteWhId, setConfirmDeleteWhId] = React.useState<string | null>(null)

  const {
    data: webhooksData,
    isLoading: whLoading,
    refetch: whRefetch,
  } = useQuery({
    queryKey: ["admin", "push", "webhooks"],
    queryFn: () =>
      apiGet<{ ok: boolean; webhooks: EventWebhookItem[] }>("/api/admin/push/webhooks"),
    staleTime: 30_000,
  })

  const resetWebhookForm = () => {
    setWhEditing(null)
    setWhEvent("booking.created")
    setWhTitle("")
    setWhBody("")
    setWhUrl("/")
    setWhRoles(["PROVIDER"])
    hasAutoApplied.current = false
  }

  const applyWebhookTemplate = React.useCallback((eventKey: string) => {
    const tmpl = WEBHOOK_TEMPLATES[eventKey]
    if (!tmpl) return
    setWhTitle(tmpl.title)
    setWhBody(tmpl.body)
    setWhUrl(tmpl.pushUrl)
    setWhRoles(tmpl.targetRoles)
  }, [])

  const handleWhEventChange = React.useCallback(
    (value: string) => {
      setWhEvent(value)
      if (!whEditing) {
        applyWebhookTemplate(value)
      }
    },
    [whEditing, applyWebhookTemplate],
  )

  const hasAutoApplied = React.useRef(false)
  React.useEffect(() => {
    if (!whEditing && !hasAutoApplied.current) {
      hasAutoApplied.current = true
      applyWebhookTemplate(whEvent)
    }
  }, [whEditing, whEvent, applyWebhookTemplate])

  const createWebhookMutation = useMutation({
    mutationFn: () =>
      apiPost("/api/admin/push/webhooks", {
        event: whEvent,
        title: whTitle,
        body: whBody,
        pushUrl: whUrl,
        targetRoles: whRoles,
      }),
    onSuccess: () => {
      toast.success("Webhook de evento criado!")
      void whRefetch()
      resetWebhookForm()
    },
    onError: (err: Error) => toast.error(err.message || "Erro ao criar webhook."),
  })

  const updateWebhookMutation = useMutation({
    mutationFn: () => {
      if (!whEditing) throw new Error("Nenhum webhook selecionado para edição.")
      return apiPatch(`/api/admin/push/webhooks/${whEditing}`, {
        title: whTitle,
        body: whBody,
        pushUrl: whUrl,
        targetRoles: whRoles,
      })
    },
    onSuccess: () => {
      toast.success("Webhook atualizado!")
      void whRefetch()
      resetWebhookForm()
    },
    onError: (err: Error) => toast.error(err.message || "Erro ao atualizar webhook."),
  })

  const toggleWebhookMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiPatch(`/api/admin/push/webhooks/${id}`, { active }),
    onSuccess: () => {
      void whRefetch()
    },
    onError: (err: Error) => toast.error(err.message || "Erro ao alternar webhook."),
  })

  const deleteWebhookMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/api/admin/push/webhooks/${id}`),
    onSuccess: () => {
      toast.success("Webhook excluído.")
      void whRefetch()
    },
    onError: (err: Error) => toast.error(err.message || "Erro ao excluir webhook."),
  })

  const startEditWebhook = (w: EventWebhookItem) => {
    setWhEditing(w.id)
    setWhEvent(w.event)
    setWhTitle(w.title)
    setWhBody(w.body ?? "")
    setWhUrl(w.pushUrl)
    setWhRoles(w.targetRoles)
  }

  const toggleWhRole = (role: string) => {
    setWhRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]))
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      {/* Webhooks list */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">
              <Webhook className="mr-2 inline-block size-5 align-text-top" /> Regras de Webhook
            </h3>
            <p className="text-muted-foreground text-sm">
              Disparam push automaticamente quando eventos do sistema ocorrem.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => void whRefetch()}
            disabled={whLoading}
          >
            <RotateCw className={cn("size-4", whLoading && "animate-spin")} />
          </Button>
        </div>

        <Card>
          {whLoading && (
            <CardContent className="p-6">
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-md" />
                ))}
              </div>
            </CardContent>
          )}
          {!whLoading && !webhooksData && (
            <CardContent className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <AlertTriangle className="size-8 text-amber-500" />
              <p className="text-muted-foreground text-sm">Erro ao carregar webhooks.</p>
              <Button variant="outline" size="sm" onClick={() => void whRefetch()}>
                Tentar novamente
              </Button>
            </CardContent>
          )}
          {!whLoading && webhooksData && webhooksData.webhooks.length === 0 && (
            <CardContent className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <Webhook className="text-muted-foreground size-8" />
              <p className="text-muted-foreground text-sm">Nenhuma regra de webhook configurada.</p>
              <p className="text-muted-foreground text-xs">
                Crie regras ao lado para automatizar notificações push por evento.
              </p>
            </CardContent>
          )}
          {!whLoading && webhooksData && webhooksData.webhooks.length > 0 && (
            <div className="max-h-[500px] overflow-y-auto">
              {webhooksData.webhooks.map((w) => (
                <div
                  key={w.id}
                  className={cn(
                    "hover:bg-muted/30 flex items-start gap-3 border-b p-4 transition-colors last:border-0",
                    whEditing === w.id && "bg-primary/5",
                  )}
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{w.title}</p>
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {w.event}
                      </Badge>
                    </div>
                    {w.body && <p className="text-muted-foreground truncate text-xs">{w.body}</p>}
                    <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-[10px]">
                      {(w.targetRoles as string[]).map((r) => (
                        <Badge key={r} variant="secondary" className="px-1.5 py-0 text-[9px]">
                          {r}
                        </Badge>
                      ))}
                      <span className="ml-1">· {w.pushUrl}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Switch
                      checked={w.active}
                      onCheckedChange={(checked) =>
                        toggleWebhookMutation.mutate({ id: w.id, active: checked })
                      }
                      aria-label="Ativar/desativar"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => startEditWebhook(w)}
                      title="Editar"
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive size-7"
                      onClick={() => setConfirmDeleteWhId(w.id)}
                      title="Excluir"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                    <AlertDialog
                      open={confirmDeleteWhId === w.id}
                      onOpenChange={(open) => {
                        if (!open) setConfirmDeleteWhId(null)
                      }}
                    >
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle className="flex items-center gap-2">
                            <Trash2 className="text-destructive size-5" />
                            Excluir regra de webhook?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            A regra <strong>&quot;{w.title}&quot;</strong> para o evento{" "}
                            <strong>{w.event}</strong> será excluída permanentemente. Notificações
                            automáticas para este evento pararão de ser enviadas.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel onClick={() => setConfirmDeleteWhId(null)}>
                            Voltar
                          </AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => {
                              deleteWebhookMutation.mutate(w.id)
                              setConfirmDeleteWhId(null)
                            }}
                            className="bg-destructive hover:bg-destructive/90 gap-2"
                          >
                            <Trash2 className="size-4" />
                            Excluir permanentemente
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Webhook form */}
      <div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {whEditing ? <Pencil className="size-4" /> : <Plus className="size-4" />}
              {whEditing ? "Editar regra" : "Nova regra de webhook"}
            </CardTitle>
            <CardDescription>
              {whEditing
                ? "Atualize os campos abaixo."
                : "Defina quando e para quem enviar push automaticamente."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-foreground text-xs font-medium">
                  Evento <span className="text-destructive">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => applyWebhookTemplate(whEvent)}
                  className="text-primary hover:text-primary/80 inline-flex items-center gap-1 text-[10px] font-medium transition-colors"
                >
                  <Sparkles className="size-3" />
                  Usar template padrão
                </button>
              </div>
              <Select value={whEvent} onValueChange={handleWhEventChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENTS_LIST.map((ev) => (
                    <SelectItem key={ev.value} value={ev.value}>
                      {ev.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex flex-wrap items-center gap-1.5">
                {!whEditing && (whTitle || whBody) && (
                  <span className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium">
                    <Sparkles className="size-2.5" />
                    Template aplicado
                  </span>
                )}
                <span className="text-muted-foreground inline-flex items-center gap-1 text-[10px]">
                  <Info className="size-3" /> Variáveis:
                  {(EVENT_VARIABLES[whEvent] ?? []).map((v) => (
                    <code
                      key={v}
                      className="bg-muted rounded px-1 py-0.5 font-mono text-[10px]"
                    >{`{{${v}}}`}</code>
                  ))}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-foreground text-xs font-medium">
                Template do título <span className="text-destructive">*</span>
              </label>
              <Input
                placeholder="Ex: Novo agendamento de {{serviceName}}"
                value={whTitle}
                onChange={(e) => setWhTitle(e.target.value.slice(0, 200))}
                maxLength={200}
              />
              <p className="text-muted-foreground text-right text-[10px]">{whTitle.length}/200</p>
            </div>

            <div className="space-y-2">
              <label className="text-foreground text-xs font-medium">Template do corpo</label>
              <Textarea
                placeholder="Ex: {{clientName}} agendou {{serviceName}} para {{date}}"
                value={whBody}
                onChange={(e) => setWhBody(e.target.value.slice(0, 500))}
                maxLength={500}
                rows={2}
              />
              <p className="text-muted-foreground text-right text-[10px]">{whBody.length}/500</p>
            </div>

            <div className="space-y-2">
              <label className="text-foreground text-xs font-medium">URL de destino</label>
              <Input placeholder="/" value={whUrl} onChange={(e) => setWhUrl(e.target.value)} />
            </div>

            <div className="space-y-2">
              <label className="text-foreground text-xs font-medium">
                Quem recebe? <span className="text-destructive">*</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {TARGET_ROLE_OPTIONS.map((opt) => (
                  <Button
                    key={opt.value}
                    type="button"
                    variant={whRoles.includes(opt.value) ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleWhRole(opt.value)}
                  >
                    {whRoles.includes(opt.value) ? (
                      <ToggleRight className="mr-1 size-3.5" />
                    ) : (
                      <ToggleLeft className="mr-1 size-3.5" />
                    )}
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="bg-muted/30 rounded-lg border border-dashed p-3">
              <p className="text-muted-foreground mb-1 flex items-center gap-1 text-xs font-medium">
                <Eye className="size-3.5" /> Preview
              </p>
              <p className="text-sm font-medium">{whTitle || "(título aparecerá aqui)"}</p>
              {whBody && <p className="text-muted-foreground text-xs">{whBody}</p>}
              <div className="text-muted-foreground mt-1 flex items-center gap-1 text-[10px]">
                <Variable className="size-3" /> Enviado para:{" "}
                {whRoles.length > 0 ? whRoles.join(", ") : "ninguém"}
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex-col gap-2">
            <Button
              className="w-full gap-2"
              onClick={() => {
                if (!whTitle.trim()) {
                  toast.error("O título é obrigatório.")
                  return
                }
                if (whRoles.length === 0) {
                  toast.error("Selecione pelo menos uma role alvo.")
                  return
                }
                if (whEditing) updateWebhookMutation.mutate()
                else createWebhookMutation.mutate()
              }}
              disabled={createWebhookMutation.isPending || updateWebhookMutation.isPending}
            >
              {createWebhookMutation.isPending || updateWebhookMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : whEditing ? (
                <Pencil className="size-4" />
              ) : (
                <Plus className="size-4" />
              )}
              {createWebhookMutation.isPending
                ? "Criando..."
                : updateWebhookMutation.isPending
                  ? "Salvando..."
                  : whEditing
                    ? "Salvar alterações"
                    : "Criar regra"}
            </Button>
            {whEditing && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs"
                onClick={resetWebhookForm}
              >
                Cancelar edição
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
