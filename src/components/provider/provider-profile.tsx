"use client"

import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useForm, useWatch, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import {
  BadgeCheck,
  Bell,
  Calculator,
  Eye,
  ImagePlus,
  Loader2,
  LocateFixed,
  MapPin,
  Navigation,
  Play,
  Save,
  Share2,
  Smartphone,
  Sparkles,
  User,
  Volume2,
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
      <label className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {label}
      </label>
      <div
        className={
          aspect === "square"
            ? "bg-muted/40 relative size-24 overflow-hidden rounded-2xl border shadow-2xs"
            : "bg-muted/40 relative h-32 w-full overflow-hidden rounded-2xl border shadow-2xs"
        }
      >
        {value ? (
          <SafeImage
            src={value}
            alt={label}
            sizes={aspect === "square" ? "96px" : "640px"}
            className="size-full object-cover"
          />
        ) : (
          <div className="text-muted-foreground flex size-full items-center justify-center">
            <ImagePlus className="size-6 opacity-60" />
          </div>
        )}
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute top-1.5 right-1.5 inline-flex size-6 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
            aria-label="Remover imagem"
          >
            <X className="size-3.5" />
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
        className="h-8 gap-1.5 rounded-xl text-xs font-medium"
      >
        {uploading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <ImagePlus className="size-3.5" />
        )}
        {value ? "Trocar imagem" : "Selecionar foto"}
      </Button>
      {max > 1 && <p className="text-muted-foreground text-[10px]">Aceita até {max} imagens.</p>}
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
    }
  }>({
    queryKey: ["provider", "profile", user?.id],
    queryFn: async () => apiGet("/api/users/me"),
    enabled: !!user,
  })

  const profile = profileQuery.data?.user

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
      toast.success("Perfil atualizado com sucesso.")
      qc.invalidateQueries({ queryKey: ["provider", "profile", user?.id] })
      await fetchMe()
    } catch (e) {
      const err = e as { message?: string }
      toast.error(err?.message ?? "Erro ao atualizar perfil.")
    } finally {
      setSaving(false)
    }
  })

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
      <form onSubmit={submit} className="space-y-6">
        {/* Top Header com Botão de Salvar Rápido */}
        <div className="flex flex-col gap-2 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-foreground text-xl font-bold tracking-tight">
                Perfil & Configurações
              </h2>
              {profile.verified && (
                <Badge className="inline-flex items-center gap-1 rounded-full border-emerald-300 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                  <BadgeCheck className="size-3.5 text-emerald-600" /> Prestador Verificado
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground text-xs">
              Configure sua apresentação pública, endereço base em Governador Valadares e raio GPS.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                triggerHaptic("selection")
                setReputationCardOpen(true)
              }}
              className="h-9 gap-1.5 rounded-xl border-emerald-500/30 text-xs font-semibold text-emerald-700 transition-all hover:bg-emerald-50 active:scale-95 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
              title="Compartilhar selo de confiança e avaliações no WhatsApp"
            >
              <Share2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              Cartão de Reputação
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                triggerHaptic("selection")
                setPriceEstimatorOpen(true)
              }}
              className="h-9 gap-1.5 rounded-xl border-blue-500/30 text-xs font-semibold text-blue-700 transition-all hover:bg-blue-50 active:scale-95 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-950/30"
              title="Calculadora expressa de mão de obra e deslocamento em GV"
            >
              <Calculator className="size-3.5 text-blue-600 dark:text-blue-400" />
              Calculadora de Preço
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                triggerHaptic("selection")
                if (user?.id) openProvider(user.id)
              }}
              className="border-border/70 hover:bg-muted/60 h-9 gap-1.5 rounded-xl text-xs font-semibold transition-all active:scale-95"
            >
              <Eye className="text-primary size-3.5" />
              Ver Perfil Público
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="h-9 gap-1.5 rounded-xl px-4 text-xs font-semibold shadow-xs transition-all active:scale-95"
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              Salvar Alterações
            </Button>
          </div>
        </div>

        {/* 3 Abas Principais (Nielsen #6: Reconhecimento em vez de memorização) */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="bg-muted/60 w-full justify-start overflow-x-auto p-1 sm:w-auto">
            <TabsTrigger value="identity" className="gap-1.5 text-xs">
              <User className="size-3.5" /> Identidade & Negócio
            </TabsTrigger>
            <TabsTrigger value="coverage" className="gap-1.5 text-xs">
              <MapPin className="size-3.5" /> Área de Atendimento & GPS
            </TabsTrigger>
            <TabsTrigger value="notifications" className="gap-1.5 text-xs">
              <Bell className="size-3.5" /> Notificações & Alertas
            </TabsTrigger>
          </TabsList>

          {/* ABA 1: IDENTIDADE & NEGÓCIO */}
          <TabsContent value="identity" className="space-y-4 pt-1">
            {/* Cover + Avatar Hero */}
            <Card className="overflow-hidden rounded-2xl border shadow-xs">
              <CardContent className="space-y-6 p-4">
                <div className="relative h-36 w-full overflow-hidden rounded-xl bg-gradient-to-r from-emerald-600 to-teal-700 shadow-xs sm:h-44">
                  {coverUrl && (
                    <SafeImage
                      src={coverUrl}
                      alt="Capa do perfil"
                      sizes="(max-width: 640px) 100vw, 640px"
                      className="size-full object-cover"
                    />
                  )}
                  <div className="absolute -bottom-8 left-4 flex items-end gap-3.5">
                    <Avatar className="border-background size-20 border-4 shadow-md sm:size-24">
                      {avatarUrl ? <AvatarImage src={avatarUrl} alt={profile.name} /> : null}
                      <AvatarFallback className="bg-primary text-primary-foreground text-xl font-bold">
                        {profile.name
                          ?.split(" ")
                          .slice(0, 2)
                          .map((s) => s[0]?.toUpperCase())
                          .join("")}
                      </AvatarFallback>
                    </Avatar>
                    <div className="mb-2">
                      <p className="text-base font-bold text-white drop-shadow-md">
                        {profile.name}
                      </p>
                      <p className="text-xs text-white/90 drop-shadow">Prestador Severinno</p>
                    </div>
                  </div>
                </div>

                <div className="mt-8 grid gap-4 border-t pt-2 sm:grid-cols-2">
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
                </div>
              </CardContent>
            </Card>

            {/* Informações Básicas & Contato */}
            <Card className="rounded-2xl border shadow-xs">
              <CardHeader className="border-b px-5 py-3.5">
                <CardTitle className="text-sm font-semibold">Dados Profissionais</CardTitle>
                <CardDescription className="text-xs">
                  Informações exibidas publicamente na vitrine para clientes em Governador
                  Valadares.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 p-5">
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
                    <FormLabel className="text-xs font-semibold">E-mail Cadastrado</FormLabel>
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
                    <p className="text-muted-foreground text-[10px]">
                      Documento autenticado no ecossistema.
                    </p>
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
                          rows={4}
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
          <TabsContent value="coverage" className="space-y-4 pt-1">
            <Card className="rounded-2xl border shadow-xs">
              <CardHeader className="flex flex-row items-center justify-between border-b px-5 py-3.5">
                <div>
                  <CardTitle className="text-sm font-semibold">
                    Base de Atendimento & Localização
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Define o ponto central para o cálculo de proximidade com clientes no mapa de GV.
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={useGPS}
                  className="h-8 gap-1.5 rounded-xl text-xs font-medium"
                >
                  <LocateFixed className="text-primary size-3.5" /> Usar GPS Atual
                </Button>
              </CardHeader>

              <CardContent className="grid gap-4 p-5">
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
                <div className="bg-muted/20 space-y-3 rounded-2xl border p-4">
                  <FormField
                    control={form.control}
                    name="radiusKm"
                    render={({ field }) => (
                      <FormItem className="space-y-2">
                        <div className="flex items-center justify-between">
                          <FormLabel className="flex items-center gap-2 text-xs font-semibold">
                            <Navigation className="size-4 text-emerald-600" />
                            <span>Raio de Atendimento em GV:</span>
                          </FormLabel>
                          <Badge
                            variant="outline"
                            className="border-emerald-300 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-300"
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
                            className="py-2"
                          />
                        </FormControl>
                        <div className="bg-background/80 flex items-start gap-2 rounded-xl border p-2.5 text-xs">
                          <Sparkles className="text-primary mt-0.5 size-4 shrink-0" />
                          <p className="text-muted-foreground leading-relaxed">
                            <strong className="text-foreground font-semibold">
                              Estimativa de Cobertura:
                            </strong>{" "}
                            {getGVCoverageDescription(radiusKm)}
                          </p>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {lat != null && lng != null && (
                  <p className="text-muted-foreground text-[11px] tabular-nums">
                    Coordenadas GPS ativas: {lat.toFixed(5)}, {lng.toFixed(5)}
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ABA 3: NOTIFICAÇÕES & EXPERIÊNCIA */}
          <TabsContent value="notifications" className="space-y-4 pt-1">
            <PushNotificationCard />

            {/* Sound preference */}
            <Card className="bg-card rounded-2xl border shadow-xs">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-start gap-3">
                    <div className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-xl">
                      <Volume2 className="size-4.5" />
                    </div>
                    <div>
                      <p className="text-foreground text-sm font-semibold">Sons do painel</p>
                      <p className="text-muted-foreground text-xs">
                        Toque um som quando novas transações ou confirmações chegarem.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        playCoinSound()
                        setTimeout(playCompletionSound, 300)
                        setTimeout(playReviewSound, 750)
                      }}
                      className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-8 items-center justify-center rounded-full border transition"
                      title="Prévia dos sons (moeda → sino → estrela)"
                      aria-label="Ouvir prévia dos sons do painel"
                    >
                      <Play className="size-3.5" />
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
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-start gap-3">
                    <div className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-xl">
                      <Smartphone className="size-4.5" />
                    </div>
                    <div>
                      <p className="text-foreground text-sm font-semibold">Vibração</p>
                      <p className="text-muted-foreground text-xs">
                        Vibração sutil em dispositivos móveis quando notificações chegarem.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        tryVibrate([30, 50, 30, 50, 30])
                      }}
                      className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-8 items-center justify-center rounded-full border transition"
                      title="Prévia da vibração"
                      aria-label="Ouvir prévia da vibração"
                    >
                      <Play className="size-3.5" />
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
        <div className="flex justify-end pt-2">
          <Button
            type="submit"
            disabled={saving}
            className="h-10 gap-1.5 rounded-xl px-6 text-xs font-semibold shadow-xs"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
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
