"use client"

import * as React from "react"
import {
  Users,
  Target,
  Send,
  Plus,
  Search,
  CheckCircle2,
  PhoneCall,
  Clock,
  ExternalLink,
  MessageSquare,
  Sparkles,
  TrendingUp,
  Award,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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

const STATUS_CONFIG: Record<LeadStatus, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  NEW: { label: "Novo Lead", color: "bg-slate-100 text-slate-800 border-slate-300", icon: Clock },
  CONTACTED: { label: "Contatado", color: "bg-blue-100 text-blue-800 border-blue-300", icon: PhoneCall },
  DEMO_SCHEDULED: { label: "Pitch / Demo", color: "bg-amber-100 text-amber-800 border-amber-300", icon: MessageSquare },
  ONBOARDED: { label: "Cadastrado", color: "bg-emerald-100 text-emerald-800 border-emerald-300", icon: CheckCircle2 },
  FIRST_SERVICE: { label: "1º Atendimento", color: "bg-purple-100 text-purple-800 border-purple-300", icon: Award },
  REJECTED: { label: "Descartado", color: "bg-rose-100 text-rose-800 border-rose-300", icon: Clock },
}

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
  const [newCity, setNewCity] = React.useState("São Paulo")
  const [newDistrict, setNewDistrict] = React.useState("")
  const [newNotes, setNewNotes] = React.useState("")

  const loadData = React.useCallback(async () => {
    try {
      setLoading(true)
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

  React.useEffect(() => {
    loadData()
  }, [loadData])

  const handleStatusChange = async (leadId: string, newStatus: LeadStatus) => {
    try {
      const res = await fetch("/api/admin/gtm/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: leadId, status: newStatus }),
      })
      if (res.ok) {
        loadData()
      }
    } catch (e) {
      console.error("Failed to update status:", e)
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
        setIsNewLeadOpen(false)
        setNewName("")
        setNewPhone("")
        setNewNotes("")
        loadData()
      }
    } catch (e) {
      console.error("Failed to create lead:", e)
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
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Target className="h-6 w-6 text-emerald-600" />
            Go-To-Market — Aquisição de Prestadores (Fase 1)
          </h2>
          <p className="text-sm text-slate-600">
            Pipeline de captação e ativação dos primeiros 50 prestadores verificados
          </p>
        </div>

        <Dialog open={isNewLeadOpen} onOpenChange={setIsNewLeadOpen}>
          <DialogTrigger asChild>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 shadow-sm">
              <Plus className="h-4 w-4" />
              Novo Prestador Alvo
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[480px]">
            <form onSubmit={handleCreateLead}>
              <DialogHeader>
                <DialogTitle>Adicionar Prestador ao Funil</DialogTitle>
                <DialogDescription>
                  Insira os dados do profissional para gerar o link de abordagem personalizado via WhatsApp.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <label className="text-xs font-semibold text-slate-700">Nome / Empresa</label>
                  <Input
                    placeholder="Ex: Carlos Eletricista Residencial"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <label className="text-xs font-semibold text-slate-700">Especialidade</label>
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
                    <label className="text-xs font-semibold text-slate-700">WhatsApp (com DDD)</label>
                    <Input
                      placeholder="(11) 98765-4321"
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <label className="text-xs font-semibold text-slate-700">Cidade</label>
                    <Input value={newCity} onChange={(e) => setNewCity(e.target.value)} />
                  </div>
                  <div className="grid gap-2">
                    <label className="text-xs font-semibold text-slate-700">Bairro / Região</label>
                    <Input
                      placeholder="Ex: Pinheiros"
                      value={newDistrict}
                      onChange={(e) => setNewDistrict(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <label className="text-xs font-semibold text-slate-700">Observações / Origem</label>
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
                <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  Salvar Lead
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Target Progress Card */}
      <Card className="border-emerald-200 bg-gradient-to-r from-emerald-50 via-teal-50 to-white shadow-sm">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2 max-w-lg">
              <div className="flex items-center gap-2 text-emerald-800 font-semibold text-sm">
                <Sparkles className="h-4 w-4" /> Meta: 50 Prestadores em 14 Dias
              </div>
              <h3 className="text-2xl font-black text-slate-900">
                {metrics?.onboardedCount || 0} / 50 <span className="text-sm font-normal text-slate-600">prestadores ativos</span>
              </h3>
              <p className="text-xs text-slate-600">
                Taxa de conversão atual do funil: <span className="font-bold text-emerald-700">{metrics?.conversionRate || 0}%</span>. Foco em categorias de alta demanda (Elétrica e Hidráulica).
              </p>
            </div>

            <div className="flex-1 max-w-md space-y-2">
              <div className="flex justify-between text-xs font-semibold text-slate-700">
                <span>Progresso do Lançamento</span>
                <span>{metrics?.progressPct || 0}%</span>
              </div>
              <div className="h-3 w-full bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-600 transition-all duration-500 rounded-full"
                  style={{ width: `${Math.max(5, metrics?.progressPct || 0)}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-slate-500">
                <span>{metrics?.activeInFunnel || 0} em negociação</span>
                <span>{metrics?.firstServiceCount || 0} com 1º serviço feito</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {(
          [
            { status: "NEW", label: "Novos", count: metrics?.byStatus.NEW || 0, color: "text-slate-700 border-slate-200" },
            { status: "CONTACTED", label: "Contatados", count: metrics?.byStatus.CONTACTED || 0, color: "text-blue-700 border-blue-200" },
            { status: "DEMO_SCHEDULED", label: "Em Pitch", count: metrics?.byStatus.DEMO_SCHEDULED || 0, color: "text-amber-700 border-amber-200" },
            { status: "ONBOARDED", label: "Cadastrados", count: metrics?.byStatus.ONBOARDED || 0, color: "text-emerald-700 border-emerald-200" },
            { status: "FIRST_SERVICE", label: "1º Serviço", count: metrics?.byStatus.FIRST_SERVICE || 0, color: "text-purple-700 border-purple-200" },
            { status: "REJECTED", label: "Descartados", count: metrics?.byStatus.REJECTED || 0, color: "text-rose-700 border-rose-200" },
          ] as const
        ).map((item) => (
          <Card
            key={item.status}
            className={`cursor-pointer transition-all hover:shadow-md border ${
              statusFilter === item.status ? "ring-2 ring-emerald-500 bg-emerald-50/40" : ""
            }`}
            onClick={() => setStatusFilter(statusFilter === item.status ? "ALL" : item.status)}
          >
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-slate-900">{item.count}</div>
              <div className="text-xs font-medium text-slate-600 mt-1">{item.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Buscar por nome, telefone, especialidade..."
            className="pl-9 bg-white"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-48 bg-white">
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
      <Card className="border-slate-200 shadow-sm overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Prestador</th>
                <th className="px-4 py-3">Especialidade</th>
                <th className="px-4 py-3">Região</th>
                <th className="px-4 py-3">Status do Funil</th>
                <th className="px-4 py-3">Observações</th>
                <th className="px-4 py-3 text-right">Ação WhatsApp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    Carregando leads do pipeline GTM...
                  </td>
                </tr>
              ) : filteredLeads.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    Nenhum prestador encontrado com os filtros selecionados.
                  </td>
                </tr>
              ) : (
                filteredLeads.map((lead) => {
                  const statusConf = STATUS_CONFIG[lead.status]
                  const waLink = generateWhatsAppOutreachLink(lead)

                  return (
                    <tr key={lead.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{lead.name}</div>
                        <div className="text-xs text-slate-500">{lead.phone}</div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="font-medium text-xs">
                          {lead.profession}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs text-slate-800 font-medium">
                          {lead.district ? `${lead.district}, ` : ""}
                          {lead.city}/{lead.state}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Select
                          value={lead.status}
                          onValueChange={(val) => handleStatusChange(lead.id, val as LeadStatus)}
                        >
                          <SelectTrigger className="h-8 text-xs w-36 font-semibold bg-white">
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
                      <td className="px-4 py-3 max-w-xs truncate text-xs text-slate-600">
                        {lead.notes || "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          asChild
                          className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 text-xs h-8 shadow-xs"
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
