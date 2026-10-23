/**
 * geo-spoof-detector.ts — Sentinela Anti-Fake GPS & Detecção de Telemetria Simulada
 *
 * Analisa amostras de telemetria geográfica em busca de sinais de adulteração
 * (Mock Location Provider no Android, saltos cinemáticos impossíveis, ausência de jitter
 * de satélite e precisão sintética) para blindar check-ins e a liberação de custódia (escrow).
 */

export interface GeoTelemetrySample {
  latitude: number
  longitude: number
  accuracy?: number
  altitude?: number
  speed?: number // em m/s
  heading?: number
  isMock?: boolean
  mocked?: boolean
  timestamp: number | string | Date
}

export type GeoSpoofVerdictType = "GENUINE" | "SUSPICIOUS" | "SPOOF_DETECTED"

export interface GeoSpoofVerdict {
  verdict: GeoSpoofVerdictType
  score: number // 0 a 100
  allowCheckin: boolean
  allowEscrowRelease: boolean
  requiresPhotoProof: boolean
  reasons: string[]
  kinematics?: {
    distanceMeters: number
    timeDeltaSeconds: number
    calculatedSpeedKmh: number
  }
  checkedAt: string
}

function haversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3 // Raio da Terra em metros
  const phi1 = (lat1 * Math.PI) / 180
  const phi2 = (lat2 * Math.PI) / 180
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c
}

function parseTimestamp(ts: number | string | Date): number {
  if (typeof ts === "number") return ts
  if (ts instanceof Date) return ts.getTime()
  return new Date(ts).getTime()
}

/**
 * Avalia uma amostra de telemetria GPS contra o histórico recente do prestador.
 */
export function evaluateGeoTelemetry(
  current: GeoTelemetrySample,
  previous?: GeoTelemetrySample | null,
): GeoSpoofVerdict {
  const reasons: string[] = []
  let score = 0

  // 1. Validação estrita de coordenadas numéricas finitas
  if (
    !Number.isFinite(current.latitude) ||
    !Number.isFinite(current.longitude) ||
    current.latitude < -90 ||
    current.latitude > 90 ||
    current.longitude < -180 ||
    current.longitude > 180
  ) {
    return {
      verdict: "SPOOF_DETECTED",
      score: 100,
      allowCheckin: false,
      allowEscrowRelease: false,
      requiresPhotoProof: true,
      reasons: ["Coordenadas geográficas inválidas ou fora dos limites terrestres"],
      checkedAt: new Date().toISOString(),
    }
  }

  // 2. Flag explícita de Mock Location (Android / Geolocation API)
  if (current.isMock === true || current.mocked === true) {
    score += 100
    reasons.push("Provedor de localização simulada (Mock Provider) ativado no dispositivo")
  }

  // 3. Análise de precisão artificial (chips GPS reais têm jitter e acurácia variável)
  const accuracy = current.accuracy ?? 10
  if (accuracy <= 0.5) {
    score += 30
    reasons.push("Acurácia excessivamente precisa (< 0.5m) típica de simulador ou injeção estática")
  } else if (accuracy > 150) {
    score += 25
    reasons.push("Acurácia degradada (> 150m) com alta margem de erro por falta de satélites")
  }

  // 4. Análise Cinemática comparada com a amostra anterior
  let kinematics:
    { distanceMeters: number; timeDeltaSeconds: number; calculatedSpeedKmh: number } | undefined

  if (previous) {
    const currentTs = parseTimestamp(current.timestamp)
    const prevTs = parseTimestamp(previous.timestamp)
    const dtSeconds = Math.max(0.1, (currentTs - prevTs) / 1000)

    const distance = haversineDistanceMeters(
      previous.latitude,
      previous.longitude,
      current.latitude,
      current.longitude,
    )

    const speedKmh = (distance / dtSeconds) * 3.6

    kinematics = {
      distanceMeters: Math.round(distance),
      timeDeltaSeconds: Math.round(dtSeconds * 10) / 10,
      calculatedSpeedKmh: Math.round(speedKmh * 10) / 10,
    }

    // Detecção de teletransporte (deslocamento > 1 km em menos de 10 segundos)
    if (distance > 1000 && dtSeconds < 10) {
      score += 70
      reasons.push(
        `Salto quântico de posição detectado (${Math.round(distance)}m em ${dtSeconds.toFixed(1)}s)`,
      )
    }
    // Velocidade biologicamente ou veicularmente impossível para trânsito urbano (> 160 km/h)
    else if (speedKmh > 160 && distance > 250) {
      score += 45
      reasons.push(
        `Velocidade cinemática calculada (${speedKmh.toFixed(0)} km/h) excede limites de trânsito urbano`,
      )
    }

    // Detecção de zero-jitter (coordenadas 100% idênticas com tempo decorrido e velocidade declarada positiva)
    if (distance === 0 && dtSeconds > 15 && current.speed && current.speed > 5) {
      score += 35
      reasons.push(
        "Ausência de jitter natural de satélite enquanto dispositivo declara movimento ativo",
      )
    }
  }

  const finalScore = Math.min(100, score)

  let verdict: GeoSpoofVerdictType = "GENUINE"
  let allowCheckin = true
  let allowEscrowRelease = true
  let requiresPhotoProof = false

  if (finalScore >= 60) {
    verdict = "SPOOF_DETECTED"
    allowCheckin = false
    allowEscrowRelease = false
    requiresPhotoProof = true
  } else if (finalScore >= 30) {
    verdict = "SUSPICIOUS"
    allowCheckin = true
    allowEscrowRelease = false
    requiresPhotoProof = true
  }

  return {
    verdict,
    score: finalScore,
    allowCheckin,
    allowEscrowRelease,
    requiresPhotoProof,
    reasons,
    kinematics,
    checkedAt: new Date().toISOString(),
  }
}
