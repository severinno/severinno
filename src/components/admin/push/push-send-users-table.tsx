"use client"

import * as React from "react"
import { AlertTriangle, BellOff, CheckSquare, RotateCw, Search, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { type UsersResponse, ROLE_OPTIONS } from "./types"

export interface PushSendUsersTableProps {
  usersData?: UsersResponse
  isLoading: boolean
  isFetching: boolean
  error: unknown
  search: string
  onSearchChange: (search: string) => void
  roleFilter: string
  onRoleFilterChange: (role: string) => void
  page: number
  onPageChange: (page: number | ((p: number) => number)) => void
  selectedIds: Set<string>
  selectAll: boolean
  onToggleSelectAll: () => void
  onToggleSelectUser: (userId: string) => void
  onRefetch: () => void
}

export function PushSendUsersTable({
  usersData,
  isLoading,
  isFetching,
  error,
  search,
  onSearchChange,
  roleFilter,
  onRoleFilterChange,
  page,
  onPageChange,
  selectedIds,
  selectAll,
  onToggleSelectAll,
  onToggleSelectUser,
  onRefetch,
}: PushSendUsersTableProps) {
  const currentIds = React.useMemo(() => usersData?.items.map((u) => u.id) ?? [], [usersData])

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Usuários com push ativo</CardTitle>
            <CardDescription>Selecione os usuários que receberão a notificação</CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={onRefetch}
            disabled={isFetching}
          >
            <RotateCw className={cn("size-4", isFetching && "animate-spin")} />
          </Button>
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              placeholder="Buscar por nome ou email..."
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={roleFilter} onValueChange={onRoleFilterChange}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filtrar por role" />
            </SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {usersData && usersData.items.length > 0 && (
          <div className="flex items-center gap-2 border-b px-4 py-2">
            <button
              type="button"
              onClick={onToggleSelectAll}
              className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-xs font-medium"
            >
              {selectAll || (selectedIds.size === currentIds.length && currentIds.length > 0) ? (
                <CheckSquare className="text-primary size-4" />
              ) : (
                <Square className="size-4" />
              )}
              {selectAll || (selectedIds.size === currentIds.length && currentIds.length > 0)
                ? `${currentIds.length} selecionado(s)`
                : `${selectedIds.size} selecionado(s)`}
            </button>
          </div>
        )}
        {isLoading && (
          <div className="space-y-1 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
        )}
        {Boolean(error) && !isLoading && (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <AlertTriangle className="size-8 text-amber-500" />
            <p className="text-muted-foreground text-sm">Erro ao carregar usuários.</p>
            <Button variant="outline" size="sm" onClick={onRefetch}>
              Tentar novamente
            </Button>
          </div>
        )}
        {!isLoading && !error && usersData?.items.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <BellOff className="text-muted-foreground/50 size-10" />
            <p className="text-muted-foreground text-sm font-medium">Nenhum usuário encontrado</p>
            <p className="text-muted-foreground text-xs">
              Tente mudar os filtros de busca ou verifique se há usuários com push ativo.
            </p>
          </div>
        )}
        {!isLoading && !error && usersData && usersData.items.length > 0 && (
          <div className="divide-y">
            {usersData.items.map((user) => {
              const isSelected = selectedAllOrOne(selectedIds, user.id, selectAll)
              return (
                <div
                  key={user.id}
                  onClick={() => onToggleSelectUser(user.id)}
                  className={cn(
                    "hover:bg-muted/50 flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors",
                    isSelected && "bg-primary/5",
                  )}
                >
                  <button type="button" className="shrink-0" onClick={(e) => e.stopPropagation()}>
                    {isSelected ? (
                      <CheckSquare className="text-primary size-4" />
                    ) : (
                      <Square className="text-muted-foreground size-4" />
                    )}
                  </button>
                  <Avatar className="size-8 shrink-0">
                    <AvatarImage src={user.avatarUrl ?? undefined} />
                    <AvatarFallback className="text-xs">
                      {user.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{user.name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {ROLE_OPTIONS.find((r) => r.value === user.role)?.label ?? user.role}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground truncate text-xs">{user.email}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Badge variant="secondary" className="text-[10px]">
                      {user.subscriptionsCount} disp.
                    </Badge>
                    {user.city && (
                      <p className="text-muted-foreground text-[10px]">
                        {user.city}
                        {user.state ? `/${user.state}` : ""}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Pagination */}
        {usersData && usersData.total > usersData.limit && (
          <div className="flex items-center justify-between border-t px-4 py-3">
            <span className="text-muted-foreground text-xs">
              Página {usersData.page} de {Math.ceil(usersData.total / usersData.limit)} (
              {usersData.total} usuários)
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => onPageChange((p) => p - 1)}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page * usersData.limit >= usersData.total}
                onClick={() => onPageChange((p) => p + 1)}
              >
                Próximo
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function selectedAllOrOne(selectedIds: Set<string>, id: string, selectAll: boolean) {
  return selectAll || selectedIds.has(id)
}
