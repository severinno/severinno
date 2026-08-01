"use client"

import * as React from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { apiGet, apiPatch, apiPost } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Check, ChevronLeft, ChevronRight, MapPin } from "lucide-react"
import { cn } from "@/lib/utils"
import { PreferenceToggles } from "@/components/shared/preference-toggles"
import RadiusPreviewMap from "@/components/shared/radius-preview-map"

const STEPS = ["Perfil", "Endereço", "Horários", "Serviços"]
const WEEKDAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"]

export function ProviderOnboarding({ onComplete }: { onComplete: () => void }) {
  const setUser = useAuthStore((s) => s.setUser)
  const user = useAuthStore((s) => s.user)
  const [step, setStep] = React.useState(0)

  const { data: savedProgress } = useQuery({
    queryKey: ["onboarding-progress", user?.id],
    queryFn: () => apiGet<{ step: number; done: boolean }>("/api/provider/onboarding"),
    enabled: !!user,
    staleTime: 30_000,
  })

  React.useEffect(() => {
    if (savedProgress && !savedProgress.done && savedProgress.step > 0) {
      setStep(savedProgress.step)
    }
  }, [savedProgress])
  const [form, setForm] = React.useState({
    name: user?.name ?? "",
    bio: "",
    whatsapp: "",
    city: "",
    state: "",
    cep: "",
    street: "",
    number: "",
    serviceTitle: "",
    servicePrice: "",
    serviceDuration: "",
  })
  const [providerLat, setProviderLat] = React.useState<number | null>(null)
  const [providerLng, setProviderLng] = React.useState<number | null>(null)
  const [providerRadius, setProviderRadius] = React.useState(15)
  const [soundEnabled, setSoundEnabled] = React.useState(true)
  const [vibrateEnabled, setVibrateEnabled] = React.useState(true)
  const [slots, setSlots] = React.useState(
    WEEKDAYS.map((_, i) => ({
      active: i < 5,
      start: "08:00",
      end: "18:00",
    })),
  )

  const updateSlot = (index: number, field: string, value: boolean | string) => {
    setSlots((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)))
  }

  const copyWeekdays = () => {
    setSlots((prev) => prev.map((s, i) => (i < 5 ? { ...prev[0] } : s)))
  }

  const updateProfile = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiPatch<{ user?: import("@/store/auth").AuthUser | null }>("/api/users/me", data),
    onSuccess: (res: { user?: import("@/store/auth").AuthUser | null }) => {
      if (res?.user) setUser(res.user)
    },
  })

  const handleNext = async () => {
    if (step === 0) {
      await updateProfile.mutateAsync({
        name: form.name,
        bio: form.bio,
        whatsapp: form.whatsapp,
        soundEnabled,
        vibrateEnabled,
      })
    }
    if (step === 1) {
      const profileUpdate: Record<string, unknown> = {
        city: form.city,
        state: form.state,
        cep: form.cep,
        street: form.street,
        number: form.number,
      }
      // Only send lat/lng/radius if provider has located themselves
      if (providerLat != null && providerLng != null) {
        profileUpdate.lat = providerLat
        profileUpdate.lng = providerLng
        profileUpdate.radiusKm = providerRadius
      }
      await updateProfile.mutateAsync(profileUpdate)
    }
    const nextStep = Math.min(step + 1, STEPS.length - 1)
    setStep(nextStep)
    apiPatch("/api/provider/onboarding", { step: nextStep }).catch((err) => {
      console.warn("[onboarding] failed to save step:", err)
    })
  }

  const handleFinish = async () => {
    try {
      if (form.serviceTitle && form.servicePrice) {
        await fetch("/api/services", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: form.serviceTitle,
            basePrice: Number(form.servicePrice),
            duration: form.serviceDuration ? Number(form.serviceDuration) : 60,
            categoryId: null,
          }),
        })
      }
      try {
        await apiPost("/api/availability", {
          slots: slots
            .filter((s) => s.active)
            .map((s, i) => ({
              dayOfWeek: i,
              startTime: s.start,
              endTime: s.end,
            })),
        })
      } catch {
        // non-blocking
      }
      await apiPatch("/api/provider/onboarding", { step: 4, done: true })
      toast.success("Cadastro completo! Bem-vindo ao Severinno.")
      onComplete()
    } catch {
      toast.error("Erro ao criar serviço.")
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg items-center justify-center p-6">
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-1">
                <div
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full text-xs font-bold",
                    i < step
                      ? "bg-primary text-primary-foreground"
                      : i === step
                        ? "bg-primary/20 text-primary"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {i < step ? <Check className="size-4" /> : i + 1}
                </div>
                <span
                  className={cn(
                    "hidden text-xs sm:inline",
                    i === step ? "font-semibold" : "text-muted-foreground",
                  )}
                >
                  {s}
                </span>
              </div>
            ))}
          </div>
          <CardTitle className="mt-4">
            {
              ["Complete seu perfil", "Onde você atende?", "Seus horários", "Seu primeiro serviço"][
                step
              ]
            }
          </CardTitle>
          <CardDescription>
            {["Nome e foto", "Endereço", "Disponibilidade", "Preço e duração"][step]}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === 0 && (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Nome</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>Bio</Label>
                <Textarea
                  value={form.bio}
                  onChange={(e) => setForm({ ...form, bio: e.target.value })}
                  placeholder="Conte um pouco sobre você..."
                />
              </div>
              <div className="grid gap-2">
                <Label>WhatsApp</Label>
                <Input
                  value={form.whatsapp}
                  onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
                  placeholder="(11) 99999-9999"
                />
              </div>

              {/* Sound & vibration preferences */}
              <PreferenceToggles
                variant="compact"
                onSoundChange={setSoundEnabled}
                onVibrateChange={setVibrateEnabled}
              />
            </div>
          )}
          {step === 1 && (
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>Cidade</Label>
                  <Input
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Estado</Label>
                  <Input
                    value={form.state}
                    onChange={(e) => setForm({ ...form, state: e.target.value })}
                    placeholder="SP"
                    maxLength={2}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>CEP</Label>
                <Input
                  value={form.cep}
                  onChange={(e) => setForm({ ...form, cep: e.target.value })}
                  placeholder="00000-000"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 grid gap-2">
                  <Label>Rua</Label>
                  <Input
                    value={form.street}
                    onChange={(e) => setForm({ ...form, street: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Número</Label>
                  <Input
                    value={form.number}
                    onChange={(e) => setForm({ ...form, number: e.target.value })}
                  />
                </div>
              </div>

              {/* Radius preview map */}
              <div className="bg-card rounded-lg border p-3">
                <div className="mb-2 flex items-center gap-2">
                  <MapPin className="size-4 text-emerald-600" />
                  <p className="text-sm font-medium">Raio de atendimento</p>
                </div>
                <RadiusPreviewMap
                  lat={providerLat}
                  lng={providerLng}
                  initialRadius={providerRadius}
                  showLocationControls={true}
                  height={250}
                  onLocationChange={(lat, lng) => {
                    setProviderLat(lat)
                    setProviderLng(lng)
                  }}
                  onRadiusChange={(radius) => {
                    setProviderRadius(radius)
                  }}
                />
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-3">
              <p className="text-muted-foreground text-sm">
                Defina seus horários de atendimento padrão:
              </p>
              {WEEKDAYS.map((day, i) => (
                <div key={i} className="flex items-center gap-3">
                  <label className="flex w-24 items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={slots[i].active}
                      onChange={(e) => updateSlot(i, "active", e.target.checked)}
                    />
                    {day}
                  </label>
                  {slots[i].active && (
                    <>
                      <input
                        type="time"
                        value={slots[i].start}
                        onChange={(e) => updateSlot(i, "start", e.target.value)}
                        className="h-9 rounded-md border px-2 text-sm"
                      />
                      <span className="text-muted-foreground">às</span>
                      <input
                        type="time"
                        value={slots[i].end}
                        onChange={(e) => updateSlot(i, "end", e.target.value)}
                        className="h-9 rounded-md border px-2 text-sm"
                      />
                    </>
                  )}
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={copyWeekdays}>
                Copiar Seg-Sex
              </Button>
            </div>
          )}
          {step === 3 && (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Nome do serviço</Label>
                <Input
                  value={form.serviceTitle}
                  onChange={(e) => setForm({ ...form, serviceTitle: e.target.value })}
                  placeholder="Ex: Corte de cabelo masculino"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label>Preço (R$)</Label>
                  <Input
                    type="number"
                    value={form.servicePrice}
                    onChange={(e) => setForm({ ...form, servicePrice: e.target.value })}
                    placeholder="99,90"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Duração (min)</Label>
                  <Input
                    type="number"
                    value={form.serviceDuration}
                    onChange={(e) => setForm({ ...form, serviceDuration: e.target.value })}
                    placeholder="60"
                  />
                </div>
              </div>
            </div>
          )}
        </CardContent>
        <CardFooter className="justify-between border-t pt-4">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
            <ChevronLeft className="mr-1 size-4" /> Voltar
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={handleNext} disabled={updateProfile.isPending}>
              {updateProfile.isPending ? "Salvando..." : "Próximo"}{" "}
              <ChevronRight className="ml-1 size-4" />
            </Button>
          ) : (
            <Button onClick={handleFinish}>
              Concluir <Check className="ml-1 size-4" />
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  )
}
