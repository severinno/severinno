import "server-only"
import { db } from "@/lib/db"
import logger from "@/lib/logger"
import { sendPushNotification } from "@/lib/push"

/**
 * Event types supported by the webhook system.
 * Each maps to a real system action that can trigger automatic push notifications.
 */
export type SystemEvent =
  | "booking.created"
  | "booking.confirmed"
  | "booking.cancelled"
  | "booking.completed"
  | "review.created"
  | "quote.received"
  | "quote.responded"
  | "payment.confirmed"
  | "message.sent"
  | "provider.registered"

/**
 * Context data passed from the caller when an event fires.
 * All fields are optional — the template engine uses whatever is available.
 */
export type EventContext = Record<string, string | number | undefined>

/**
 * Resolves {{variable}} placeholders in a template string.
 * Unknown variables are left as-is (silently ignored).
 */
function interpolate(template: string, ctx: EventContext): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const val = ctx[key]
    return val != null ? String(val) : `{{${key}}}`
  })
}

/**
 * Options for firing an event.
 *
 * @param scopedUserIds — When provided, the role-based user lookup is intersected
 *   with these IDs. This prevents notifying ALL users of a given role when only
 *   specific affected users should be notified (e.g., the specific provider who
 *   was booked, not all providers).
 *
 * @example
 *   // Notify only the affected provider, not ALL providers
 *   await fireEvent("booking.created",
 *     { clientName: "Maria", serviceName: "Limpeza", providerName: "João" },
 *     { scopedUserIds: [providerId] },
 *   )
 */
export type FireEventOptions = {
  /** When set, intersect role-based user list with these specific user IDs */
  scopedUserIds?: string[]
}

/**
 * Fires a system event: looks up all active EventWebhook rules matching
 * the event type and sends push notifications to target users.
 *
 * This is a fire-and-forget function — it never throws and logs errors
 * instead of propagating them. Call it after the main business logic
 * succeeds (e.g., after creating a booking).
 *
 * @example
 *   // Notify all providers (role-based)
 *   await fireEvent("booking.created", { serviceName: "Limpeza", clientName: "Maria" })
 *
 *   // Notify only the affected provider (scoped)
 *   await fireEvent("booking.created",
 *     { serviceName: "Limpeza", clientName: "Maria" },
 *     { scopedUserIds: [providerId] },
 *   )
 */
export async function fireEvent(
  event: SystemEvent,
  ctx: EventContext,
  opts?: FireEventOptions,
): Promise<void> {
  try {
    const rules = await db.eventWebhook.findMany({
      where: { event, active: true },
    })

    if (rules.length === 0) return // no rules configured for this event

    for (const rule of rules) {
      const ruleStart = Date.now()
      let usersSent = 0
      let usersFailed = 0
      let firstError: string | undefined

      try {
        const targetRoles = rule.targetRoles as string[]
        if (!Array.isArray(targetRoles) || targetRoles.length === 0) {
          await logExecution(rule, event, ctx, 0, 0, 0, "success", 0, "no target roles configured")
          continue
        }

        const userWhere: Record<string, unknown> = {
          role: { in: targetRoles },
          active: true,
          pushSubscriptions: { some: {} },
        }

        // If scopedUserIds is provided, intersect with target roles so a rule
        // like "notify PROVIDERs" doesn't spam ALL providers — only the affected ones
        if (opts?.scopedUserIds && opts.scopedUserIds.length > 0) {
          userWhere.id = { in: opts.scopedUserIds }
        }

        const users = await db.user.findMany({
          where: userWhere as any,
          select: { id: true, name: true },
        })

        if (users.length === 0) {
          await logExecution(rule, event, ctx, 0, 0, 0, "success", Date.now() - ruleStart, "no eligible users found")
          continue
        }

        const title = interpolate(rule.title, ctx)
        const body = rule.body ? interpolate(rule.body, ctx) : ""
        const pushUrl = rule.pushUrl

        // Send to each user in parallel
        const results = await Promise.allSettled(
          users.map((u) =>
            sendPushNotification(u.id, title, body, pushUrl).catch((err: Error) => {
              logger.error({ err, userId: u.id, event, ruleId: rule.id }, "event-webhook push failed")
              throw err
            }),
          ),
        )

        // Count successes and failures
        for (const r of results) {
          if (r.status === "fulfilled") {
            usersSent++
          } else {
            usersFailed++
            if (!firstError) {
              firstError = r.reason?.message ?? String(r.reason)
            }
          }
        }

        const status = usersFailed === 0 ? "success" : usersSent === 0 ? "failed" : "partial"

        logger.info(
          { event, ruleId: rule.id, title, usersSent, usersFailed, status, executionMs: Date.now() - ruleStart },
          "event-webhook processed",
        )

        // Create audit log
        await logExecution(rule, event, ctx, users.length, usersSent, usersFailed, status, Date.now() - ruleStart, firstError)
      } catch (ruleErr) {
        const executionMs = Date.now() - ruleStart
        logger.error({ err: ruleErr, ruleId: rule.id, event }, "event-webhook rule failed")
        await logExecution(rule, event, ctx, 0, 0, 1, "failed", executionMs, (ruleErr as Error)?.message ?? "unknown error")
      }
    }
  } catch (err) {
    logger.error({ err, event }, "event-webhook fireEvent failed")
  }
}

/**
 * Creates an audit log entry for a webhook rule execution.
 */
async function logExecution(
  rule: { id: string; title: string; body: string | null; pushUrl: string; targetRoles: unknown },
  event: string,
  ctx: EventContext,
  usersFound: number,
  usersSent: number,
  usersFailed: number,
  status: string,
  executionMs: number,
  errorMessage?: string,
): Promise<void> {
  try {
    const title = interpolate(rule.title, ctx)
    const body = rule.body ? interpolate(rule.body, ctx) : null

    await db.webhookExecutionLog.create({
      data: {
        webhookId: rule.id,
        event,
        title,
        body,
        pushUrl: rule.pushUrl,
        targetRoles: rule.targetRoles as any,
        usersFound,
        usersSent,
        usersFailed,
        status,
        errorMessage: errorMessage ?? null,
        context: (ctx ?? {}) as any,
        executionMs,
      },
    })
  } catch (err) {
    logger.error({ err, ruleId: rule.id, event }, "failed to create webhook execution log")
  }
}
