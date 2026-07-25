/**
 * Structured logger for Severinno Marketplace.
 *
 * Levels: info, warn, error
 * - In the browser (NEXT_PUBLIC env): only warn/error are printed to console.
 * - On the server: all levels print with ISO timestamp + structured extras.
 *
 * Usage:
 *   import { logger } from "@/lib/logger"
 *   logger.info("User registered", { userId: "abc" })
 *   logger.warn("Rate limit approaching", { ip: "…" })
 *   logger.error("Failed to process payment", { bookingId: "…" }, err)
 */

type LogLevel = "info" | "warn" | "error";

const isServer = typeof window === "undefined";

/** Pretty-print extras object for server-side logs. */
function formatExtras(extras?: Record<string, unknown>): string {
  if (!extras || Object.keys(extras).length === 0) return "";
  try {
    return " " + JSON.stringify(extras);
  } catch {
    return " [extras: unserializable]";
  }
}

/** Extract a useful message from an unknown error value. */
function formatError(err: unknown): string {
  if (err instanceof Error) return err.stack ?? err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function log(level: LogLevel, message: string, extras?: Record<string, unknown>, error?: unknown) {
  // In the browser, only show warn/error to avoid noise
  if (!isServer && level === "info") return;

  const timestamp = isServer ? new Date().toISOString() : undefined;
  const prefix = timestamp ? `[${timestamp}]` : "";
  const tag = `[${level.toUpperCase()}]`;
  const extraStr = formatExtras(extras);
  const errStr = error ? `\n  └─ ${formatError(error)}` : "";

  const line = `${prefix}${tag} ${message}${extraStr}${errStr}`;

  switch (level) {
    case "error":
      console.error(line);
      break;
    case "warn":
      console.warn(line);
      break;
    case "info":
    default:
      console.log(line);
      break;
  }
}

export const logger = {
  info: (message: string, extras?: Record<string, unknown>) => log("info", message, extras),

  warn: (message: string, extras?: Record<string, unknown>) => log("warn", message, extras),

  error: (message: string, extras?: Record<string, unknown>, error?: unknown) =>
    log("error", message, extras, error),
};
