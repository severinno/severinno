"use client"

import * as React from "react"
import {
  FileText,
  ShieldCheck,
  CheckCircle2,
  Copy,
  Printer,
  Sparkles,
  Lock,
  QrCode,
  Scale,
  Download,
  Check,
  MessageCircle,
  ArrowRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type DigitalContractGeneratorProps = {
  onExploreProtectedProviders?: () => void
  className?: string
}

export function DigitalContractGenerator({
  onExploreProtectedProviders,
  className,
}: DigitalContractGeneratorProps) {
  const [clientName, setClientName] = React.useState("Mariana Silveira")
  const [serviceName, setServiceName] = React.useState("Instalação Elétrica & Chuveiro")
  const [neighborhood, setNeighborhood] = React.useState("Ilha dos Araújos")
  const [amount, setAmount] = React.useState("180,00")
  const [copied, setCopied] = React.useState(false)

  const protocolId = React.useMemo(() => {
    return `SEV-GV-2026-${Math.abs(
      (clientName + serviceName + neighborhood)
        .split("")
        .reduce((acc, c) => acc + c.charCodeAt(0), 1000),
    )
      .toString(16)
      .toUpperCase()
      .slice(0, 6)}`
  }, [clientName, serviceName, neighborhood])

  const contractText = `MINUTA DE CONTRATO DE PRESTAÇÃO DE SERVIÇOS RESIDENCIAIS
Plataforma: Severinno Marketplace (Governador Valadares - MG)
Protocolo de Autenticidade: ${protocolId}
Data: ${new Date().toLocaleDateString("pt-BR")}

CONTRATANTE: ${clientName || "Cliente"}
LOCAL DO SERVIÇO: Bairro ${neighborhood}, Governador Valadares - MG
SERVIÇO CONTRATADO: ${serviceName}
VALOR TOTAL ACORDADO: R$ ${amount}

CLÁUSULAS DE BLINDAGEM SEVERINNO:
1. CUSTÓDIA BLINDADA (ESCROW): O valor de R$ ${amount} fica retido pela plataforma e somente será liberado ao prestador após o aceite expresso e vistoria do CONTRATANTE.
2. GARANTIA OBRIGATÓRIA: Garantia técnica de 90 dias com reexecução sem custos em caso de vício no serviço.
3. COBERTURA DE DANOS: Seguro contra danos materiais acidentais de até R$ 5.000,00 intermediado pelo Severinno.
4. FORO: Comarca de Governador Valadares, Estado de Minas Gerais.`

  const handleCopy = () => {
    navigator.clipboard?.writeText(contractText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const handlePrint = () => {
    if (typeof window !== "undefined") {
      window.print()
    }
  }

  return (
    <section
      aria-label="Gerador de Pré-Contrato Digital e Recibo Oficial"
      className={cn(
        "via-background to-background relative mx-auto my-10 w-full max-w-7xl overflow-hidden rounded-3xl border border-blue-500/20 bg-gradient-to-b from-blue-500/5 p-6 shadow-xl sm:p-8 md:p-10",
        className,
      )}
    >
      {/* Background blur */}
      <div className="pointer-events-none absolute -top-16 -right-16 size-80 rounded-full bg-blue-500/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 -left-16 size-80 rounded-full bg-indigo-500/10 blur-3xl" />

      {/* Header */}
      <div className="relative mb-8 text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 px-3.5 py-1 text-xs font-bold text-blue-700 dark:text-blue-400">
          <Scale className="size-3.5" />
          <span>Fim do &ldquo;Acordo de Boca&rdquo; • Validade Jurídica Real</span>
        </div>
        <h2 className="mt-3 text-2xl font-black tracking-tight sm:text-3xl md:text-4xl">
          Contrato Digital & Recibo Oficial em 1 Clique
        </h2>
        <p className="text-muted-foreground mx-auto mt-2 max-w-2xl text-xs sm:text-sm md:text-base">
          No Severinno, toda contratação gera automaticamente um termo de prestação com garantia de
          90 dias, seguro de danos de R$ 5.000 e retenção do pagamento até a sua aprovação final.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Left Column: Interactive Form Simulator */}
        <div className="border-border/80 bg-card/80 space-y-4 rounded-2xl border p-5 shadow-sm backdrop-blur-xs lg:col-span-5">
          <h3 className="text-foreground text-sm font-bold">
            Simule o seu Pré-Contrato em Tempo Real:
          </h3>

          <div>
            <label className="text-muted-foreground text-[11px] font-bold uppercase">
              Nome do Contratante:
            </label>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="border-border/80 bg-background focus:border-primary focus:ring-primary mt-1 w-full rounded-xl border px-3 py-2 text-xs font-semibold focus:ring-1 focus:outline-none"
              placeholder="Ex: Seu Nome Completo"
            />
          </div>

          <div>
            <label className="text-muted-foreground text-[11px] font-bold uppercase">
              Serviço a ser Prestado:
            </label>
            <input
              type="text"
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              className="border-border/80 bg-background focus:border-primary focus:ring-primary mt-1 w-full rounded-xl border px-3 py-2 text-xs font-semibold focus:ring-1 focus:outline-none"
              placeholder="Ex: Troca de Quadro de Luz, Pintura, etc."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-muted-foreground text-[11px] font-bold uppercase">
                Bairro em GV:
              </label>
              <input
                type="text"
                value={neighborhood}
                onChange={(e) => setNeighborhood(e.target.value)}
                className="border-border/80 bg-background focus:border-primary focus:ring-primary mt-1 w-full rounded-xl border px-3 py-2 text-xs font-semibold focus:ring-1 focus:outline-none"
                placeholder="Ex: Ilha dos Araújos"
              />
            </div>
            <div>
              <label className="text-muted-foreground text-[11px] font-bold uppercase">
                Valor Acordado (R$):
              </label>
              <input
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="border-border/80 bg-background focus:border-primary focus:ring-primary mt-1 w-full rounded-xl border px-3 py-2 text-xs font-semibold focus:ring-1 focus:outline-none"
                placeholder="180,00"
              />
            </div>
          </div>

          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3.5 text-xs text-emerald-800 dark:text-emerald-300">
            <div className="flex items-center gap-2 font-bold">
              <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
              <span>Garantias Ativas no Documento:</span>
            </div>
            <ul className="mt-2 space-y-1 text-[11px]">
              <li>✓ Custódia segura (Liberação somente após aprovação)</li>
              <li>✓ Cobertura de danos materiais até R$ 5.000,00</li>
              <li>✓ Retorno gratuito em até 90 dias caso haja problema</li>
            </ul>
          </div>

          <div className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleCopy}
              className="w-full gap-2 text-xs font-bold"
            >
              {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
              <span>{copied ? "Minuta Copiada com Sucesso!" : "Copiar Texto da Minuta"}</span>
            </Button>
          </div>
        </div>

        {/* Right Column: Visual Sheet Document */}
        <div className="relative rounded-2xl border-2 border-slate-300 bg-white p-6 text-slate-800 shadow-2xl lg:col-span-7 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          {/* Watermark stamp */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.04] dark:opacity-[0.06]">
            <ShieldCheck className="size-80" />
          </div>

          {/* Document Top Header */}
          <div className="flex items-start justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
            <div>
              <span className="text-primary text-[10px] font-black tracking-widest uppercase">
                Severinno Marketplace GV
              </span>
              <h4 className="text-sm font-black tracking-tight sm:text-base">
                TERMO OFICIAL DE CONTRATAÇÃO & GARANTIA RESIDENCIAL
              </h4>
              <span className="text-muted-foreground text-[10px]">
                Comarca de Governador Valadares - MG • Válido nos termos do Art. 10 da MP
                2.200-2/2001
              </span>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-1.5 text-center dark:border-slate-800 dark:bg-slate-800">
              <QrCode className="size-8 text-slate-700 dark:text-slate-300" />
              <span className="mt-0.5 block font-mono text-[8px] font-bold">AUTÊNTICO</span>
            </div>
          </div>

          {/* Metadata Grid */}
          <div className="my-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-[11px] sm:grid-cols-4 dark:bg-slate-800/60">
            <div>
              <span className="text-muted-foreground block text-[9px] uppercase">Protocolo</span>
              <span className="text-primary font-mono font-bold">{protocolId}</span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[9px] uppercase">Contratante</span>
              <span className="block truncate font-bold">{clientName || "Cliente"}</span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[9px] uppercase">Bairro</span>
              <span className="font-bold">{neighborhood}</span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[9px] uppercase">
                Valor Caucionado
              </span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">R$ {amount}</span>
            </div>
          </div>

          {/* Clauses */}
          <div className="space-y-3 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
            <p>
              <strong>1. DO OBJETO:</strong> O PRESTADOR compromete-se a executar o serviço de{" "}
              <strong>&ldquo;{serviceName}&rdquo;</strong> no endereço do CONTRATANTE, com zelo
              técnico e materiais adequados.
            </p>
            <p>
              <strong>2. DA CUSTÓDIA BLINDADA (ESCROW):</strong> O valor acordado de{" "}
              <strong>R$ {amount}</strong> permanece retido na conta de custódia Severinno, sendo
              liberado ao PRESTADOR apenas após confirmação e aprovação expressa do serviço pelo
              CONTRATANTE.
            </p>
            <p>
              <strong>3. DA GARANTIA LEGAL E SEGURO:</strong> Fica assegurada garantia integral de{" "}
              <strong>90 (noventa) dias</strong> contra defeitos de execução, além de cobertura
              subsidiária contra danos patrimoniais de até <strong>R$ 5.000,00</strong>.
            </p>
          </div>

          {/* Digital Signature Footer */}
          <div className="mt-6 flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                <Lock className="size-3.5" />
              </div>
              <div>
                <span className="block text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                  Assinatura Digital Criptografada
                </span>
                <span className="text-muted-foreground block font-mono text-[9px]">
                  SHA-256: 8f4c...3e9a (Validada)
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handlePrint}
                className="gap-1.5 text-xs font-semibold"
              >
                <Printer className="size-3.5" />
                <span>Imprimir / PDF</span>
              </Button>

              {onExploreProtectedProviders && (
                <Button
                  type="button"
                  size="sm"
                  onClick={onExploreProtectedProviders}
                  className="bg-primary text-primary-foreground gap-1.5 text-xs font-bold shadow-xs"
                >
                  <span>Contratar com Proteção</span>
                  <ArrowRight className="size-3.5" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
export default DigitalContractGenerator
