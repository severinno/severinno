import { describe, it, expect, beforeEach } from "vitest"
import {
  triggerEmergencySOS,
  updateSOSStatus,
  getSOSIncident,
  clearSOSIncidentsForTesting,
} from "../emergency-sos"

describe("emergency-sos", () => {
  beforeEach(() => {
    clearSOSIncidentsForTesting()
  })

  it("cria um incidente de emergência com coordenadas GPS, rotas Maps/Waze e token ao vivo", () => {
    const incident = triggerEmergencySOS({
      userId: "user-provider-99",
      userName: "Maria Diarista",
      userRole: "PROVIDER",
      bookingId: "book-gv-00123",
      latitude: -18.8542,
      longitude: -41.9511,
      accuracy: 5,
      triggerType: "DISCREET_TAP",
      emergencyContacts: [
        { name: "Carlos Filho", phone: "5533999991111" },
        { name: "Polícia Militar / Base", phone: "190" },
      ],
    })

    expect(incident.id).toMatch(/^sos_/)
    expect(incident.status).toBe("ACTIVE")
    expect(incident.mapsUrl).toContain("-18.854200,-41.951100")
    expect(incident.wazeUrl).toContain("navigate=yes")
    expect(incident.liveTrackingToken).toBeDefined()
    expect(incident.notificationsPrepared).toHaveLength(2)
    expect(incident.notificationsPrepared[0].message).toContain("Maria Diarista")
    expect(incident.notificationsPrepared[0].message).toContain("Botão de Pânico")
  })

  it("permite atualizar o status para OPERATOR_DISPATCHED e depois RESOLVED", () => {
    const incident = triggerEmergencySOS({
      userId: "user-client-11",
      userName: "Ana Cliente",
      userRole: "CLIENT",
      latitude: -18.85,
      longitude: -41.95,
    })

    const updated = updateSOSStatus(incident.id, "OPERATOR_DISPATCHED", "admin-operator-1")
    expect(updated.status).toBe("OPERATOR_DISPATCHED")

    const resolved = updateSOSStatus(
      incident.id,
      "RESOLVED",
      "admin-operator-1",
      "Contato feito por telefone, tudo sob controle.",
    )
    expect(resolved.status).toBe("RESOLVED")
    expect(resolved.resolvedBy).toBe("admin-operator-1")
    expect(resolved.resolvedAt).toBeDefined()
    expect(resolved.resolutionNotes).toContain("tudo sob controle")
  })

  it("recupera o incidente ativo da base", () => {
    const incident = triggerEmergencySOS({
      userId: "user-1",
      userName: "José",
      userRole: "PROVIDER",
      latitude: -18.8,
      longitude: -41.9,
    })

    const retrieved = getSOSIncident(incident.id)
    expect(retrieved).toBeDefined()
    expect(retrieved?.id).toBe(incident.id)
  })

  it("rejeita acionamento com coordenadas ausentes", () => {
    expect(() =>
      triggerEmergencySOS({
        userId: "user-1",
        userName: "José",
        userRole: "PROVIDER",
        latitude: NaN,
        longitude: -41.9,
      }),
    ).toThrow()
  })
})
