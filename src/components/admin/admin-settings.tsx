"use client"

/**
 * AdminSettings — editor dinâmico de configurações (console tipo .env).
 *
 * Heurísticas de Nielsen aplicadas neste redesign:
 *   H1  Visibilidade do status  → FreshnessLabel + SavingPill no sticky bar
 *   H3  Controle e liberdade    → Undo por campo (pilha de edições) + Descartar tudo
 *   H4  Consistência            → UMA cor por grupo; StatusBadge p/ "Secreto"
 *   H5  Prevenção de erros      → Eye/EyeOff p/ revelar segredos; warning banner
 *   H6  Reconhecimento          → "Secreto" (claro) em vez de "Sigiloso"; Info tooltip por chave
 *   H7  Eficiência              → SearchInput filtra por chave; flat list quando buscando
 *   H8  Minimalismo             → UM botão Salvar (sticky "Salvar tudo"); sem botão por linha
 *   H9  Recuperar erros         → ErrorState c/ retry; toast p/ cada mutation
 *   H10 Ajuda e documentação    → SETTING_HELP map (tooltips p/ prefixos conhecidos);
 *        caption "Para remover, limpe o valor e salve."
 *
 * Data source: GET /api/admin/settings    → { items: Setting[], total }
 *              POST /api/admin/settings   { settings: [{ key, value }] } (upsert)
 * (NÃO há endpoint DELETE no MVP — admin limpa o valor para desativar.)
 */

import * as React from "react"
import {
  Save,
  Plus,
  Loader2,
  Settings as SettingsIcon,
  AlertTriangle,
  Check,
  Undo2,
  Trash2,
  MapPin,
  CreditCard,
  Mail,
  Cloud,
  Server,
  HelpCircle,
  Info,
  Eye,
  EyeOff,
  Lock,
  type LucideIcon,
} from "lucide-react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { apiGet, apiPost } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { formatDate } from "@/lib/format"

import {
  PageSectionHeader,
  SearchInput,
  StatusBadge,
  FreshnessLabel,
  ErrorState,
  EmptyState,
  errMsg,
  type StatusTone,
} from "@/components/admin/admin-shared"

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
// SETTING_HELP — H10: descrições curtas p/ chaves com prefixo conhecido.
// Caso a chave não esteja mapeada, omitimos o tooltip (não inventamos).
// ---------------------------------------------------------------------------
const SETTING_HELP: Record<string, string> = {
  // Pagamentos
  PAYMENT_API_KEY: "Chave de API do gateway de pagamento.",
  PAYMENT_SECRET_KEY: "Chave secreta do gateway de pagamento.",
  PAYMENT_PUBLIC_KEY: "Chave pública do gateway (cliente).",
  PAYMENT_WEBHOOK_SECRET: "Segredo para validar webhooks do gateway.",
  PAYMENT_PIX_KEY: "Chave Pix usada para recebimentos.",
  PAYMENT_WEBHOOK_URL: "URL pública que recebe notificações do gateway.",
  PAYMENT_SUCCESS_URL: "URL de redirecionamento após pagamento aprovado.",
  PAYMENT_CANCEL_URL: "URL de redirecionamento após pagamento cancelado.",
  // E-mail / SMTP
  EMAIL_FROM: "Endereço de e-mail usado como remetente do sistema.",
  EMAIL_FROM_NAME: "Nome amigável exibido no remetente.",
  EMAIL_PROVIDER: "Provedor de envio (ex.: smtp, resend, ses).",
  SMTP_HOST: "Servidor SMTP de envio de e-mail.",
  SMTP_PORT: "Porta do servidor SMTP (comum: 587, 465, 25).",
  SMTP_USER: "Usuário (login) do servidor SMTP.",
  SMTP_PASSWORD: "Senha do servidor SMTP.",
  SMTP_SECURE: "Use 'true' para TLS (porta 465); 'false' caso contrário.",
  // Geolocalização
  NOMINATIM_BASE_URL: "URL base da API Nominatim (busca de endereço por CEP).",
  NOMINATIM_USER_AGENT: "User-Agent enviado à API Nominatim (identificação).",
  NOMINATIM_EMAIL: "E-mail de contato enviado à API Nominatim (boa prática).",
  GEO_DEFAULT_LAT: "Latitude padrão do mapa (quando sem geolocalização).",
  GEO_DEFAULT_LNG: "Longitude padrão do mapa (quando sem geolocalização).",
  GEO_DEFAULT_ZOOM: "Zoom inicial do mapa (0–20).",
  // Site / Suporte / Clima / Servidor
  SITE_NAME: "Nome do marketplace exibido no header e e-mails.",
  SITE_URL: "URL pública do site (usada em links de e-mail).",
  SITE_LOGO_URL: "URL do logotipo principal.",
  SUPPORT_EMAIL: "E-mail de suporte ao cliente.",
  SUPPORT_WHATSAPP: "WhatsApp de suporte (com DDI, ex.: 5511999999999).",
  WEATHER_API_KEY: "Chave de API do serviço de previsão do tempo.",
  WEATHER_API_URL: "URL base da API de clima.",
  SERVER_PORT: "Porta em que o servidor Next.js escuta.",
  SERVER_NODE_ENV: "Ambiente (development, production, test).",
}

function lookupHelp(key: string): string | null {
  if (SETTING_HELP[key]) return SETTING_HELP[key]
  const upper = key.toUpperCase()
  // Heurísticas por prefixo
  if (upper.startsWith("PAYMENT_"))
    return "Configuração relacionada ao gateway de pagamento."
  if (upper.startsWith("SMTP_"))
    return "Configuração do servidor de envio de e-mails (SMTP)."
  if (upper.startsWith("EMAIL_"))
    return "Configuração de remetente e provedor de e-mail."
  if (upper.startsWith("NOMINATIM_") || upper.startsWith("GEO_"))
    return "Configuração de geolocalização (endereço, CEP, mapa)."
  if (upper.startsWith("SITE_"))
    return "Configuração geral do site (branding, URL, nome)."
  if (upper.startsWith("SUPPORT_"))
    return "Canal de atendimento/suporte ao cliente."
  if (upper.startsWith("WEATHER_"))
    return "Integração com serviço de previsão do tempo."
  return null
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export function AdminSettings() {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<Record<string, string>>({})
  const [dirty, setDirty] = React.useState<Set<string>>(new Set())
  // H3 — pilha de edições (para "Desfazer" reversível por campo)
  const [editHistory, setEditHistory] = React.useState<string[]>([])
  // H5 — chaves reveladas (segredos)
  const [revealedKeys, setRevealedKeys] = React.useState<Set<string>>(new Set())
  // H7 — busca por chave
  const [query, setQuery] = React.useState("")
  // H1 — última atualização
  const [lastFetched, setLastFetched] = React.useState<Date | null>(null)

  const { data, isLoading, isError, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => apiGet<SettingsResponse>("/api/admin/settings"),
    staleTime: 30_000,
  })

  // H1 — sincroniza freshness label
  React.useEffect(() => {
    if (dataUpdatedAt) setLastFetched(new Date(dataUpdatedAt))
  }, [dataUpdatedAt])

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

  // H7 — quando buscando, lista flat filtrada por chave (case-insensitive)
  const flatFiltered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    return items.filter((s) => s.key.toLowerCase().includes(q))
  }, [items, query])

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
      setEditHistory([])
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

  // H3 — change tracking registra ordem das edições p/ undo por campo
  const handleValueChange = (key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
    setDirty((prev) => {
      const next = new Set(prev)
      const original = items.find((s) => s.key === key)?.value
      if (original !== value) next.add(key)
      else next.delete(key)
      return next
    })
    setEditHistory((prev) => {
      // move key to end (most recent)
      const next = prev.filter((k) => k !== key)
      next.push(key)
      return next
    })
  }

  const saveAll = () => {
    if (dirty.size === 0) return
    const pairs = Array.from(dirty).map((key) => ({
      key,
      value: draft[key] ?? "",
    }))
    upsertMutation.mutate(pairs)
  }

  // H3 — desfaz apenas a última edição (mais controle que "Descartar tudo")
  const undoLastEdit = () => {
    if (editHistory.length === 0) return
    const lastKey = editHistory[editHistory.length - 1]
    const original = items.find((s) => s.key === lastKey)?.value ?? ""
    setDraft((prev) => ({ ...prev, [lastKey]: original }))
    setDirty((prev) => {
      const next = new Set(prev)
      next.delete(lastKey)
      return next
    })
    setEditHistory((prev) => prev.slice(0, -1))
    toast.success(`Alteração em "${lastKey}" desfeita.`)
  }

  // H3 — descarta TODAS as alterações
  const resetAll = () => {
    const next: Record<string, string> = {}
    for (const s of items) next[s.key] = s.value
    setDraft(next)
    setDirty(new Set())
    setEditHistory([])
    toast.success("Todas as alterações foram descartadas.")
  }

  // H5 — toggle de revelar segredo
  const toggleReveal = (key: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-4 pb-24">
      <PageSectionHeader
        title="Configurações"
        description="Chaves dinâmicas (estilo .env) que controlam pagamentos, e-mail, geolocalização e mais."
        action={
          lastFetched ? (
            <FreshnessLabel updatedAt={lastFetched} />
          ) : null
        }
      />

      {/* Warning banner — H5 prevenção */}
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

      {/* Toolbar — H7 busca + contagem + H1 freshness + nova */}
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-sm sm:flex-row sm:items-center">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            {isLoading
              ? "Carregando configurações..."
              : `${items.length} configuração(ões) em ${groups.length} grupo(s)`}
            {dirty.size > 0 ? (
              <span className="ml-1 inline-flex items-center gap-1 font-medium text-primary">
                · {dirty.size} pendente(s)
              </span>
            ) : null}
          </span>
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Buscar por chave (ex.: PAYMENT_)"
            className="min-w-[200px] flex-1"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {lastFetched ? (
            <span className="hidden sm:inline-flex">
              <FreshnessLabel updatedAt={lastFetched} />
            </span>
          ) : null}
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

      {/* Body — error / loading / empty / list */}
      {isError ? (
        <ErrorState
          title="Não foi possível carregar as configurações"
          description="Verifique sua conexão e tente novamente."
          onRetry={() => refetch()}
        />
      ) : isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={SettingsIcon}
          title="Nenhuma configuração"
          description="Crie a primeira configuração para começar."
          action={
            <Button
              size="sm"
              onClick={() => setCreateOpen(true)}
              className="gap-1.5"
            >
              <Plus className="size-4" />
              Nova configuração
            </Button>
          }
        />
      ) : flatFiltered ? (
        // H7 — modo busca: flat list
        <FlatResultsList
          items={flatFiltered}
          draft={draft}
          dirty={dirty}
          revealedKeys={revealedKeys}
          onValueChange={handleValueChange}
          onToggleReveal={toggleReveal}
        />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={SettingsIcon}
          title="Nenhum grupo encontrado"
          description="Ajuste a busca ou crie uma nova configuração."
        />
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
                  <StatusBadge tone="zinc">
                    {groupItems.length}{" "}
                    {groupItems.length === 1 ? "chave" : "chaves"}
                  </StatusBadge>
                </div>
                <CardContent className="flex flex-col gap-2.5 p-4">
                  {groupItems.map((s) => (
                    <SettingRow
                      key={s.key}
                      setting={s}
                      draftValue={draft[s.key] ?? ""}
                      isDirty={dirty.has(s.key)}
                      isRevealed={revealedKeys.has(s.key)}
                      onValueChange={handleValueChange}
                      onToggleReveal={toggleReveal}
                    />
                  ))}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* H8 — UM único caminho de salvar: sticky bar (sem botão por linha) */}
      {dirty.size > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground tabular-nums">
                {dirty.size}
              </span>{" "}
              alteração(ões) não salva(s)
              {editHistory.length > 0 ? (
                <span className="ml-1 text-xs text-muted-foreground">
                  · última:{" "}
                  <code className="font-mono">{editHistory[editHistory.length - 1]}</code>
                </span>
              ) : null}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {upsertMutation.isPending ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                  <Loader2 className="size-3.5 animate-spin" />
                  Salvando…
                </span>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={undoLastEdit}
                disabled={
                  upsertMutation.isPending || editHistory.length === 0
                }
                className="gap-1.5"
              >
                <Undo2 className="size-3.5" />
                Desfazer
                {editHistory.length > 0 ? (
                  <span className="ml-0.5 rounded bg-muted px-1 text-[10px] tabular-nums">
                    {editHistory.length}
                  </span>
                ) : null}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={resetAll}
                disabled={upsertMutation.isPending}
                className="gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <Trash2 className="size-3.5" />
                Descartar tudo
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
// SettingRow — uma linha por configuração
// H5: eye toggle para segredos · H6: badge "Secreto" · H10: Info tooltip
// H4: caption "Para remover, limpe o valor e salve."
// ---------------------------------------------------------------------------
function SettingRow({
  setting,
  draftValue,
  isDirty,
  isRevealed,
  onValueChange,
  onToggleReveal,
}: {
  setting: Setting
  draftValue: string
  isDirty: boolean
  isRevealed: boolean
  onValueChange: (key: string, value: string) => void
  onToggleReveal: (key: string) => void
}) {
  const isSecret = isSecretKey(setting.key)
  const help = lookupHelp(setting.key)

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border p-3 transition-colors",
        isDirty
          ? "border-primary/40 bg-primary/5"
          : "border-border bg-card",
      )}
    >
      {/* Linha 1 — chave + badges + updatedAt + Info tooltip (H10) */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Label
            htmlFor={`set-${setting.key}`}
            className="truncate font-mono text-[11px] font-medium tracking-tight text-foreground"
          >
            {setting.key}
          </Label>
          {isSecret ? (
            <StatusBadge tone="amber">
              <Lock className="size-3" />
              Secreto
            </StatusBadge>
          ) : null}
          {help ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={`O que é ${setting.key}?`}
                >
                  <Info className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                className="max-w-xs text-xs leading-relaxed"
              >
                {help}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        {setting.updatedAt ? (
          <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
            {formatDate(setting.updatedAt)}
          </span>
        ) : null}
      </div>

      {/* Linha 2 — input + eye toggle (H5). Sem botão Salvar (H8). */}
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Input
            id={`set-${setting.key}`}
            value={draftValue}
            onChange={(e) => onValueChange(setting.key, e.target.value)}
            type={isSecret && !isRevealed ? "password" : "text"}
            className="h-9 pr-9 font-mono text-xs"
            spellCheck={false}
            autoComplete="off"
          />
          {isSecret ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onToggleReveal(setting.key)}
                  className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label={isRevealed ? "Ocultar valor" : "Mostrar valor"}
                  aria-pressed={isRevealed}
                >
                  {isRevealed ? (
                    <EyeOff className="size-3.5" />
                  ) : (
                    <Eye className="size-3.5" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {isRevealed ? "Ocultar valor" : "Mostrar valor"}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        {/* H8 — feedback sutil de "salvo/vazio" sem virar um botão competidor */}
        {isDirty ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-1.5 py-1 text-[10px] font-medium text-primary">
            <Check className="size-3" />
            alterado
          </span>
        ) : null}
      </div>

      {/* H4 — caption honesto sobre a ausência de endpoint DELETE */}
      <p className="text-[10px] text-muted-foreground">
        Para remover, limpe o valor e salve.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// FlatResultsList — H7: lista filtrada quando há busca
// ---------------------------------------------------------------------------
function FlatResultsList({
  items,
  draft,
  dirty,
  revealedKeys,
  onValueChange,
  onToggleReveal,
}: {
  items: Setting[]
  draft: Record<string, string>
  dirty: Set<string>
  revealedKeys: Set<string>
  onValueChange: (key: string, value: string) => void
  onToggleReveal: (key: string) => void
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={HelpCircle}
        title="Nenhuma configuração corresponde à busca"
        description="Ajuste o termo ou crie uma nova configuração."
      />
    )
  }
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b p-5">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <SettingsIcon className="size-4" />
          </span>
          <div>
            <p className="text-base font-semibold">Resultados da busca</p>
            <p className="text-xs text-muted-foreground">
              {items.length}{" "}
              {items.length === 1 ? "configuração encontrada" : "configurações encontradas"}
            </p>
          </div>
        </div>
        <StatusBadge tone="emerald">
          <Check className="size-3" />
          Busca ativa
        </StatusBadge>
      </div>
      <CardContent className="flex flex-col gap-2.5 p-4">
        {items.map((s) => (
          <SettingRow
            key={s.key}
            setting={s}
            draftValue={draft[s.key] ?? ""}
            isDirty={dirty.has(s.key)}
            isRevealed={revealedKeys.has(s.key)}
            onValueChange={onValueChange}
            onToggleReveal={onToggleReveal}
          />
        ))}
      </CardContent>
    </Card>
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
  const help = keyValid && !dupe ? lookupHelp(key.toUpperCase()) : null

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
            ) : help ? (
              <p className="flex items-start gap-1 text-[11px] text-muted-foreground">
                <Info className="mt-0.5 size-3 shrink-0" />
                {help}
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
// Group metadata — icon, tone (H4 — UMA cor por grupo, sempre tom quente),
// description per prefix.
// ---------------------------------------------------------------------------
type GroupMeta = {
  label: string
  description: string
  icon: LucideIcon
  tone: string
}

const GROUP_TONE: Record<string, StatusTone> = {
  payment: "emerald",
  email: "teal",
  smtp: "teal",
  nominatim: "amber",
  geo: "amber",
  site: "emerald",
  support: "amber",
  weather: "amber",
  server: "zinc",
  Geral: "zinc",
}

function toneToClass(tone: StatusTone): string {
  const map: Record<StatusTone, string> = {
    emerald:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    amber:
      "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    rose: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
    teal: "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300",
    zinc: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200",
    sky: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  }
  return map[tone]
}

const GROUP_META: Record<string, GroupMeta> = {
  payment: {
    label: "Pagamentos",
    description: "Chaves de API, tokens e configurações de gateway",
    icon: CreditCard,
    tone: toneToClass("emerald"),
  },
  email: {
    label: "E-mail",
    description: "Remetente, provedor e templates de e-mail",
    icon: Mail,
    tone: toneToClass("teal"),
  },
  smtp: {
    label: "SMTP",
    description: "Servidor e credenciais de envio de e-mail",
    icon: Mail,
    tone: toneToClass("teal"),
  },
  nominatim: {
    label: "Geolocalização",
    description: "Endereço, CEP e busca por coordenadas",
    icon: MapPin,
    tone: toneToClass("amber"),
  },
  geo: {
    label: "Geolocalização",
    description: "Endereço, CEP e busca por coordenadas",
    icon: MapPin,
    tone: toneToClass("amber"),
  },
  site: {
    label: "Site",
    description: "Configurações gerais do site e branding",
    icon: SettingsIcon,
    tone: toneToClass("emerald"),
  },
  support: {
    label: "Suporte",
    description: "Canais de atendimento e contato",
    icon: HelpCircle,
    tone: toneToClass("amber"),
  },
  weather: {
    label: "Clima",
    description: "Integração com serviço de previsão do tempo",
    icon: Cloud,
    tone: toneToClass("amber"),
  },
  server: {
    label: "Servidor",
    description: "Configurações de infraestrutura e runtime",
    icon: Server,
    tone: toneToClass("zinc"),
  },
  Geral: {
    label: "Geral",
    description: "Configurações gerais sem prefixo específico",
    icon: SettingsIcon,
    tone: toneToClass("zinc"),
  },
  default: {
    label: "Outros",
    description: "Configurações diversas",
    icon: SettingsIcon,
    tone: toneToClass("zinc"),
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
