"use client"

/**
 * AdminSettings — dynamic configuration editor (".env-like" console).
 *
 * Data source: GET /api/admin/settings    → { items: Setting[], total }
 *              POST /api/admin/settings   { settings: [{ key, value }] } (upsert)
 * (No DELETE endpoint exists in MVP — admin can clear the value to disable.)
 *
 * Settings are grouped by prefix (split on first "_"). The UI just renders
 * whatever is in the settings table — no hardcoded list. A new setting can
 * be added on the fly.
 */

import * as React from "react"
import {
  Save,
  Plus,
  Loader2,
  Settings as SettingsIcon,
  AlertTriangle,
  Check,
  RotateCcw,
  MapPin,
  CreditCard,
  Mail,
  Cloud,
  Server,
  HelpCircle,
  type LucideIcon,
} from "lucide-react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { apiGet, apiPost } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDate } from "@/lib/format"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Setting = {
  id?: string
  key: string
  value: string
  updatedAt?: string
}

type SettingsResponse = {
  items: Setting[]
  total: number
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export function AdminSettings() {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<Record<string, string>>({})
  const [dirty, setDirty] = React.useState<Set<string>>(new Set())

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => apiGet<SettingsResponse>("/api/admin/settings"),
    staleTime: 30_000,
  })

  const items = data?.items ?? []

  // Group by prefix (first segment before "_"); fallback to "Geral"
  const groups = React.useMemo(() => {
    const map = new Map<string, Setting[]>()
    for (const s of items) {
      const idx = s.key.indexOf("_")
      const group = idx > 0 ? s.key.slice(0, idx) : "Geral"
      const arr = map.get(group) ?? []
      arr.push(s)
      map.set(group, arr)
    }
    // Sort groups alphabetically, but keep "Geral" last
    return Array.from(map.entries()).sort((a, b) => {
      if (a[0] === "Geral") return 1
      if (b[0] === "Geral") return -1
      return a[0].localeCompare(b[0])
    })
  }, [items])

  // Initialize draft when items arrive
  React.useEffect(() => {
    if (items.length === 0) return
    setDraft((prev) => {
      const next: Record<string, string> = { ...prev }
      for (const s of items) {
        if (!(s.key in next)) next[s.key] = s.value
      }
      return next
    })
  }, [items])

  const upsertMutation = useMutation({
    mutationFn: (settings: Array<{ key: string; value: string }>) =>
      apiPost<{ items: Setting[] }>("/api/admin/settings", { settings }),
    onSuccess: (_data, vars) => {
      toast.success(
        vars.length === 1
          ? `Configuração "${vars[0].key}" salva.`
          : `${vars.length} configurações salvas.`,
      )
      setDirty(new Set())
      queryClient.invalidateQueries({ queryKey: ["admin", "settings"] })
    },
    onError: (e: unknown) =>
      toast.error(errMsg(e, "Não foi possível salvar as configurações.")),
  })

  const createMutation = useMutation({
    mutationFn: (setting: { key: string; value: string }) =>
      apiPost<{ items: Setting[] }>("/api/admin/settings", {
        settings: [setting],
      }),
    onSuccess: (_d, vars) => {
      toast.success(`Configuração "${vars.key}" criada.`)
      queryClient.invalidateQueries({ queryKey: ["admin", "settings"] })
      setCreateOpen(false)
    },
    onError: (e: unknown) =>
      toast.error(errMsg(e, "Não foi possível criar a configuração.")),
  })

  const handleValueChange = (key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
    setDirty((prev) => {
      const next = new Set(prev)
      const original = items.find((s) => s.key === key)?.value
      if (original !== value) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const saveRow = (key: string) => {
    if (!dirty.has(key)) return
    upsertMutation.mutate([{ key, value: draft[key] ?? "" }])
  }

  const saveAll = () => {
    if (dirty.size === 0) return
    const pairs = Array.from(dirty).map((key) => ({
      key,
      value: draft[key] ?? "",
    }))
    upsertMutation.mutate(pairs)
  }

  const resetDirty = () => {
    const next: Record<string, string> = {}
    for (const s of items) next[s.key] = s.value
    setDraft(next)
    setDirty(new Set())
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Não foi possível carregar as configurações.
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Tentar novamente
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4 pb-24">
      {/* Warning banner */}
      <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-100">
        <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
        <AlertTitle className="text-sm font-semibold">
          Estas configurações afetam todo o sistema. Edite com cuidado.
        </AlertTitle>
        <AlertDescription className="text-xs">
          Alterações são salvas no banco e aplicadas instantaneamente. Erros
          podem afetar pagamentos, e-mails e geolocalização.
        </AlertDescription>
      </Alert>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {isLoading
            ? "Carregando configurações..."
            : `${items.length} configuração(ões) em ${groups.length} grupo(s)`}
          {dirty.size > 0 ? (
            <span className="ml-2 inline-flex items-center gap-1 font-medium text-primary">
              · {dirty.size} pendente(s) de salvar
            </span>
          ) : null}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="gap-1.5"
          >
            <Plus className="size-3.5" />
            Nova configuração
          </Button>
        </div>
      </div>

      {/* Grouped cards */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <SettingsIcon className="size-7" />
            </div>
            <div>
              <p className="text-lg font-semibold">Nenhuma configuração</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Crie a primeira configuração para começar.
              </p>
            </div>
            <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
              <Plus className="size-4" />
              Nova configuração
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {groups.map(([group, groupItems]) => {
            const meta = GROUP_META[group] ?? GROUP_META.default
            const GroupIcon = meta.icon
            return (
              <Card key={group} className="overflow-hidden">
                <div className="flex items-center justify-between border-b p-5">
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-lg",
                        meta.tone,
                      )}
                    >
                      <GroupIcon className="size-4" />
                    </span>
                    <div>
                      <p className="text-base font-semibold">{meta.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {meta.description}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    {groupItems.length} chave(s)
                  </Badge>
                </div>
                <CardContent className="flex flex-col gap-2.5 p-4">
                  {groupItems.map((s) => {
                    const isDirty = dirty.has(s.key)
                    const isMasked = isSecretKey(s.key)
                    return (
                      <div
                        key={s.key}
                        className={cn(
                          "flex flex-col gap-1.5 rounded-lg border p-3 transition-colors",
                          isDirty
                            ? "border-primary/40 bg-primary/5"
                            : "border-border bg-card",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Label
                            htmlFor={`set-${s.key}`}
                            className="font-mono text-[11px] font-medium tracking-tight text-foreground"
                          >
                            {s.key}
                          </Label>
                          <div className="flex items-center gap-1.5">
                            {isMasked ? (
                              <Badge
                                variant="outline"
                                className="gap-1 border-amber-200 bg-amber-50 text-[9px] uppercase tracking-wide text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300"
                              >
                                <AlertTriangle className="size-2.5" />
                                Sigiloso
                              </Badge>
                            ) : null}
                            {s.updatedAt ? (
                              <span className="text-[10px] text-muted-foreground tabular-nums">
                                {formatDate(s.updatedAt)}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Input
                            id={`set-${s.key}`}
                            value={draft[s.key] ?? ""}
                            onChange={(e) =>
                              handleValueChange(s.key, e.target.value)
                            }
                            type={isMasked ? "password" : "text"}
                            className="h-9 font-mono text-xs"
                            spellCheck={false}
                            autoComplete="off"
                          />
                          <Button
                            size="sm"
                            variant={isDirty ? "default" : "outline"}
                            onClick={() => saveRow(s.key)}
                            disabled={!isDirty || upsertMutation.isPending}
                            className="h-9 shrink-0 gap-1"
                          >
                            {upsertMutation.isPending &&
                            upsertMutation.variables?.some(
                              (p) => p.key === s.key,
                            ) ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : isDirty ? (
                              <Save className="size-3.5" />
                            ) : (
                              <Check className="size-3.5" />
                            )}
                            <span className="hidden sm:inline">
                              {isDirty ? "Salvar" : "Salvo"}
                            </span>
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Sticky save bar — grouped Descartar + Salvar tudo */}
      {dirty.size > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{dirty.size}</span>{" "}
              alteração(ões) não salva(s)
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={resetDirty}
                disabled={upsertMutation.isPending}
                className="gap-1.5"
              >
                <RotateCcw className="size-3.5" />
                Descartar
              </Button>
              <Button
                size="sm"
                onClick={saveAll}
                disabled={upsertMutation.isPending}
                className="gap-1.5"
              >
                {upsertMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                Salvar tudo
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Create dialog */}
      <CreateSettingDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        existingKeys={items.map((s) => s.key)}
        submitting={createMutation.isPending}
        onSubmit={(p) => createMutation.mutate(p)}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// CreateSettingDialog
// ---------------------------------------------------------------------------
function CreateSettingDialog({
  open,
  onOpenChange,
  existingKeys,
  submitting,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  existingKeys: string[]
  submitting: boolean
  onSubmit: (payload: { key: string; value: string }) => void
}) {
  const [key, setKey] = React.useState("")
  const [value, setValue] = React.useState("")

  React.useEffect(() => {
    if (open) {
      setKey("")
      setValue("")
    }
  }, [open])

  const keyValid = /^[A-Z0-9_]+$/.test(key) && key.length >= 1
  const dupe = existingKeys.includes(key.toUpperCase())

  const canSubmit = keyValid && !dupe && !submitting

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova configuração</DialogTitle>
          <DialogDescription>
            Adicione um novo par chave/valor. A chave deve ter apenas letras
            maiúsculas, números e underline.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!canSubmit) return
            onSubmit({ key: key.toUpperCase(), value })
          }}
          className="flex flex-col gap-3 py-1"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="set-key">Chave</Label>
            <Input
              id="set-key"
              value={key}
              onChange={(e) =>
                setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))
              }
              placeholder="EX.: PAYMENT_API_KEY"
              className="font-mono"
              autoFocus
            />
            {dupe ? (
              <p className="text-[11px] text-red-600">
                Esta chave já existe.
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Convenção: <code>GRUPO_NOME</code> (ex.:{" "}
                <code>PAYMENT_PIX_KEY</code>).
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="set-value">Valor</Label>
            <Input
              id="set-value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Valor da configuração"
              className="font-mono text-xs"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSubmit} className="gap-1.5">
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Criar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Group metadata — icon, tone, description per prefix
// ---------------------------------------------------------------------------
type GroupMeta = {
  label: string
  description: string
  icon: LucideIcon
  tone: string
}

const GROUP_META: Record<string, GroupMeta> = {
  payment: {
    label: "Pagamentos",
    description: "Chaves de API, tokens e configurações de gateway",
    icon: CreditCard,
    tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
  email: {
    label: "E-mail",
    description: "Remetente, provedor e templates de e-mail",
    icon: Mail,
    tone: "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300",
  },
  smtp: {
    label: "SMTP",
    description: "Servidor e credenciais de envio de e-mail",
    icon: Mail,
    tone: "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300",
  },
  nominatim: {
    label: "Geolocalização",
    description: "Endereço, CEP e busca por coordenadas",
    icon: MapPin,
    tone: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  },
  geo: {
    label: "Geolocalização",
    description: "Endereço, CEP e busca por coordenadas",
    icon: MapPin,
    tone: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  },
  site: {
    label: "Site",
    description: "Configurações gerais do site e branding",
    icon: SettingsIcon,
    tone: "bg-primary/10 text-primary",
  },
  support: {
    label: "Suporte",
    description: "Canais de atendimento e contato",
    icon: HelpCircle,
    tone: "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-200",
  },
  weather: {
    label: "Clima",
    description: "Integração com serviço de previsão do tempo",
    icon: Cloud,
    tone: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  },
  server: {
    label: "Servidor",
    description: "Configurações de infraestrutura e runtime",
    icon: Server,
    tone: "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-200",
  },
  Geral: {
    label: "Geral",
    description: "Configurações gerais sem prefixo específico",
    icon: SettingsIcon,
    tone: "bg-primary/10 text-primary",
  },
  default: {
    label: "Outros",
    description: "Configurações diversas",
    icon: SettingsIcon,
    tone: "bg-muted text-muted-foreground",
  },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isSecretKey(key: string): boolean {
  const k = key.toUpperCase()
  return (
    k.includes("SECRET") ||
    k.includes("TOKEN") ||
    k.includes("PASSWORD") ||
    k.includes("API_KEY") ||
    k.includes("KEY")
  )
}

function errMsg(e: unknown, fallback: string): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message?: unknown }).message ?? fallback)
  }
  return fallback
}
