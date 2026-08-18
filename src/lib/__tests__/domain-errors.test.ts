/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest"
import { BookingError, PaymentError } from "../domain-errors"
import { handleError } from "../api-server"

describe("Domain Errors", () => {
  describe("BookingError", () => {
    it("creates error with default message and status code", () => {
      const err = new BookingError("BOOKING_NOT_FOUND")
      expect(err.code).toBe("BOOKING_NOT_FOUND")
      expect(err.status).toBe(404)
      expect(err.message).toBe("Agendamento não encontrado")
      expect(err).toBeInstanceOf(Error)
      expect(err).toBeInstanceOf(BookingError)
    })

    it("accepts custom message", () => {
      const err = new BookingError("SLOT_UNAVAILABLE", "O horário das 14:00 foi reservado")
      expect(err.code).toBe("SLOT_UNAVAILABLE")
      expect(err.status).toBe(409)
      expect(err.message).toBe("O horário das 14:00 foi reservado")
    })

    it("is handled properly by handleError", async () => {
      const err = new BookingError("INVALID_PIN")
      const res = handleError(err)
      const body = await res.json()

      expect(res.status).toBe(400)
      expect(body.error).toBe("Código PIN de confirmação incorreto")
      expect(body.code).toBe("INVALID_PIN")
    })
  })

  describe("PaymentError", () => {
    it("creates error with default message and status code", () => {
      const err = new PaymentError("WEBHOOK_VERIFICATION_FAILED")
      expect(err.code).toBe("WEBHOOK_VERIFICATION_FAILED")
      expect(err.status).toBe(401)
      expect(err.message).toBe("Assinatura do webhook inválida")
      expect(err).toBeInstanceOf(Error)
      expect(err).toBeInstanceOf(PaymentError)
    })

    it("handles already paid conflict", async () => {
      const err = new PaymentError("ALREADY_PAID")
      const res = handleError(err)
      const body = await res.json()

      expect(res.status).toBe(409)
      expect(body.error).toBe("Este agendamento já foi pago")
      expect(body.code).toBe("ALREADY_PAID")
    })

    it("handles recipient not configured", async () => {
      const err = new PaymentError("RECIPIENT_NOT_CONFIGURED")
      const res = handleError(err)
      const body = await res.json()

      expect(res.status).toBe(422)
      expect(body.code).toBe("RECIPIENT_NOT_CONFIGURED")
    })
  })
})
