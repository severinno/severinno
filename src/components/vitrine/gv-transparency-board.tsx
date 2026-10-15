"use client"

import * as React from "react"
import {
  ShieldCheck,
  Clock,
  Lock,
  CheckCircle2,
  FileCheck2,
  AlertCircle,
  Sparkles,
  ArrowRight,
  Award,
  Scale,
  BadgeCheck,
  Building2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type TransparencyPillar = {
  id: string
  title: string
  metric: string
  sublabel: string
  badge: string
  details: string
  points: string[]
}

const TRANSPARENCY_PILLARS: TransparencyPillar[] = [
  {
    id: "antecedentes",
    title: "Antecedentes & Biometria Facial",
    metric: "100%",
    sublabel: "dos prestadores auditados",
    badge: "Tolerância Zero",
    details:
      "Nenhum profissional é ativado no Severinno sem apresentação de Certidão Negativa de Antecedentes Criminais (Justiça Estadual e Federal) e validação biométrica facial cruzada.",
    points: [
      "Cruzamento com bases policiais e Gov.br",
      "Revalidação periódica a cada 90 dias",
      "Checagem cadastral de MEI / CNPJ ativo",
    ],
  },
  {
    id: "escrow",
    title: "Custódia Financeira Blindada (Escrow)",
    metric: "R$ 0,00",
    sublabel: "de prejuízo a clientes",
    badge: "Zero Adiantamento",
    details:
      "O cliente nunca passa PIX ou dinheiro direto antes da conclusão. O valor fica em custódia segura na plataforma e só é liberado para o prestador após a aprovação do serviço.",
    points: [
      "Você só paga quando testar e aprovar",
      "Prevenção total contra abandono de obra",
      "Reembolso automático em caso de desacordo",
    ],
  },
  {
    id: "resposta",
    title: "Agilidade Hiperlocal em GV",
    metric: "8 min",
    sublabel: "tempo médio de resposta",
    badge: "Atendimento Rápido",
    details:
      "Técnicos distribuídos estrategicamente pelos bairros de Governador Valadares garantem atendimento célere, tanto para manutenções programadas quanto para plantão emergencial.",
    points: [
      "Notificação instantânea via WhatsApp",
      "Rotas otimizadas por proximidade geográfica",
      "Suporte humano dedicado em GV",
    ],
  },
  {
    id: "aprovacao",
    title: "Satisfação & Reexecução Garantida",
    metric: "99.4%",
    sublabel: "de aprovação nos serviços",
    badge: "+1.840 Atendimentos",
    details:
      "Mais de 1.840 chamados realizados em Governador Valadares com avaliação média de 4.9 estrelas. Garantia técnica de 90 dias com seguro contra danos acidentais de até R$ 5.000.",
    points: [
      "Garantia legal de 90 dias sem custos extras",
      "Seguro contra danos patrimoniais de até R$ 5.000",
      "Avaliações 100% verificadas por clientes reais",
    ],
  },
]

const LIVE_AUDIT_LOGS = [
  {
    time: "Hoje às 18:45",
    district: "Ilha dos Araújos",
    action: "Liberação de Escrow autorizada pelo cliente após teste de ar-condicionado.",
    status: "Concluído",
  },
  {
    time: "Hoje às 17:30",
    district: "Centro",
    action: "Validação biométrica e certidão criminal renovada para eletricista parceiro.",
    status: "Auditado",
  },
  {
    time: "Hoje às 16:15",
    district: "Morada do Vale",
    action: "Check-in presencial confirmado via geolocalização para reparo hidráulico.",
    status: "Em Execução",
  },
]

export type GvTransparencyBoardProps = {
  onLearnMore?: () => void
  className?: string
}

export function GvTransparencyBoard({ onLearnMore, className }: GvTransparencyBoardProps) {
  const [activePillarId, setActivePillarId] = React.useState<string>("antecedentes")
  const activePillar =
    TRANSPARENCY_PILLARS.find((p) => p.id === activePillarId) || TRANSPARENCY_PILLARS[0]

  return (
    <section
      aria-label="Central de Integridade e Transparência em Governador Valadares"
      className={cn(
        "border-border/80 from-card/90 via-background to-background relative mx-auto my-10 w-full max-w-7xl overflow-hidden rounded-3xl border bg-gradient-to-b p-6 shadow-xl sm:p-8 md:p-10",
        className,
      )}
    >
      {/* Background glow */}
      <div className="pointer-events-none absolute -top-20 -right-20 size-80 rounded-full bg-blue-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -left-20 size-80 rounded-full bg-emerald-500/10 blur-3xl" />

      {/* Header */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3.5 py-1 text-xs font-bold text-blue-700 dark:text-blue-400">
          <Scale className="size-3.5" />
          <span>Auditoria Contínua • Central de Integridade GV</span>
        </div>
        <h2 className="text-foreground mt-3 text-2xl font-black tracking-tight sm:text-3xl md:text-4xl">
          Transparência Total: Como Protegemos a Sua Casa
        </h2>
        <p className="text-muted-foreground mx-auto mt-2 max-w-2xl text-xs sm:text-sm md:text-base">
          O Severinno é a única plataforma de Governador Valadares com verificação criminal
          obrigatória, pagamento retido até a sua aprovação e seguro de danos.
        </p>
      </div>

      {/* 4 Pillars Grid Metrics */}
      <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {TRANSPARENCY_PILLARS.map((pillar) => {
          const active = pillar.id === activePillarId
          return (
            <button
              key={pillar.id}
              type="button"
              onClick={() => setActivePillarId(pillar.id)}
              className={cn(
                "group relative flex flex-col items-start rounded-2xl border p-4 text-left transition-all duration-200 sm:p-5",
                active
                  ? "border-primary bg-primary/10 ring-primary/30 shadow-md ring-2"
                  : "border-border/70 bg-card/60 hover:border-primary/40 hover:bg-muted/40",
              )}
            >
              <div className="flex w-full items-center justify-between">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {pillar.badge}
                </span>
                <BadgeCheck
                  className={cn(
                    "size-4 transition-colors",
                    active ? "text-primary" : "text-muted-foreground/40",
                  )}
                />
              </div>

              <span className="text-foreground mt-3 text-2xl font-black sm:text-3xl">
                {pillar.metric}
              </span>
              <span className="text-foreground mt-0.5 text-xs font-bold">{pillar.title}</span>
              <span className="text-muted-foreground mt-0.5 text-[11px]">{pillar.sublabel}</span>
            </button>
          )
        })}
      </div>

      {/* Active Pillar Detailed Spotlight */}
      <div className="border-border/80 bg-background/90 mt-6 rounded-2xl border p-6 shadow-sm backdrop-blur-xs sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-3xl space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="text-primary size-5" />
              <h3 className="text-foreground text-lg font-black sm:text-xl">
                {activePillar.title} — Como Funciona na Prática:
              </h3>
            </div>
            <p className="text-muted-foreground text-xs leading-relaxed sm:text-sm">
              {activePillar.details}
            </p>

            <ul className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
              {activePillar.points.map((pt, i) => (
                <li
                  key={i}
                  className="text-foreground flex items-center gap-2 text-xs font-semibold"
                >
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>{pt}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="shrink-0">
            {onLearnMore && (
              <Button
                type="button"
                onClick={onLearnMore}
                className="w-full gap-2 font-bold shadow-md sm:w-auto"
              >
                <span>Conhecer a Blindagem Severinno</span>
                <ArrowRight className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Live Operational Integrity Feed */}
      <div className="border-border/60 bg-muted/30 mt-6 rounded-2xl border p-4 sm:p-5">
        <div className="border-border/50 flex items-center justify-between border-b pb-3">
          <div className="text-foreground flex items-center gap-2 text-xs font-bold">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            <span>Feed de Auditoria ao Vivo de Governador Valadares:</span>
          </div>
          <span className="text-muted-foreground text-[10px]">Atualizado em tempo real</span>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {LIVE_AUDIT_LOGS.map((log, idx) => (
            <div
              key={idx}
              className="border-border/60 bg-background/80 rounded-xl border p-3 text-xs shadow-2xs"
            >
              <div className="text-muted-foreground flex items-center justify-between text-[10px]">
                <span>{log.time}</span>
                <span className="text-primary font-bold">{log.district}</span>
              </div>
              <p className="text-foreground mt-1.5 text-[11px] font-medium">{log.action}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
export default GvTransparencyBoard
