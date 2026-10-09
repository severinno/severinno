"use client"

/**
 * AdminMaintenance — a CHAVE de ligar/desligar o marketplace (um clique)
 * e o controle de Bypass por IP Local / Whitelist durante a manutenção.
 *
 * LIGADA: o site inteiro fica INACESSÍVEL ao público — tela "Manutenção
 * preventiva — em breve estaremos online para melhor atender" em qualquer
 * página, 503 nas APIs — e apenas ADMINs ou IPs AUTORIZADOS entram.
 * DESLIGADA: acesso restaurado para todos.
 *
 * Nielsen aplicado:
 *   H1  Visibilidade — o estado atual e o IP detectado vêm do servidor (GET); toast confirma cada ação.
 *   H5  Prevenção — LIGAR pede confirmação (AlertDialog); DESLIGAR é imediato.
 *   H9  Recuperação — erro de rede mantém o estado real do servidor (refetch).
 */

import * as React from "react"
import { HardHat, Loader2, ShieldCheck, Plus, Trash2, Globe, CheckCircle2 } from "lucide-react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { apiGet, apiPost } from "@/lib/api"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
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
import { Skeleton } from "@/components/ui/skeleton"

type MaintenanceState = {
  maintenanceMode: boolean
  allowedIps?: string[]
  currentIp?: string
}

function ToggleCard() {
  const queryClient = useQueryClient()
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin-maintenance-mode"],
    queryFn: () => apiGet<MaintenanceState>("/api/admin/maintenance-mode"),
  })

  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      apiPost<{
        maintenanceMode: boolean
        allowedIps: string[]
        currentIp: string
        message: string
      }>("/api/admin/maintenance-mode", { enabled }),
    onSuccess: (res) => {
      toast.success(res.message)
      queryClient.setQueryData<MaintenanceState>(["admin-maintenance-mode"], {
        maintenanceMode: res.maintenanceMode,
        allowedIps: res.allowedIps,
        currentIp: res.currentIp,
      })
    },
    onError: (e) => {
      toast.error(
        `Não foi possível mudar o modo de manutenção: ${e instanceof Error ? e.message : "erro inesperado"}`,
      )
      void refetch()
    },
  })

  const maintenanceMode = data?.maintenanceMode === true

  function onSwitchChange(checked: boolean) {
    if (checked) {
      setConfirmOpen(true) // LIGAR pede confirmação — derruba o site inteiro
      return
    }
    toggle.mutate(false) // DESLIGAR é imediato — restaurar é o caminho seguro
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-4 w-80" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-24" />
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Não foi possível ler o estado da manutenção. Tente novamente.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardHat className="size-5" aria-hidden="true" />
            Modo de manutenção
          </CardTitle>
          <CardDescription>
            Uma chave para o site inteiro. LIGADA: o público vê a página de manutenção preventiva e
            as APIs respondem 503 — administradores e IPs autorizados continuam acessando
            normalmente. DESLIGADA: o site volta ao ar na hora.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Switch
              checked={maintenanceMode}
              onCheckedChange={onSwitchChange}
              disabled={toggle.isPending}
              aria-label="Ligar ou desligar o modo de manutenção do site"
            />
            <span
              className={
                maintenanceMode
                  ? "text-sm font-medium text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground text-sm font-medium"
              }
            >
              {maintenanceMode
                ? "Site INACESSÍVEL — em manutenção preventiva"
                : "Site acessível ao público"}
            </span>
            {toggle.isPending && (
              <Loader2 className="text-muted-foreground size-4 animate-spin" aria-hidden="true" />
            )}
            {isFetching && !toggle.isPending && (
              <Loader2
                className="text-muted-foreground/50 size-4 animate-spin"
                aria-hidden="true"
              />
            )}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Colocar o site em manutenção?</AlertDialogTitle>
            <AlertDialogDescription>
              Todo o marketplace fica inacessível ao público geral: visitantes veem a página
              &quot;Manutenção preventiva — em breve estaremos online para melhor atender&quot; e as
              APIs respondem 503. Você e os IPs autorizados na lista abaixo continuam navegando
              normalmente. Basta desligar esta chave para reabrir.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 text-white hover:bg-amber-700"
              onClick={() => {
                setConfirmOpen(false)
                toggle.mutate(true)
              }}
            >
              Ligar manutenção
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function IpWhitelistCard() {
  const queryClient = useQueryClient()
  const [newIp, setNewIp] = React.useState("")

  const { data, refetch, isFetching } = useQuery({
    queryKey: ["admin-maintenance-mode"],
    queryFn: () => apiGet<MaintenanceState>("/api/admin/maintenance-mode"),
  })

  const saveIps = useMutation({
    mutationFn: (allowedIps: string[]) =>
      apiPost<{
        maintenanceMode: boolean
        allowedIps: string[]
        currentIp: string
        message: string
      }>("/api/admin/maintenance-mode", {
        enabled: data?.maintenanceMode === true,
        allowedIps,
      }),
    onSuccess: (res) => {
      toast.success("Lista de IPs autorizados atualizada com sucesso!")
      queryClient.setQueryData<MaintenanceState>(["admin-maintenance-mode"], {
        maintenanceMode: res.maintenanceMode,
        allowedIps: res.allowedIps,
        currentIp: res.currentIp,
      })
    },
    onError: (e) => {
      toast.error(
        `Erro ao salvar lista de IPs: ${e instanceof Error ? e.message : "falha inesperada"}`,
      )
      void refetch()
    },
  })

  const currentIp = data?.currentIp?.trim() || ""
  const allowedIps = React.useMemo(() => data?.allowedIps || [], [data?.allowedIps])
  const isCurrentIpAllowed =
    Boolean(currentIp) &&
    (currentIp === "127.0.0.1" ||
      currentIp === "::1" ||
      currentIp === "localhost" ||
      allowedIps.includes(currentIp))

  function handleAddCurrentIp() {
    if (!currentIp) return
    if (allowedIps.includes(currentIp)) {
      toast.info("Seu IP atual já está na lista de autorizados.")
      return
    }
    const updated = [...allowedIps, currentIp]
    saveIps.mutate(updated)
  }

  function handleAddCustomIp(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = newIp.trim()
    if (!trimmed) return
    if (allowedIps.includes(trimmed)) {
      toast.info("Este IP já está na lista de autorizados.")
      setNewIp("")
      return
    }
    const updated = [...allowedIps, trimmed]
    saveIps.mutate(updated)
    setNewIp("")
  }

  function handleRemoveIp(ipToRemove: string) {
    const updated = allowedIps.filter((ip) => ip !== ipToRemove)
    saveIps.mutate(updated)
  }

  return (
    <Card className="mt-6 border-dashed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck
            className="size-5 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
          Acesso Exclusivo por IP (Bypass durante Manutenção)
        </CardTitle>
        <CardDescription>
          IPs cadastrados nesta lista têm acesso livre e irrestrito ao sistema mesmo com o modo de
          manutenção ativo. Ideal para desenvolvimento local, homologação e manutenção em produção.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Identificação do IP Atual */}
        <div className="bg-muted/50 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <Globe className="text-muted-foreground size-4" aria-hidden="true" />
            <span className="text-sm font-medium">Seu IP Atual Detectado:</span>
            <code className="bg-background rounded px-1.5 py-0.5 text-xs font-semibold">
              {currentIp || "Detectando..."}
            </code>
            {isCurrentIpAllowed ? (
              <Badge
                variant="outline"
                className="gap-1 border-emerald-500 bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30"
              >
                <CheckCircle2 className="size-3" /> Autorizado
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-xs">
                Bloqueado em manutenção
              </Badge>
            )}
          </div>

          {!isCurrentIpAllowed && currentIp && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleAddCurrentIp}
              disabled={saveIps.isPending}
              className="gap-1.5 border-emerald-600 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950"
            >
              <Plus className="size-3.5" />
              Permitir meu IP atual
            </Button>
          )}
        </div>

        {/* Formulário para Adicionar IP */}
        <form onSubmit={handleAddCustomIp} className="flex gap-2">
          <Input
            placeholder="Ex: 192.168.1.100 ou 201.55.12.34"
            value={newIp}
            onChange={(e) => setNewIp(e.target.value)}
            disabled={saveIps.isPending}
            className="font-mono text-sm"
            aria-label="Digitar endereço IP para autorizar"
          />
          <Button
            type="submit"
            size="sm"
            disabled={saveIps.isPending || !newIp.trim()}
            className="gap-1"
          >
            <Plus className="size-4" />
            Adicionar IP
          </Button>
        </form>

        {/* Lista de IPs Autorizados */}
        <div className="space-y-2">
          <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
            IPs Autorizados ({allowedIps.length}):
          </span>

          {allowedIps.length === 0 ? (
            <p className="text-muted-foreground text-xs italic">
              Nenhum IP adicional cadastrado. Apenas o localhost padrão (127.0.0.1, ::1) e
              administradores logados têm acesso.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {allowedIps.map((ip) => {
                const isCurrent = ip === currentIp
                const isDefault = ip === "127.0.0.1" || ip === "::1" || ip === "localhost"

                return (
                  <Badge
                    key={ip}
                    variant="secondary"
                    className="flex items-center gap-1.5 py-1 pr-1.5 pl-2.5 font-mono text-xs"
                  >
                    <span>{ip}</span>
                    {isCurrent && (
                      <span className="font-sans text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                        (você)
                      </span>
                    )}
                    {!isDefault && (
                      <button
                        type="button"
                        onClick={() => handleRemoveIp(ip)}
                        disabled={saveIps.isPending}
                        className="text-muted-foreground hover:text-destructive rounded-full p-0.5"
                        title={`Remover ${ip}`}
                        aria-label={`Remover IP ${ip}`}
                      >
                        <Trash2 className="size-3" />
                      </button>
                    )}
                  </Badge>
                )
              })}
            </div>
          )}
        </div>

        {saveIps.isPending && (
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <Loader2 className="size-3 animate-spin" /> Salvando configurações de IP...
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function AdminMaintenance() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <ToggleCard />
      <IpWhitelistCard />
    </div>
  )
}
