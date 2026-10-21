"use client"

import * as React from "react"
import { CalendarClock, Eye, EyeOff, Loader2, Send, Zap } from "lucide-react"

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
import { cn } from "@/lib/utils"
import { NOTIFICATION_TYPES } from "./types"

export interface PushSendComposerProps {
  selectedCount: number
  selectAll: boolean
  totalUsers?: number
  scheduleMode: "now" | "schedule"
  onScheduleModeChange: (mode: "now" | "schedule") => void
  scheduledDate: string
  onScheduledDateChange: (date: string) => void
  scheduledTime: string
  onScheduledTimeChange: (time: string) => void
  notifType: string
  onNotifTypeChange: (type: string) => void
  title: string
  onTitleChange: (title: string) => void
  body: string
  onBodyChange: (body: string) => void
  pushUrl: string
  onPushUrlChange: (url: string) => void
  showPreview: boolean
  onTogglePreview: () => void
  isPending: boolean
  confirmSendOpen: boolean
  onConfirmSendOpenChange: (open: boolean) => void
  onSubmit: () => void
  onConfirmSend: () => void
  selectedIds: Set<string>
}

export function PushSendComposer({
  selectedCount,
  selectAll,
  totalUsers,
  scheduleMode,
  onScheduleModeChange,
  scheduledDate,
  onScheduledDateChange,
  scheduledTime,
  onScheduledTimeChange,
  notifType,
  onNotifTypeChange,
  title,
  onTitleChange,
  body,
  onBodyChange,
  pushUrl,
  onPushUrlChange,
  showPreview,
  onTogglePreview,
  isPending,
  confirmSendOpen,
  onConfirmSendOpenChange,
  onSubmit,
  onConfirmSend,
  selectedIds,
}: PushSendComposerProps) {
  const targetCountLabel = selectAll ? (totalUsers ?? "...") : selectedCount

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="size-4" /> Enviar notificação
        </CardTitle>
        <CardDescription>
          {selectedCount > 0 || selectAll
            ? `${targetCountLabel} usuário(s) selecionado(s)`
            : "Selecione usuários ao lado"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Schedule mode toggle */}
        <div className="flex gap-1 rounded-lg border p-1">
          <button
            type="button"
            onClick={() => onScheduleModeChange("now")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              scheduleMode === "now"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Zap className="size-3.5" /> Enviar agora
          </button>
          <button
            type="button"
            onClick={() => onScheduleModeChange("schedule")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              scheduleMode === "schedule"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <CalendarClock className="size-3.5" /> Agendar
          </button>
        </div>

        {scheduleMode === "schedule" && (
          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <label className="text-foreground text-xs font-medium">
              Data e hora do envio <span className="text-destructive">*</span>
            </label>
            <div className="flex gap-2">
              <Input
                type="date"
                value={scheduledDate}
                onChange={(e) => onScheduledDateChange(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                className="flex-1"
              />
              <Input
                type="time"
                value={scheduledTime}
                onChange={(e) => onScheduledTimeChange(e.target.value)}
                className="w-[130px]"
              />
            </div>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-foreground text-xs font-medium">Tipo</label>
          <Select value={notifType} onValueChange={onNotifTypeChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NOTIFICATION_TYPES.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-foreground text-xs font-medium">
            Título <span className="text-destructive">*</span>
          </label>
          <Input
            placeholder="Ex: Promoção imperdível!"
            value={title}
            onChange={(e) => onTitleChange(e.target.value.slice(0, 120))}
            maxLength={120}
          />
          <p className="text-muted-foreground text-right text-[10px]">{title.length}/120</p>
        </div>

        <div className="space-y-2">
          <label className="text-foreground text-xs font-medium">Corpo da mensagem</label>
          <Textarea
            placeholder="Digite o texto da notificação..."
            value={body}
            onChange={(e) => onBodyChange(e.target.value.slice(0, 500))}
            maxLength={500}
            rows={3}
          />
          <p className="text-muted-foreground text-right text-[10px]">{body.length}/500</p>
        </div>

        <div className="space-y-2">
          <label className="text-foreground text-xs font-medium">URL de destino (ao clicar)</label>
          <Input
            placeholder="/"
            value={pushUrl}
            onChange={(e) => onPushUrlChange(e.target.value)}
          />
          <p className="text-muted-foreground text-[10px]">
            Deixe &quot;/&quot; para ir para a página inicial
          </p>
        </div>

        <button
          type="button"
          onClick={onTogglePreview}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs"
        >
          {showPreview ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          {showPreview ? "Ocultar preview" : "Ver preview do payload"}
        </button>

        {showPreview && (
          <pre className="bg-muted overflow-x-auto rounded-lg p-3 text-[10px] leading-relaxed">
            {JSON.stringify(
              {
                title,
                body,
                pushUrl,
                type: notifType,
                userIds: selectAll ? `[${totalUsers ?? "..."} usuários]` : Array.from(selectedIds),
              },
              null,
              2,
            )}
          </pre>
        )}
      </CardContent>

      <CardFooter className="flex-col gap-2">
        <AlertDialog open={confirmSendOpen} onOpenChange={onConfirmSendOpenChange}>
          <Button
            className="w-full gap-2"
            onClick={onSubmit}
            disabled={isPending || (selectedCount === 0 && !selectAll) || !title.trim()}
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : scheduleMode === "schedule" ? (
              <CalendarClock className="size-4" />
            ) : (
              <Send className="size-4" />
            )}
            {isPending
              ? "Processando..."
              : scheduleMode === "schedule"
                ? `Agendar para ${targetCountLabel} usuário(s)`
                : `Enviar para ${targetCountLabel} usuário(s)`}
          </Button>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <Send className="size-5" />
                Confirmar envio de notificação
              </AlertDialogTitle>
              <AlertDialogDescription>
                Você está prestes a enviar uma notificação push para{" "}
                <strong>{targetCountLabel} usuário(s)</strong>.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="bg-muted/50 space-y-2 rounded-lg p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Título</span>
                <span className="max-w-[200px] truncate text-right font-medium">{title}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Tipo</span>
                <span className="font-medium">
                  {NOTIFICATION_TYPES.find((t) => t.value === notifType)?.label ?? notifType}
                </span>
              </div>
              {body && (
                <div className="flex items-start justify-between gap-2">
                  <span className="text-muted-foreground shrink-0">Corpo</span>
                  <span className="max-w-[200px] truncate text-right text-xs">{body}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Destinatários</span>
                <span className="font-medium">{targetCountLabel} usuário(s)</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">URL</span>
                <span className="max-w-[200px] truncate text-xs font-medium">{pushUrl}</span>
              </div>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={onConfirmSend} className="gap-2">
                <Send className="size-4" />
                Confirmar e enviar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {isPending && (
          <p className="text-muted-foreground text-xs">
            {scheduleMode === "schedule"
              ? "Agendando notificação..."
              : "Enviando notificações... Isso pode levar alguns segundos."}
          </p>
        )}
      </CardFooter>
    </Card>
  )
}
