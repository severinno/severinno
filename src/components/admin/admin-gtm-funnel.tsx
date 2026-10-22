"use client"

import * as React from "react"
import { Target, Send, Plus, Search, ExternalLink, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { GTMLead, LeadStatus, FunnelMetrics, generateWhatsAppOutreachLink } from "@/lib/gtm-engine"
import { triggerHaptic } from "@/lib/haptics"

export function AdminGTMFunnel() {
  const [leads, setLeads] = React.useState<GTMLead[]>([])
  const [metrics, setMetrics] = React.useState<FunnelMetrics | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<string>("ALL")
  const [isNewLeadOpen, setIsNewLeadOpen] = React.useState(false)

  // New lead form state
  const [newName, setNewName] = React.useState("")
  const [newProfession, setNewProfession] = React.useState("Eletricista")
  const [newPhone, setNewPhone] = React.useState("")
  const [newCity, setNewCity] = React.useState("Governador Valadares")
  const [newDistrict, setNewDistrict] = React.useState("")
  const [newNotes, setNewNotes] = React.useState("")

  const loadData = React.useCallback(async () => {
    try {
      const res = await fetch("/api/admin/gtm/leads")
      const json = await res.json()
      if (json.success) {
        setLeads(json.data.leads)
        setMetrics(json.data.metrics)
      }
    } catch (e) {
      console.error("Failed to load GTM leads:", e)
    } finally {
      setLoading(false)
    }
  }, [])

  // Deferred via queueMicrotask to satisfy react-hooks/set-state-in-effect
  // (matches the pattern in admin-benchmark-dashboard.tsx).
  React.useEffect(() => {
    queueMicrotask(() => {
      loadData()
    })
  }, [loadData])

  const handleStatusChange = async (leadId: string, newStatus: LeadStatus) => {
    try {
      const res = await fetch("/api/admin/gtm/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: leadId, status: newStatus }),
      })
      if (res.ok) {
        triggerHaptic("success")
        toast.success("Status do lead atualizado!")
        loadData()
      } else {
        toast.error("Erro ao atualizar status do lead.")
      }
    } catch (e) {
      console.error("Failed to update status:", e)
      toast.error("Erro ao atualizar status do lead.")
    }
  }

  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName || !newPhone) return

    try {
      const res = await fetch("/api/admin/gtm/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName,
          profession: newProfession,
          phone: newPhone,
          city: newCity,
          district: newDistrict,
          notes: newNotes,
        }),
      })

      if (res.ok) {
        triggerHaptic("success")
        toast.success("Prestador adicionado ao funil!")
        setIsNewLeadOpen(false)
        setNewName("")
        setNewPhone("")
        setNewNotes("")
        loadData()
      } else {
        toast.error("Erro ao adicionar prestador ao funil.")
      }
    } catch (e) {
      console.error("Failed to create lead:", e)
      toast.error("Erro ao adicionar prestador ao funil.")
    }
  }

  const filteredLeads = React.useMemo(() => {
    return leads.filter((l) => {
      const matchesSearch =
        search === "" ||
        l.name.toLowerCase().includes(search.toLowerCase()) ||
        l.profession.toLowerCase().includes(search.toLowerCase()) ||
        l.phone.includes(search) ||
        (l.district && l.district.toLowerCase().includes(search.toLowerCase()))

      const matchesStatus = statusFilter === "ALL" || l.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [leads, search, statusFilter])

  return (
    <div className="space-y-3.5">
      {/* Top Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-foreground flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Target className="h-6 w-6 text-emerald-600" />
            Go-To-Market — Aquisição de Prestadores (Fase 1)
          </h2>
          <p className="text-muted-foreground text-sm">
            Pipeline de captação e ativação dos primeiros 50 prestadores verificados
          </p>
        </div>

        <Dialog open={isNewLeadOpen} onOpenChange={setIsNewLeadOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700">
              <Plus className="h-4 w-4" />
              Novo Prestador Alvo
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[480px]">
            <form onSubmit={handleCreateLead}>
              <DialogHeader>
                <DialogTitle>Adicionar Prestador ao Funil</DialogTitle>
                <DialogDescription>
                  Insira os dados do profissional para gerar o link de abordagem personalizado via
                  WhatsApp.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <label className="text-muted-foreground text-xs font-semibold">
                    Nome / Empresa
                  </label>
                  <Input
                    placeholder="Ex: Carlos Eletricista Residencial"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <label className="text-muted-foreground text-xs font-semibold">
                      Especialidade
                    </label>
                    <Select value={newProfession} onValueChange={setNewProfession}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Eletricista">Eletricista</SelectItem>
                        <SelectItem value="Encanador">Encanador</SelectItem>
                        <SelectItem value="Pintor">Pintor</SelectItem>
                        <SelectItem value="Diarista">Diarista</SelectItem>
                        <SelectItem value="Marido de Aluguel">Marido de Aluguel</SelectItem>
                        <SelectItem value="Climatização">Ar-Condicionado</SelectItem>
                        <SelectItem value="Chaveiro">Chaveiro</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-2">
                    <label className="text-muted-foreground text-xs font-semibold">
                      WhatsApp (com DDD)
                    </label>
                    <Input
                      placeholder="(33) 98765-4321"
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <label className="text-muted-foreground text-xs font-semibold">Cidade</label>
                    <Input value={newCity} onChange={(e) => setNewCity(e.target.value)} />
                  </div>
                  <div className="grid gap-2">
                    <label className="text-muted-foreground text-xs font-semibold">
                      Bairro / Região
                    </label>
                    <Input
                      placeholder="Ex: Ilha dos Araújos"
                      value={newDistrict}
                      onChange={(e) => setNewDistrict(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <label className="text-muted-foreground text-xs font-semibold">
                    Observações / Origem
                  </label>
                  <Input
                    placeholder="Ex: Grupo WhatsApp Zona Oeste, 5k seguidores Instagram"
                    value={newNotes}
                    onChange={(e) => setNewNotes(e.target.value)}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsNewLeadOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" className="bg-emerald-600 text-white hover:bg-emerald-700">
                  Salvar Lead
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Target Progress Card */}
      <Card className="to-card border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 via-teal-500/5 shadow-sm">
        <CardContent className="p-3.5">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div className="max-w-lg space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                <Sparkles className="h-4 w-4" /> Meta: 50 Prestadores em 14 Dias
              </div>
              <h3 className="text-foreground text-2xl font-black tabular-nums">
                {metrics?.onboardedCount || 0} / 50{" "}
                <span className="text-muted-foreground text-sm font-normal">
                  prestadores ativos
                </span>
              </h3>
              <p className="text-muted-foreground text-xs">
                Taxa de conversão atual do funil:{" "}
                <span className="font-bold text-emerald-600 dark:text-emerald-400">
                  {metrics?.conversionRate || 0}%
                </span>
                . Foco em categorias de alta demanda (Elétrica e Hidráulica).
              </p>
            </div>

            <div className="max-w-md flex-1 space-y-1.5">
              <div className="text-muted-foreground flex justify-between text-xs font-semibold">
                <span>Progresso do Lançamento</span>
                <span className="tabular-nums">{metrics?.progressPct || 0}%</span>
              </div>
              <div className="bg-muted h-3 w-full overflow-hidden rounded-full">
                <div
                  className="h-full rounded-full bg-emerald-600 transition-all duration-500"
                  style={{ width: `${Math.max(5, metrics?.progressPct || 0)}%` }}
                />
              </div>
              <div className="text-muted-foreground flex justify-between text-[11px] tabular-nums">
                <span>{metrics?.activeInFunnel || 0} em negociação</span>
                <span>{metrics?.firstServiceCount || 0} com 1º serviço feito</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(
          [
            {
              status: "NEW",
              label: "Novos",
              count: metrics?.byStatus.NEW || 0,
              color: "text-muted-foreground border-border/60",
            },
            {
              status: "CONTACTED",
              label: "Contatados",
              count: metrics?.byStatus.CONTACTED || 0,
              color: "text-blue-700 border-blue-200",
            },
            {
              status: "DEMO_SCHEDULED",
              label: "Em Pitch",
              count: metrics?.byStatus.DEMO_SCHEDULED || 0,
              color: "text-amber-700 border-amber-200",
            },
            {
              status: "ONBOARDED",
              label: "Cadastrados",
              count: metrics?.byStatus.ONBOARDED || 0,
              color: "text-emerald-700 border-emerald-200",
            },
            {
              status: "FIRST_SERVICE",
              label: "1º Serviço",
              count: metrics?.byStatus.FIRST_SERVICE || 0,
              color: "text-purple-700 border-purple-200",
            },
            {
              status: "REJECTED",
              label: "Descartados",
              count: metrics?.byStatus.REJECTED || 0,
              color: "text-rose-700 border-rose-200",
            },
          ] as const
        ).map((item) => (
          <Card
            key={item.status}
            className={`cursor-pointer border transition-all hover:shadow-md ${
              statusFilter === item.status ? "bg-emerald-500/10 ring-2 ring-emerald-500" : ""
            }`}
            onClick={() => setStatusFilter(statusFilter === item.status ? "ALL" : item.status)}
          >
            <CardContent className="p-2.5 text-center">
              <div className="text-foreground text-lg font-bold tabular-nums">{item.count}</div>
              <div className="text-muted-foreground mt-1 text-xs font-medium">{item.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
        <div className="relative w-full sm:w-80">
          <Search className="text-muted-foreground absolute top-2.5 left-3 h-4 w-4" />
          <Input
            placeholder="Buscar por nome, telefone, especialidade..."
            className="bg-card pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="bg-card w-full sm:w-48">
              <SelectValue placeholder="Filtrar por Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos os Status</SelectItem>
              <SelectItem value="NEW">Novos</SelectItem>
              <SelectItem value="CONTACTED">Contatados</SelectItem>
              <SelectItem value="DEMO_SCHEDULED">Pitch / Demo</SelectItem>
              <SelectItem value="ONBOARDED">Cadastrados</SelectItem>
              <SelectItem value="FIRST_SERVICE">1º Atendimento</SelectItem>
              <SelectItem value="REJECTED">Descartados</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Leads Table */}
      <Card className="border-border/60 bg-card overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="text-muted-foreground w-full text-left text-sm">
            <thead className="border-border/60 bg-muted/40 text-muted-foreground border-b text-xs font-semibold uppercase">
              <tr>
                <th className="px-4 py-2.5">Prestador</th>
                <th className="px-4 py-2.5">Especialidade</th>
                <th className="px-4 py-2.5">Região</th>
                <th className="px-4 py-2.5">Status do Funil</th>
                <th className="px-4 py-2.5">Observações</th>
                <th className="px-4 py-2.5 text-right">Ação WhatsApp</th>
              </tr>
            </thead>
            <tbody className="divide-border/60 divide-y">
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-muted-foreground px-4 py-8 text-center">
                    Carregando leads do pipeline GTM...
                  </td>
                </tr>
              ) : filteredLeads.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-muted-foreground px-4 py-8 text-center">
                    Nenhum prestador encontrado com os filtros selecionados.
                  </td>
                </tr>
              ) : (
                filteredLeads.map((lead) => {
                  const waLink = generateWhatsAppOutreachLink(lead)

                  return (
                    <tr key={lead.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="text-foreground font-semibold">{lead.name}</div>
                        <div className="text-muted-foreground text-xs">{lead.phone}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant="outline" className="text-xs font-medium">
                          {lead.profession}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="text-foreground text-xs font-medium">
                          {lead.district ? `${lead.district}, ` : ""}
                          {lead.city}/{lead.state}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <Select
                          value={lead.status}
                          onValueChange={(val) => handleStatusChange(lead.id, val as LeadStatus)}
                        >
                          <SelectTrigger className="bg-card h-8 w-36 text-xs font-semibold">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="NEW">Novo Lead</SelectItem>
                            <SelectItem value="CONTACTED">Contatado</SelectItem>
                            <SelectItem value="DEMO_SCHEDULED">Pitch / Demo</SelectItem>
                            <SelectItem value="ONBOARDED">Cadastrado</SelectItem>
                            <SelectItem value="FIRST_SERVICE">1º Atendimento</SelectItem>
                            <SelectItem value="REJECTED">Descartado</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="text-muted-foreground max-w-xs truncate px-4 py-2.5 text-xs">
                        {lead.notes || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Button
                          size="sm"
                          asChild
                          className="h-8 gap-1.5 bg-emerald-600 text-xs text-white shadow-xs hover:bg-emerald-700"
                        >
                          <a href={waLink} target="_blank" rel="noopener noreferrer">
                            <Send className="h-3 w-3" />
                            Abordar
                            <ExternalLink className="h-2.5 w-2.5 opacity-70" />
                          </a>
                        </Button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
