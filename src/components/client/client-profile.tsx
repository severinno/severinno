"use client"

/**
 * ClientProfile — Redesigned client profile view + edit form.
 *
 *  - Signature Hero Banner with navigation shortcuts
 *  - Real-time profile completeness meter (percentage & criteria checklist)
 *  - 3 Account Health & Location StatCards
 *  - Balanced 2-column layout eliminating awkward whitespace
 *  - Read-only official identity card with anti-fraud shield advisory
 *  - Quick security shortcut to client.security (password & 2FA)
 *  - Structured contact, bio, and GeoAddressForm integration
 *  - Push notification, sound preview & haptics sensory settings
 *  - Dirty-state tracking with clear save/discard action bar
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
  Loader2,
  Lock,
  Mail,
  MapPin,
  Play,
  RotateCcw,
  Save,
  ShieldCheck,
  Smartphone,
  Sparkles,
  User as UserIcon,
  Volume2,
} from "lucide-react"
import { toast } from "sonner"

import { apiGet, apiPatch } from "@/lib/api"
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
    onError: (e: { message?: string }) =>
      toast.error(e?.message || "Não foi possível salvar o perfil."),
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
      toast.success("Foto atualizada! Lembre-se de salvar as alterações.")
    } catch (e) {
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

  return (
    <div className="space-y-6">
      {/* Signature Hero Banner */}
      <div className="border-border/60 from-card via-card/95 to-primary/5 relative overflow-hidden rounded-2xl border bg-gradient-to-br p-6 shadow-sm">
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="border-primary/20 bg-primary/10 text-primary inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium">
              <UserIcon className="size-3.5" />
              <span>Perfil & Identidade Cadastral</span>
            </div>
            <h1 className="text-foreground mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
              Meu Perfil
            </h1>
            <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
              Mantenha seus dados cadastrais, endereço e preferências atualizados para agilizar
              orçamentos e garantir conexão precisa com prestadores locais.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("client.dashboard")}
              className="gap-1.5 text-xs font-medium"
            >
              <LayoutDashboard className="size-3.5" />
              Visão geral
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("client.security")}
              className="gap-1.5 text-xs font-medium"
            >
              <ShieldCheck className="size-3.5" />
              Segurança & Senha
            </Button>
          </div>
        </div>
      </div>

      {/* 3 Account Health & Location StatCards */}
      <div className="grid gap-3 sm:grid-cols-3">
        {/* StatCard 1: Completude */}
        <Card className="border-border/70 rounded-xl shadow-sm transition-shadow hover:shadow-md">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3">
              <span className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-lg">
                <Sparkles className="size-5" />
              </span>
              <Badge
                variant={completenessScore === 100 ? "default" : "secondary"}
                className={`text-[10px] font-medium ${
                  completenessScore === 100
                    ? "bg-emerald-600 text-white dark:bg-emerald-500"
                    : "text-primary"
                }`}
              >
                {completenessScore === 100 ? "Completo" : `${completenessScore}%`}
              </Badge>
            </div>
            <div className="mt-3">
              <h2 className="text-foreground text-2xl font-bold tracking-tight">
                {completenessScore}%
              </h2>
              <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                Completude do Perfil
              </p>
              <div className="mt-2.5">
                <Progress
                  value={completenessScore}
                  className="h-1.5"
                  aria-label="Completude cadastral do perfil"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* StatCard 2: Verificação */}
        <Card className="border-border/70 rounded-xl shadow-sm transition-shadow hover:shadow-md">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3">
              <span className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <BadgeCheck className="size-5" />
              </span>
              <Badge
                variant="outline"
                className="border-emerald-500/30 text-[10px] text-emerald-600"
              >
                {u?.verified ? "Ativo" : "Pendente"}
              </Badge>
            </div>
            <div className="mt-3">
              <h2 className="text-foreground text-2xl font-bold tracking-tight">
                {u?.verified ? "Verificada" : "Em análise"}
              </h2>
              <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                Status da Conta
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {u?.cpfCnpj ? "CPF/CNPJ cadastrado" : "Documento em validação"}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* StatCard 3: Localização */}
        <Card className="border-border/70 rounded-xl shadow-sm transition-shadow hover:shadow-md">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3">
              <span className="flex size-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                <MapPin className="size-5" />
              </span>
              <Badge variant="secondary" className="text-[10px]">
                {address.state || "MG"}
              </Badge>
            </div>
            <div className="mt-3">
              <h2 className="text-foreground truncate text-2xl font-bold tracking-tight">
                {address.city || "Governador Valadares"}
              </h2>
              <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                Localização Ativa
              </p>
              <p className="text-muted-foreground mt-1 truncate text-xs">
                {address.district
                  ? `${address.district} · CEP ${address.cep}`
                  : "Raio geográfico calibrado"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {meQuery.isLoading ? (
        <div className="border-border/60 text-muted-foreground flex items-center justify-center gap-2 rounded-xl border p-12 text-sm shadow-sm">
          <Loader2 className="size-5 animate-spin" />
          Carregando dados do perfil…
        </div>
      ) : !u ? (
        <Card className="border-border/70 rounded-xl shadow-sm">
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            Não foi possível carregar as informações do seu perfil.
          </CardContent>
        </Card>
      ) : (
        <form
          onInputCapture={markDirty}
          onSubmit={(e) => {
            e.preventDefault()
            saveMutation.mutate()
          }}
          className="grid gap-6 lg:grid-cols-12"
        >
          {/* Left Column: Visual Identity & Official Credentials (4 cols on lg) */}
          <div className="space-y-6 lg:col-span-4">
            {/* Card 1: Identity Card with Completeness Checklist */}
            <Card className="border-border/70 overflow-hidden rounded-xl border shadow-sm">
              <div className="from-primary/10 via-primary/5 h-20 w-full bg-gradient-to-r to-transparent" />
              <CardContent className="-mt-12 space-y-4 px-6 pb-6">
                <div className="flex flex-col items-center text-center">
                  <div className="relative">
                    <Avatar className="ring-background size-24 shadow-lg ring-4">
                      {avatarUrl ? <AvatarImage src={avatarUrl} alt={name || u.name} /> : null}
                      <AvatarFallback className="bg-primary text-primary-foreground text-2xl font-bold">
                        {initials || "U"}
                      </AvatarFallback>
                    </Avatar>

                    <label
                      className="bg-card text-foreground hover:bg-accent absolute -right-1 -bottom-1 flex size-8 cursor-pointer items-center justify-center rounded-full border shadow-md transition-all hover:scale-105"
                      title="Alterar foto de perfil"
                      aria-label="Alterar foto de perfil"
                    >
                      {uploadingAvatar ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Camera className="text-primary size-4" />
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

                  <div className="mt-3">
                    <h2 className="text-foreground text-base font-bold">{name || u.name}</h2>
                    <p className="text-muted-foreground text-xs">{u.email}</p>
                    <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
                      <Badge variant="secondary" className="text-[11px] font-medium">
                        {ROLE_LABELS[u.role] || "Cliente"}
                      </Badge>
                      {u.verified ? (
                        <Badge
                          variant="outline"
                          className="gap-1 border-emerald-500/30 text-[11px] text-emerald-600 dark:text-emerald-400"
                        >
                          <BadgeCheck className="size-3" />
                          Verificado
                        </Badge>
                      ) : null}
                    </div>

                    {memberSince ? (
                      <p className="text-muted-foreground mt-2 flex items-center justify-center gap-1 text-[11px]">
                        <Calendar className="size-3" />
                        Membro desde {memberSince}
                      </p>
                    ) : null}
                  </div>
                </div>

                {/* Completeness Checklist */}
                <div className="border-border/60 bg-muted/20 space-y-2.5 rounded-lg border p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-foreground font-semibold">Completude do Perfil</span>
                    <span className="text-primary font-bold">{completenessScore}%</span>
                  </div>
                  <Progress
                    value={completenessScore}
                    className="h-1.5"
                    aria-label="Barra de progresso dos itens cadastrais"
                  />

                  <div className="space-y-1.5 pt-1 text-[11px]">
                    {completenessItems.map((item) => (
                      <div key={item.id} className="flex items-center justify-between">
                        <span
                          className={`flex items-center gap-1.5 ${
                            item.completed ? "text-foreground font-medium" : "text-muted-foreground"
                          }`}
                        >
                          {item.completed ? (
                            <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400" />
                          ) : (
                            <Circle className="text-muted-foreground/60 size-3" />
                          )}
                          {item.label}
                        </span>
                        <span className="text-muted-foreground text-[10px]">+{item.weight}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Card 2: Official Registered Data (Anti-Fraud & Read-Only) */}
            <Card className="border-border/70 rounded-xl border shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="bg-primary/10 text-primary rounded-lg p-2">
                    <Lock className="size-4" />
                  </div>
                  <div>
                    <h2 className="text-foreground text-sm font-semibold">
                      Dados Cadastrais Oficiais
                    </h2>
                    <CardDescription className="text-xs">
                      Informações de validação primária da conta
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div className="divide-border/40 divide-y text-xs">
                  <div className="flex items-center justify-between py-2">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <Mail className="size-3.5" />
                      E-mail principal
                    </span>
                    <span className="text-foreground max-w-[180px] truncate font-medium">
                      {u.email}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <UserIcon className="size-3.5" />
                      Tipo de perfil
                    </span>
                    <span className="text-foreground font-medium">
                      {ROLE_LABELS[u.role] || "Cliente"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <IdCard className="size-3.5" />
                      CPF / Documento
                    </span>
                    <span className="text-foreground font-mono font-medium">
                      {u.cpfCnpj || "Não informado"}
                    </span>
                  </div>
                </div>

                <div className="border-border/60 bg-muted/30 flex items-start gap-2.5 rounded-lg border p-3">
                  <ShieldCheck className="text-primary mt-0.5 size-4 shrink-0" />
                  <p className="text-muted-foreground text-[11px] leading-relaxed">
                    E-mail, CPF/CNPJ e tipo de perfil são protegidos contra alterações diretas para
                    prevenção de fraudes e compliance fiscal. Em caso de divergência, contate o
                    suporte.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Card 3: Quick Security Navigation */}
            <Card className="border-border/70 from-card to-primary/5 rounded-xl border bg-gradient-to-br shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="bg-primary/10 text-primary shrink-0 rounded-lg p-2.5">
                    <KeyRound className="size-5" />
                  </div>
                  <div className="space-y-1">
                    <h2 className="text-foreground text-xs font-semibold">
                      Segurança & Autenticação
                    </h2>
                    <p className="text-muted-foreground text-[11px]">
                      Altere sua senha de acesso e configure o 2FA (TOTP) na Central de Segurança.
                    </p>
                    <div className="pt-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => navigate("client.security")}
                        className="h-7 gap-1.5 text-xs font-medium"
                      >
                        <ShieldCheck className="size-3.5" />
                        Gerenciar Segurança
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Column: Editable Contact, Address & Preferences (8 cols on lg) */}
          <div className="space-y-6 lg:col-span-8">
            {/* Sub-Card 1: Contact Information */}
            <Card className="border-border/70 rounded-xl border shadow-sm">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="bg-primary/10 text-primary rounded-lg p-2">
                    <UserIcon className="size-4" />
                  </div>
                  <div>
                    <h2 className="text-foreground text-base font-semibold">
                      Dados Pessoais & Contato
                    </h2>
                    <CardDescription className="text-xs">
                      Informações visíveis aos prestadores durante a negociação e atendimento
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
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
                      className="text-xs"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="profile-whatsapp" className="text-xs font-medium">
                      WhatsApp <span className="text-rose-500">*</span>
                    </Label>
                    <div className="relative">
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
                        className="text-xs"
                      />
                    </div>
                    <p className="text-muted-foreground text-[11px]">
                      Com DDD. Utilizado para avisos do serviço e orçamentos.
                    </p>
                  </div>

                  <div className="space-y-1.5">
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
                      className="text-xs"
                    />
                    <p className="text-muted-foreground text-[11px]">
                      Telefone fixo ou para recados.
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="profile-bio" className="text-xs font-medium">
                      Apresentação pessoal (Bio)
                    </Label>
                    <span className="text-muted-foreground text-[11px] tabular-nums">
                      {bio.length}/600
                    </span>
                  </div>
                  <Textarea
                    id="profile-bio"
                    value={bio}
                    onChange={(e) => {
                      setBio(e.target.value)
                      markDirty()
                    }}
                    rows={3}
                    maxLength={600}
                    placeholder="Ex.: Morador de Governador Valadares, busco serviços de manutenção predial e elétrica para minha residência..."
                    className="text-xs"
                  />
                  <p className="text-muted-foreground text-[11px]">
                    Conte um pouco sobre suas necessidades habituais para que os prestadores
                    conheçam seu perfil de contratação.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Sub-Card 2: Address & Geolocation */}
            <Card className="border-border/70 rounded-xl border shadow-sm">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="bg-primary/10 text-primary rounded-lg p-2">
                    <Building2 className="size-4" />
                  </div>
                  <div>
                    <h2 className="text-foreground text-base font-semibold">
                      Endereço & Localização Residencial
                    </h2>
                    <CardDescription className="text-xs">
                      Utilizado pelo algoritmo de geolocalização para calcular distância e raio de
                      atendimento
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="border-border/60 bg-muted/20 flex items-center justify-between rounded-lg border p-3">
                  <div className="flex items-center gap-2 text-xs">
                    <MapPin className="text-primary size-4 shrink-0" />
                    <div>
                      <p className="text-foreground font-medium">Georreferenciamento Ativo</p>
                      <p className="text-muted-foreground text-[11px]">
                        {address.city
                          ? `${address.city} - ${address.state}`
                          : "Governador Valadares, MG"}
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

            {/* Sub-Card 3: Notifications & Sensory Preferences */}
            <Card className="border-border/70 rounded-xl border shadow-sm">
              <CardHeader className="pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="bg-primary/10 text-primary rounded-lg p-2">
                    <Sparkles className="size-4" />
                  </div>
                  <div>
                    <h2 className="text-foreground text-base font-semibold">
                      Preferências de Sistema & Feedback
                    </h2>
                    <CardDescription className="text-xs">
                      Personalize notificações push no aparelho e respostas táteis/sonoras
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Native Web Push Card */}
                <PushNotificationCard />

                {/* Sound Preferences */}
                <div className="border-border/60 bg-card flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="bg-primary/10 text-primary mt-0.5 rounded-lg p-2">
                      <Volume2 className="size-4" />
                    </div>
                    <div>
                      <p className="text-foreground text-xs font-semibold">Sons do Painel</p>
                      <p className="text-muted-foreground text-[11px]">
                        Emite avisos sonoros sutis na chegada de novos orçamentos, confirmações de
                        serviço e mensagens.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 self-end sm:self-center">
                    <button
                      type="button"
                      onClick={() => {
                        playCoinSound()
                        setTimeout(playCompletionSound, 300)
                        setTimeout(playReviewSound, 750)
                      }}
                      className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-8 items-center justify-center rounded-full border transition"
                      title="Ouvir demonstração dos efeitos sonoros"
                      aria-label="Ouvir demonstração dos efeitos sonoros"
                    >
                      <Play className="size-3.5" />
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
                <div className="border-border/60 bg-card flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="bg-primary/10 text-primary mt-0.5 rounded-lg p-2">
                      <Smartphone className="size-4" />
                    </div>
                    <div>
                      <p className="text-foreground text-xs font-semibold">
                        Resposta Tátil (Vibração)
                      </p>
                      <p className="text-muted-foreground text-[11px]">
                        Gera microvibrações hápticas em dispositivos móveis e smartphones
                        compatíveis.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 self-end sm:self-center">
                    <button
                      type="button"
                      onClick={() => {
                        tryVibrate([30, 50, 30, 50, 30])
                      }}
                      className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-8 items-center justify-center rounded-full border transition"
                      title="Testar resposta tátil do aparelho"
                      aria-label="Testar resposta tátil do aparelho"
                    >
                      <Play className="size-3.5" />
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
              </CardContent>
            </Card>

            {/* Bottom Actions Bar */}
            <div className="border-border/70 bg-card/95 supports-[backdrop-filter]:bg-card/80 sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 shadow-lg backdrop-blur-md">
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
                  onClick={handleDiscard}
                  disabled={saveMutation.isPending || !isDirty}
                  className="gap-1.5 text-xs font-medium"
                >
                  <RotateCcw className="size-3.5" />
                  Descartar
                </Button>

                <Button
                  type="submit"
                  size="sm"
                  disabled={saveMutation.isPending || !name.trim()}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 gap-1.5 text-xs font-semibold shadow-sm"
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
          </div>
        </form>
      )}
    </div>
  )
}
