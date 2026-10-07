"use client"

/**
 * AdminMaintenance — a CHAVE de ligar/desligar o marketplace (um clique).
 *
 * LIGADA: o site inteiro fica INACESSÍVEL ao público — tela "Manutenção
 * preventiva — em breve estaremos online para melhor atender" em qualquer
 * página, 503 nas APIs — e apenas ADMINs entram (o painel segue operável
 * para DESLIGAR). DESLIGADA: acesso restaurado.
 *
 * Nielsen aplicado:
 *   H1  Visibilidade — o estado atual vem do servidor (GET), nunca de palpite
 *       local; toast confirma cada virada.
 *   H5  Prevenção — LIGAR pede confirmação (AlertDialog); DESLIGAR é imediato
 *       (o erro barato é voltar cedo, não derrubar o site).
 *   H9  Recuperação — erro de rede mantém o estado real do servidor (refetch)
 *       e o toast nomeia o que falhou.
 */

import * as React from "react"
import { HardHat, Loader2 } from "lucide-react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { apiGet, apiPost } from "@/lib/api"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { Skeleton } from "@/components/ui/skeleton"

type MaintenanceState = { maintenanceMode: boolean }

function ToggleCard() {
  const queryClient = useQueryClient()
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin-maintenance-mode"],
    queryFn: () => apiGet<MaintenanceState>("/api/admin/maintenance-mode"),
  })

  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      apiPost<{ maintenanceMode: boolean; message: string }>("/api/admin/maintenance-mode", {
        enabled,
      }),
    onSuccess: (res) => {
      toast.success(res.message)
      queryClient.setQueryData<MaintenanceState>(["admin-maintenance-mode"], {
        maintenanceMode: res.maintenanceMode,
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
    toggle.mutate(false) // DESLIGAR é imediato — restaurar é o caminho barato
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
            as APIs respondem 503 — administradores continuam acessando normalmente. DESLIGADA: o
            site volta ao ar na hora.
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
              Todo o marketplace fica inacessível ao público: visitantes veem a página
              &quot;Manutenção preventiva — em breve estaremos online para melhor atender&quot; e as
              APIs respondem 503. Você e outros administradores continuam entrando normalmente, e
              basta desligar esta chave para reabrir.
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

export function AdminMaintenance() {
  return (
    <div className="mx-auto max-w-2xl">
      <ToggleCard />
    </div>
  )
}
