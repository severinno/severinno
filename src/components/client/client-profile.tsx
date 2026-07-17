"use client"

/**
 * ClientProfile — profile view + edit form.
 *
 *  - Read-only: email, role, cpfCnpj (verified fields).
 *  - Editable: avatar (upload via /api/upload → PATCH /api/users/me), name,
 *    whatsapp, phone, bio, address (CEP autofill + GPS via AddressForm).
 *
 * On save: PATCH /api/users/me. On success: toast + invalidate auth/me +
 * refresh the local user store.
 */

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AtSign,
  BadgeCheck,
  Building2,
  Camera,
  IdCard,
  Loader2,
  Phone,
  Save,
  User as UserIcon,
} from "lucide-react"
import { toast } from "sonner"

import { apiGet, apiPatch } from "@/lib/api"
import { ROLE_LABELS, type UserRole } from "@/lib/constants"
import { useAuthStore } from "@/store"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  AddressForm,
  type AddressFormValue,
} from "@/components/modals/address-form"
import {
  PageHeader,
} from "@/components/client/client-shared"

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
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClientProfile() {
  const qc = useQueryClient()
  const setUser = useAuthStore((s) => s.setUser)
  const authUser = useAuthStore((s) => s.user)

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
  const [uploadingAvatar, setUploadingAvatar] = React.useState(false)
  const initialized = React.useRef(false)

  // Populate the form once data arrives
  React.useEffect(() => {
    if (meQuery.data?.user && !initialized.current) {
      const u = meQuery.data.user
      setName(u.name ?? "")
      setWhatsapp(u.whatsapp ?? "")
      setPhone(u.phone ?? "")
      setBio(u.bio ?? "")
      setAvatarUrl(u.avatarUrl ?? "")
      setAddress({
        cep: u.cep ?? "",
        street: u.street ?? "",
        number: u.number ?? "",
        complement: u.complement ?? "",
        district: u.district ?? "",
        city: u.city ?? "",
        state: u.state ?? "",
        lat: u.lat ?? null,
        lng: u.lng ?? null,
      })
      initialized.current = true
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
      qc.invalidateQueries({ queryKey: ["users", "me"] })
      // Sync the auth store with the new name/avatar (subset)
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
      toast.success("Imagem enviada. Salve para confirmar.")
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Falha ao enviar imagem.",
      )
    } finally {
      setUploadingAvatar(false)
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Meu perfil"
        subtitle="Mantenha seus dados atualizados para uma melhor experiência e orçamentos mais precisos."
      />

      {meQuery.isLoading ? (
        <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          Carregando perfil…
        </div>
      ) : !u ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            Não foi possível carregar seu perfil.
          </CardContent>
        </Card>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            saveMutation.mutate()
          }}
          className="grid gap-4 lg:grid-cols-3"
        >
          {/* Avatar + read-only identity */}
          <Card className="lg:col-span-1">
            <CardContent className="space-y-4">
              <div className="flex flex-col items-center gap-3">
                <div className="relative">
                  <Avatar className="size-24 border-4 border-background shadow-md">
                    {avatarUrl ? (
                      <AvatarImage src={avatarUrl} alt={name} />
                    ) : null}
                    <AvatarFallback className="bg-primary text-xl font-semibold text-primary-foreground">
                      {initials || "U"}
                    </AvatarFallback>
                  </Avatar>
                  <label
                    className="absolute -right-1 -bottom-1 flex size-9 cursor-pointer items-center justify-center rounded-full border bg-background text-foreground shadow-md transition hover:bg-accent"
                    title="Trocar foto"
                    aria-label="Trocar foto"
                  >
                    {uploadingAvatar ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Camera className="size-4" />
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
                <div className="text-center">
                  <p className="text-sm font-semibold">{name || u.name}</p>
                  <p className="text-xs text-muted-foreground">{u.email}</p>
                  <div className="mt-1 flex items-center justify-center gap-1.5">
                    <Badge variant="secondary" className="text-[10px]">
                      {ROLE_LABELS[u.role]}
                    </Badge>
                    {u.verified ? (
                      <Badge
                        variant="outline"
                        className="gap-1 text-[10px] text-emerald-600"
                      >
                        <BadgeCheck className="size-3" />
                        Verificado
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="space-y-2 border-t pt-3 text-sm">
                <ReadonlyRow
                  icon={AtSign}
                  label="E-mail"
                  value={u.email}
                />
                <ReadonlyRow
                  icon={UserIcon}
                  label="Tipo de conta"
                  value={ROLE_LABELS[u.role]}
                />
                <ReadonlyRow
                  icon={IdCard}
                  label="CPF/CNPJ"
                  value={u.cpfCnpj || "—"}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                E-mail, CPF/CNPJ e tipo de conta não podem ser alterados
                diretamente. Em caso de divergência, entre em contato com o
                suporte.
              </p>
            </CardContent>
          </Card>

          {/* Editable fields */}
          <Card className="lg:col-span-2">
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nome completo" htmlFor="profile-name">
                  <Input
                    id="profile-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={120}
                    required
                  />
                </Field>
                <Field
                  label="WhatsApp"
                  htmlFor="profile-whatsapp"
                  hint="Com DDD. Ex: (11) 98888-7777"
                >
                  <Input
                    id="profile-whatsapp"
                    inputMode="tel"
                    value={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.value)}
                    placeholder="(11) 98888-7777"
                    maxLength={20}
                  />
                </Field>
                <Field
                  label="Telefone fixo"
                  htmlFor="profile-phone"
                  hint="Opcional"
                >
                  <Input
                    id="profile-phone"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(11) 3000-0000"
                    maxLength={20}
                  />
                </Field>
              </div>

              <Field
                label="Bio"
                htmlFor="profile-bio"
                hint="Conte um pouco sobre você (máx 600 caracteres)"
              >
                <Textarea
                  id="profile-bio"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  rows={4}
                  maxLength={600}
                  placeholder="Ex.: Morador de São Paulo, busco serviços de qualidade para minha casa…"
                />
                <p className="text-right text-xs text-muted-foreground tabular-nums">
                  {bio.length}/600
                </p>
              </Field>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Building2 className="size-4 text-primary" />
                  <p className="text-sm font-semibold">Endereço</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Usado para calcular a distância dos prestadores.
                </p>
                <AddressForm
                  value={address}
                  onChange={setAddress}
                  idPrefix="profile"
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t pt-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
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
                      toast.info("Alterações descartadas.")
                    }
                  }}
                  disabled={saveMutation.isPending}
                >
                  Descartar
                </Button>
                <Button
                  type="submit"
                  disabled={saveMutation.isPending || !name.trim()}
                  className="gap-2 bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  Salvar alterações
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small UI helpers
// ---------------------------------------------------------------------------

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

function ReadonlyRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof AtSign
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium">{value}</p>
      </div>
    </div>
  )
}
