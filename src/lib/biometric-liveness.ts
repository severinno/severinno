import crypto from "crypto"
import { ensureConnected, activeTier } from "@/lib/redis"

export type LivenessStep = "BLINK" | "TURN_LEFT" | "TURN_RIGHT" | "SMILE"

export interface LivenessChallenge {
  id: string
  userId: string
  steps: LivenessStep[]
  createdAt: number
  expiresAt: number
  status: "PENDING" | "COMPLETED" | "EXPIRED"
}

export interface LivenessFrameData {
  step: LivenessStep
  timestamp: number
  faceBox: {
    x: number
    y: number
    width: number
    height: number
  }
  brightness: number
  aspectRatio: number
  imageDataHash?: string
}

export interface LivenessValidationResult {
  passed: boolean
  livenessScore: number
  reasons: string[]
  biometricToken?: string
}

const memoryChallenges = new Map<string, LivenessChallenge>()
const CHALLENGE_TTL_SECONDS = 300 // 5 minutos
const ALL_STEPS: LivenessStep[] = ["BLINK", "TURN_LEFT", "TURN_RIGHT", "SMILE"]

/**
 * Gera um desafio de vivacidade dinâmico e imprevisível para o usuário.
 */
export async function createLivenessChallenge(userId: string): Promise<LivenessChallenge> {
  const id = `liveness_${crypto.randomBytes(16).toString("hex")}`
  const now = Date.now()

  // Seleciona de 2 a 3 passos aleatórios em ordem imprevisível
  const shuffled = [...ALL_STEPS].sort(() => Math.random() - 0.5)
  const stepCount = Math.floor(Math.random() * 2) + 2 // 2 ou 3 passos
  const steps = shuffled.slice(0, stepCount)

  const challenge: LivenessChallenge = {
    id,
    userId,
    steps,
    createdAt: now,
    expiresAt: now + CHALLENGE_TTL_SECONDS * 1000,
    status: "PENDING",
  }

  // Tenta persistir no Redis
  try {
    const client = await ensureConnected()
    if (client && activeTier !== "memory") {
      await client.set(
        `liveness:challenge:${id}`,
        JSON.stringify(challenge),
        "EX",
        CHALLENGE_TTL_SECONDS,
      )
      return challenge
    }
  } catch {
    // Fallback em memória
  }

  memoryChallenges.set(id, challenge)
  return challenge
}

/**
 * Recupera o desafio ativo por ID.
 */
export async function getLivenessChallenge(id: string): Promise<LivenessChallenge | null> {
  try {
    const client = await ensureConnected()
    if (client && activeTier !== "memory") {
      const data = await client.get(`liveness:challenge:${id}`)
      if (data) return JSON.parse(data) as LivenessChallenge
    }
  } catch {
    // Fallback
  }

  const inMem = memoryChallenges.get(id)
  if (inMem) {
    if (Date.now() > inMem.expiresAt) {
      memoryChallenges.delete(id)
      return null
    }
    return inMem
  }

  return null
}

/**
 * Valida a submissão de quadros do teste de vivacidade (Anti-Spoofing & Liveness).
 */
export async function validateLivenessSubmission(
  challengeId: string,
  frames: LivenessFrameData[],
): Promise<LivenessValidationResult> {
  const reasons: string[] = []
  let score = 100

  // 1. Verifica desafio
  const challenge = await getLivenessChallenge(challengeId)
  if (!challenge) {
    return {
      passed: false,
      livenessScore: 0,
      reasons: ["Desafio de vivacidade inválido ou expirado."],
    }
  }

  if (challenge.status === "COMPLETED") {
    return {
      passed: false,
      livenessScore: 0,
      reasons: ["Desafio de vivacidade já foi utilizado anteriormente."],
    }
  }

  if (Date.now() > challenge.expiresAt) {
    return {
      passed: false,
      livenessScore: 0,
      reasons: ["Tempo limite do desafio excedido (5 minutos)."],
    }
  }

  // 2. Validação de quantidade de quadros
  if (!frames || frames.length < challenge.steps.length) {
    return {
      passed: false,
      livenessScore: 10,
      reasons: [
        `Quantidade de quadros insuficiente: recebidos ${frames?.length ?? 0}, esperados ${challenge.steps.length}.`,
      ],
    }
  }

  // 3. Ordem correta dos passos exigidos
  for (let i = 0; i < challenge.steps.length; i++) {
    const expectedStep = challenge.steps[i]
    const submittedFrame = frames[i]

    if (!submittedFrame || submittedFrame.step !== expectedStep) {
      score -= 40
      reasons.push(
        `Passo ${i + 1} incorreto: esperado ${expectedStep}, recebido ${submittedFrame?.step ?? "nenhum"}.`,
      )
    }
  }

  // 4. Verificação temporal e fluidez humana (evita bots e injeção de vídeo acelerado)
  const firstTime = frames[0].timestamp
  const lastTime = frames[frames.length - 1].timestamp
  const totalDurationMs = lastTime - firstTime

  // Muito rápido (< 600ms para 2-3 movimentos faciais) = bot ou script
  if (totalDurationMs < 600) {
    score -= 45
    reasons.push("Velocidade de execução incompatível com movimento biológico humano (< 600ms).")
  }

  // Muito lento (> 120s) = possível adulteração manual
  if (totalDurationMs > 120_000) {
    score -= 20
    reasons.push("Tempo total excedeu a tolerância normal de reação.")
  }

  // 5. Verificação de variação de movimento (Anti-Foto Estática / Papel Impresso)
  let totalDeltaX = 0
  let totalDeltaY = 0
  let totalDeltaWidth = 0

  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1].faceBox
    const curr = frames[i].faceBox

    totalDeltaX += Math.abs(curr.x - prev.x)
    totalDeltaY += Math.abs(curr.y - prev.y)
    totalDeltaWidth += Math.abs(curr.width - prev.width)
  }

  const averageDelta = (totalDeltaX + totalDeltaY + totalDeltaWidth) / (frames.length - 1)
  if (averageDelta < 0.005) {
    // Menos de 0.5% de movimento em 3 desafios = foto estática na frente da webcam
    score -= 50
    reasons.push(
      "Ausência de micro-movimento tridimensional detectada (suspeita de foto impressa ou estática).",
    )
  }

  // 6. Verificação de luminosidade e consistência ótica
  const brightnessValues = frames.map((f) => f.brightness)
  const minBrightness = Math.min(...brightnessValues)
  const maxBrightness = Math.max(...brightnessValues)

  if (minBrightness < 10) {
    score -= 15
    reasons.push("Iluminação excessivamente baixa. Rosto pouco discernível.")
  }

  if (maxBrightness > 250) {
    score -= 15
    reasons.push("Superexposição de luz (brilho excessivo).")
  }

  const finalScore = Math.max(0, Math.min(100, score))
  const passed = finalScore >= 70

  // Se aprovado, consome o desafio e gera token biométrico
  if (passed) {
    challenge.status = "COMPLETED"
    const biometricToken = `SEV_BIO_${crypto.randomBytes(24).toString("hex")}`

    try {
      const client = await ensureConnected()
      if (client && activeTier !== "memory") {
        await client.del(`liveness:challenge:${challengeId}`)
      }
    } catch {
      // Ignore
    }
    memoryChallenges.delete(challengeId)

    return {
      passed: true,
      livenessScore: finalScore,
      reasons: [],
      biometricToken,
    }
  }

  return {
    passed: false,
    livenessScore: finalScore,
    reasons,
  }
}
