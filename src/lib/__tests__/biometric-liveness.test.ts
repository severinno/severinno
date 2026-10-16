import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  createLivenessChallenge,
  validateLivenessSubmission,
  type LivenessFrameData,
} from "@/lib/biometric-liveness"

vi.mock("@/lib/redis", () => ({
  ensureConnected: vi.fn().mockResolvedValue(null),
  activeTier: "memory",
}))

describe("biometric-liveness engine", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("cria desafio de vivacidade dinâmico com passos e expiração válida", async () => {
    const challenge = await createLivenessChallenge("user-123")

    expect(challenge.id).toMatch(/^liveness_/)
    expect(challenge.userId).toBe("user-123")
    expect(challenge.steps.length).toBeGreaterThanOrEqual(2)
    expect(challenge.status).toBe("PENDING")
    expect(challenge.expiresAt).toBeGreaterThan(Date.now())
  })

  it("aprova submissão quando passos, ordem e movimentos biológicos são válidos", async () => {
    const challenge = await createLivenessChallenge("user-456")
    const now = Date.now()

    // Constrói frames correspondentes aos passos gerados
    const frames: LivenessFrameData[] = challenge.steps.map((step, idx) => ({
      step,
      timestamp: now + (idx + 1) * 800, // 800ms por movimento
      faceBox: {
        x: 100 + idx * 15,
        y: 120 + idx * 8,
        width: 200 + idx * 10,
        height: 250 + idx * 10,
      },
      brightness: 128,
      aspectRatio: 1.25,
    }))

    const result = await validateLivenessSubmission(challenge.id, frames)

    expect(result.passed).toBe(true)
    expect(result.livenessScore).toBeGreaterThanOrEqual(70)
    expect(result.biometricToken).toMatch(/^SEV_BIO_/)
    expect(result.reasons).toHaveLength(0)
  })

  it("rejeita e reduz score quando passos são executados na ordem errada", async () => {
    const challenge = await createLivenessChallenge("user-789")
    const now = Date.now()

    // Inverte a ordem dos passos
    const reversedSteps = [...challenge.steps].reverse()
    const frames: LivenessFrameData[] = reversedSteps.map((step, idx) => ({
      step,
      timestamp: now + (idx + 1) * 1000,
      faceBox: { x: 100 + idx * 10, y: 120, width: 200, height: 250 },
      brightness: 120,
      aspectRatio: 1.25,
    }))

    const result = await validateLivenessSubmission(challenge.id, frames)

    expect(result.passed).toBe(false)
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("incorreto: esperado")]),
    )
  })

  it("detecta ataque de bot por velocidade sobre-humana (< 600ms)", async () => {
    const challenge = await createLivenessChallenge("user-bot")
    const now = Date.now()

    // 2 passos submetidos em apenas 50ms
    const frames: LivenessFrameData[] = challenge.steps.map((step, idx) => ({
      step,
      timestamp: now + idx * 25,
      faceBox: { x: 100 + idx * 20, y: 120, width: 200, height: 250 },
      brightness: 120,
      aspectRatio: 1.25,
    }))

    const result = await validateLivenessSubmission(challenge.id, frames)

    expect(result.passed).toBe(false)
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Velocidade de execução incompatível com movimento biológico"),
      ]),
    )
  })

  it("detecta foto estática ou máscara impressa por ausência de micro-movimentos", async () => {
    const challenge = await createLivenessChallenge("user-static-photo")
    const now = Date.now()

    // Exatamente a mesma bounding box em todos os frames (foto estática)
    const frames: LivenessFrameData[] = challenge.steps.map((step, idx) => ({
      step,
      timestamp: now + (idx + 1) * 1000,
      faceBox: { x: 100, y: 100, width: 200, height: 250 },
      brightness: 120,
      aspectRatio: 1.25,
    }))

    const result = await validateLivenessSubmission(challenge.id, frames)

    expect(result.passed).toBe(false)
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Ausência de micro-movimento tridimensional"),
      ]),
    )
  })
})
