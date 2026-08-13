/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    eventWebhook: {
      findMany: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
    webhookExecutionLog: {
      create: vi.fn(),
    },
  },
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
}))

vi.mock("@/lib/push", () => ({
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { fireEvent } from "@/lib/event-hub"
import { db } from "@/lib/db"
import { sendPushNotification } from "@/lib/push"

// ── Helpers ────────────────────────────────────────────────────────────────

function mockRule(overrides: Record<string, unknown> = {}): any {
  return {
    id: "rule-1",
    event: "booking.created",
    title: "Novo booking: {{clientName}} — {{serviceName}}",
    body: "{{clientName}} agendou {{serviceName}} para {{date}}",
    pushUrl: "/dashboard",
    targetRoles: ["PROVIDER"],
    ...overrides,
  }
}

function mockUser(id: string, name: string): any {
  return { id, name }
}

// ── Tests: fireEvent ───────────────────────────────────────────────────────

describe("fireEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── No rules configured ────────────────────────────────────────────
  it("does nothing when no rules match the event", async () => {
    vi.mocked(db.eventWebhook.findMany).mockResolvedValue([])

    await fireEvent("booking.created", { clientName: "Maria" })

    expect(db.user.findMany).not.toHaveBeenCalled()
    expect(sendPushNotification).not.toHaveBeenCalled()
  })

  // ── Fires push to matching users ─────────────────────────────────
  it("sends push notifications to users matching targetRoles", async () => {
    vi.mocked(db.eventWebhook.findMany).mockResolvedValue([mockRule()])
    vi.mocked(db.user.findMany).mockResolvedValue([
      mockUser("user-1", "João"),
      mockUser("user-2", "Maria"),
    ])

    await fireEvent("booking.created", {
      clientName: "Ana",
      serviceName: "Limpeza",
      date: "15 de ago às 14:00",
    })

    // Should find providers with active push subscriptions
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: { in: ["PROVIDER"] },
          active: true,
          pushSubscriptions: { some: {} },
        }),
      }),
    )

    // Should send push to each user
    expect(sendPushNotification).toHaveBeenCalledTimes(2)
    expect(sendPushNotification).toHaveBeenCalledWith(
      "user-1",
      "Novo booking: Ana — Limpeza",
      "Ana agendou Limpeza para 15 de ago às 14:00",
      "/dashboard",
    )
    expect(sendPushNotification).toHaveBeenCalledWith(
      "user-2",
      "Novo booking: Ana — Limpeza",
      "Ana agendou Limpeza para 15 de ago às 14:00",
      "/dashboard",
    )
  })

  // ── scopedUserIds filters correctly ───────────────────────────────
  it("filters users by scopedUserIds when provided", async () => {
    vi.mocked(db.eventWebhook.findMany).mockResolvedValue([mockRule()])
    vi.mocked(db.user.findMany).mockResolvedValue([mockUser("provider-1", "João")])

    await fireEvent(
      "booking.created",
      { clientName: "Ana", serviceName: "Limpeza", date: "hoje" },
      { scopedUserIds: ["provider-1"] },
    )

    // Should intersect targetRoles with scopedUserIds
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["provider-1"] },
        }),
      }),
    )

    // Only one user found → 1 push sent
    expect(sendPushNotification).toHaveBeenCalledTimes(1)
  })

  // ── scopedUserIds with no matching users ────────────────────────
  it("skips sending when scopedUserIds do not match any user", async () => {
    vi.mocked(db.eventWebhook.findMany).mockResolvedValue([mockRule()])
    vi.mocked(db.user.findMany).mockResolvedValue([]) // no eligible users

    await fireEvent(
      "booking.created",
      { clientName: "Ana" },
      { scopedUserIds: ["non-existent-user"] },
    )

    expect(sendPushNotification).not.toHaveBeenCalled()
  })

  // ── Template interpolation ──────────────────────────────────────
  it("interpolates {{variables}} in title and body", async () => {
    vi.mocked(db.eventWebhook.findMany).mockResolvedValue([mockRule()])
    vi.mocked(db.user.findMany).mockResolvedValue([mockUser("user-1", "João")])

    await fireEvent("booking.created", {
      clientName: "Carlos",
      serviceName: "Pintura",
      date: "20/08 às 10h",
    })

    expect(sendPushNotification).toHaveBeenCalledWith(
      "user-1",
      "Novo booking: Carlos — Pintura",
      "Carlos agendou Pintura para 20/08 às 10h",
      "/dashboard",
    )
  })

  // ── Unknown variables are left as-is ────────────────────────────
  it("leaves unknown {{variables}} as-is in the output", async () => {
    vi.mocked(db.eventWebhook.findMany).mockResolvedValue([mockRule()])
    vi.mocked(db.user.findMany).mockResolvedValue([mockUser("user-1", "João")])

    await fireEvent("booking.created", {
      // Only provide 'clientName', not 'serviceName' or 'date'
      clientName: "Carlos",
    })

    expect(sendPushNotification).toHaveBeenCalledWith(
      "user-1",
      "Novo booking: Carlos — {{serviceName}}",
      "Carlos agendou {{serviceName}} para {{date}}",
      "/dashboard",
    )
  })

  // ── Empty targetRoles → skips rule ─────────────────────────────
  it("skips rule when targetRoles is empty array", async () => {
    vi.mocked(db.eventWebhook.findMany).mockResolvedValue([mockRule({ targetRoles: [] })])

    await fireEvent("booking.created", { clientName: "Ana" })

    expect(db.user.findMany).not.toHaveBeenCalled()
    expect(sendPushNotification).not.toHaveBeenCalled()
  })

  // ── Multiple rules for the same event ─────────────────────────
  it("processes multiple rules for the same event", async () => {
    vi.mocked(db.eventWebhook.findMany).mockResolvedValue([
      mockRule({ id: "rule-1", title: "Rule1: {{clientName}}" }),
      mockRule({ id: "rule-2", title: "Rule2: {{clientName}}", targetRoles: ["CLIENT"] }),
    ])
    // Rule 1 → finds 2 PROVIDERs; Rule 2 → finds 1 CLIENT
    vi.mocked(db.user.findMany)
      .mockResolvedValueOnce([mockUser("p1", "Provider"), mockUser("p2", "Provider2")])
      .mockResolvedValueOnce([mockUser("c1", "Client")])

    await fireEvent("booking.created", { clientName: "Ana" })

    // Rule 1 → 2 pushes; Rule 2 → 1 push
    expect(sendPushNotification).toHaveBeenCalledTimes(3)
    expect(db.webhookExecutionLog.create).toHaveBeenCalledTimes(2)
  })

  // ── Creates execution log ─────────────────────────────────────
  it("creates WebhookExecutionLog with correct data", async () => {
    vi.mocked(db.eventWebhook.findMany).mockResolvedValue([mockRule()])
    vi.mocked(db.user.findMany).mockResolvedValue([
      mockUser("user-1", "João"),
      mockUser("user-2", "Maria"),
    ])

    await fireEvent("booking.created", {
      clientName: "Ana",
      serviceName: "Limpeza",
      date: "hoje",
    })

    expect(db.webhookExecutionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          webhookId: "rule-1",
          event: "booking.created",
          title: "Novo booking: Ana — Limpeza",
          body: "Ana agendou Limpeza para hoje",
          usersFound: 2,
          usersSent: 2,
          usersFailed: 0,
          status: "success",
        }),
      }),
    )
  })

  // ── Some pushes fail → status 'partial' ───────────────────────
  it("sets status to 'partial' when some pushes fail", async () => {
    vi.mocked(db.eventWebhook.findMany).mockResolvedValue([mockRule()])
    vi.mocked(db.user.findMany).mockResolvedValue([
      mockUser("user-1", "João"),
      mockUser("user-2", "Maria"),
    ])
    // First call succeeds, second throws
    vi.mocked(sendPushNotification)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("push failed: 410 Gone"))

    await fireEvent("booking.created", { clientName: "Ana" })

    expect(db.webhookExecutionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          usersSent: 1,
          usersFailed: 1,
          status: "partial",
          errorMessage: "push failed: 410 Gone",
        }),
      }),
    )
  })

  // ── All pushes fail → status 'failed' ─────────────────────────
  it("sets status to 'failed' when all pushes fail", async () => {
    vi.mocked(db.eventWebhook.findMany).mockResolvedValue([mockRule()])
    vi.mocked(db.user.findMany).mockResolvedValue([mockUser("user-1", "João")])
    vi.mocked(sendPushNotification).mockRejectedValue(new Error("push failed"))

    await fireEvent("booking.created", { clientName: "Ana" })

    expect(db.webhookExecutionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          usersSent: 0,
          usersFailed: 1,
          status: "failed",
        }),
      }),
    )
  })

  // ── Handles rule-level error gracefully ──────────────────────
  it("handles rule-level errors gracefully (user.findMany throws)", async () => {
    vi.mocked(db.eventWebhook.findMany).mockResolvedValue([mockRule()])
    vi.mocked(db.user.findMany).mockRejectedValue(new Error("DB connection error"))

    // Should not throw — fireEvent is fire-and-forget
    await expect(fireEvent("booking.created", { clientName: "Ana" })).resolves.toBeUndefined()

    // Should create an execution log with status 'failed'
    expect(db.webhookExecutionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          usersFound: 0,
          usersSent: 0,
          usersFailed: 1,
          status: "failed",
          errorMessage: "DB connection error",
        }),
      }),
    )
  })

  // ── provider.registered event ─────────────────────────────────
  it("works with provider.registered event", async () => {
    vi.mocked(db.eventWebhook.findMany).mockResolvedValue([
      mockRule({
        event: "provider.registered",
        title: "Novo prestador: {{providerName}}",
        body: "{{providerName}} se cadastrou em {{city}}/{{state}}",
        targetRoles: ["ADMIN"],
      }),
    ])
    vi.mocked(db.user.findMany).mockResolvedValue([mockUser("admin-1", "Admin")])

    await fireEvent("provider.registered", {
      providerName: "João Silva",
      city: "São Paulo",
      state: "SP",
    })

    expect(sendPushNotification).toHaveBeenCalledWith(
      "admin-1",
      "Novo prestador: João Silva",
      "João Silva se cadastrou em São Paulo/SP",
      "/dashboard",
    )
  })
})
