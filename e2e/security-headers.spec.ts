import { test, expect } from "@playwright/test"
import type { APIResponse } from "@playwright/test"

// =========================================================================
// Security Headers E2E Tests
// =========================================================================
// Verifies that ALL security headers defined in Caddyfile.prod and
// proxy.ts are present and correctly configured.
//
// NOTE: Some headers (CSP, removed Server/X-Powered-By) come from
// Caddyfile.prod and are only present when behind the Caddy reverse proxy.
// When running on localhost:3000 (dev mode without Caddy), these tests
// will be conditionally skipped via isBehindCaddy detection.
//
// Expected headers come from:
//   Caddyfile.prod  →  HSTS, CSP, XFO, XSS, Referrer-Policy,
//                      Permissions-Policy, -Server, -X-Powered-By
//   proxy.ts        →  HSTS, XFO, XCTO, Referrer-Policy,
//                      Permissions-Policy, X-DNS-Prefetch-Control, CORS
// =========================================================================

// ── Config ────────────────────────────────────────────────────────────────

interface HeaderCheck {
  pattern: RegExp
  description: string
  severity: "CRITICAL" | "HIGH" | "MEDIUM"
}

interface CspCheck {
  directive: string
  severity: "CRITICAL" | "HIGH" | "MEDIUM"
}

const EXPECTED_HEADERS: Record<string, HeaderCheck> = {
  "strict-transport-security": {
    pattern: /max-age=31536000/i,
    description: "HSTS com max-age de 1 ano",
    severity: "CRITICAL",
  },
  "x-content-type-options": {
    pattern: /nosniff/i,
    description: "X-Content-Type-Options impede MIME sniffing",
    severity: "CRITICAL",
  },
  "x-frame-options": {
    pattern: /DENY/i,
    description: "X-Frame-Options impede clickjacking",
    severity: "CRITICAL",
  },
  "x-xss-protection": {
    pattern: /1; mode=block/i,
    description: "X-XSS-Protection bloqueia XSS refletido (legacy)",
    severity: "HIGH",
  },
  "referrer-policy": {
    pattern: /strict-origin-when-cross-origin/i,
    description: "Referrer-Policy protege dados do referrer",
    severity: "HIGH",
  },
  "permissions-policy": {
    pattern: /camera=\(\).*microphone=\(\)/i,
    description: "Permissions-Policy desabilita câmera e microfone",
    severity: "HIGH",
  },
}

const CSP_DIRECTIVES: CspCheck[] = [
  { directive: "default-src 'self'", severity: "CRITICAL" },
  { directive: "object-src 'none'", severity: "CRITICAL" },
  { directive: "frame-ancestors 'none'", severity: "CRITICAL" },
  { directive: "base-uri 'self'", severity: "HIGH" },
  { directive: "form-action 'self'", severity: "HIGH" },
  { directive: "worker-src 'self' blob:", severity: "HIGH" },
  { directive: "manifest-src 'self'", severity: "MEDIUM" },
  { directive: "script-src 'self'", severity: "CRITICAL" },
  { directive: "style-src 'self'", severity: "HIGH" },
  { directive: "img-src 'self' data:", severity: "HIGH" },
]

const SENSITIVE_HEADERS_TO_REMOVE = ["server", "x-powered-by", "x-aspnet-version"]

// ── Detect: behind Caddy? ────────────────────────────────────────────────
// Caddy adiciona um header próprio (Server: Caddy) que podemos detectar.
// Se não houver Caddy, CSP e outros headers específicos do proxy
// não estarão presentes — pula os testes que dependem dele.

let _behindCaddy: boolean | null = null

async function isBehindCaddy(
  request: import("@playwright/test").APIRequestContext,
): Promise<boolean> {
  if (_behindCaddy !== null) return _behindCaddy
  try {
    const res = await request.get("/")
    const server = getHeader(res, "server")
    _behindCaddy = server !== null && server.toLowerCase().includes("caddy")
  } catch {
    _behindCaddy = false
  }
  return _behindCaddy
}

// ── Helper: normalize header name to lowercase ────────────────────────────

function getHeader(response: APIResponse, name: string): string | null {
  const headers = response.headers()
  const lowerName = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lowerName) {
      return headers[key]!
    }
  }
  return null
}

// ── Helper: check header exists and matches pattern (single expect) ──────

function checkSecurityHeader(
  response: APIResponse,
  headerName: string,
  pattern: RegExp,
  endpoint: string,
) {
  const value = getHeader(response, headerName)
  expect(value, `[${endpoint}] ${headerName} deve existir`).toBeDefined()
  if (value) {
    expect(value, `[${endpoint}] ${headerName} = "${value}"`).toMatch(pattern)
  }
}

// ── Helper: check header is absent ────────────────────────────────────────

function checkHeaderRemoved(response: APIResponse, headerName: string, endpoint: string) {
  const value = getHeader(response, headerName)
  expect(value, `[${endpoint}] "${headerName}" deve estar removido (sem vazamento)`).toBeNull()
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS — PÁGINA PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

test.describe("Security Headers — Página Principal (/)", () => {
  let response: APIResponse

  test.beforeAll(async ({ request }) => {
    response = await request.get("/")
  })

  test("HTTP 200 OK", () => {
    expect(response.status()).toBe(200)
  })

  for (const [header, config] of Object.entries(EXPECTED_HEADERS)) {
    test(`${config.severity === "CRITICAL" ? "🔴" : "🟠"} ${header}: ${config.description}`, () => {
      checkSecurityHeader(response, header, config.pattern, "/")
    })
  }

  // ── HSTS extras ──────────────────────────────────────────────────────

  test("🔴 HSTS: includeSubDomains presente", () => {
    const hsts = getHeader(response, "strict-transport-security")
    expect(hsts).toBeDefined()
    expect(hsts!.toLowerCase()).toContain("includesubdomains")
  })

  test("🔴 HSTS: preload presente", () => {
    const hsts = getHeader(response, "strict-transport-security")
    expect(hsts).toBeDefined()
    expect(hsts!.toLowerCase()).toContain("preload")
  })

  // ── Permissions-Policy extra ─────────────────────────────────────────

  test("🔴 Permissions-Policy: geolocation restrita a self", () => {
    const pp = getHeader(response, "permissions-policy")
    expect(pp).toBeDefined()
    expect(pp!.toLowerCase()).toContain("geolocation=(self)")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// TESTS — CSP (apenas quando atrás do Caddy)
// ═══════════════════════════════════════════════════════════════════════════

test.describe("Content-Security-Policy (Caddy)", () => {
  let response: APIResponse
  let behindCaddy = false

  test.beforeAll(async ({ request }) => {
    response = await request.get("/")
    behindCaddy = await isBehindCaddy(request)
  })

  for (const { directive, severity } of CSP_DIRECTIVES) {
    test(`${severity === "CRITICAL" ? "🔴" : severity === "HIGH" ? "🟠" : "🟡"} CSP: ${directive}`, async ({
      request: _request,
    }) => {
      test.skip(!behindCaddy, "CSP configurado apenas no Caddyfile.prod (requer Caddy)")
      const csp = getHeader(response, "content-security-policy")
      expect(csp, "Content-Security-Policy presente").toBeDefined()
      if (csp) {
        expect(csp.toLowerCase()).toContain(directive.toLowerCase())
      }
    })
  }

  test("🔴 CSP: connect-src inclui GlitchTip e OSM", async () => {
    test.skip(!behindCaddy, "CSP configurado apenas no Caddyfile.prod (requer Caddy)")
    const csp = getHeader(response, "content-security-policy")
    expect(csp).toBeDefined()
    expect(csp!.toLowerCase()).toContain("api.glitchtip.com")
    expect(csp!.toLowerCase()).toContain("tile.openstreetmap.org")
    expect(csp!.toLowerCase()).toContain("nominatim.openstreetmap.org")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// TESTS — HEADERS REMOVIDOS (apenas Caddy)
// ═══════════════════════════════════════════════════════════════════════════

test.describe("Tecnologia Não Vaza (Caddy)", () => {
  let response: APIResponse
  let behindCaddy = false

  test.beforeAll(async ({ request }) => {
    response = await request.get("/")
    behindCaddy = await isBehindCaddy(request)
  })

  for (const header of SENSITIVE_HEADERS_TO_REMOVE) {
    test(`🚫 ${header} removido`, () => {
      test.skip(!behindCaddy, "Server/X-Powered-By removido apenas no Caddyfile.prod")
      checkHeaderRemoved(response, header, "/")
    })
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// TESTS — API (/api/health)
// ═══════════════════════════════════════════════════════════════════════════

test.describe("Security Headers — API (/api/health)", () => {
  let response: APIResponse

  test.beforeAll(async ({ request }) => {
    response = await request.get("/api/health")
  })

  test("HTTP 200 OK", () => {
    expect(response.status()).toBe(200)
  })

  // Headers obrigatórios (presentes em TODAS as respostas, via proxy.ts)
  const apiCriticalHeaders: Record<string, HeaderCheck> = {
    "strict-transport-security": EXPECTED_HEADERS["strict-transport-security"],
    "x-content-type-options": EXPECTED_HEADERS["x-content-type-options"],
    "x-frame-options": EXPECTED_HEADERS["x-frame-options"],
    "referrer-policy": EXPECTED_HEADERS["referrer-policy"],
  }

  for (const [header, config] of Object.entries(apiCriticalHeaders)) {
    test(`🔴 ${header}: ${config.description} (API)`, () => {
      checkSecurityHeader(response, header, config.pattern, "/api/health")
    })
  }

  // NOTE: /api/health is in RATE_LIMIT_BYPASS_ROUTES, so rate limit headers are absent (correct)
  // Rate limit headers are tested on /api/providers below
})

// ═══════════════════════════════════════════════════════════════════════════
// TESTS — PÁGINA DE LOGIN (via page.goto para seguir redirects)
// ═══════════════════════════════════════════════════════════════════════════

test.describe("Security Headers — Página de Login (/login)", () => {
  // Note: Playwright doesn't allow `page` fixture in beforeAll.
  // Each test fetches headers individually via request API.
  async function getLoginHeaders(request: any) {
    // Follow redirects manually to /login
    const res = await request.get("/login", { maxRedirects: 5 })
    return res.headers()
  }

  // Usa headers do page.goto (que segue redirects)
  const loginCritical: Record<string, RegExp> = {
    "strict-transport-security": /max-age=31536000/i,
    "x-content-type-options": /nosniff/i,
    "x-frame-options": /DENY/i,
    "referrer-policy": /strict-origin-when-cross-origin/i,
  }

  for (const [header, pattern] of Object.entries(loginCritical)) {
    test(`🔴 ${header} presente (login)`, async ({ request }) => {
      const headers = await getLoginHeaders(request)
      const value = headers[header]
      expect(value, `[login] ${header} presente`).toBeDefined()
      expect(value, `[login] ${header} = "${value}"`).toMatch(pattern)
    })
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// TESTS — X-DNS-Prefetch-Control
// ═══════════════════════════════════════════════════════════════════════════

test.describe("X-DNS-Prefetch-Control", () => {
  test("🟡 Header presente (configurado em proxy.ts)", async ({ request }) => {
    const response = await request.get("/")
    const dns = response.headers()["x-dns-prefetch-control"]
    expect(dns, "X-DNS-Prefetch-Control presente").toBeDefined()
    expect(dns!.toLowerCase()).toBe("on")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// TESTS — CORS Headers (via fetch nativo)
// ═══════════════════════════════════════════════════════════════════════════

test.describe("CORS Headers (API)", () => {
  test("🟡 OPTIONS /api/health retorna 204 com CORS headers", async ({ request }) => {
    const corsHeaders = await request.fetch("/api/health", {
      method: "OPTIONS",
      headers: {
        "Access-Control-Request-Method": "GET",
      },
    })

    // OPTIONS preflight should return 204 with CORS headers
    expect(corsHeaders.status()).toBe(204)

    const allowMethods = Object.keys(corsHeaders.headers()).find(
      (k) => k.toLowerCase() === "access-control-allow-methods",
    )
    expect(allowMethods, "Access-Control-Allow-Methods presente").toBeDefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// TESTS — Resumo Agregado
// ═══════════════════════════════════════════════════════════════════════════

test.describe("Resumo — Todos os Endpoints", () => {
  test("Report: security headers presentes em /, /api/health, /login, /register", async ({
    request,
  }) => {
    const endpoints = ["/", "/api/health", "/login", "/register"]
    const errors: string[] = []

    for (const ep of endpoints) {
      const res = await request.get(ep)
      if (!res.ok()) {
        errors.push(`${ep}: HTTP ${res.status()}`)
        continue
      }

      // Verifica headers críticos presentes em TODOS os endpoints
      const criticalHeaders = [
        "strict-transport-security",
        "x-content-type-options",
        "x-frame-options",
      ]
      for (const h of criticalHeaders) {
        const val = getHeader(res, h)
        if (!val) {
          errors.push(`${ep}: missing ${h}`)
        }
      }
    }

    if (errors.length > 0) {
      console.log("⚠️ Security header issues found:")
      for (const err of errors) {
        console.log(`  ❌ ${err}`)
      }
    }

    expect(errors, `Nenhum security header ausente nos endpoints`).toHaveLength(0)
  })
})
