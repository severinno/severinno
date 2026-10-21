"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { BadgeCheck, CheckCircle2, MapPin, Navigation, ShieldCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useUIStore } from "@/store/ui"
import { useGeoStore } from "@/store/geo"
import { type ProviderDetail } from "@/lib/api"
import { decodeEntities } from "./shared"

// Mini map — client-only, lazy loaded
const ProviderMiniMap = dynamic(() => import("@/components/shared/provider-mini-map"), {
  ssr: false,
  loading: () => <Skeleton className="h-48 w-full rounded-xl" />,
})

export function AboutTab({ provider, loading }: { provider?: ProviderDetail; loading: boolean }) {
  const openQuote = useUIStore((s) => s.openQuote)
  const userLat = useGeoStore((s) => s.lat)
  const userLng = useGeoStore((s) => s.lng)
  const [previewRadius, setPreviewRadius] = React.useState<number | null>(null)

  const handleRadiusChange = React.useCallback((km: number) => {
    setPreviewRadius(km)
  }, [])

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    )
  }

  const effectiveRadius = previewRadius ?? provider?.radiusKm ?? 25
  const hasProviderCoords =
    typeof provider?.lat === "number" &&
    typeof provider?.lng === "number" &&
    Number.isFinite(provider.lat) &&
    Number.isFinite(provider.lng)

  const formattedAddress = [provider?.address, provider?.district].filter(Boolean).join(", ")

  return (
    <div className="w-full min-w-0 space-y-4 text-sm">
      {/* Bio Card */}
      <div className="border-border/50 bg-card rounded-2xl border p-5 shadow-xs">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
            Apresentação Profissional
          </p>
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
            <BadgeCheck className="size-3.5" />
            Perfil Verificado
          </span>
        </div>
        {provider?.bio ? (
          <p className="text-foreground/90 text-xs leading-relaxed whitespace-pre-line sm:text-sm">
            {decodeEntities(provider.bio)}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs italic">Sem descrição cadastrada.</p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <span className="bg-muted/40 border-border/50 text-foreground/90 inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold shadow-2xs">
            <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />
            Antecedentes & CPF/CNPJ Verificados
          </span>
          <span className="bg-muted/40 border-border/50 text-foreground/90 inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold shadow-2xs">
            <ShieldCheck className="size-3.5 shrink-0 text-emerald-600" />
            Custódia PIX + Garantia 90 dias
          </span>
        </div>
      </div>

      {/* Coverage & Map Section */}
      <div className="border-border/50 bg-card w-full min-w-0 overflow-hidden rounded-2xl border p-4 shadow-xs">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <MapPin className="size-4" />
            </span>
            <div>
              <p className="text-foreground text-xs font-bold sm:text-sm">
                Região de Atendimento & Cobertura
              </p>
              <p className="text-muted-foreground text-[11px]">
                Atendimento presencial e em domicílio em Governador Valadares e região
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-extrabold text-emerald-700 dark:text-emerald-300">
            Raio de {effectiveRadius} km
          </span>
        </div>

        {hasProviderCoords ? (
          <div className="border-border/60 relative overflow-hidden rounded-xl border">
            <ProviderMiniMap
              providerLat={provider!.lat!}
              providerLng={provider!.lng!}
              providerName={provider!.name}
              userLat={userLat}
              userLng={userLng}
              radiusKm={effectiveRadius}
              accuracyM={provider!.gpsAccuracyM}
              onRadiusChange={handleRadiusChange}
              height={170}
              showSlider={false}
              className="w-full max-w-full overflow-hidden"
            />
          </div>
        ) : null}

        {/* Neighborhood coverage pills */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground mr-1 text-[11px] font-medium">
            Bairros atendidos com prontidão:
          </span>
          {[
            "Centro",
            "Ilha dos Araújos",
            "Vila Bretas",
            "Lourdes",
            "Grã-Duquesa",
            "São Pedro",
            "Esplanada",
            "Santa Rita",
            "Vila Isa",
          ].map((bairro) => (
            <span
              key={bairro}
              className="bg-muted/50 text-foreground/80 border-border/40 rounded-lg border px-2 py-0.5 text-[10px] font-medium"
            >
              {bairro}
            </span>
          ))}
        </div>
      </div>

      {/* Info grid */}
      <div className="grid gap-3 sm:grid-cols-3">
        {/* Address */}
        <div className="border-border/50 bg-card flex items-start gap-3 rounded-2xl border p-4 shadow-xs">
          <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-xl">
            <MapPin className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
              Endereço / Base
            </p>
            <p className="mt-1 text-xs leading-relaxed font-semibold">
              {formattedAddress || "Atendimento em Domicílio"}
              <br />
              <span className="text-muted-foreground font-normal">
                {provider?.city}
                {provider?.state ? `/${provider.state}` : ""}
                {provider?.cep ? ` · CEP ${provider.cep}` : ""}
              </span>
            </p>
          </div>
        </div>

        {/* Coverage */}
        <div className="border-border/50 bg-card flex items-start gap-3 rounded-2xl border p-4 shadow-xs">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
            <Navigation className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
              Área de cobertura
            </p>
            <p className="mt-1 text-xs leading-relaxed">
              Raio de{" "}
              <strong className="font-bold text-emerald-700 dark:text-emerald-400">
                {effectiveRadius} km
              </strong>
              <br />
              <span className="text-muted-foreground text-[11px]">
                Deslocamento rápido para toda GV
              </span>
            </p>
          </div>
        </div>

        {/* Contact Intermediado / Protegido */}
        <div className="border-border/50 bg-card flex items-center justify-between gap-3 rounded-2xl border p-4 shadow-xs">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="text-muted-foreground text-[10px] font-bold tracking-wider uppercase">
                Comunicação Segura
              </p>
              <p className="mt-0.5 truncate text-xs font-bold text-emerald-600 dark:text-emerald-400">
                100% Protegida por Custódia
              </p>
              <span className="text-muted-foreground text-[11px]">
                Orçamento e chat intermediados
              </span>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => provider && openQuote({ providerId: provider.id })}
            className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs transition-colors hover:bg-emerald-700 active:scale-95"
          >
            <span>Orçamento</span>
          </Button>
        </div>
      </div>
    </div>
  )
}
