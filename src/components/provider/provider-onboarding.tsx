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
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Loader2,
  LocateFixed,
  MapPin,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useUpload } from "@/lib/use-upload"
import { fetchCep, fetchReverseGeo } from "@/lib/api"
import { getCachedCep, setCachedCep } from "@/lib/client-cep-cache"
import { AnimatePresence, motion } from "framer-motion"
import { PreferenceToggles } from "@/components/shared/preference-toggles"
import RadiusPreviewMap from "@/components/shared/radius-preview-map"
import { nearbyPhrase, suggestRadiusFromAccuracy } from "@/lib/geo-radius"
import { refineSuggestedRadius } from "@/lib/geo-density"

const STEPS = ["Perfil", "Endereço", "Horários", "Serviços"]
const WEEKDAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"]

const SERVICE_UNITS = [
  { value: "UNIDADE", label: "Por unidade" },
  { value: "METRO_LINEAR", label: "Por metro linear" },
  { value: "METRO_QUADRADO", label: "Por metro quadrado" },
  { value: "METRO_CUBICO", label: "Por metro cúbico" },
] as const

/**
 * Nó da árvore de categorias (GET /api/categories devolve raízes com
 * `children` aninhados — level 0 → 1 → 2). O serviço exige SUBCATEGORIA
 * (level 2); childless no meio vira opção própria (categoria válida também).
 */
type CategoryNode = {
  id: string
  name: string
  level: number
  children?: CategoryNode[]
}

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

const STEP_TITLES = [
  "Complete seu perfil",
  "Onde você atende?",
  "Seus horários",
  "Seu primeiro serviço",
]

const STEP_DESCRIPTIONS = [
  "Nome, bio e foto",
  "Endereço e raio",
  "Disponibilidade",
  "Categoria, preço e duração",
]

/**
 * Overlay de captura de foto pela câmera — webcam no desktop, câmera frontal
 * no celular (`facingMode: "user"`). O stream é parado no unmount/close e o
 * quadro capturado vira um JPEG quadrado (recorte central, espelhado como no
 * preview). Sem câmera/permissão, mostra erro acionável em vez de quebrar.
 */
function CameraCapture({
  onCapture,
  onClose,
}: {
  onCapture: (file: File) => void
  onClose: () => void
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error("getUserMedia indisponível (contexto inseguro?)")
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        if (videoRef.current) videoRef.current.srcObject = stream
      } catch {
        if (!cancelled)
          setError(
            "Não foi possível acessar a câmera. Verifique a permissão do navegador ou anexe uma foto.",
          )
      }
    }
    start()
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const capture = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement("canvas")
    const size = Math.min(video.videoWidth, video.videoHeight)
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    // Espelha (selfie) e recorta um quadrado central do vídeo.
    ctx.translate(size, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(
      video,
      (video.videoWidth - size) / 2,
      (video.videoHeight - size) / 2,
      size,
      size,
      0,
      0,
      size,
      size,
    )
    canvas.toBlob(
      (blob) => {
        if (!blob) return
        onCapture(new File([blob], "selfie.jpg", { type: "image/jpeg" }))
        onClose()
      },
      "image/jpeg",
      0.9,
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Tirar foto com a câmera"
    >
      <div className="bg-card w-full max-w-sm rounded-xl p-4 shadow-lg">
        <p className="mb-3 text-sm font-medium">Tirar foto de perfil</p>
        {error ? (
          <p className="text-destructive mb-3 text-sm" role="alert">
            {error}
          </p>
        ) : (
          <div className="bg-muted relative aspect-square w-full overflow-hidden rounded-lg">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="size-full scale-x-[-1] object-cover"
            />
          </div>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          {!error && (
            <Button
              type="button"
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={capture}
            >
              Capturar
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export function ProviderOnboarding({ onComplete }: { onComplete: () => void }) {
  const setUser = useAuthStore((s) => s.setUser)
  const user = useAuthStore((s) => s.user)
  const [step, setStep] = React.useState(0)
  // Direção da transição: 1 = avançar (entra pela direita), -1 = voltar.
  const [direction, setDirection] = React.useState<1 | -1>(1)
  const [stepError, setStepError] = React.useState<string | null>(null)
  const [finishing, setFinishing] = React.useState(false)

  // Boas-vindas personalizado — primeiro nome do prestador.
  const firstName = user?.name?.trim().split(/\s+/)[0] ?? ""

  // Foto de perfil: avatarUrl é o valor persistível (URL do storage);
  // localPreview é a prévia efêmera (objectURL) enquanto o upload roda.
  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(user?.avatarUrl ?? null)
  const [localPreview, setLocalPreview] = React.useState<string | null>(null)
  const [cameraOpen, setCameraOpen] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const { upload, uploading } = useUpload()

  const previewSrc = localPreview ?? avatarUrl

  const handleFileSelected = (file: File) => {
    const preview = URL.createObjectURL(file)
    setLocalPreview(preview)
    upload(file, "avatar").then((url) => {
      URL.revokeObjectURL(preview)
      setLocalPreview((cur) => (cur === preview ? null : cur))
      if (url) setAvatarUrl(url)
      // falha: o hook já mostra o toast; a prévia some e nada é persistido
    })
  }

  const removeAvatar = () => {
    setAvatarUrl(null)
    setLocalPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const { data: savedProgress } = useQuery({
    queryKey: ["onboarding-progress", user?.id],
    queryFn: () => apiGet<{ step: number; done: boolean }>("/api/provider/onboarding"),
    enabled: !!user,
    staleTime: 30_000,
  })

  // Restore saved progress step when it loads (adjust state during render)
  const [prevProgress, setPrevProgress] = React.useState(savedProgress)
  if (
    savedProgress &&
    !savedProgress.done &&
    savedProgress.step > 0 &&
    prevProgress !== savedProgress
  ) {
    setPrevProgress(savedProgress)
    setStep(savedProgress.step)
  }
  // Etapas já visitadas (nesta sessão ou em sessões salvas) — a maior etapa
  // alcançada. Passos à frente do atual dentro desse alcance aparecem com
  // borda tracejada no stepper (visitada, ainda não concluída de novo).
  // Ajuste de estado durante o render (padrão React para derivar de estado
  // sem effect em cascata): cada novo `step` amplia o alcance visitado.
  const [visitedState, setVisitedState] = React.useState({ lastStep: step, max: step })
  if (visitedState.lastStep !== step) {
    setVisitedState({ lastStep: step, max: Math.max(visitedState.max, step) })
  }
  const maxVisitedStep = visitedState.max
  const [form, setForm] = React.useState({
    name: user?.name ?? "",
    bio: user?.bio ?? "",
    whatsapp: user?.whatsapp ?? "",
    city: user?.city ?? "",
    state: user?.state ?? "",
    cep: "",
    street: "",
    number: "",
    serviceTitle: "",
    serviceDescription: "",
    serviceCategory: "",
    servicePrice: "",
    serviceUnit: "UNIDADE",
    serviceDuration: "",
  })

  // Dados do cadastro (nome/bio/whatsapp/cidade/estado) hidratam quando o
  // fetchMe chega DEPOIS da montagem do wizard (uma única vez; nunca
  // sobrescreve o que o prestador já digitou).
  const initials = form.name
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase()
  const [prevSeedUser, setPrevSeedUser] = React.useState(user)
  if (user && prevSeedUser !== user) {
    setPrevSeedUser(user)
    setForm((f) => ({
      ...f,
      name: f.name || user.name || "",
      bio: f.bio || user.bio || "",
      whatsapp: f.whatsapp || user.whatsapp || "",
      city: f.city || user.city || "",
      state: f.state || user.state || "",
    }))
  }
  const [providerLat, setProviderLat] = React.useState<number | null>(null)
  const [providerLng, setProviderLng] = React.useState<number | null>(null)
  const [providerRadius, setProviderRadius] = React.useState(15)
  // Precisão da fix do GPS (± m) — desenha o círculo pontilhado de incerteza no mapa.
  const [providerAccuracy, setProviderAccuracy] = React.useState<number | null>(null)
  // Token de sessão do refino por densidade: uma nova fix de GPS invalida
  // refinos pendentes da fix anterior.
  const geoCaptureSeqRef = React.useRef(0)
  const [soundEnabled, setSoundEnabled] = React.useState(true)
  // Auto-preenchimento de endereço: busca por CEP (ViaCEP) e GPS (Nominatim reverse).
  const [cepLoading, setCepLoading] = React.useState(false)
  const [cepError, setCepError] = React.useState<string | null>(null)
  const [geoLoading, setGeoLoading] = React.useState(false)
  const [geoHint, setGeoHint] = React.useState<string | null>(null)
  const [vibrateEnabled, setVibrateEnabled] = React.useState(true)
  const [slots, setSlots] = React.useState(
    WEEKDAYS.map((_, i) => ({
      active: i < 5,
      start: "08:00",
      end: "18:00",
    })),
  )

  // Subcategorias (level 2) para o select do passo Serviços — o
  // `serviceSchema` EXIGE categoryId; sem isto o POST do serviço 400.
  const { data: categories } = useQuery({
    queryKey: ["onboarding-categories"],
    queryFn: () => apiGet<CategoryNode[]>("/api/categories"),
    staleTime: 5 * 60_000,
  })
  const subcategories = React.useMemo(() => {
    const out: { id: string; label: string }[] = []
    const walk = (nodes: CategoryNode[] | undefined, parents: string[]) => {
      for (const node of nodes ?? []) {
        const label = [...parents, node.name].join(" › ")
        if (node.children && node.children.length > 0) {
          walk(node.children, [...parents, node.name])
        } else if (node.level >= 1) {
          out.push({ id: node.id, label })
        }
      }
    }
    walk(categories, [])
    out.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"))
    return out
  }, [categories])

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

  // Validação inline por passo — a mensagem nasce sob o campo no submit
  // tentado (nada de next cego para um passo inválido).
  const validateStep = (s: number): string | null => {
    if (s === 0 && form.name.trim().length < 2) return "Informe seu nome (mínimo 2 letras)."
    if (s === 1 && form.city.trim().length < 2)
      return "Informe a cidade — é ela que coloca você nos resultados de busca."
    if (s === 2 && !slots.some((slot) => slot.active))
      return "Marque pelo menos um dia de atendimento."
    if (s === 3) {
      if (form.serviceTitle.trim().length < 3) return "Título do serviço: mínimo 3 letras."
      if (form.serviceDescription.trim().length < 10)
        return "Descreva o serviço em pelo menos 10 caracteres."
      if (!form.serviceCategory) return "Selecione a subcategoria do serviço."
      const price = Number(form.servicePrice)
      if (!form.servicePrice || Number.isNaN(price) || price < 0)
        return "Informe o preço base (R$)."
      if (form.serviceDuration) {
        const duration = Number(form.serviceDuration)
        if (!Number.isInteger(duration) || duration < 15 || duration > 480)
          return "Duração entre 15 e 480 minutos."
      }
    }
    return null
  }

  /** Aplica o resultado do ViaCEP ao form (só preenche o que veio vazio do usuário). */
  const applyCepResult = React.useCallback(
    (addr: { street?: string; city?: string; state?: string }) => {
      setForm((prev) => ({
        ...prev,
        street: prev.street.trim() || (addr.street ?? ""),
        city: prev.city.trim() || (addr.city ?? ""),
        state: prev.state.trim() || (addr.state ?? ""),
      }))
    },
    [],
  )

  /** CEP completo (8 dígitos) → ViaCEP → preenche rua/cidade/estado. */
  const handleCepChange = async (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 8)
    const masked = digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits
    setForm((prev) => ({ ...prev, cep: masked }))
    setCepError(null)

    if (digits.length !== 8) return
    setCepLoading(true)
    try {
      const cached = getCachedCep(digits)
      if (cached) {
        applyCepResult(cached)
        return
      }
      const addr = await fetchCep(digits)
      setCachedCep(digits, addr)
      applyCepResult(addr)
    } catch {
      setCepError("CEP não encontrado — verifique o número ou preencha manualmente.")
    } finally {
      setCepLoading(false)
    }
  }

  /** GPS do dispositivo → Nominatim reverse → CEP/cidade/estado/rua precisos. */
  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      setGeoHint("Seu navegador não suporta localização — use o CEP.")
      return
    }
    setGeoLoading(true)
    setGeoHint(null)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude, accuracy } = pos.coords
          setProviderLat(latitude)
          setProviderLng(longitude)
          setProviderAccuracy(accuracy ?? null)
          // Raio inicial ideal a partir da precisão da fix (±accuracy em m) —
          // o mapa centraliza e o slider seguem a sugestão.
          const suggestedRadius = suggestRadiusFromAccuracy(accuracy)
          setProviderRadius(suggestedRadius)
          const addr = await fetchReverseGeo(latitude, longitude)
          setForm((prev) => ({
            ...prev,
            street: prev.street.trim() || (addr.street ?? ""),
            city: prev.city.trim() || (addr.city ?? ""),
            state: prev.state.trim() || (addr.state ?? ""),
            cep: prev.cep.replace(/\D/g, "").length === 8 ? prev.cep : (addr.cep ?? ""),
          }))
          setGeoHint(
            addr.cep
              ? `Endereço preenchido pelo GPS — confira antes de seguir. Raio inicial sugerido: ${suggestedRadius} km.`
              : `Local encontrado — complete o CEP se souber. Raio inicial sugerido: ${suggestedRadius} km.`,
          )

          // Refino assíncrono com as métricas de busca do marketplace
          // (densidade de prestadores por bairro): área densa encolhe o raio,
          // área esparsa cresce. A sugestão por accuracy já está aplicada —
          // o refino só substitui quando muda o número, e uma nova fix
          // (token) ou falha da API mantém a sugestão original.
          const capture = ++geoCaptureSeqRef.current
          const fixAccuracy = accuracy
          void refineSuggestedRadius({
            accuracyM: fixAccuracy,
            baseRadiusKm: suggestedRadius,
            lat: latitude,
            lng: longitude,
          }).then((refined) => {
            if (!refined || geoCaptureSeqRef.current !== capture) return
            setProviderRadius(refined.radiusKm)
            const densityText = `Raio ajustado pela densidade local: ${refined.radiusKm} km — ${nearbyPhrase(refined.nearbyCount)}${refined.district ? ` · bairro mais denso: ${refined.district}` : ""}.`
            setGeoHint(
              addr.cep
                ? `Endereço preenchido pelo GPS — confira antes de seguir. ${densityText}`
                : `Local encontrado — complete o CEP se souber. ${densityText}`,
            )
          })
        } catch {
          setGeoHint("Não foi possível ler o endereço do GPS — use o CEP.")
        } finally {
          // Caminho de sucesso não desligava o spinner (só o catch fazia).
          setGeoLoading(false)
        }
      },
      (err) => {
        setGeoLoading(false)
        setGeoHint(
          err.code === err.PERMISSION_DENIED
            ? "Permissão de localização negada — use o CEP."
            : "Não conseguimos obter sua localização — use o CEP.",
        )
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    )
  }

  const handleNext = async () => {
    const error = validateStep(step)
    if (error) {
      setStepError(error)
      return
    }
    setStepError(null)
    try {
      if (step === 0) {
        await updateProfile.mutateAsync({
          name: form.name,
          bio: form.bio,
          whatsapp: form.whatsapp,
          soundEnabled,
          vibrateEnabled,
          // Foto de perfil: só envia quando mudou ("" remove — o schema
          // aceita literal(""), o route converte para null).
          ...(avatarUrl !== (user?.avatarUrl ?? null) ? { avatarUrl: avatarUrl ?? "" } : {}),
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
          // Persiste a precisão da fix — o círculo de incerteza reaparece com
          // a localização salva (mini-map do perfil), sem nova fix.
          if (providerAccuracy != null) {
            profileUpdate.gpsAccuracyM = providerAccuracy
          }
        }
        await updateProfile.mutateAsync(profileUpdate)
      }
    } catch (err) {
      const message =
        (err as { message?: string } | null)?.message ?? "Não foi possível salvar. Tente de novo."
      setStepError(message)
      return
    }
    const nextStep = Math.min(step + 1, STEPS.length - 1)
    setDirection(1)
    setStep(nextStep)
    apiPatch("/api/provider/onboarding", { step: nextStep }).catch((err) => {
      console.warn("[onboarding] failed to save step:", err)
    })
  }

  // PASSO FINAL — nada silencioso: serviço com o payload COMPLETO do
  // `serviceSchema` (description + categoryId obrigatórios), availability no
  // contrato real (`{ items: [...] }`), e o `done` só depois de tudo que
  // importava ter dado certo. Falha de availability avisa mas não impede —
  // o provider ajusta em Horários depois.
  const handleFinish = async () => {
    const error = validateStep(3)
    if (error) {
      setStepError(error)
      return
    }
    setStepError(null)
    setFinishing(true)
    try {
      await apiPost("/api/services", {
        title: form.serviceTitle.trim(),
        description: form.serviceDescription.trim(),
        categoryId: form.serviceCategory,
        basePrice: Number(form.servicePrice),
        unit: form.serviceUnit,
        ...(form.serviceDuration ? { duration: Number(form.serviceDuration) } : {}),
        photos: [],
        active: true,
      })
    } catch (err) {
      toast.error(
        (err as { message?: string } | null)?.message ??
          "Erro ao criar serviço. Revise os dados e tente de novo.",
      )
      setFinishing(false)
      return
    }
    try {
      await apiPost("/api/availability", {
        items: slots
          .map((s, dayOfWeek) => ({
            dayOfWeek,
            startTime: s.start,
            endTime: s.end,
            active: s.active,
          }))
          .filter((item) => item.active),
      })
    } catch (err) {
      toast.warning(
        (err as { message?: string } | null)?.message ??
          "Serviço criado, mas os horários não foram salvos — ajuste na aba Horários.",
      )
    }
    try {
      await apiPatch("/api/provider/onboarding", { step: 4, done: true })
    } catch (err) {
      toast.error(
        (err as { message?: string } | null)?.message ??
          "Serviço criado, mas não consegui registrar a conclusão — reabra o painel.",
      )
      setFinishing(false)
      return
    }
    toast.success("Cadastro completo! Bem-vindo ao Severinno.")
    setFinishing(false)
    onComplete()
  }

  const pending = updateProfile.isPending || finishing

  return (
    <div className="mx-auto flex min-h-screen max-w-lg items-center justify-center p-6">
      <Card className="w-full">
        <CardHeader className="gap-3">
          {/* Progresso: segmento por etapa — concluída preenche (e é um
              botão para voltar direto à etapa), atual pulsa. A semântica
              ARIA de progressbar fica num elemento sr-only: botões dentro
              de progressbar seriam inválidos. */}
          <div>
            <div
              role="progressbar"
              className="sr-only"
              aria-valuemin={1}
              aria-valuemax={STEPS.length}
              aria-valuenow={step + 1}
              aria-label={`Etapa ${step + 1} de ${STEPS.length}: ${STEPS[step]}`}
            />
            <div className="flex gap-1.5">
              {STEPS.map((label, i) => {
                const isDone = i < step
                const isCurrent = i === step
                // Visitada mas não concluída (de novo): o usuário já esteve
                // aqui (nesta sessão ou pela progressão salva) e voltou.
                const isVisited = !isDone && !isCurrent && i <= maxVisitedStep
                const segment = cn(
                  "h-1.5 flex-1 rounded-full transition-colors duration-300",
                  isDone
                    ? "bg-emerald-600"
                    : isCurrent
                      ? "animate-pulse bg-emerald-500"
                      : isVisited
                        ? "border border-dashed border-amber-600/70 bg-amber-100/70 dark:border-amber-400/60 dark:bg-amber-900/30"
                        : "bg-muted",
                )
                if (!isDone) {
                  return (
                    <span
                      key={label}
                      aria-hidden
                      data-step-index={i}
                      data-visited={isVisited ? "true" : undefined}
                      title={
                        isVisited
                          ? `Você já visitou ${label} — ainda não concluída de novo`
                          : undefined
                      }
                      className={segment}
                    />
                  )
                }
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      if (pending || i === step) return
                      setStepError(null)
                      setDirection(-1)
                      setStep(i)
                    }}
                    aria-label={`Voltar para a etapa ${i + 1}: ${label}`}
                    title={`Revisar ${label}`}
                    disabled={pending}
                    className={cn(
                      segment,
                      "cursor-pointer hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600",
                    )}
                  />
                )
              })}
            </div>
            <p className="text-muted-foreground mt-2 text-xs">
              Passo {step + 1} de {STEPS.length} · {STEPS[step]}
            </p>
            {user?.city ? (
              <p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
                <MapPin className="size-3.5 text-emerald-600" aria-hidden />
                <span>
                  Você está em{" "}
                  <span className="text-foreground font-medium">
                    {user.city}
                    {user.state ? ` — ${user.state}` : ""}
                  </span>
                </span>
              </p>
            ) : step === 0 ? (
              <p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
                <MapPin className="size-3.5 text-emerald-600" aria-hidden />
                Sua cidade aparece aqui — complete o passo Endereço.
              </p>
            ) : null}
          </div>
          <CardTitle className="text-lg font-semibold tracking-tight">
            {step === 0 && firstName ? `Olá, ${firstName}! 👋` : STEP_TITLES[step]}
          </CardTitle>
          <CardDescription>
            {step === 0 && firstName
              ? "Falta pouco para você começar a receber clientes."
              : STEP_DESCRIPTIONS[step]}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 24 * direction }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 * direction }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              {step === 0 && (
                <div className="grid gap-4">
                  {/* Foto de perfil — anexar arquivo ou tirar na hora (webcam/selfie) */}
                  <div className="grid gap-2">
                    <Label>Foto de perfil</Label>
                    <div className="flex items-center gap-4">
                      <div className="bg-muted relative size-20 shrink-0 overflow-hidden rounded-full border">
                        {previewSrc ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={previewSrc}
                            alt="Prévia da foto de perfil"
                            className="size-full object-cover"
                          />
                        ) : (
                          <div className="text-muted-foreground flex size-full items-center justify-center">
                            <ImagePlus className="size-6" aria-hidden />
                          </div>
                        )}
                        {uploading && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
                            <Loader2 className="size-5 animate-spin" aria-hidden />
                          </div>
                        )}
                      </div>
                      <div className="grid gap-1.5">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={uploading}
                            onClick={() => fileInputRef.current?.click()}
                          >
                            <ImagePlus className="mr-1 size-4" aria-hidden /> Anexar foto
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={uploading}
                            onClick={() => setCameraOpen(true)}
                          >
                            <Camera className="mr-1 size-4" aria-hidden /> Tirar foto
                          </Button>
                          {previewSrc && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={uploading}
                              onClick={removeAvatar}
                            >
                              <X className="mr-1 size-4" aria-hidden /> Remover
                            </Button>
                          )}
                        </div>
                        <p className="text-muted-foreground text-xs">
                          JPG, PNG ou WebP · até 10 MB
                        </p>
                      </div>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      className="hidden"
                      aria-label="Anexar foto de perfil"
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) handleFileSelected(f)
                        e.target.value = ""
                      }}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="ob-name">Nome</Label>
                    <Input
                      id="ob-name"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Seu nome como aparecerá para clientes"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="ob-bio">Bio</Label>
                    <Textarea
                      id="ob-bio"
                      value={form.bio}
                      onChange={(e) => setForm({ ...form, bio: e.target.value })}
                      placeholder="Conte um pouco sobre você..."
                      rows={3}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="ob-whatsapp">WhatsApp</Label>
                    <Input
                      id="ob-whatsapp"
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
                  {/* Atalho GPS — preenche tudo com a localização real do dispositivo */}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleUseMyLocation}
                      disabled={geoLoading}
                      className="border-emerald-600/40 text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                    >
                      {geoLoading ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <LocateFixed className="size-4" aria-hidden />
                      )}
                      {geoLoading ? "Localizando…" : "Usar GPS do celular"}
                    </Button>
                    <p className="text-muted-foreground text-xs">
                      ou digite o CEP — preenchemos o resto
                    </p>
                  </div>
                  {geoHint && (
                    <p
                      role="status"
                      className={cn(
                        "text-xs",
                        geoHint.includes("negada") ||
                          geoHint.includes("não") ||
                          geoHint.includes("Não")
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-emerald-700 dark:text-emerald-400",
                      )}
                    >
                      {geoHint}
                    </p>
                  )}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2 grid gap-2">
                      <Label htmlFor="ob-city">Cidade</Label>
                      <Input
                        id="ob-city"
                        value={form.city}
                        onChange={(e) => setForm({ ...form, city: e.target.value })}
                        placeholder="Governador Valadares"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="ob-state">Estado</Label>
                      <Input
                        id="ob-state"
                        value={form.state}
                        onChange={(e) => setForm({ ...form, state: e.target.value })}
                        placeholder="MG"
                        maxLength={2}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2 grid gap-2">
                      <Label htmlFor="ob-street">Rua</Label>
                      <Input
                        id="ob-street"
                        value={form.street}
                        onChange={(e) => setForm({ ...form, street: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="ob-number">Número</Label>
                      <Input
                        id="ob-number"
                        value={form.number}
                        onChange={(e) => setForm({ ...form, number: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="ob-cep">CEP</Label>
                    <div className="relative">
                      <Input
                        id="ob-cep"
                        value={form.cep}
                        onChange={(e) => void handleCepChange(e.target.value)}
                        placeholder="00000-000"
                        inputMode="numeric"
                        autoComplete="postal-code"
                        aria-describedby="ob-cep-feedback"
                        className="pr-9"
                      />
                      {cepLoading && (
                        <Loader2
                          className="text-muted-foreground absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin"
                          aria-hidden
                        />
                      )}
                    </div>
                    <div id="ob-cep-feedback" aria-live="polite">
                      {cepError ? (
                        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                          {cepError}
                        </p>
                      ) : (
                        cepLoading && (
                          <p className="text-muted-foreground text-xs">Buscando endereço…</p>
                        )
                      )}
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
                      accuracyM={providerAccuracy}
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
                          className="size-4 accent-emerald-600"
                        />
                        {day}
                      </label>
                      {slots[i].active && (
                        <>
                          <input
                            type="time"
                            aria-label={`${day} — início`}
                            value={slots[i].start}
                            onChange={(e) => updateSlot(i, "start", e.target.value)}
                            className="bg-background h-9 rounded-md border px-2 text-sm"
                          />
                          <span className="text-muted-foreground text-xs">às</span>
                          <input
                            type="time"
                            aria-label={`${day} — fim`}
                            value={slots[i].end}
                            onChange={(e) => updateSlot(i, "end", e.target.value)}
                            className="bg-background h-9 rounded-md border px-2 text-sm"
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
                  {/* Resumo do perfil — revisão rápida antes de publicar */}
                  <div className="bg-muted/30 flex items-center gap-3 rounded-lg border p-3">
                    {avatarUrl || localPreview ? (
                      // <img> de propósito: o localPreview é blob: URL de
                      // URL.createObjectURL(file) — o <Image> do next não
                      // parseia blob:, e a prévia de 40px não usa otimizador.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={avatarUrl ?? localPreview ?? undefined}
                        alt="Foto do prestador"
                        className="size-12 shrink-0 rounded-full object-cover ring-2 ring-emerald-600/20"
                      />
                    ) : (
                      <div
                        aria-hidden
                        className="flex size-12 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                      >
                        {initials || "?"}
                      </div>
                    )}
                    <div className="min-w-0 text-xs">
                      <p className="truncate text-sm font-semibold">{form.name || "Seu nome"}</p>
                      <p className="text-muted-foreground truncate">
                        {[form.city, form.state].filter(Boolean).join(" — ")}
                        {form.whatsapp ? ` · ${form.whatsapp}` : ""}
                      </p>
                      <p className="text-emerald-700 dark:text-emerald-400">
                        Confira tudo antes de publicar ✨
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="ob-svc-title">Nome do serviço</Label>
                    <Input
                      id="ob-svc-title"
                      value={form.serviceTitle}
                      onChange={(e) => setForm({ ...form, serviceTitle: e.target.value })}
                      placeholder="Ex: Troca de tomada e interruptores"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="ob-svc-desc">Descrição</Label>
                    <Textarea
                      id="ob-svc-desc"
                      value={form.serviceDescription}
                      onChange={(e) => setForm({ ...form, serviceDescription: e.target.value })}
                      placeholder="O que está incluído, materiais, garantia..."
                      rows={3}
                    />
                    <p className="text-muted-foreground text-xs">
                      {form.serviceDescription.trim().length}/10 caracteres mínimos
                    </p>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="ob-svc-cat">Subcategoria</Label>
                    <select
                      id="ob-svc-cat"
                      value={form.serviceCategory}
                      onChange={(e) => setForm({ ...form, serviceCategory: e.target.value })}
                      className={selectClass}
                    >
                      <option value="">
                        {subcategories.length > 0
                          ? "Selecione a subcategoria"
                          : "Carregando categorias..."}
                      </option>
                      {subcategories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="grid gap-2">
                      <Label htmlFor="ob-svc-price">Preço (R$)</Label>
                      <Input
                        id="ob-svc-price"
                        type="number"
                        min={0}
                        step="0.01"
                        value={form.servicePrice}
                        onChange={(e) => setForm({ ...form, servicePrice: e.target.value })}
                        placeholder="99.90"
                      />
                    </div>
                    <div className="col-span-2 grid gap-2">
                      <Label htmlFor="ob-svc-unit">Cobrança</Label>
                      <select
                        id="ob-svc-unit"
                        value={form.serviceUnit}
                        onChange={(e) => setForm({ ...form, serviceUnit: e.target.value })}
                        className={selectClass}
                      >
                        {SERVICE_UNITS.map((unit) => (
                          <option key={unit.value} value={unit.value}>
                            {unit.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="ob-svc-duration">Duração (min)</Label>
                    <Input
                      id="ob-svc-duration"
                      type="number"
                      min={15}
                      max={480}
                      step={5}
                      value={form.serviceDuration}
                      onChange={(e) => setForm({ ...form, serviceDuration: e.target.value })}
                      placeholder="60"
                    />
                  </div>
                </div>
              )}
              {stepError && (
                <p className="text-destructive text-sm" role="alert">
                  {stepError}
                </p>
              )}
            </motion.div>
          </AnimatePresence>
        </CardContent>
        <CardFooter className="justify-between border-t pt-4">
          <Button
            variant="ghost"
            disabled={step === 0 || pending}
            onClick={() => {
              setStepError(null)
              setDirection(-1)
              setStep((s) => s - 1)
            }}
          >
            <ChevronLeft className="mr-1 size-4" /> Voltar
          </Button>
          {step < STEPS.length - 1 ? (
            <Button
              onClick={handleNext}
              disabled={pending}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {updateProfile.isPending ? (
                <>
                  Salvando... <ChevronRight className="ml-1 size-4" />
                </>
              ) : (
                <>
                  Próximo <ChevronRight className="ml-1 size-4" />
                </>
              )}
            </Button>
          ) : (
            <Button
              onClick={handleFinish}
              disabled={pending}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {finishing ? (
                <>
                  Publicando... <Check className="ml-1 size-4" />
                </>
              ) : (
                <>
                  Publicar meu serviço <Check className="ml-1 size-4" />
                </>
              )}
            </Button>
          )}
        </CardFooter>
      </Card>
      {cameraOpen && (
        <CameraCapture
          onCapture={(file) => handleFileSelected(file)}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </div>
  )
}
