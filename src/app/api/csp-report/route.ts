import { NextResponse } from "next/server"
import logger from "@/lib/logger"

// ---------------------------------------------------------------------------
// CSP violation report ingestion (report-uri /api/csp-report)
// ---------------------------------------------------------------------------
// Browsers POST violation reports here (Content-Type: application/csp-report
// or application/reports+json) when the Content-Security-Policy blocks a
// resource. We log the report so a wrongly-strict directive is visible in
// production instead of silently breaking assets. Returns 204 — the browser
// does not expect a body.
//
// No auth: the report arrives from the browser without the session cookie in
// some cases, and the data is not sensitive. Kept out of the rate-limit
// exclusion on purpose — a flooded report endpoint is itself a signal.

export async function POST(request: Request) {
  try {
    const raw = await request.text()
    let report: unknown = null
    try {
      report = JSON.parse(raw)
    } catch {
      report = raw.slice(0, 2000)
    }
    logger.warn({ cspReport: report }, "csp violation report")
  } catch (error) {
    logger.error({ err: error }, "failed to ingest csp report")
  }
  return new NextResponse(null, { status: 204 })
}
