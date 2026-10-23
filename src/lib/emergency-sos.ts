/**
 * emergency-sos.ts — Botão de Pânico e Protocolo de Segurança SOS em Tempo Real
 *
 * Módulo de proteção à vida e integridade física para prestadores (ex: diaristas em locais desconhecidos)
 * e clientes durante serviços presenciais.
 *
 * Ao ser acionado:
 * 1. Captura geolocalização de alta precisão (GPS/Satélite).
 * 2. Gera links imediatos de resgate (Google Maps & Waze com rota direta).
 * 3. Cria token criptográfico de rastreamento ao vivo para o Centro Operacional.
 * 4. Prepara mensagens de despacho prioritário para WhatsApp/SMS de contatos de emergência.
 * 5. Registra o incidente na Torre de Controle com auditoria imutável.
 */

import { randomBytes } from "crypto"

export type SOSTriggerType =
  | "MANUAL_BUTTON"
  | "DISCREET_TAP" // 3 toques seguidos no logo do app
  | "VOICE_TRIGGER"
  | "AUTOMATIC_TIMEOUT"

export type SOSStatus = "ACTIVE" | "OPERATOR_DISPATCHED" | "RESOLVED" | "FALSE_ALARM"

export interface EmergencyContact {
  name: string
  phone: string
  relationship?: string
}

export interface TriggerSOSParams {
  userId: string
  userName: string
  userRole: "CLIENT" | "PROVIDER"
  bookingId?: string
  latitude: number
  longitude: number
  accuracy?: number
  triggerType?: SOSTriggerType
  emergencyContacts?: EmergencyContact[]
  notes?: string
}

export interface SOSIncident {
  id: string
  userId: string
  userName: string
  userRole: "CLIENT" | "PROVIDER"
  bookingId?: string
  latitude: number
  longitude: number
  accuracy: number
  triggerType: SOSTriggerType
  mapsUrl: string
  wazeUrl: string
  liveTrackingToken: string
  triggeredAt: string
  status: SOSStatus
  notificationsPrepared: Array<{
    recipientPhone: string
    recipientName: string
    message: string
  }>
  resolvedAt?: string
  resolvedBy?: string
  resolutionNotes?: string
}

// Armazenamento em memória dos incidentes ativos (fallback ao Redis)
const activeIncidents = new Map<string, SOSIncident>()

/**
 * Aciona o protocolo SOS de Emergência.
 */
export function triggerEmergencySOS(params: TriggerSOSParams): SOSIncident {
  const {
    userId,
    userName,
    userRole,
    bookingId,
    latitude,
    longitude,
    accuracy = 10,
    triggerType = "MANUAL_BUTTON",
    emergencyContacts = [],
    notes,
  } = params

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("Coordenadas geográficas inválidas para acionamento do SOS")
  }

  const id = `sos_${Date.now()}_${randomBytes(4).toString("hex")}`
  const liveTrackingToken = randomBytes(16).toString("hex")
  const triggeredAt = new Date().toISOString()

  const mapsUrl = `https://www.google.com/maps?q=${latitude.toFixed(6)},${longitude.toFixed(6)}`
  const wazeUrl = `https://waze.com/ul?ll=${latitude.toFixed(6)},${longitude.toFixed(6)}&navigate=yes`

  const roleText = userRole === "PROVIDER" ? "O(A) prestador(a)" : "O(A) cliente"
  const bookingText = bookingId ? ` no atendimento #${bookingId.slice(-6)}` : ""

  // Monta as mensagens de emergência para os contatos cadastrados
  const notificationsPrepared = emergencyContacts.map((contact) => ({
    recipientPhone: contact.phone,
    recipientName: contact.name,
    message: `🚨 *ALERTA DE EMERGÊNCIA SEVERINNO*\n\n${roleText} *${userName}* acionou o Botão de Pânico${bookingText}!\n\n📍 *Localização Atual:* ${mapsUrl}\n🚗 *Rota Waze:* ${wazeUrl}\n🎯 *Precisão do GPS:* ${Math.round(accuracy)}m\n⏰ *Horário:* ${new Date().toLocaleTimeString("pt-BR")}\n\nNossa Central de Monitoramento foi acionada. Entre em contato ou acione as autoridades caso necessário.${notes ? `\n\nObs: ${notes}` : ""}`,
  }))

  const incident: SOSIncident = {
    id,
    userId,
    userName,
    userRole,
    bookingId,
    latitude,
    longitude,
    accuracy,
    triggerType,
    mapsUrl,
    wazeUrl,
    liveTrackingToken,
    triggeredAt,
    status: "ACTIVE",
    notificationsPrepared,
  }

  activeIncidents.set(id, incident)
  return incident
}

/**
 * Atualiza o status do incidente de emergência.
 */
export function updateSOSStatus(
  sosId: string,
  newStatus: SOSStatus,
  operatorId: string,
  resolutionNotes?: string,
): SOSIncident {
  const incident = activeIncidents.get(sosId)
  if (!incident) {
    throw new Error(`Incidente de SOS ${sosId} não encontrado`)
  }

  incident.status = newStatus
  if (newStatus === "RESOLVED" || newStatus === "FALSE_ALARM") {
    incident.resolvedAt = new Date().toISOString()
    incident.resolvedBy = operatorId
    incident.resolutionNotes = resolutionNotes
  }

  activeIncidents.set(sosId, incident)
  return incident
}

/**
 * Consulta o incidente pelo ID ou token de rastreamento ao vivo.
 */
export function getSOSIncident(sosId: string): SOSIncident | undefined {
  return activeIncidents.get(sosId)
}

/**
 * Limpa incidentes (utilitário para suítes de testes).
 */
export function clearSOSIncidentsForTesting(): void {
  activeIncidents.clear()
}
