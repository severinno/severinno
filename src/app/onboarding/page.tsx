/**
 * Provider Onboarding Wizard — 3 steps to get started.
 *
 * Step 1: Define address + service radius
 * Step 2: Add first service with photo
 * Step 3: Preview profile + go live
 *
 * Saves progress to localStorage so providers can resume later.
 */
"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { PageTransition } from "@/components/shared/page-transition"
import { CheckCircle2, Sparkles, Loader2, ArrowRight } from "lucide-react"
import { launchConfetti } from "@/lib/confetti"

type OnboardingStep = 1 | 2 | 3

type OnboardingData = {
  // Step 1: Address
  cep: string
  street: string
  number: string
  district: string
  city: string
  state: string
  lat: number | null
  lng: number | null
  radiusKm: number
  // Step 2: First service
  serviceTitle: string
  serviceDescription: string
  serviceCategory: string
  servicePrice: number
  serviceDurationMinutes: number
  // Step 3: Profile
  bio: string
  experience: string
}

const STORAGE_KEY = "severinno-onboarding"

const CATEGORIES = [
  "Limpeza",
  "Encanamento",
  "Elétrica",
  "Pintura",
  "Montagem de Móveis",
  "Jardinagem",
  "Manutenção",
  "Dedetização",
  "Marcenaria",
  "Serralheria",
  "Outro",
]

const STEPS = [
  { number: 1, title: "Endereço", description: "Onde você atende" },
  { number: 2, title: "Serviço", description: "Seu primeiro serviço" },
  { number: 3, title: "Revisão", description: "Tudo certo?" },
]

function StepIndicator({ current }: { current: OnboardingStep }) {
  const percentage = current === 1 ? 33 : current === 2 ? 66 : 100
  return (
    <div className="mb-6 space-y-3">
      <div className="flex items-center justify-between text-xs font-semibold">
        <span className="text-gray-700 dark:text-gray-300">
          Passo {current} de 3: {STEPS[current - 1].title}
        </span>
        <span className="font-bold text-emerald-600">{percentage}% concluído</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-600 to-emerald-500 transition-all duration-500 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="flex items-center justify-between pt-1">
        {STEPS.map((step) => {
          const isDone = step.number < current
          const isCurrent = step.number === current
          return (
            <div key={step.number} className="flex items-center gap-2">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-all ${
                  isCurrent
                    ? "bg-blue-600 text-white shadow-xs ring-4 ring-blue-100"
                    : isDone
                      ? "bg-emerald-500 text-white"
                      : "bg-gray-200 text-gray-500"
                }`}
              >
                {isDone ? "✓" : step.number}
              </div>
              <span
                className={`hidden text-xs font-medium sm:inline ${
                  isCurrent ? "font-semibold text-gray-900" : "text-gray-500"
                }`}
              >
                {step.title}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Step1Address({
  data,
  onChange,
  onNext,
}: {
  data: OnboardingData
  onChange: (d: Partial<OnboardingData>) => void
  onNext: () => void
}) {
  const [isSearchingCep, setIsSearchingCep] = useState(false)
  const [cepFeedback, setCepFeedback] = useState<string | null>(null)

  const handleCepChange = async (val: string) => {
    onChange({ cep: val })
    const clean = val.replace(/\D/g, "")
    if (clean.length === 8) {
      setIsSearchingCep(true)
      setCepFeedback(null)
      try {
        const res = await fetch(`/api/geo/cep?cep=${clean}`)
        if (res.ok) {
          const json = await res.json()
          if (json.data && !json.data.error) {
            onChange({
              street: json.data.street || data.street,
              district: json.data.district || data.district,
              city: json.data.city || data.city,
              state: json.data.state || data.state,
              lat: json.data.lat ?? data.lat,
              lng: json.data.lng ?? data.lng,
            })
            setCepFeedback("✅ Endereço localizado automaticamente!")
          } else {
            setCepFeedback("CEP não encontrado. Preencha manualmente.")
          }
        }
      } catch {
        setCepFeedback("Erro ao consultar CEP. Preencha os campos abaixo.")
      } finally {
        setIsSearchingCep(false)
      }
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">📍 Onde você trabalha?</h2>
      <p className="text-gray-600">Defina seu endereço para clientes encontrarem você.</p>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-sm font-medium">CEP</label>
            {isSearchingCep && (
              <span className="flex animate-pulse items-center gap-1 text-xs font-medium text-blue-600">
                <Loader2 className="h-3 w-3 animate-spin" /> Buscando...
              </span>
            )}
          </div>
          <input
            type="text"
            value={data.cep}
            onChange={(e) => handleCepChange(e.target.value)}
            placeholder="30130-000"
            maxLength={9}
            className="w-full rounded-lg border px-3 py-2"
          />
          {cepFeedback && (
            <p className="mt-1 text-xs font-medium text-emerald-600">{cepFeedback}</p>
          )}
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Raio de atendimento</label>
          <select
            value={data.radiusKm}
            onChange={(e) => onChange({ radiusKm: Number(e.target.value) })}
            className="w-full rounded-lg border px-3 py-2"
          >
            <option value={5}>5 km</option>
            <option value={10}>10 km</option>
            <option value={15}>15 km</option>
            <option value={25}>25 km</option>
            <option value={50}>50 km</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <label className="mb-1 block text-sm font-medium">Rua</label>
          <input
            type="text"
            value={data.street}
            onChange={(e) => onChange({ street: e.target.value })}
            placeholder="Av. Augusto de Lima"
            className="w-full rounded-lg border px-3 py-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Número</label>
          <input
            type="text"
            value={data.number}
            onChange={(e) => onChange({ number: e.target.value })}
            placeholder="1000"
            className="w-full rounded-lg border px-3 py-2"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Bairro</label>
          <input
            type="text"
            value={data.district}
            onChange={(e) => onChange({ district: e.target.value })}
            placeholder="Centro"
            className="w-full rounded-lg border px-3 py-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Cidade</label>
          <input
            type="text"
            value={data.city}
            onChange={(e) => onChange({ city: e.target.value })}
            placeholder="Governador Valadares"
            className="w-full rounded-lg border px-3 py-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Estado</label>
          <input
            type="text"
            value={data.state}
            onChange={(e) => onChange({ state: e.target.value })}
            placeholder="MG"
            className="w-full rounded-lg border px-3 py-2"
          />
        </div>
      </div>

      <button
        onClick={onNext}
        disabled={!data.cep || !data.street || !data.city}
        className="w-full rounded-lg bg-blue-600 py-3 font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300"
      >
        Próximo →
      </button>
    </div>
  )
}

function Step2Service({
  data,
  onChange,
  onNext,
  onBack,
}: {
  data: OnboardingData
  onChange: (d: Partial<OnboardingData>) => void
  onNext: () => void
  onBack: () => void
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">🔧 Seu primeiro serviço</h2>
      <p className="text-gray-600">Adicione o serviço que você mais faz.</p>

      <div>
        <label className="mb-1 block text-sm font-medium">Categoria</label>
        <select
          value={data.serviceCategory}
          onChange={(e) => onChange({ serviceCategory: e.target.value })}
          className="w-full rounded-lg border px-3 py-2"
        >
          <option value="">Selecione...</option>
          {CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Nome do serviço</label>
        <input
          type="text"
          value={data.serviceTitle}
          onChange={(e) => onChange({ serviceTitle: e.target.value })}
          placeholder="Limpeza Residencial Completa"
          className="w-full rounded-lg border px-3 py-2"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Descrição</label>
        <textarea
          value={data.serviceDescription}
          onChange={(e) => onChange({ serviceDescription: e.target.value })}
          placeholder="Inclui limpeza de todos os cômodos, cozinha, banheiro e área externa..."
          rows={3}
          className="w-full rounded-lg border px-3 py-2"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Preço (R$)</label>
          <input
            type="number"
            value={data.servicePrice || ""}
            onChange={(e) => onChange({ servicePrice: Number(e.target.value) })}
            placeholder="150"
            className="w-full rounded-lg border px-3 py-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Duração (min)</label>
          <input
            type="number"
            value={data.serviceDurationMinutes || ""}
            onChange={(e) => onChange({ serviceDurationMinutes: Number(e.target.value) })}
            placeholder="120"
            className="w-full rounded-lg border px-3 py-2"
          />
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 rounded-lg border border-gray-300 py-3 font-semibold hover:bg-gray-50"
        >
          ← Voltar
        </button>
        <button
          onClick={onNext}
          disabled={!data.serviceTitle || !data.serviceCategory || !data.servicePrice}
          className="flex-1 rounded-lg bg-blue-600 py-3 font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300"
        >
          Próximo →
        </button>
      </div>
    </div>
  )
}

function Step3Review({
  data,
  onBack,
  onComplete,
  isSubmitting = false,
  error = null,
}: {
  data: OnboardingData
  onBack: () => void
  onComplete: () => void
  isSubmitting?: boolean
  error?: string | null
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">✅ Revisão final</h2>
      <p className="text-gray-600">Confirme seus dados antes de publicar.</p>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-3 rounded-lg bg-gray-50 p-4">
        <div>
          <span className="text-sm text-gray-500">Endereço</span>
          <p className="font-medium">
            {data.street}, {data.number} — {data.district}, {data.city}/{data.state}
          </p>
        </div>
        <div>
          <span className="text-sm text-gray-500">Raio</span>
          <p className="font-medium">{data.radiusKm} km</p>
        </div>
        <div>
          <span className="text-sm text-gray-500">Serviço</span>
          <p className="font-medium">
            {data.serviceTitle} — R$ {data.servicePrice}
          </p>
        </div>
        <div>
          <span className="text-sm text-gray-500">Categoria</span>
          <p className="font-medium">{data.serviceCategory}</p>
        </div>
      </div>

      <div className="rounded-lg border border-green-200 bg-green-50 p-4">
        <p className="text-sm text-green-800">
          🎉 Seu perfil será publicado imediatamente. Você receberá notificações quando clientes
          fizerem orçamentos na sua região.
        </p>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          disabled={isSubmitting}
          className="flex-1 rounded-lg border border-gray-300 py-3 font-semibold hover:bg-gray-50 disabled:opacity-50"
        >
          ← Voltar
        </button>
        <button
          onClick={onComplete}
          disabled={isSubmitting}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-600 py-3 font-semibold text-white hover:bg-green-700 disabled:opacity-50"
        >
          {isSubmitting ? (
            <>
              <span className="inline-block size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Salvando...
            </>
          ) : (
            "🚀 Publicar perfil"
          )}
        </button>
      </div>
    </div>
  )
}

export default function OnboardingPage() {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [step, setStep] = useState<OnboardingStep>(() => {
    if (typeof window === "undefined") return 1
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? (JSON.parse(saved).step ?? 1) : 1
    } catch {
      return 1
    }
  })
  const [data, setData] = useState<OnboardingData>(() => {
    if (typeof window === "undefined")
      return {
        cep: "",
        street: "",
        number: "",
        district: "",
        city: "Governador Valadares",
        state: "MG",
        lat: null,
        lng: null,
        radiusKm: 10,
        serviceTitle: "",
        serviceDescription: "",
        serviceCategory: "",
        servicePrice: 0,
        serviceDurationMinutes: 120,
        bio: "",
        experience: "",
      }
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved
        ? (JSON.parse(saved).data ?? {
            cep: "",
            street: "",
            number: "",
            district: "",
            city: "Governador Valadares",
            state: "MG",
            lat: null,
            lng: null,
            radiusKm: 10,
            serviceTitle: "",
            serviceDescription: "",
            serviceCategory: "",
            servicePrice: 0,
            serviceDurationMinutes: 120,
            bio: "",
            experience: "",
          })
        : {
            cep: "",
            street: "",
            number: "",
            district: "",
            city: "Governador Valadares",
            state: "MG",
            lat: null,
            lng: null,
            radiusKm: 10,
            serviceTitle: "",
            serviceDescription: "",
            serviceCategory: "",
            servicePrice: 0,
            serviceDurationMinutes: 120,
            bio: "",
            experience: "",
          }
    } catch {
      return {
        cep: "",
        street: "",
        number: "",
        district: "",
        city: "Governador Valadares",
        state: "MG",
        lat: null,
        lng: null,
        radiusKm: 10,
        serviceTitle: "",
        serviceDescription: "",
        serviceCategory: "",
        servicePrice: 0,
        serviceDurationMinutes: 120,
        bio: "",
        experience: "",
      }
    }
  })

  const [isCompleted, setIsCompleted] = useState(false)

  // Save to localStorage
  useEffect(() => {
    if (!isCompleted) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ step, data }))
    }
  }, [step, data, isCompleted])

  const handleChange = (partial: Partial<OnboardingData>) => {
    setData((prev) => ({ ...prev, ...partial }))
  }

  const handleComplete = async () => {
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch("/api/provider/onboarding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: 3, done: true }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || "Falha ao registrar conclusão do onboarding")
      }
      localStorage.removeItem(STORAGE_KEY)
      launchConfetti()
      setIsCompleted(true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao concluir onboarding"
      setSubmitError(msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isCompleted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-lg">
          <PageTransition className="space-y-6 rounded-2xl border border-emerald-100 bg-white p-8 text-center shadow-lg">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 shadow-inner">
              <Sparkles className="h-10 w-10 animate-pulse" />
            </div>

            <div className="space-y-1.5">
              <h2 className="text-2xl font-black tracking-tight text-gray-900">
                Parabéns! Seu perfil está ativo 🚀
              </h2>
              <p className="text-sm text-gray-600">
                Você já pode ser encontrado e receber pedidos de orçamento em{" "}
                {data.city || "sua região"}.
              </p>
            </div>

            {/* Profile Completeness Card */}
            <div className="space-y-3.5 rounded-xl border border-gray-100 bg-gray-50/80 p-5 text-left">
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="text-gray-700">Completude do Perfil</span>
                <span className="font-extrabold text-emerald-600">75% Concluído</span>
              </div>

              <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-200">
                <div className="h-full w-3/4 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-1000" />
              </div>

              <div className="space-y-2.5 pt-1 text-xs">
                <div className="flex items-center gap-2 font-medium text-emerald-700">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>Endereço e raio de atendimento definidos ({data.radiusKm} km)</span>
                </div>
                <div className="flex items-center gap-2 font-medium text-emerald-700">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>Primeiro serviço cadastrado ({data.serviceCategory})</span>
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-gray-400 text-[10px] font-bold">
                    3
                  </span>
                  <span>Envie seus documentos KYC para conquistar o Selo Verificado</span>
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-gray-400 text-[10px] font-bold">
                    4
                  </span>
                  <span>
                    Adicione fotos de serviços concluídos para atrair até 3x mais clientes
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={() => router.push("/dashboard")}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3.5 font-bold text-white shadow-md transition-all hover:bg-emerald-700 active:scale-[0.99]"
            >
              <span>Acessar Meu Painel</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </PageTransition>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Bem-vindo ao Severinno! 🏠</h1>
          <p className="mt-1 text-sm text-gray-600">Complete seu cadastro em 3 passos rápidos</p>
        </div>

        <StepIndicator current={step} />

        <PageTransition
          key={step}
          className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm"
        >
          {step === 1 && (
            <Step1Address data={data} onChange={handleChange} onNext={() => setStep(2)} />
          )}
          {step === 2 && (
            <Step2Service
              data={data}
              onChange={handleChange}
              onNext={() => setStep(3)}
              onBack={() => setStep(1)}
            />
          )}
          {step === 3 && (
            <Step3Review
              data={data}
              onBack={() => setStep(2)}
              onComplete={handleComplete}
              isSubmitting={isSubmitting}
              error={submitError}
            />
          )}
        </PageTransition>

        <div className="mx-auto mt-4 flex w-fit items-center justify-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span>Progresso salvo automaticamente no seu dispositivo.</span>
        </div>
      </div>
    </div>
  )
}
