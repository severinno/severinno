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
  return (
    <div className="flex items-center justify-center gap-4 mb-8">
      {STEPS.map((step) => (
        <div key={step.number} className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
              step.number === current
                ? "bg-blue-600 text-white"
                : step.number < current
                  ? "bg-green-500 text-white"
                  : "bg-gray-200 text-gray-500"
            }`}
          >
            {step.number < current ? "✓" : step.number}
          </div>
          <span className={`text-sm ${step.number === current ? "font-semibold" : "text-gray-500"}`}>
            {step.title}
          </span>
          {step.number < 3 && <div className="w-8 h-0.5 bg-gray-200" />}
        </div>
      ))}
    </div>
  )
}

function Step1Address({ data, onChange, onNext }: { data: OnboardingData; onChange: (d: Partial<OnboardingData>) => void; onNext: () => void }) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">📍 Onde você trabalha?</h2>
      <p className="text-gray-600">Defina seu endereço para clientes encontrarem você.</p>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">CEP</label>
          <input
            type="text"
            value={data.cep}
            onChange={(e) => onChange({ cep: e.target.value })}
            placeholder="30130-000"
            className="w-full border rounded-lg px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Raio de atendimento</label>
          <select
            value={data.radiusKm}
            onChange={(e) => onChange({ radiusKm: Number(e.target.value) })}
            className="w-full border rounded-lg px-3 py-2"
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
          <label className="block text-sm font-medium mb-1">Rua</label>
          <input
            type="text"
            value={data.street}
            onChange={(e) => onChange({ street: e.target.value })}
            placeholder="Av. Augusto de Lima"
            className="w-full border rounded-lg px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Número</label>
          <input
            type="text"
            value={data.number}
            onChange={(e) => onChange({ number: e.target.value })}
            placeholder="1000"
            className="w-full border rounded-lg px-3 py-2"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Bairro</label>
          <input
            type="text"
            value={data.district}
            onChange={(e) => onChange({ district: e.target.value })}
            placeholder="Centro"
            className="w-full border rounded-lg px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Cidade</label>
          <input
            type="text"
            value={data.city}
            onChange={(e) => onChange({ city: e.target.value })}
            placeholder="Governador Valadares"
            className="w-full border rounded-lg px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Estado</label>
          <input
            type="text"
            value={data.state}
            onChange={(e) => onChange({ state: e.target.value })}
            placeholder="MG"
            className="w-full border rounded-lg px-3 py-2"
          />
        </div>
      </div>

      <button
        onClick={onNext}
        disabled={!data.cep || !data.street || !data.city}
        className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-300"
      >
        Próximo →
      </button>
    </div>
  )
}

function Step2Service({ data, onChange, onNext, onBack }: { data: OnboardingData; onChange: (d: Partial<OnboardingData>) => void; onNext: () => void; onBack: () => void }) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">🔧 Seu primeiro serviço</h2>
      <p className="text-gray-600">Adicione o serviço que você mais faz.</p>

      <div>
        <label className="block text-sm font-medium mb-1">Categoria</label>
        <select
          value={data.serviceCategory}
          onChange={(e) => onChange({ serviceCategory: e.target.value })}
          className="w-full border rounded-lg px-3 py-2"
        >
          <option value="">Selecione...</option>
          {CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Nome do serviço</label>
        <input
          type="text"
          value={data.serviceTitle}
          onChange={(e) => onChange({ serviceTitle: e.target.value })}
          placeholder="Limpeza Residencial Completa"
          className="w-full border rounded-lg px-3 py-2"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Descrição</label>
        <textarea
          value={data.serviceDescription}
          onChange={(e) => onChange({ serviceDescription: e.target.value })}
          placeholder="Inclui limpeza de todos os cômodos, cozinha, banheiro e área externa..."
          rows={3}
          className="w-full border rounded-lg px-3 py-2"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Preço (R$)</label>
          <input
            type="number"
            value={data.servicePrice || ""}
            onChange={(e) => onChange({ servicePrice: Number(e.target.value) })}
            placeholder="150"
            className="w-full border rounded-lg px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Duração (min)</label>
          <input
            type="number"
            value={data.serviceDurationMinutes || ""}
            onChange={(e) => onChange({ serviceDurationMinutes: Number(e.target.value) })}
            placeholder="120"
            className="w-full border rounded-lg px-3 py-2"
          />
        </div>
      </div>

      <div className="flex gap-3">
        <button onClick={onBack} className="flex-1 border border-gray-300 py-3 rounded-lg font-semibold hover:bg-gray-50">
          ← Voltar
        </button>
        <button
          onClick={onNext}
          disabled={!data.serviceTitle || !data.serviceCategory || !data.servicePrice}
          className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-300"
        >
          Próximo →
        </button>
      </div>
    </div>
  )
}

function Step3Review({ data, onBack, onComplete }: { data: OnboardingData; onBack: () => void; onComplete: () => void }) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">✅ Revisão final</h2>
      <p className="text-gray-600">Confirme seus dados antes de publicar.</p>

      <div className="bg-gray-50 rounded-lg p-4 space-y-3">
        <div>
          <span className="text-sm text-gray-500">Endereço</span>
          <p className="font-medium">{data.street}, {data.number} — {data.district}, {data.city}/{data.state}</p>
        </div>
        <div>
          <span className="text-sm text-gray-500">Raio</span>
          <p className="font-medium">{data.radiusKm} km</p>
        </div>
        <div>
          <span className="text-sm text-gray-500">Serviço</span>
          <p className="font-medium">{data.serviceTitle} — R$ {data.servicePrice}</p>
        </div>
        <div>
          <span className="text-sm text-gray-500">Categoria</span>
          <p className="font-medium">{data.serviceCategory}</p>
        </div>
      </div>

      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <p className="text-green-800 text-sm">
          🎉 Seu perfil será publicado imediatamente. Você receberá notificações quando clientes fizerem orçamentos na sua região.
        </p>
      </div>

      <div className="flex gap-3">
        <button onClick={onBack} className="flex-1 border border-gray-300 py-3 rounded-lg font-semibold hover:bg-gray-50">
          ← Voltar
        </button>
        <button
          onClick={onComplete}
          className="flex-1 bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700"
        >
          🚀 Publicar perfil
        </button>
      </div>
    </div>
  )
}

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<OnboardingStep>(() => {
    if (typeof window === "undefined") return 1
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? JSON.parse(saved).step ?? 1 : 1
    } catch { return 1 }
  })
  const [data, setData] = useState<OnboardingData>(() => {
    if (typeof window === "undefined") return {
      cep: "", street: "", number: "", district: "", city: "Governador Valadares", state: "MG",
      lat: null, lng: null, radiusKm: 10,
      serviceTitle: "", serviceDescription: "", serviceCategory: "", servicePrice: 0, serviceDurationMinutes: 120,
      bio: "", experience: "",
    }
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? JSON.parse(saved).data ?? {
        cep: "", street: "", number: "", district: "", city: "Governador Valadares", state: "MG",
        lat: null, lng: null, radiusKm: 10,
        serviceTitle: "", serviceDescription: "", serviceCategory: "", servicePrice: 0, serviceDurationMinutes: 120,
        bio: "", experience: "",
      } : {
        cep: "", street: "", number: "", district: "", city: "Governador Valadares", state: "MG",
        lat: null, lng: null, radiusKm: 10,
        serviceTitle: "", serviceDescription: "", serviceCategory: "", servicePrice: 0, serviceDurationMinutes: 120,
        bio: "", experience: "",
      }
    } catch {
      return {
        cep: "", street: "", number: "", district: "", city: "Governador Valadares", state: "MG",
        lat: null, lng: null, radiusKm: 10,
        serviceTitle: "", serviceDescription: "", serviceCategory: "", servicePrice: 0, serviceDurationMinutes: 120,
        bio: "", experience: "",
      }
    }
  })

  // Save to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ step, data }))
  }, [step, data])

  const handleChange = (partial: Partial<OnboardingData>) => {
    setData((prev) => ({ ...prev, ...partial }))
  }

  const handleComplete = async () => {
    // TODO: Submit to API
    localStorage.removeItem(STORAGE_KEY)
    router.push("/dashboard")
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold">Bem-vindo ao Severinno! 🏠</h1>
          <p className="text-gray-600 mt-1">Complete seu cadastro em 3 passos rápidos</p>
        </div>

        <StepIndicator current={step} />

        <div className="bg-white rounded-xl shadow-sm p-6">
          {step === 1 && <Step1Address data={data} onChange={handleChange} onNext={() => setStep(2)} />}
          {step === 2 && <Step2Service data={data} onChange={handleChange} onNext={() => setStep(3)} onBack={() => setStep(1)} />}
          {step === 3 && <Step3Review data={data} onBack={() => setStep(2)} onComplete={handleComplete} />}
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          Seus dados são salvos automaticamente. Você pode voltar a qualquer momento.
        </p>
      </div>
    </div>
  )
}
