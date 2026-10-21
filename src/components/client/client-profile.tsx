"use client"

/**
 * ClientProfile — Redesigned ultra-compact client profile view + edit form.
 *
 *  - Compact Signature Hero Banner with navigation shortcuts & haptic feedback
 *  - 3 Ultra-compact Bento StatCards (~68px) eliminating awkward whitespace
 *  - Modern filter & viewMode toolbar (Lista / Grade) with instant search and clear "X"
 *  - List View: Clean, horizontal and linear service design flow
 *  - Grid View: Balanced 12-column responsive Bento grid
 *  - Real-time profile completeness meter (percentage & criteria checklist)
 *  - Read-only official identity card with anti-fraud shield advisory
 *  - Quick security shortcut to client.security (password & 2FA)
 *  - Structured contact, bio, and GeoAddressForm integration
 *  - Push notification, sound preview & haptics sensory settings
 *  - Dirty-state tracking with clear sticky save/discard action bar
 */

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BadgeCheck,
  Building2,
  Calendar,
  Camera,
  CheckCircle2,
  Circle,
  IdCard,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  LayoutList,
  Loader2,
  Lock,
  Mail,
  MapPin,
  Play,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  User as UserIcon,
  Volume2,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { apiGet, apiPatch } from "@/lib/api"
import { triggerHaptic } from "@/lib/haptics"
import { playCoinSound, playCompletionSound, playReviewSound, tryVibrate } from "@/lib/sounds"
import { ROLE_LABELS, type UserRole } from "@/lib/constants"
import { useAuthStore } from "@/store/auth"
import { useViewStore } from "@/store/view"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Switch } from "@/components/ui/switch"
import { Progress } from "@/components/ui/progress"
import { GeoAddressForm, type AddressFormValue } from "@/components/forms/geo-address-form"
import { PushNotificationCard } from "@/components/shared/push-notification-card"
import { StatCard } from "@/components/shared/dashboard-shell"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MeResponse = {
  user: {
    id: string
    email: string
    name: string
    role: UserRole
    cpfCnpj?: string | null
    whatsapp?: string | null
    phone?: string | null
    avatarUrl?: string | null
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
    verified?: boolean
    soundEnabled?: boolean
    vibrateEnabled?: boolean
    createdAt?: string | null
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClientProfile() {
  const qc = useQueryClient()
  const setUser = useAuthStore((s) => s.setUser)
  const authUser = useAuthStore((s) => s.user)
  const navigate = useViewStore((s) => s.navigate)

  const meQuery = useQuery<MeResponse>({
    queryKey: ["users", "me"],
    queryFn: () => apiGet<MeResponse>("/api/users/me"),
  })

  const [viewMode, setViewMode] = React.useState<"list" | "grid">("list")
  const [filterText, setFilterText] = React.useState("")

  const [name, setName] = React.useState("")
  const [whatsapp, setWhatsapp] = React.useState("")
  const [phone, setPhone] = React.useState("")
  const [bio, setBio] = React.useState("")
  const [avatarUrl, setAvatarUrl] = React.useState("")
  const [address, setAddress] = React.useState<AddressFormValue>({
    cep: "",
    street: "",
    number: "",
    complement: "",
    district: "",
    city: "",
    state: "",
    lat: null,
    lng: null,
  })
  const [soundEnabled, setSoundEnabled] = React.useState(true)
  const [vibrateEnabled, setVibrateEnabled] = React.useState(true)
  const [uploadingAvatar, setUploadingAvatar] = React.useState(false)

  // Dirty state tracking
  const [isDirty, setIsDirty] = React.useState(false)
  const dirtyRef = React.useRef(false)

  const markDirty = React.useCallback(() => {
    dirtyRef.current = true
    setIsDirty(true)
  }, [])

  // Populate the form once data arrives
  React.useEffect(() => {
    if (meQuery.data?.user && !dirtyRef.current) {
      const u = meQuery.data.user
      setName(u.name ?? "")
      setWhatsapp(u.whatsapp ?? "")
      setPhone(u.phone ?? "")
      setBio(u.bio ?? "")
      setAvatarUrl(u.avatarUrl ?? "")
      setSoundEnabled(u.soundEnabled ?? true)
      setVibrateEnabled(u.vibrateEnabled ?? true)
      setAddress((prev) => ({
        cep: u.cep ?? prev.cep,
        street: u.street ?? prev.street,
        number: u.number ?? prev.number,
        complement: u.complement ?? prev.complement,
        district: u.district ?? prev.district,
        city: u.city ?? prev.city,
        state: u.state ?? prev.state,
        lat: u.lat ?? prev.lat,
        lng: u.lng ?? prev.lng,
      }))
    }
  }, [meQuery.data])

  const saveMutation = useMutation({
    mutationFn: () =>
      apiPatch<MeResponse>("/api/users/me", {
        name,
        whatsapp,
        phone,
        bio,
        avatarUrl,
        soundEnabled,
        vibrateEnabled,
        cep: address.cep,
        street: address.street,
        number: address.number,
        complement: address.complement,
        district: address.district,
        city: address.city,
        state: address.state,
        lat: address.lat,
        lng: address.lng,
      }),
    onSuccess: (data) => {
      triggerHaptic("success")
      toast.success("Perfil atualizado com sucesso!")
      dirtyRef.current = false
      setIsDirty(false)
      qc.invalidateQueries({ queryKey: ["users", "me"] })
      if (authUser && data.user) {
        setUser({
          ...authUser,
          name: data.user.name,
          avatarUrl: data.user.avatarUrl ?? null,
        })
      }
    },
    onError: (e: { message?: string }) => {
      triggerHaptic("error")
      toast.error(e?.message || "Não foi possível salvar o perfil.")
    },
  })

  const handleAvatarUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Apenas imagens são permitidas.")
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Imagem muito grande (máx 8MB).")
      return
    }
    setUploadingAvatar(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
        credentials: "same-origin",
      })
      const data = await res.json()
      if (!res.ok || !data?.url) {
        throw new Error(data?.error || "Falha no upload")
      }
      setAvatarUrl(data.url as string)
      markDirty()
      triggerHaptic("success")
      toast.success("Foto atualizada! Lembre-se de salvar as alterações.")
    } catch (e) {
      triggerHaptic("error")
      toast.error(e instanceof Error ? e.message : "Falha ao enviar imagem.")
    } finally {
      setUploadingAvatar(false)
    }
  }

  const handleDiscard = () => {
    if (meQuery.data?.user) {
      const uu = meQuery.data.user
      setName(uu.name ?? "")
      setWhatsapp(uu.whatsapp ?? "")
      setPhone(uu.phone ?? "")
      setBio(uu.bio ?? "")
      setAvatarUrl(uu.avatarUrl ?? "")
      setAddress({
        cep: uu.cep ?? "",
        street: uu.street ?? "",
        number: uu.number ?? "",
        complement: uu.complement ?? "",
        district: uu.district ?? "",
        city: uu.city ?? "",
        state: uu.state ?? "",
        lat: uu.lat ?? null,
        lng: uu.lng ?? null,
      })
      dirtyRef.current = false
      setIsDirty(false)
      triggerHaptic("selection")
      toast.info("Alterações descartadas.")
    }
  }

  const u = meQuery.data?.user

  const initials = (name || u?.name || "")
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()

  const uCreatedAt = u?.createdAt
  const uAvatarUrl = u?.avatarUrl

  const memberSince = React.useMemo(() => {
    if (!uCreatedAt) return null
    try {
      const d = new Date(uCreatedAt)
      return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
    } catch {
      return null
    }
  }, [uCreatedAt])

  // Profile Completeness Calculation
  const completenessItems = React.useMemo(() => {
    return [
      {
        id: "photo",
        label: "Foto de perfil",
        completed: Boolean(avatarUrl || uAvatarUrl),
        weight: 20,
      },
      {
        id: "name",
        label: "Nome completo",
        completed: Boolean(name.trim().length >= 3),
        weight: 20,
      },
      {
        id: "whatsapp",
        label: "WhatsApp de contato",
        completed: Boolean(whatsapp.trim().length >= 10),
        weight: 20,
      },
      {
        id: "address",
        label: "Endereço cadastrado",
        completed: Boolean(address.cep && address.street),
        weight: 25,
      },
      {
        id: "bio",
        label: "Bio / Apresentação",
        completed: Boolean(bio.trim().length >= 10),
        weight: 15,
      },
    ]
  }, [avatarUrl, uAvatarUrl, name, whatsapp, address.cep, address.street, bio])

  const completenessScore = React.useMemo(() => {
    return completenessItems.reduce((acc, item) => acc + (item.completed ? item.weight : 0), 0)
  }, [completenessItems])

  // Filter sections
  const normFilter = filterText.toLowerCase().trim()
  const matchesIdentity =
    !normFilter ||
    "identidade foto perfil avatar completude checklist".includes(normFilter) ||
    (name || u?.name || "").toLowerCase().includes(normFilter) ||
    (u?.email || "").toLowerCase().includes(normFilter)
  const matchesContact =
    !normFilter ||
    "dados pessoais contato whatsapp telefone bio apresentacao".includes(normFilter) ||
    (name || "").toLowerCase().includes(normFilter) ||
    whatsapp.toLowerCase().includes(normFilter) ||
    phone.toLowerCase().includes(normFilter) ||
    bio.toLowerCase().includes(normFilter)
  const matchesAddress =
    !normFilter ||
    "endereco localizacao residencial cep rua bairro numero cidade estado gps".includes(
      normFilter,
    ) ||
    (address.street || "").toLowerCase().includes(normFilter) ||
    (address.city || "").toLowerCase().includes(normFilter) ||
    (address.district || "").toLowerCase().includes(normFilter) ||
    (address.cep || "").includes(normFilter)
  const matchesOfficial =
    !normFilter ||
    "dados cadastrais oficiais email cpf documento antifraude compliance".includes(normFilter) ||
    (u?.email || "").toLowerCase().includes(normFilter) ||
    (u?.cpfCnpj || "").includes(normFilter)
  const matchesSecurity =
    !normFilter || "seguranca autenticacao senha 2fa totp central".includes(normFilter)
  const matchesPreferences =
    !normFilter ||
    "preferencias sistema feedback notificacoes push sons vibracao tátil".includes(normFilter)

  const hasAnyMatch =
    matchesIdentity ||
    matchesContact ||
    matchesAddress ||
    matchesOfficial ||
    matchesSecurity ||
    matchesPreferences

  // -------------------------------------------------------------------------
  // Render Sub-components
  // -------------------------------------------------------------------------

  /** Visual Identity Card: Avatar, Name, Email, Checklist */
  const renderIdentityCard = (isListLayout = false) => (
    <Card className="border-border/70 overflow-hidden rounded-xl border shadow-2xs">
      <div className="from-primary/10 via-primary/5 h-14 w-full bg-gradient-to-r to-transparent" />
      <CardContent className="-mt-8 space-y-3.5 px-4 pb-4 sm:px-5 sm:pb-5">
        <div
          className={`flex ${isListLayout ? "flex-col sm:flex-row sm:items-center sm:justify-between" : "flex-col items-center text-center"} gap-3`}
        >
          <div
            className={`flex ${isListLayout ? "items-center gap-3.5" : "flex-col items-center text-center"}`}
          >
            <div className="relative shrink-0">
              <Avatar
                className={`ring-background rounded-full shadow-md ring-4 ${isListLayout ? "size-16 sm:size-18" : "size-20"}`}
              >
                {avatarUrl || uAvatarUrl ? (
                  <AvatarImage
                    src={avatarUrl || uAvatarUrl || ""}
                    alt={name || u?.name}
                    className="rounded-full"
                  />
                ) : null}
                <AvatarFallback className="bg-primary text-primary-foreground rounded-full text-xl font-bold">
                  {initials || "U"}
                </AvatarFallback>
              </Avatar>

              <label
                className="bg-card text-foreground hover:bg-accent absolute -right-1 -bottom-1 flex size-7 cursor-pointer items-center justify-center rounded-full border shadow-md transition-all hover:scale-105"
                title="Alterar foto de perfil"
                aria-label="Alterar foto de perfil"
              >
                {uploadingAvatar ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Camera className="text-primary size-3.5" />
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleAvatarUpload(f)
                    e.target.value = ""
                  }}
                  disabled={uploadingAvatar}
                />
              </label>
            </div>

            <div className={isListLayout ? "space-y-0.5 text-left" : "mt-2 space-y-0.5"}>
              <h2 className="text-foreground text-sm font-bold sm:text-base">{name || u?.name}</h2>
              <p className="text-muted-foreground text-xs">{u?.email}</p>
              <div
                className={`mt-1.5 flex flex-wrap items-center gap-1.5 ${isListLayout ? "justify-start" : "justify-center"}`}
              >
                <Badge variant="secondary" className="text-[10px] font-medium">
                  {ROLE_LABELS[u?.role || "CLIENT"] || "Cliente"}
                </Badge>
                {u?.verified ? (
                  <Badge
                    variant="outline"
                    className="gap-1 border-emerald-500/30 text-[10px] text-emerald-600 dark:text-emerald-400"
                  >
                    <BadgeCheck className="size-3" />
                    Verificado
                  </Badge>
                ) : null}
              </div>

              {memberSince ? (
                <p
                  className={`text-muted-foreground mt-1 flex items-center gap-1 text-[11px] ${isListLayout ? "justify-start" : "justify-center"}`}
                >
                  <Calendar className="size-3" />
                  Membro desde {memberSince}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {/* Completeness Checklist */}
        <div className="border-border/60 bg-muted/20 space-y-2 rounded-lg border p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-foreground font-semibold">Completude do Perfil</span>
            <span className="text-primary font-bold">{completenessScore}%</span>
          </div>
          <Progress
            value={completenessScore}
            className="h-1.5"
            aria-label="Barra de progresso dos itens cadastrais"
          />

          <div
            className={`pt-1 text-[11px] ${isListLayout ? "grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3" : "space-y-1.5"}`}
          >
            {completenessItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-1.5">
                <span
                  className={`flex items-center gap-1.5 truncate ${
                    item.completed ? "text-foreground font-medium" : "text-muted-foreground"
                  }`}
                >
                  {item.completed ? (
                    <CheckCircle2 className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Circle className="text-muted-foreground/60 size-3 shrink-0" />
                  )}
                  <span className="truncate">{item.label}</span>
                </span>
                <span className="text-muted-foreground shrink-0 text-[10px]">+{item.weight}%</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )

  /** Official Registered Data Card (Anti-Fraud) */
  const renderOfficialDataCard = () => (
    <Card className="border-border/70 rounded-xl border shadow-2xs">
      <CardHeader className="p-3.5 pb-2 sm:p-4 sm:pb-2">
        <div className="flex items-center gap-2">
          <div className="bg-primary/10 text-primary rounded-lg p-1.5">
            <Lock className="size-3.5" />
          </div>
          <div>
            <h2 className="text-foreground text-xs font-semibold sm:text-sm">
              Dados Cadastrais Oficiais
            </h2>
            <CardDescription className="text-[11px]">
              Informações de validação primária da conta
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5 p-3.5 pt-0 sm:p-4 sm:pt-0">
        <div className="divide-border/40 divide-y text-xs">
          <div className="flex items-center justify-between py-1.5">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Mail className="size-3.5" />
              E-mail principal
            </span>
            <span className="text-foreground max-w-[180px] truncate font-medium">{u?.email}</span>
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <UserIcon className="size-3.5" />
              Tipo de perfil
            </span>
            <span className="text-foreground font-medium">
              {ROLE_LABELS[u?.role || "CLIENT"] || "Cliente"}
            </span>
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <IdCard className="size-3.5" />
              CPF / Documento
            </span>
            <span className="text-foreground font-mono font-medium">
              {u?.cpfCnpj || "Não informado"}
            </span>
          </div>
        </div>

        <div className="border-border/60 bg-muted/30 flex items-start gap-2 rounded-lg border p-2.5">
          <ShieldCheck className="text-primary mt-0.5 size-3.5 shrink-0" />
          <p className="text-muted-foreground text-[10.5px] leading-relaxed">
            E-mail, CPF/CNPJ e tipo de perfil são protegidos contra alterações diretas para
            prevenção de fraudes e compliance fiscal. Em caso de divergência, contate o suporte.
          </p>
        </div>
      </CardContent>
    </Card>
  )

  /** Quick Security Navigation Card */
  const renderSecurityCard = () => (
    <Card className="border-border/70 from-card to-primary/5 rounded-xl border bg-gradient-to-br shadow-2xs">
      <CardContent className="p-3.5 sm:p-4">
        <div className="flex items-start gap-3">
          <div className="bg-primary/10 text-primary shrink-0 rounded-lg p-2">
            <KeyRound className="size-4" />
          </div>
          <div className="space-y-1">
            <h2 className="text-foreground text-xs font-semibold sm:text-sm">
              Segurança & Autenticação
            </h2>
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              Altere sua senha de acesso e configure o 2FA (TOTP) na Central de Segurança.
            </p>
            <div className="pt-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  navigate("client.security")
                }}
                className="h-8 gap-1.5 rounded-xl text-xs font-medium transition-all active:scale-95"
              >
                <ShieldCheck className="size-3.5" />
                Gerenciar Segurança
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )

  /** Contact Information Form */
  const renderContactCard = () => (
    <Card className="border-border/70 rounded-xl border shadow-2xs">
      <CardHeader className="p-3.5 pb-2 sm:p-4 sm:pb-2">
        <div className="flex items-center gap-2">
          <div className="bg-primary/10 text-primary rounded-lg p-1.5">
            <UserIcon className="size-3.5" />
          </div>
          <div>
            <h2 className="text-foreground text-xs font-semibold sm:text-sm">
              Dados Pessoais & Contato
            </h2>
            <CardDescription className="text-[11px]">
              Informações visíveis aos prestadores durante a negociação e atendimento
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3.5 p-3.5 sm:p-4 sm:pt-2">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="profile-name" className="text-xs font-medium">
              Nome completo <span className="text-rose-500">*</span>
            </Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                markDirty()
              }}
              placeholder="Seu nome completo"
              maxLength={120}
              required
              className="h-8.5 text-xs"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="profile-whatsapp" className="text-xs font-medium">
              WhatsApp <span className="text-rose-500">*</span>
            </Label>
            <Input
              id="profile-whatsapp"
              inputMode="tel"
              value={whatsapp}
              onChange={(e) => {
                setWhatsapp(e.target.value)
                markDirty()
              }}
              placeholder="(11) 98888-7777"
              maxLength={20}
              className="h-8.5 text-xs"
            />
            <p className="text-muted-foreground text-[10.5px]">
              Com DDD. Utilizado para avisos do serviço e orçamentos.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="profile-phone" className="text-xs font-medium">
              Telefone alternativo (opcional)
            </Label>
            <Input
              id="profile-phone"
              inputMode="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value)
                markDirty()
              }}
              placeholder="(11) 3000-0000"
              maxLength={20}
              className="h-8.5 text-xs"
            />
            <p className="text-muted-foreground text-[10.5px]">Telefone fixo ou para recados.</p>
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label htmlFor="profile-bio" className="text-xs font-medium">
              Apresentação pessoal (Bio)
            </Label>
            <span className="text-muted-foreground text-[11px] tabular-nums">{bio.length}/600</span>
          </div>
          <Textarea
            id="profile-bio"
            value={bio}
            onChange={(e) => {
              setBio(e.target.value)
              markDirty()
            }}
            rows={2.5}
            maxLength={600}
            placeholder="Ex.: Morador de Governador Valadares, busco serviços de manutenção predial e elétrica para minha residência..."
            className="text-xs"
          />
          <p className="text-muted-foreground text-[10.5px]">
            Conte um pouco sobre suas necessidades habituais para que os prestadores conheçam seu
            perfil de contratação.
          </p>
        </div>
      </CardContent>
    </Card>
  )

  /** Address & Geolocation Card */
  const renderAddressCard = () => (
    <Card className="border-border/70 rounded-xl border shadow-2xs">
      <CardHeader className="p-3.5 pb-2 sm:p-4 sm:pb-2">
        <div className="flex items-center gap-2">
          <div className="bg-primary/10 text-primary rounded-lg p-1.5">
            <Building2 className="size-3.5" />
          </div>
          <div>
            <h2 className="text-foreground text-xs font-semibold sm:text-sm">
              Endereço & Localização Residencial
            </h2>
            <CardDescription className="text-[11px]">
              Utilizado pelo algoritmo de geolocalização para calcular distância e raio de
              atendimento
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3.5 p-3.5 sm:p-4 sm:pt-2">
        <div className="border-border/60 bg-muted/20 flex items-center justify-between rounded-lg border p-2.5">
          <div className="flex items-center gap-2 text-xs">
            <MapPin className="text-primary size-3.5 shrink-0" />
            <div>
              <p className="text-foreground text-xs font-medium">Georreferenciamento Ativo</p>
              <p className="text-muted-foreground text-[11px]">
                {address.city ? `${address.city} - ${address.state}` : "Governador Valadares, MG"}
              </p>
            </div>
          </div>
          <Badge variant="outline" className="text-primary border-primary/30 text-[10px]">
            GPS Preciso
          </Badge>
        </div>

        <GeoAddressForm
          value={address}
          onChange={(newAddress) => {
            setAddress(newAddress)
            markDirty()
          }}
          idPrefix="profile"
        />
      </CardContent>
    </Card>
  )

  /** Notifications & Sensory Preferences Card */
  const renderPreferencesCard = () => (
    <Card className="border-border/70 rounded-xl border shadow-2xs">
      <CardHeader className="p-3.5 pb-2 sm:p-4 sm:pb-2">
        <div className="flex items-center gap-2">
          <div className="bg-primary/10 text-primary rounded-lg p-1.5">
            <Sparkles className="size-3.5" />
          </div>
          <div>
            <h2 className="text-foreground text-xs font-semibold sm:text-sm">
              Preferências de Sistema & Feedback
            </h2>
            <CardDescription className="text-[11px]">
              Personalize notificações push no aparelho e respostas táteis/sonoras
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3.5 p-3.5 sm:p-4 sm:pt-2">
        {/* Native Web Push Card */}
        <PushNotificationCard />

        {/* Sensory settings grid */}
        <div className="grid gap-2.5 sm:grid-cols-2">
          {/* Sound Preferences */}
          <div className="border-border/60 bg-card flex flex-col justify-between gap-2.5 rounded-xl border p-3">
            <div className="flex items-start gap-2.5">
              <div className="bg-primary/10 text-primary mt-0.5 rounded-lg p-1.5">
                <Volume2 className="size-3.5" />
              </div>
              <div>
                <p className="text-foreground text-xs font-semibold">Sons do Painel</p>
                <p className="text-muted-foreground text-[10.5px]">
                  Avisos sutis de novos orçamentos e mensagens.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between border-t pt-2">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("selection")
                  playCoinSound()
                  setTimeout(playCompletionSound, 300)
                  setTimeout(playReviewSound, 750)
                }}
                className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-7 items-center justify-center rounded-full border transition-all active:scale-95"
                title="Ouvir demonstração dos efeitos sonoros"
                aria-label="Ouvir demonstração dos efeitos sonoros"
              >
                <Play className="size-3" />
              </button>
              <Switch
                checked={soundEnabled}
                onCheckedChange={(v) => {
                  setSoundEnabled(v)
                  apiPatch("/api/users/me", { soundEnabled: v }).then(() => {
                    qc.invalidateQueries({ queryKey: ["users", "me"] })
                    if (authUser) {
                      setUser({ ...authUser, soundEnabled: v })
                    }
                  })
                }}
                aria-label="Ativar sons do painel"
              />
            </div>
          </div>

          {/* Vibration Preferences */}
          <div className="border-border/60 bg-card flex flex-col justify-between gap-2.5 rounded-xl border p-3">
            <div className="flex items-start gap-2.5">
              <div className="bg-primary/10 text-primary mt-0.5 rounded-lg p-1.5">
                <Smartphone className="size-3.5" />
              </div>
              <div>
                <p className="text-foreground text-xs font-semibold">Resposta Tátil (Vibração)</p>
                <p className="text-muted-foreground text-[10.5px]">
                  Microvibrações hápticas em aparelhos compatíveis.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between border-t pt-2">
              <button
                type="button"
                onClick={() => {
                  tryVibrate([30, 50, 30, 50, 30])
                }}
                className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-7 items-center justify-center rounded-full border transition-all active:scale-95"
                title="Testar resposta tátil do aparelho"
                aria-label="Testar resposta tátil do aparelho"
              >
                <Play className="size-3" />
              </button>
              <Switch
                checked={vibrateEnabled}
                onCheckedChange={(v) => {
                  setVibrateEnabled(v)
                  apiPatch("/api/users/me", { vibrateEnabled: v }).then(() => {
                    qc.invalidateQueries({ queryKey: ["users", "me"] })
                    if (authUser) {
                      setUser({ ...authUser, vibrateEnabled: v })
                    }
                  })
                }}
                aria-label="Ativar resposta tátil de vibração"
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Signature Hero Banner — Compact, Clean & Minimalist */}
      <div className="border-border/60 from-card via-card/95 to-primary/5 relative overflow-hidden rounded-2xl border bg-gradient-to-br p-4 shadow-2xs sm:p-5">
        <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="border-primary/20 bg-primary/10 text-primary inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium">
              <UserIcon className="size-3" />
              <span>Perfil & Identidade Cadastral</span>
            </div>
            <h1 className="text-foreground mt-1.5 text-xl font-bold tracking-tight sm:text-2xl">
              Meu Perfil
            </h1>
            <p className="text-muted-foreground mt-0.5 max-w-2xl text-xs sm:text-sm">
              Mantenha seus dados cadastrais, endereço e preferências atualizados para agilizar
              orçamentos e garantir conexão precisa com prestadores locais.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                navigate("client.dashboard")
              }}
              className="h-8 gap-1.5 rounded-xl text-xs font-medium transition-all active:scale-95"
            >
              <LayoutDashboard className="size-3.5" />
              Visão geral
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                triggerHaptic("selection")
                navigate("client.security")
              }}
              className="h-8 gap-1.5 rounded-xl text-xs font-medium transition-all active:scale-95"
            >
              <ShieldCheck className="size-3.5" />
              Segurança & Senha
            </Button>
          </div>
        </div>
      </div>

      {/* 3 Ultra-Compact Bento StatCards (~68px) */}
      <div className="grid gap-2.5 sm:grid-cols-3">
        <StatCard
          compact={true}
          icon={Sparkles}
          label="Completude do Perfil"
          value={`${completenessScore}%`}
          tone={completenessScore === 100 ? "primary" : "amber"}
          hint={
            completenessScore === 100
              ? "Perfil 100% preenchido"
              : "Preencha seus dados para alcançar 100%"
          }
        />
        <StatCard
          compact={true}
          icon={BadgeCheck}
          label="Status da Conta"
          value={u?.verified ? "Verificada" : "Em análise"}
          tone={u?.verified ? "primary" : "amber"}
          hint={u?.cpfCnpj ? "CPF/CNPJ cadastrado" : "Documento em validação"}
        />
        <StatCard
          compact={true}
          icon={MapPin}
          label="Localização Ativa"
          value={
            address.city
              ? address.city.length > 18
                ? address.city.slice(0, 16) + "…"
                : address.city
              : "Gov. Valadares"
          }
          tone="sky"
          hint={
            address.district
              ? `${address.district} · CEP ${address.cep}`
              : "Raio geográfico calibrado"
          }
        />
      </div>

      {/* Modern Filter & View Mode Toolbar */}
      <div className="bg-card border-border/60 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border p-2.5 shadow-2xs sm:p-3">
        {/* Search Input with quick clear */}
        <div className="relative min-w-[200px] flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
          <Input
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filtrar dados cadastrais, endereço ou preferências..."
            className="h-8.5 rounded-lg pr-8 pl-8.5 text-xs"
          />
          {filterText ? (
            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection")
                setFilterText("")
              }}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 p-0.5"
              aria-label="Limpar busca"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>

        {/* View mode switcher */}
        <div className="bg-muted/40 flex items-center rounded-lg border p-0.5">
          <button
            type="button"
            onClick={() => {
              triggerHaptic("selection")
              setViewMode("list")
            }}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all active:scale-95 ${
              viewMode === "list"
                ? "bg-card text-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
            aria-label="Visualização em Lista"
            aria-pressed={viewMode === "list"}
          >
            <LayoutList className="size-3.5" />
            <span className="hidden sm:inline">Lista</span>
          </button>
          <button
            type="button"
            onClick={() => {
              triggerHaptic("selection")
              setViewMode("grid")
            }}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all active:scale-95 ${
              viewMode === "grid"
                ? "bg-card text-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
            aria-label="Visualização em Grade"
            aria-pressed={viewMode === "grid"}
          >
            <LayoutGrid className="size-3.5" />
            <span className="hidden sm:inline">Grade</span>
          </button>
        </div>
      </div>

      {meQuery.isLoading ? (
        <div className="border-border/60 text-muted-foreground flex items-center justify-center gap-2 rounded-xl border p-12 text-sm shadow-2xs">
          <Loader2 className="size-5 animate-spin" />
          Carregando dados do perfil…
        </div>
      ) : !u ? (
        <Card className="border-border/70 rounded-xl shadow-2xs">
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            Não foi possível carregar as informações do seu perfil.
          </CardContent>
        </Card>
      ) : !hasAnyMatch ? (
        <div className="border-border/60 bg-card rounded-xl border p-8 text-center shadow-2xs">
          <div className="bg-muted mx-auto flex size-12 items-center justify-center rounded-full">
            <Search className="text-muted-foreground size-5" />
          </div>
          <h3 className="text-foreground mt-3 text-sm font-semibold">Nenhuma seção encontrada</h3>
          <p className="text-muted-foreground mt-1 text-xs">
            Nenhuma configuração de perfil corresponde ao termo &quot;{filterText}&quot;.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              triggerHaptic("selection")
              setFilterText("")
            }}
            className="mt-4 h-8 gap-1.5 rounded-xl text-xs transition-all active:scale-95"
          >
            Limpar filtro
          </Button>
        </div>
      ) : (
        <form
          onInputCapture={markDirty}
          onSubmit={(e) => {
            e.preventDefault()
            saveMutation.mutate()
          }}
          className="space-y-4"
        >
          {viewMode === "list" ? (
            /* =======================================================
               MODO LISTA: Fluxo linear, horizontal e ultra-compacto
               ======================================================= */
            <div className="space-y-4">
              {matchesIdentity && renderIdentityCard(true)}
              {matchesContact && renderContactCard()}
              {matchesAddress && renderAddressCard()}

              {(matchesOfficial || matchesSecurity) && (
                <div className="grid gap-3.5 sm:grid-cols-2">
                  {matchesOfficial && renderOfficialDataCard()}
                  {matchesSecurity && renderSecurityCard()}
                </div>
              )}

              {matchesPreferences && renderPreferencesCard()}
            </div>
          ) : (
            /* =======================================================
               MODO GRADE: Layout Bento 12 colunas balanceado
               ======================================================= */
            <div className="grid gap-4 lg:grid-cols-12">
              {/* Coluna Esquerda: Identidade & Segurança (4 colunas) */}
              <div className="space-y-4 lg:col-span-4">
                {matchesIdentity && renderIdentityCard(false)}
                {matchesOfficial && renderOfficialDataCard()}
                {matchesSecurity && renderSecurityCard()}
              </div>

              {/* Coluna Direita: Contato, Endereço e Preferências (8 colunas) */}
              <div className="space-y-4 lg:col-span-8">
                {matchesContact && renderContactCard()}
                {matchesAddress && renderAddressCard()}
                {matchesPreferences && renderPreferencesCard()}
              </div>
            </div>
          )}

          {/* Sticky Bottom Actions Bar */}
          <div className="border-border/70 bg-card/95 supports-[backdrop-filter]:bg-card/85 sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border p-3 shadow-lg backdrop-blur-md sm:bottom-4 sm:p-3.5">
            <div className="flex items-center gap-2 text-xs">
              {isDirty ? (
                <span className="flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
                  <span className="size-2 animate-pulse rounded-full bg-amber-500" />
                  Alterações não salvas
                </span>
              ) : (
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                  Dados sincronizados com o servidor
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  triggerHaptic("selection")
                  handleDiscard()
                }}
                disabled={saveMutation.isPending || !isDirty}
                className="h-8 gap-1.5 rounded-xl text-xs font-medium transition-all active:scale-95"
              >
                <RotateCcw className="size-3.5" />
                Descartar
              </Button>

              <Button
                type="submit"
                size="sm"
                onClick={() => triggerHaptic("selection")}
                disabled={saveMutation.isPending || !name.trim()}
                className="bg-primary text-primary-foreground hover:bg-primary/90 h-8 gap-1.5 rounded-xl text-xs font-semibold shadow-xs transition-all active:scale-95"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                Salvar alterações
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}
