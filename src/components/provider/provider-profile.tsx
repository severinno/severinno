"use client"

import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useForm, useWatch, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import {
  ArrowRight,
  BadgeCheck,
  Bell,
  Calculator,
  CheckCircle2,
  Eye,
  ImagePlus,
  Loader2,
  LocateFixed,
  MapPin,
  Navigation,
  Pause,
  Play,
  Save,
  Share2,
  Smartphone,
  Sparkles,
  Star,
  User,
  Volume2,
  Wrench,
  X,
} from "lucide-react"

import { apiGet, apiPatch } from "@/lib/api"
import { nearbyPhrase, suggestRadiusFromAccuracy } from "@/lib/geo-radius"
import { refineSuggestedRadius } from "@/lib/geo-density"
import { triggerHaptic } from "@/lib/haptics"
import { playCoinSound, playCompletionSound, playReviewSound, tryVibrate } from "@/lib/sounds"
import { providerProfileSchema, type ProviderProfileInput } from "@/lib/validators"
import { useAuthStore } from "@/store/auth"
import { useUIStore } from "@/store/ui"
import { useViewStore } from "@/store/view"
import { formatBRL } from "@/lib/format"

import { SafeImage } from "@/components/shared/safe-image"
import { PushNotificationCard } from "@/components/shared/push-notification-card"
import { ProviderSocialReputationCard } from "./provider-social-reputation-card"
import { ProviderPriceEstimatorDialog } from "./provider-price-estimator-dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"

const UF_OPTIONS = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Decodifica entidades HTML escapadas (ex.: &amp; → &, &quot; → ") */
function decodeEntities(str?: string | null): string {
  if (!str) return ""
  let decoded = str
  while (decoded.includes("&amp;")) {
    decoded = decoded.replace(/&amp;/g, "&")
  }
  return decoded
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

function getGVCoverageDescription(radiusKm: number): string {
  if (radiusKm <= 5) {
    return "Raio focado: Centro, Ilha dos Araújos e Esplanada."
  }
  if (radiusKm <= 12) {
    return "Raio amplo: Abrange Centro, Ilha, Vila Isa, Grã-Duquesa, São Pedro e Santa Rita."
  }
  if (radiusKm <= 25) {
    return "Cobertura total: Toda a área urbana de Governador Valadares e distritos próximos."
  }
  return "Cobertura regional: Governador Valadares e municípios vizinhos do Vale do Rio Doce."
}

/** Calcula % de completude do perfil (0-100) e retorna itens faltantes. */
function computeProfileCompleteness(profile: {
  name?: string | null
  bio?: string | null
  avatarUrl?: string | null
  coverUrl?: string | null
  whatsapp?: string | null
  cep?: string | null
  district?: string | null
  lat?: number | null
  radiusKm?: number | null
}) {
  const checks = [
    { label: "Nome completo", done: !!profile.name && profile.name.length >= 3 },
    { label: "Foto de perfil", done: !!profile.avatarUrl },
    { label: "Capa de apresentação", done: !!profile.coverUrl },
    { label: "Bio / Especialidades", done: !!profile.bio && profile.bio.length >= 20 },
    { label: "WhatsApp", done: !!profile.whatsapp },
    { label: "CEP / Endereço", done: !!profile.cep },
    { label: "Bairro", done: !!profile.district },
    { label: "Localização GPS", done: profile.lat != null },
    { label: "Raio de atendimento", done: !!profile.radiusKm && profile.radiusKm > 0 },
  ]
  const done = checks.filter((c) => c.done).length
  const pct = Math.round((done / checks.length) * 100)
  const missing = checks.filter((c) => !c.done).map((c) => c.label)
  return { pct, done, total: checks.length, missing }
}

// ---------------------------------------------------------------------------
// Single photo uploader (avatar or cover)
// ---------------------------------------------------------------------------

function SinglePhoto({
  value,
  onChange,
  label,
  aspect = "square",
  max = 1,
}: {
  value?: string | null
  onChange: (url: string | null) => void
  label: string
  aspect?: "square" | "wide"
  max?: number
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = React.useState(false)

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
        credentials: "same-origin",
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.url) {
        onChange(URL.createObjectURL(file))
      } else {
        onChange(data.url as string)
      }
    } catch {
      onChange(URL.createObjectURL(file))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-1.5">
      <label className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
        {label}
      </label>
      <div
        className={
          aspect === "square"
            ? "bg-muted/30 relative size-20 overflow-hidden rounded-xl border shadow-2xs"
            : "bg-muted/30 relative h-24 w-full overflow-hidden rounded-xl border shadow-2xs"
        }
      >
        {value ? (
          <SafeImage
            src={value}
            alt={label}
            sizes={aspect === "square" ? "80px" : "640px"}
            className="size-full object-cover"
          />
        ) : (
          <div className="text-muted-foreground flex size-full items-center justify-center">
            <ImagePlus className="size-5 opacity-50" />
          </div>
        )}
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute top-1 right-1 inline-flex size-5 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
            aria-label="Remover imagem"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) upload(f)
          if (inputRef.current) inputRef.current.value = ""
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="h-7 gap-1 rounded-lg px-2.5 text-[11px] font-medium"
      >
        {uploading ? <Loader2 className="size-3 animate-spin" /> : <ImagePlus className="size-3" />}
        {value ? "Trocar" : "Selecionar"}
      </Button>
      {max > 1 && <p className="text-muted-foreground text-[10px]">Aceita até {max} imagens.</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Profile completeness bar
// ---------------------------------------------------------------------------

function ProfileCompletenessBar({
  pct,
  done,
  total,
  missing,
}: {
  pct: number
  done: number
  total: number
  missing: string[]
}) {
  const colorClass = pct >= 90 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-rose-500"

  if (pct >= 100) return null

  return (
    <div className="bg-muted/30 space-y-1.5 rounded-xl border px-3.5 py-2.5">
      <div className="flex items-center justify-between">
        <p className="text-foreground text-xs font-semibold">Perfil {pct}% completo</p>
        <span className="text-muted-foreground text-[11px] tabular-nums">
          {done}/{total}
        </span>
      </div>
      <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
        <div
          className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {missing.length > 0 && (
        <p className="text-muted-foreground text-[10px] leading-relaxed">
          Falta: {missing.slice(0, 3).join(", ")}
          {missing.length > 3 ? ` +${missing.length - 3}` : ""}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function ProviderProfile() {
  const qc = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const fetchMe = useAuthStore((s) => s.fetchMe)
  const openProvider = useUIStore((s) => s.openProvider)
  const navigate = useViewStore((s) => s.navigate)
  const [activeTab, setActiveTab] = React.useState("identity")
  const [reputationCardOpen, setReputationCardOpen] = React.useState(false)
  const [priceEstimatorOpen, setPriceEstimatorOpen] = React.useState(false)

  const profileQuery = useQuery<{
    user: {
      id: string
      name: string
      email: string
      role: string
      cpfCnpj?: string | null
      whatsapp?: string | null
      phone?: string | null
      avatarUrl?: string | null
      coverUrl?: string | null
      bio?: string | null
      cep?: string | null
      street?: string | null
      number?: string | null
      complement?: string | null
      district?: string | null
      city?: string | null
      state?: string | null
      lat?: number | null
      lng?: number | null
      radiusKm?: number | null
      gpsAccuracyM?: number | null
      verified: boolean
      soundEnabled?: boolean
      vibrateEnabled?: boolean
      avgRating?: number | null
      reviewCount?: number | null
    }
  }>({
    queryKey: ["provider", "profile", user?.id],
    queryFn: async () => apiGet("/api/users/me"),
    enabled: !!user,
  })

  // Query dos serviços do prestador
  const servicesQuery = useQuery<{
    services: Array<{
      id: string
      title: string
      basePrice: number
      active: boolean
      unit?: string | null
      category?: { name: string } | null
    }>
  }>({
    queryKey: ["provider", "profile", "services", user?.id],
    queryFn: async () => apiGet("/api/provider/services"),
    enabled: !!user,
  })

  const profile = profileQuery.data?.user
  const services = servicesQuery.data?.services ?? []
  const activeServices = services.filter((s) => s.active)

  const form = useForm<ProviderProfileInput>({
    resolver: zodResolver(providerProfileSchema) as unknown as Resolver<ProviderProfileInput>,
    defaultValues: {
      name: "",
      bio: "",
      whatsapp: "",
      phone: "",
      avatarUrl: "",
      coverUrl: "",
      cep: "",
      street: "",
      number: "",
      complement: "",
      district: "",
      city: "",
      state: "",
      lat: undefined,
      lng: undefined,
      radiusKm: 15,
      gpsAccuracyM: undefined,
    },
  })

  const coverUrl = useWatch({ control: form.control, name: "coverUrl" })
  const avatarUrl = useWatch({ control: form.control, name: "avatarUrl" })
  const lat = useWatch({ control: form.control, name: "lat" })
  const lng = useWatch({ control: form.control, name: "lng" })
  const radiusKm = useWatch({ control: form.control, name: "radiusKm" }) ?? 15

  const [soundEnabled, setSoundEnabled] = React.useState(true)
  const [vibrateEnabled, setVibrateEnabled] = React.useState(true)
  const [prevProfile, setPrevProfile] = React.useState(profile)
  if (profile !== prevProfile) {
    setPrevProfile(profile)
    if (profile) {
      setSoundEnabled(profile.soundEnabled ?? true)
      setVibrateEnabled(profile.vibrateEnabled ?? true)
    }
  }

  React.useEffect(() => {
    if (profile) {
      form.reset({
        name: profile.name ?? "",
        bio: profile.bio ?? "",
        whatsapp: profile.whatsapp ?? "",
        phone: profile.phone ?? "",
        avatarUrl: profile.avatarUrl ?? "",
        coverUrl: profile.coverUrl ?? "",
        cep: profile.cep ?? "",
        street: profile.street ?? "",
        number: profile.number ?? "",
        complement: profile.complement ?? "",
        district: profile.district ?? "",
        city: profile.city ?? "",
        state: profile.state ?? "",
        lat: profile.lat ?? undefined,
        lng: profile.lng ?? undefined,
        radiusKm: profile.radiusKm ?? 15,
        gpsAccuracyM: profile.gpsAccuracyM ?? undefined,
      })
    }
  }, [profile, form])

  const [saving, setSaving] = React.useState(false)

  const useGPS = async () => {
    if (!navigator.geolocation) {
      toast.error("Geolocalização não suportada neste dispositivo.")
      return
    }
    toast.info("Obtendo sua localização…")
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude, accuracy } = pos.coords
        form.setValue("lat", latitude)
        form.setValue("lng", longitude)
        form.setValue("gpsAccuracyM", accuracy ?? null)
        const suggestedRadius = suggestRadiusFromAccuracy(accuracy)
        form.setValue("radiusKm", suggestedRadius)

        void refineSuggestedRadius({
          accuracyM: accuracy,
          baseRadiusKm: suggestedRadius,
          lat: latitude,
          lng: longitude,
        }).then((refined) => {
          if (!refined || form.getValues("radiusKm") !== suggestedRadius) return
          form.setValue("radiusKm", refined.radiusKm)
          const districtPart = refined.district ? ` · bairro mais denso: ${refined.district}` : ""
          toast.info(
            `Raio ajustado pela densidade local: ${refined.radiusKm} km — ${nearbyPhrase(refined.nearbyCount)}${districtPart}.`,
          )
        })

        try {
          const data = await apiGet<{
            street?: string
            district?: string
            city?: string
            state?: string
            cep?: string
          }>("/api/geo/reverse", { lat: latitude, lng: longitude })
          if (data.cep) form.setValue("cep", data.cep)
          if (data.street) form.setValue("street", data.street)
          if (data.district) form.setValue("district", data.district)
          if (data.city) form.setValue("city", data.city)
          if (data.state) form.setValue("state", data.state)
          toast.success(`Localização capturada. Raio sugerido: ${suggestedRadius} km.`)
        } catch {
          toast.success(
            `Coordenadas capturadas. Raio sugerido: ${suggestedRadius} km. Preencha o endereço manualmente.`,
          )
        }
      },
      () => {
        toast.error("Não foi possível obter sua localização.")
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    )
  }

  const submit = form.handleSubmit(async (values) => {
    setSaving(true)
    try {
      await apiPatch("/api/users/me", values)
      triggerHaptic("success")
      toast.success("Perfil atualizado com sucesso.")
      qc.invalidateQueries({ queryKey: ["provider", "profile", user?.id] })
      await fetchMe()
    } catch (e) {
      const err = e as { message?: string }
      triggerHaptic("warning")
      toast.error(err?.message ?? "Erro ao atualizar perfil.")
    } finally {
      setSaving(false)
    }
  })

  const completeness = profile
    ? computeProfileCompleteness(profile)
    : { pct: 0, done: 0, total: 9, missing: [] }

  if (profileQuery.isLoading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-12 text-sm">
        <Loader2 className="mr-2 size-5 animate-spin" /> Carregando perfil…
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="text-muted-foreground rounded-2xl border border-dashed p-10 text-center text-sm">
        Não foi possível carregar o perfil.
      </div>
    )
  }

  return (
    <Form {...form}>
      <form onSubmit={submit} className="space-y-4">
        {/* ─── Hero Card Compacto ─── */}
        <div className="overflow-hidden rounded-2xl border shadow-xs">
          {/* Cover */}
          <div className="relative h-28 w-full bg-gradient-to-r from-emerald-600 to-teal-700 sm:h-36">
            {coverUrl && (
              <SafeImage
                src={coverUrl}
                alt="Capa do perfil"
                sizes="(max-width: 640px) 100vw, 640px"
                className="size-full object-cover"
              />
            )}
          </div>

          {/* Identity Strip */}
          <div className="bg-card relative px-4 pt-0 pb-3.5">
            {/* Avatar floating over the cover */}
            <div className="-mt-10 flex items-end gap-3">
              <Avatar className="border-background size-20 border-4 shadow-md">
                {avatarUrl ? <AvatarImage src={avatarUrl} alt={profile.name} /> : null}
                <AvatarFallback className="bg-primary text-primary-foreground text-lg font-bold">
                  {profile.name
                    ?.split(" ")
                    .slice(0, 2)
                    .map((s) => s[0]?.toUpperCase())
                    .join("")}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 pb-0.5">
                <div className="flex items-center gap-2">
                  <h2 className="text-foreground truncate text-base font-bold tracking-tight">
                    {decodeEntities(profile.name)}
                  </h2>
                  {profile.verified && (
                    <BadgeCheck className="size-4.5 shrink-0 text-emerald-600" />
                  )}
                </div>
                <p className="text-muted-foreground text-xs">
                  {profile.city || "Governador Valadares"}, {profile.state || "MG"} ·{" "}
                  {profile.district || "Prestador Severinno"}
                </p>
              </div>
            </div>

            {/* KPIs Strip */}
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
              {profile.avgRating != null && profile.avgRating > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                  <Star className="size-3 fill-amber-500 text-amber-500" />
                  {profile.avgRating.toFixed(1)}
                  <span className="text-muted-foreground font-normal">
                    ({profile.reviewCount ?? 0})
                  </span>
                </span>
              )}
              <span className="text-muted-foreground inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] tabular-nums">
                <Wrench className="size-3" />
                {activeServices.length} serviço{activeServices.length !== 1 ? "s" : ""} ativo
                {activeServices.length !== 1 ? "s" : ""}
              </span>
              {profile.verified && (
                <span className="inline-flex items-center gap-1 rounded-full border-emerald-200 bg-emerald-50/80 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400">
                  <CheckCircle2 className="size-3" /> Verificado
                </span>
              )}
              {lat != null && (
                <span className="text-muted-foreground inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px]">
                  <MapPin className="size-3" /> GPS ativo · {radiusKm} km
                </span>
              )}
            </div>

            {/* Quick Actions */}
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  setReputationCardOpen(true)
                }}
                className="h-7.5 gap-1 rounded-lg border-emerald-500/30 px-2.5 text-[11px] font-semibold text-emerald-700 transition-all hover:bg-emerald-50 active:scale-95 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
              >
                <Share2 className="size-3 text-emerald-600 dark:text-emerald-400" />
                Reputação
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  setPriceEstimatorOpen(true)
                }}
                className="h-7.5 gap-1 rounded-lg border-blue-500/30 px-2.5 text-[11px] font-semibold text-blue-700 transition-all hover:bg-blue-50 active:scale-95 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-950/30"
              >
                <Calculator className="size-3 text-blue-600 dark:text-blue-400" />
                Calculadora
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  if (user?.id) openProvider(user.id)
                }}
                className="border-border/70 hover:bg-muted/60 h-7.5 gap-1 rounded-lg px-2.5 text-[11px] font-semibold transition-all active:scale-95"
              >
                <Eye className="text-primary size-3" />
                Ver Público
              </Button>
              <Button
                type="submit"
                disabled={saving}
                size="sm"
                className="ml-auto h-7.5 gap-1 rounded-lg px-3 text-[11px] font-semibold shadow-xs transition-all active:scale-95"
              >
                {saving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
                Salvar
              </Button>
            </div>
          </div>
        </div>

        {/* ─── Barra de Completude do Perfil ─── */}
        <ProfileCompletenessBar {...completeness} />

        {/* ─── Meus Serviços & Catálogo (Hiperfoco) ─── */}
        <Card className="overflow-hidden rounded-2xl border shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between border-b px-4 py-2.5">
            <div className="min-w-0">
              <CardTitle className="text-sm font-semibold">Meus Serviços</CardTitle>
              <CardDescription className="text-[11px]">
                Serviços exibidos para clientes no catálogo de GV
              </CardDescription>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  navigate("provider.services")
                }}
                className="h-7 gap-1 rounded-lg px-2.5 text-[11px] font-semibold"
              >
                Gerenciar <ArrowRight className="size-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-3.5">
            {servicesQuery.isLoading ? (
              <div className="text-muted-foreground flex items-center justify-center py-4 text-xs">
                <Loader2 className="text-primary mr-2 size-4 animate-spin" /> Carregando serviços…
              </div>
            ) : services.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-5 text-center">
                <div className="flex size-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <Wrench className="size-4.5" />
                </div>
                <div>
                  <p className="text-foreground text-xs font-semibold">Nenhum serviço cadastrado</p>
                  <p className="text-muted-foreground mt-0.5 max-w-xs text-[11px]">
                    Cadastre seus serviços para aparecer no catálogo de GV e receber pedidos.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    triggerHaptic("selection")
                    navigate("provider.services")
                  }}
                  className="mt-1 h-7.5 gap-1 rounded-lg text-xs font-semibold"
                >
                  <Wrench className="size-3" /> Cadastrar serviço
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {services.slice(0, 6).map((svc) => (
                  <div
                    key={svc.id}
                    className="bg-muted/20 hover:bg-muted/40 flex items-center gap-2.5 rounded-xl border px-3 py-2 transition-colors"
                  >
                    <div
                      className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${svc.active ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}
                    >
                      <Wrench className="size-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate text-xs font-semibold">
                        {decodeEntities(svc.title)}
                      </p>
                      <div className="flex items-center gap-1.5">
                        <span className="text-primary text-[11px] font-bold tabular-nums">
                          {formatBRL(svc.basePrice)}
                        </span>
                        {svc.unit && (
                          <span className="text-muted-foreground text-[10px]">/{svc.unit}</span>
                        )}
                        <span
                          className={`ml-auto inline-flex items-center gap-0.5 text-[10px] font-medium ${svc.active ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
                        >
                          {svc.active ? (
                            <>
                              <span className="size-1.5 rounded-full bg-emerald-500" /> Ativo
                            </>
                          ) : (
                            <>
                              <Pause className="size-2.5" /> Pausado
                            </>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {services.length > 6 && (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("selection")
                  navigate("provider.services")
                }}
                className="text-primary hover:text-primary/80 mt-2 w-full text-center text-[11px] font-semibold"
              >
                Ver todos os {services.length} serviços →
              </button>
            )}
          </CardContent>
        </Card>

        {/* ─── 3 Abas Principais ─── */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-3">
          <TabsList className="bg-muted/60 w-full justify-start overflow-x-auto p-1 sm:w-auto">
            <TabsTrigger
              value="identity"
              className="gap-1.5 text-xs"
              onClick={() => triggerHaptic("selection")}
            >
              <User className="size-3.5" /> Identidade & Negócio
            </TabsTrigger>
            <TabsTrigger
              value="coverage"
              className="gap-1.5 text-xs"
              onClick={() => triggerHaptic("selection")}
            >
              <MapPin className="size-3.5" /> Área & GPS
            </TabsTrigger>
            <TabsTrigger
              value="notifications"
              className="gap-1.5 text-xs"
              onClick={() => triggerHaptic("selection")}
            >
              <Bell className="size-3.5" /> Alertas
            </TabsTrigger>
          </TabsList>

          {/* ABA 1: IDENTIDADE & NEGÓCIO */}
          <TabsContent value="identity" className="space-y-3 pt-1">
            {/* Photos */}
            <Card className="rounded-2xl border shadow-xs">
              <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
                <SinglePhoto
                  label="Foto de Perfil (Avatar)"
                  value={avatarUrl}
                  onChange={(url) => form.setValue("avatarUrl", url ?? "", { shouldDirty: true })}
                  aspect="square"
                />
                <SinglePhoto
                  label="Capa de Apresentação"
                  value={coverUrl}
                  onChange={(url) => form.setValue("coverUrl", url ?? "", { shouldDirty: true })}
                  aspect="wide"
                />
              </CardContent>
            </Card>

            {/* Dados Profissionais */}
            <Card className="rounded-2xl border shadow-xs">
              <CardHeader className="border-b px-4 py-2.5">
                <CardTitle className="text-sm font-semibold">Dados Profissionais</CardTitle>
                <CardDescription className="text-[11px]">
                  Informações exibidas publicamente para clientes em Governador Valadares.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3.5 p-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-semibold">
                        Nome Completo ou Nome Fantasia
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Ex.: Carlos Silva — Reparos Elétricos"
                          {...field}
                          className="h-9 rounded-xl text-xs"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <FormLabel className="text-xs font-semibold">E-mail</FormLabel>
                    <Input
                      value={profile.email}
                      disabled
                      className="bg-muted/40 h-9 rounded-xl text-xs"
                    />
                    <p className="text-muted-foreground text-[10px]">
                      O e-mail principal não pode ser alterado.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <FormLabel className="flex items-center gap-1.5 text-xs font-semibold">
                      CPF / CNPJ
                      {profile.verified && (
                        <Badge className="rounded-full bg-emerald-100 px-1.5 py-0 text-[10px] text-emerald-800">
                          Verificado
                        </Badge>
                      )}
                    </FormLabel>
                    <Input
                      value={profile.cpfCnpj ?? ""}
                      disabled
                      className="bg-muted/40 h-9 rounded-xl text-xs"
                    />
                  </div>
                </div>

                <FormField
                  control={form.control}
                  name="bio"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-semibold">
                        Apresentação & Especialidades (Bio)
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          rows={3}
                          maxLength={600}
                          placeholder="Conte aos clientes sobre sua experiência, tempo de profissão e compromisso com qualidade…"
                          {...field}
                          className="resize-none rounded-xl text-xs"
                        />
                      </FormControl>
                      <FormDescription className="text-[11px]">
                        Máximo 600 caracteres.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="whatsapp"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-semibold">
                          WhatsApp para Contato
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder="(33) 99999-9999"
                            inputMode="tel"
                            {...field}
                            className="h-9 rounded-xl text-xs"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-semibold">
                          Telefone Fixo (opcional)
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder="(33) 3271-0000"
                            inputMode="tel"
                            {...field}
                            className="h-9 rounded-xl text-xs"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ABA 2: ÁREA DE ATENDIMENTO & GPS */}
          <TabsContent value="coverage" className="space-y-3 pt-1">
            <Card className="rounded-2xl border shadow-xs">
              <CardHeader className="flex flex-row items-center justify-between border-b px-4 py-2.5">
                <div>
                  <CardTitle className="text-sm font-semibold">Base & Localização</CardTitle>
                  <CardDescription className="text-[11px]">
                    Ponto central para cálculo de proximidade com clientes no mapa de GV.
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={useGPS}
                  className="h-7.5 gap-1 rounded-lg px-2.5 text-[11px] font-medium"
                >
                  <LocateFixed className="text-primary size-3.5" /> GPS Atual
                </Button>
              </CardHeader>

              <CardContent className="grid gap-3.5 p-4">
                <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
                  <FormField
                    control={form.control}
                    name="cep"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-semibold">CEP</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="35010-000"
                            inputMode="numeric"
                            {...field}
                            className="h-9 rounded-xl text-xs"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="street"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-semibold">Rua / Avenida</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Ex.: Rua Israel Pinheiro"
                            {...field}
                            className="h-9 rounded-xl text-xs"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <FormField
                    control={form.control}
                    name="number"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-semibold">Número</FormLabel>
                        <FormControl>
                          <Input placeholder="123" {...field} className="h-9 rounded-xl text-xs" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="complement"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel className="text-xs font-semibold">Complemento</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Apto, Sala, Bloco…"
                            {...field}
                            className="h-9 rounded-xl text-xs"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <FormField
                    control={form.control}
                    name="district"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-semibold">Bairro</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Ex.: Centro"
                            {...field}
                            className="h-9 rounded-xl text-xs"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="city"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-semibold">Cidade</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Governador Valadares"
                            {...field}
                            className="h-9 rounded-xl text-xs"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="state"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-semibold">UF</FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="h-9 rounded-xl text-xs">
                              <SelectValue placeholder="Estado" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent className="rounded-xl">
                            {UF_OPTIONS.map((uf) => (
                              <SelectItem key={uf} value={uf}>
                                {uf}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Slider Interativo de Raio em GV */}
                <div className="bg-muted/15 space-y-2.5 rounded-xl border px-3.5 py-3">
                  <FormField
                    control={form.control}
                    name="radiusKm"
                    render={({ field }) => (
                      <FormItem className="space-y-2">
                        <div className="flex items-center justify-between">
                          <FormLabel className="flex items-center gap-1.5 text-xs font-semibold">
                            <Navigation className="size-3.5 text-emerald-600" />
                            Raio de Atendimento:
                          </FormLabel>
                          <Badge
                            variant="outline"
                            className="border-emerald-300 px-2 py-0 text-xs font-bold text-emerald-700 tabular-nums dark:text-emerald-300"
                          >
                            {(field.value ?? 15).toFixed(0)} km
                          </Badge>
                        </div>
                        <FormControl>
                          <Slider
                            min={1}
                            max={100}
                            step={1}
                            value={[field.value ?? 15]}
                            onValueChange={(v) => field.onChange(v[0])}
                            className="py-1.5"
                          />
                        </FormControl>
                        <div className="bg-background/80 flex items-start gap-2 rounded-lg border p-2 text-[11px]">
                          <Sparkles className="text-primary mt-0.5 size-3.5 shrink-0" />
                          <p className="text-muted-foreground leading-relaxed">
                            <strong className="text-foreground font-semibold">Cobertura:</strong>{" "}
                            {getGVCoverageDescription(radiusKm)}
                          </p>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {lat != null && lng != null && (
                  <p className="text-muted-foreground text-[10px] tabular-nums">
                    Coordenadas GPS ativas: {lat.toFixed(5)}, {lng.toFixed(5)}
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ABA 3: NOTIFICAÇÕES & EXPERIÊNCIA */}
          <TabsContent value="notifications" className="space-y-3 pt-1">
            <PushNotificationCard />

            {/* Sound preference */}
            <Card className="bg-card rounded-2xl border shadow-xs">
              <CardContent className="p-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-start gap-2.5">
                    <div className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-xl">
                      <Volume2 className="size-4" />
                    </div>
                    <div>
                      <p className="text-foreground text-sm font-semibold">Sons do painel</p>
                      <p className="text-muted-foreground text-[11px]">
                        Toque um som quando novas transações ou confirmações chegarem.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        playCoinSound()
                        setTimeout(playCompletionSound, 300)
                        setTimeout(playReviewSound, 750)
                      }}
                      className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-7 items-center justify-center rounded-full border transition"
                      title="Prévia dos sons (moeda → sino → estrela)"
                      aria-label="Ouvir prévia dos sons do painel"
                    >
                      <Play className="size-3" />
                    </button>
                    <Switch
                      checked={soundEnabled}
                      onCheckedChange={(v) => {
                        setSoundEnabled(v)
                        apiPatch("/api/users/me", { soundEnabled: v })
                          .then(() => {
                            qc.invalidateQueries({ queryKey: ["provider", "profile", user?.id] })
                          })
                          .catch(() => {
                            setSoundEnabled(!v)
                          })
                      }}
                      aria-label="Ativar sons do painel"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Vibration preference */}
            <Card className="bg-card rounded-2xl border shadow-xs">
              <CardContent className="p-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-start gap-2.5">
                    <div className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-xl">
                      <Smartphone className="size-4" />
                    </div>
                    <div>
                      <p className="text-foreground text-sm font-semibold">Vibração</p>
                      <p className="text-muted-foreground text-[11px]">
                        Vibração sutil em dispositivos móveis quando notificações chegarem.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        tryVibrate([30, 50, 30, 50, 30])
                      }}
                      className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-7 items-center justify-center rounded-full border transition"
                      title="Prévia da vibração"
                      aria-label="Ouvir prévia da vibração"
                    >
                      <Play className="size-3" />
                    </button>
                    <Switch
                      checked={vibrateEnabled}
                      onCheckedChange={(v) => {
                        setVibrateEnabled(v)
                        apiPatch("/api/users/me", { vibrateEnabled: v })
                          .then(() => {
                            qc.invalidateQueries({ queryKey: ["provider", "profile", user?.id] })
                          })
                          .catch(() => {
                            setVibrateEnabled(!v)
                          })
                      }}
                      aria-label="Ativar vibração"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Botão de Salvar no Rodapé */}
        <div className="flex justify-end pt-1">
          <Button
            type="submit"
            disabled={saving}
            className="h-9 gap-1.5 rounded-xl px-5 text-xs font-semibold shadow-xs transition-all active:scale-95"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Salvar alterações
          </Button>
        </div>
      </form>

      {/* Modais de Reputação & Precificação */}
      {profile && (
        <>
          <ProviderSocialReputationCard
            open={reputationCardOpen}
            onOpenChange={setReputationCardOpen}
            provider={{
              id: profile.id,
              name: profile.name,
              avatarUrl: profile.avatarUrl,
              bio: profile.bio,
              city: profile.city || "Governador Valadares, MG",
              verified: profile.verified,
            }}
          />
          <ProviderPriceEstimatorDialog
            open={priceEstimatorOpen}
            onOpenChange={setPriceEstimatorOpen}
          />
        </>
      )}
    </Form>
  )
}

export default ProviderProfile
