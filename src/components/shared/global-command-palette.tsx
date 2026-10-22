"use client"

/**
 * GlobalCommandPalette — Paleta de Comando Global (⌘K / Ctrl+K Spotlight).
 *
 * Permite navegação ultrarrápida, busca de funcionalidades e disparo de ações
 * operacionais com foco em eficiência e usabilidade em desktop e mobile.
 */

import * as React from "react"
import { useTheme } from "next-themes"
import {
  Activity,
  Award,
  BellRing,
  Calculator,
  CalendarCheck,
  CalendarDays,
  Compass,
  FileSpreadsheet,
  FileText,
  Gift,
  HelpCircle,
  Layers,
  LogOut,
  MapPin,
  MessageSquare,
  Moon,
  Radio,
  Scale,
  Search,
  Share2,
  ShieldCheck,
  Sparkles,
  Sun,
  Volume2,
  VolumeX,
  Wallet,
  Wrench,
} from "lucide-react"

import { triggerHaptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"

export interface CommandPaletteAction {
  id: string
  label: string
  subtitle?: string
  icon: React.ComponentType<{ className?: string }>
  badge?: string
  shortcut?: string
  onSelect: () => void
}

interface GlobalCommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  role?: "ADMIN" | "CLIENT" | "PROVIDER"
  onNavigate: (view: string) => void
  onOpenTour?: () => void
  onOpenMeiReport?: () => void
  onOpenPriceEstimator?: () => void
  onOpenReputationCard?: () => void
  onOpenQuote?: () => void
  soundEnabled?: boolean
  onToggleSound?: () => void
  onLogout?: () => void
}

export function GlobalCommandPalette({
  open,
  onOpenChange,
  role = "CLIENT",
  onNavigate,
  onOpenTour,
  onOpenMeiReport,
  onOpenPriceEstimator,
  onOpenReputationCard,
  onOpenQuote,
  soundEnabled = true,
  onToggleSound,
  onLogout,
}: GlobalCommandPaletteProps) {
  const { theme, setTheme } = useTheme()

  // Global keyboard shortcut: ⌘K or Ctrl+K
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        triggerHaptic("selection")
        onOpenChange(!open)
      }
    }

    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [open, onOpenChange])

  const handleSelect = (callback: () => void) => {
    triggerHaptic("selection")
    onOpenChange(false)
    callback()
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Paleta de Comandos Severinno"
      description="Pesquise por telas, comandos e atalhos operacionais"
    >
      <CommandInput placeholder="Digite uma tela, comando ou ação rápida (ex: agenda, rotas, saldo)..." />
      <CommandList>
        <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>

        {/* 1. Comandos Específicos por Papel */}
        {role === "ADMIN" && (
          <CommandGroup heading="Operações &amp; Gestão Administrativa">
            <CommandItem onSelect={() => handleSelect(() => onNavigate("admin.operations"))}>
              <Radio className="mr-2 size-4 text-emerald-500" />
              <span>Torre de Controle Operacional (Live GV)</span>
              <CommandShortcut>GV Live</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={() => handleSelect(() => onNavigate("admin.verifications"))}>
              <ShieldCheck className="mr-2 size-4 text-blue-500" />
              <span>Verificações &amp; Aprovação KYC</span>
            </CommandItem>
            <CommandItem onSelect={() => handleSelect(() => onNavigate("admin.settlements"))}>
              <Wallet className="mr-2 size-4 text-emerald-500" />
              <span>Custódia &amp; Repasses PIX</span>
            </CommandItem>
            <CommandItem onSelect={() => handleSelect(() => onNavigate("admin.disputes"))}>
              <Scale className="mr-2 size-4 text-amber-500" />
              <span>Mediação de Disputas &amp; Arbitragem</span>
            </CommandItem>
            <CommandItem onSelect={() => handleSelect(() => onNavigate("admin.whatsapp"))}>
              <MessageSquare className="mr-2 size-4 text-emerald-500" />
              <span>WhatsApp &amp; Evolution API</span>
            </CommandItem>
            <CommandItem onSelect={() => handleSelect(() => onNavigate("admin.push"))}>
              <BellRing className="mr-2 size-4 text-purple-500" />
              <span>Campanhas Push &amp; Notificações</span>
            </CommandItem>
            <CommandItem onSelect={() => handleSelect(() => onNavigate("admin.coverage"))}>
              <MapPin className="mr-2 size-4 text-sky-500" />
              <span>Mapa de Cobertura &amp; Demanda GV</span>
            </CommandItem>
            <CommandItem onSelect={() => handleSelect(() => onNavigate("admin.taxonomy"))}>
              <Layers className="text-muted-foreground mr-2 size-4" />
              <span>Taxonomia &amp; Catálogo de Serviços</span>
            </CommandItem>
            <CommandItem onSelect={() => handleSelect(() => onNavigate("admin.health"))}>
              <Activity className="mr-2 size-4 text-rose-500" />
              <span>Saúde do Sistema &amp; DevOps</span>
            </CommandItem>
          </CommandGroup>
        )}

        {role === "CLIENT" && (
          <CommandGroup heading="Central de Ações do Cliente">
            <CommandItem onSelect={() => handleSelect(() => onNavigate("client.providers"))}>
              <MapPin className="mr-2 size-4 text-emerald-500" />
              <span>Buscar Prestadores com Radar Geográfico</span>
              <CommandShortcut>Busca</CommandShortcut>
            </CommandItem>
            {onOpenQuote && (
              <CommandItem onSelect={() => handleSelect(onOpenQuote)}>
                <Sparkles className="text-primary mr-2 size-4" />
                <span>Pedir Orçamento Expresso Grátis</span>
                <CommandShortcut>Novo</CommandShortcut>
              </CommandItem>
            )}
            <CommandItem onSelect={() => handleSelect(() => onNavigate("client.bookings"))}>
              <CalendarCheck className="mr-2 size-4 text-blue-500" />
              <span>Meus Agendamentos &amp; Rastreamento</span>
            </CommandItem>
            <CommandItem onSelect={() => handleSelect(() => onNavigate("client.quotes"))}>
              <FileText className="mr-2 size-4 text-amber-500" />
              <span>Orçamentos Recebidos &amp; Cotações</span>
            </CommandItem>
            <CommandItem onSelect={() => handleSelect(() => onNavigate("client.finance"))}>
              <ShieldCheck className="mr-2 size-4 text-emerald-500" />
              <span>Pagamentos Seguros &amp; Garantia de 90 Dias</span>
            </CommandItem>
            <CommandItem onSelect={() => handleSelect(() => onNavigate("client.rewards"))}>
              <Award className="mr-2 size-4 text-purple-500" />
              <span>Clube de Benefícios &amp; Cupons VIP</span>
            </CommandItem>
            <CommandItem onSelect={() => handleSelect(() => onNavigate("client.referral"))}>
              <Gift className="mr-2 size-4 text-rose-500" />
              <span>Indique e Ganhe Bônus PIX</span>
            </CommandItem>
          </CommandGroup>
        )}

        {role === "PROVIDER" && (
          <CommandGroup heading="Produtividade &amp; Operação do Prestador">
            <CommandItem onSelect={() => handleSelect(() => onNavigate("provider.agenda"))}>
              <CalendarDays className="mr-2 size-4 text-blue-500" />
              <span>Minha Agenda &amp; Calendário de Atendimentos</span>
            </CommandItem>
            <CommandItem onSelect={() => handleSelect(() => onNavigate("provider.routes"))}>
              <Compass className="mr-2 size-4 text-emerald-500" />
              <span>Rotas &amp; Logística nos Bairros de GV</span>
            </CommandItem>
            <CommandItem onSelect={() => handleSelect(() => onNavigate("provider.quotes"))}>
              <FileText className="mr-2 size-4 text-blue-500" />
              <span>Responder Orçamentos Pendentes</span>
            </CommandItem>
            <CommandItem onSelect={() => handleSelect(() => onNavigate("provider.finance"))}>
              <Wallet className="mr-2 size-4 text-emerald-500" />
              <span>Saldo Liberado &amp; Saques PIX</span>
            </CommandItem>
            <CommandItem onSelect={() => handleSelect(() => onNavigate("provider.services"))}>
              <Wrench className="mr-2 size-4 text-amber-500" />
              <span>Gerenciar Meus Serviços &amp; Preços</span>
            </CommandItem>
            {onOpenMeiReport && (
              <CommandItem onSelect={() => handleSelect(onOpenMeiReport)}>
                <FileSpreadsheet className="mr-2 size-4 text-purple-500" />
                <span>Exportar Demonstrativo MEI &amp; DRE Contábil</span>
                <CommandShortcut>PDF/CSV</CommandShortcut>
              </CommandItem>
            )}
            {onOpenPriceEstimator && (
              <CommandItem onSelect={() => handleSelect(onOpenPriceEstimator)}>
                <Calculator className="mr-2 size-4 text-blue-500" />
                <span>Calculadora de Preço de Mão de Obra e Deslocamento</span>
              </CommandItem>
            )}
            {onOpenReputationCard && (
              <CommandItem onSelect={() => handleSelect(onOpenReputationCard)}>
                <Share2 className="mr-2 size-4 text-emerald-500" />
                <span>Gerar Cartão de Reputação para WhatsApp</span>
              </CommandItem>
            )}
            <CommandItem onSelect={() => handleSelect(() => onNavigate("provider.rewards"))}>
              <Award className="mr-2 size-4 text-purple-500" />
              <span>Clube de Vantagens &amp; Resgate de Pontos</span>
            </CommandItem>
          </CommandGroup>
        )}

        <CommandSeparator />

        {/* 2. Preferências, Suporte e Sistema */}
        <CommandGroup heading="Preferências &amp; Sistema">
          {onOpenTour && (
            <CommandItem onSelect={() => handleSelect(onOpenTour)}>
              <HelpCircle className="text-primary mr-2 size-4" />
              <span>Iniciar Tour Guiado do Sistema</span>
              <CommandShortcut>Tour</CommandShortcut>
            </CommandItem>
          )}

          <CommandItem
            onSelect={() => handleSelect(() => setTheme(theme === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? (
              <Sun className="mr-2 size-4 text-amber-500" />
            ) : (
              <Moon className="mr-2 size-4 text-indigo-500" />
            )}
            <span>Alternar Tema ({theme === "dark" ? "Modo Claro" : "Modo Escuro"})</span>
          </CommandItem>

          {onToggleSound && (
            <CommandItem onSelect={() => handleSelect(onToggleSound)}>
              {soundEnabled ? (
                <VolumeX className="text-muted-foreground mr-2 size-4" />
              ) : (
                <Volume2 className="mr-2 size-4 text-emerald-500" />
              )}
              <span>{soundEnabled ? "Silenciar Sons do App" : "Ativar Efeitos Sonoros"}</span>
            </CommandItem>
          )}

          <CommandItem
            onSelect={() =>
              handleSelect(() => {
                window.open(
                  "https://wa.me/5533999999999?text=Ol%C3%A1!%20Preciso%20de%20ajuda%20no%20Severinno.",
                  "_blank",
                )
              })
            }
          >
            <MessageSquare className="mr-2 size-4 text-emerald-600" />
            <span>Suporte Humanizado via WhatsApp</span>
          </CommandItem>

          {onLogout && (
            <CommandItem onSelect={() => handleSelect(onLogout)}>
              <LogOut className="mr-2 size-4 text-rose-500" />
              <span>Encerrar Sessão (Sair da Conta)</span>
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}

/**
 * CommandPaletteTrigger — Botão atalho para o topo do DashboardShell.
 */
export function CommandPaletteTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        triggerHaptic("selection")
        onClick()
      }}
      className={cn(
        "bg-muted/50 hover:bg-muted/80 text-muted-foreground hover:text-foreground",
        "border-border/60 flex h-8 items-center gap-2 rounded-xl border px-2.5 text-xs font-medium shadow-2xs transition-all",
        "focus-visible:ring-primary/40 focus-visible:ring-2 focus-visible:outline-none active:scale-95",
      )}
      aria-label="Abrir busca e paleta de comandos (Atalho ⌘K)"
    >
      <Search className="size-3.5" />
      <span className="hidden sm:inline">Buscar ou comando...</span>
      <span className="inline sm:hidden">Buscar</span>
      <kbd className="bg-background text-muted-foreground/80 pointer-events-none hidden h-4.5 items-center gap-0.5 rounded border px-1.5 font-mono text-[10px] font-medium opacity-100 select-none sm:inline-flex">
        <span className="text-xs">⌘</span>K
      </kbd>
    </button>
  )
}
