import { writeFileSync, readFileSync } from "fs"
import { readdirSync, statSync } from "fs"
import path from "path"

// ── Find all route.ts files under src/app/api ──────────────────────────────

const API_ROOT = path.resolve(__dirname, "..", "src", "app", "api")

function findAllRouteFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      results.push(...findAllRouteFiles(full))
    } else if (entry === "route.ts") {
      results.push(full)
    }
  }
  return results
}

// ── Extract HTTP methods and JSDoc from a route file ───────────────────────

type HttpMethod = "get" | "post" | "put" | "patch" | "delete"
type RouteInfo = {
  methods: HttpMethod[]
  summary: string | null
}

function extractRouteInfo(filePath: string): RouteInfo {
  const content = readFileSync(filePath, "utf-8")
  const methods: HttpMethod[] = []

  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
    if (new RegExp(`export\\s+(?:async\\s+function|const)\\s+${method}\\b`).test(content)) {
      methods.push(method.toLowerCase() as HttpMethod)
    }
  }

  // Extract JSDoc summary: first /** ... */ block before the first exported function
  let summary: string | null = null
  const jsdocMatch = content.match(/\/\*\*\s*\n?\s*\*\s*(.+?)(?:\n|\*\/)/)
  if (jsdocMatch) {
    summary = jsdocMatch[1].trim().replace(/\s*\*\/$/, "")
  }

  return { methods, summary }
}

// ── Convert filesystem path to API path ────────────────────────────────────

function filePathToApiPath(filePath: string): string {
  const relative = path.relative(API_ROOT, filePath)
  // Remove trailing /route.ts
  const dir = path.dirname(relative)
  // Replace Windows backslashes
  const normalized = dir.replace(/\\/g, "/")
  // Root route.ts (src/app/api/route.ts) → /api
  if (normalized === "." || normalized === "") return "/api"
  // Convert [param] to {param}
  const converted = normalized
    .split("/")
    .map((segment) => {
      const paramMatch = segment.match(/^\[(.+)\]$/)
      if (paramMatch) return `{${paramMatch[1]}}`
      return segment
    })
    .join("/")
  return `/api/${converted}`
}

// ── Derive tag from API path ───────────────────────────────────────────────

function deriveTag(apiPath: string): string {
  // /api/auth/login → Auth
  // /api/providers/{id} → Providers
  // /api/admin/users → Admin
  // /api/geo/cep → Geo
  // /api/bookings/[id]/pay → Bookings
  // /api/ → System
  const segments = apiPath
    .replace(/^\/api\//, "")
    .split("/")
    .filter(Boolean)
  if (segments.length === 0 || (segments.length === 1 && segments[0] === "")) return "System"

  const first = segments[0].toLowerCase()

  // Special-case known top-level segments
  const tagMap: Record<string, string> = {
    api: "System",
    auth: "Auth",
    providers: "Providers",
    provider: "Provider",
    bookings: "Bookings",
    quotes: "Quotes",
    messages: "Messages",
    reviews: "Reviews",
    categories: "Categories",
    services: "Services",
    search: "Search",
    geo: "Geo",
    health: "Health",
    admin: "Admin",
    users: "Users",
    favorites: "Favorites",
    notifications: "Notifications",
    push: "Push",
    chat: "Chat",
    upload: "Storage",
    cron: "Cron",
    webhooks: "Webhooks",
    metrics: "Metrics",
    monitor: "Monitor",
    subscriptions: "Subscriptions",
    newsletter: "Newsletter",
    calendar: "Calendar",
    tracking: "Tracking",
    availability: "Availability",
    sentry: "Sentry",
    stats: "Stats",
    resume: "Resume",
  }

  return tagMap[first] || first.charAt(0).toUpperCase() + first.slice(1)
}

// ── HTTP method descriptions ───────────────────────────────────────────────

const METHOD_SUMMARIES: Record<HttpMethod, string> = {
  get: "Retrieve",
  post: "Create",
  put: "Replace",
  patch: "Update",
  delete: "Delete",
}

function buildOperation(method: HttpMethod, summary: string | null): Record<string, unknown> {
  const op: Record<string, unknown> = {
    summary: summary || METHOD_SUMMARIES[method],
    responses: {
      "200": { description: "Success" },
    },
  }

  if (method === "post" || method === "put" || method === "patch") {
    op.requestBody = {
      required: true,
      content: { "application/json": { schema: { type: "object" } } },
    }
  }

  return op
}

// ── Manually-defined rich paths (backward compat) ─────────────────────────

const MANUAL_PATHS: Record<string, Record<string, unknown>> = {
  "/api/auth/register": {
    post: {
      tags: ["Auth"],
      summary: "Registrar novo usuário",
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/RegisterInput" } },
        },
      },
      responses: {
        "201": { description: "Usuário criado" },
        "400": { description: "Dados inválidos" },
      },
    },
  },
  "/api/auth/login": {
    post: {
      tags: ["Auth"],
      summary: "Login",
      requestBody: {
        required: true,
        content: { "application/json": { schema: { $ref: "#/components/schemas/LoginInput" } } },
      },
      responses: {
        "200": { description: "Login realizado" },
        "401": { description: "Credenciais inválidas" },
      },
    },
  },
  "/api/auth/logout": {
    post: {
      tags: ["Auth"],
      summary: "Logout",
      responses: { "200": { description: "Logout realizado" } },
    },
  },
  "/api/auth/me": {
    get: {
      tags: ["Auth"],
      summary: "Sessão atual",
      responses: { "200": { description: "Dados do usuário" } },
    },
  },
  "/api/providers": {
    get: {
      tags: ["Providers"],
      summary: "Listar prestadores",
      parameters: [
        { name: "lat", in: "query", schema: { type: "number" } },
        { name: "lng", in: "query", schema: { type: "number" } },
        { name: "q", in: "query", schema: { type: "string" } },
        { name: "categoryId", in: "query", schema: { type: "string" } },
        { name: "radius", in: "query", schema: { type: "number" } },
        { name: "sort", in: "query", schema: { type: "string", enum: ["rating", "distance"] } },
        { name: "page", in: "query", schema: { type: "integer" } },
        { name: "limit", in: "query", schema: { type: "integer" } },
      ],
      responses: { "200": { description: "Lista de prestadores" } },
    },
  },
  "/api/categories": {
    get: {
      tags: ["Categories"],
      summary: "Listar categorias",
      responses: { "200": { description: "Árvore de categorias" } },
    },
  },
  "/api/bookings": {
    get: {
      tags: ["Bookings"],
      summary: "Listar agendamentos",
      responses: { "200": { description: "Lista de agendamentos" } },
    },
    post: {
      tags: ["Bookings"],
      summary: "Criar agendamento",
      responses: { "201": { description: "Agendamento criado" } },
    },
  },
  "/api/quotes": {
    get: {
      tags: ["Quotes"],
      summary: "Listar orçamentos",
      responses: { "200": { description: "Lista de orçamentos" } },
    },
    post: {
      tags: ["Quotes"],
      summary: "Solicitar orçamento",
      responses: { "201": { description: "Orçamento criado" } },
    },
  },
  "/api/messages": {
    get: {
      tags: ["Messages"],
      summary: "Listar mensagens",
      responses: { "200": { description: "Lista de mensagens" } },
    },
    post: {
      tags: ["Messages"],
      summary: "Enviar mensagem",
      responses: { "201": { description: "Mensagem enviada" } },
    },
  },
  "/api/reviews": {
    get: {
      tags: ["Reviews"],
      summary: "Listar avaliações",
      responses: { "200": { description: "Lista de avaliações" } },
    },
    post: {
      tags: ["Reviews"],
      summary: "Criar avaliação",
      responses: { "201": { description: "Avaliação criada" } },
    },
  },
  "/api/upload": {
    post: {
      tags: ["Storage"],
      summary: "Upload de arquivo",
      responses: { "200": { description: "URL do arquivo" } },
    },
  },
  "/api/health": {
    get: {
      tags: ["System"],
      summary: "Health check",
      responses: { "200": { description: "Status dos serviços" } },
    },
  },
}

// ── Main ───────────────────────────────────────────────────────────────────

const routeFiles = findAllRouteFiles(API_ROOT)
console.log(`Found ${routeFiles.length} route files`)

// Start with manual paths
const paths: Record<string, Record<string, unknown>> = {}
for (const [apiPath, methods] of Object.entries(MANUAL_PATHS)) {
  paths[apiPath] = methods
}

let autoGenerated = 0

for (const filePath of routeFiles) {
  const apiPath = filePathToApiPath(filePath)
  const tag = deriveTag(apiPath)
  const info = extractRouteInfo(filePath)

  if (!paths[apiPath]) {
    paths[apiPath] = {}
  }

  for (const method of info.methods) {
    // If manually defined, keep it (backward compat)
    if ((paths[apiPath] as Record<string, unknown>)[method]) {
      continue
    }

    const operation = buildOperation(method, info.summary)
    ;(paths[apiPath] as Record<string, unknown>)[method] = {
      ...operation,
      tags: [tag],
    }
    autoGenerated++
  }
}

console.log(`Auto-generated ${autoGenerated} operations from route files`)

// ── Assemble final spec ───────────────────────────────────────────────────

const apiDoc = {
  openapi: "3.1.0",
  info: {
    title: "Severinno Marketplace API",
    version: "0.2.0",
    description: "API do Marketplace de serviços com geolocalização",
  },
  servers: [
    { url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000", description: "API Server" },
  ],
  paths,
  components: {
    schemas: {
      LoginInput: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email", description: "E-mail do usuário" },
          password: { type: "string", minLength: 6, description: "Senha" },
        },
      },
      RegisterInput: {
        type: "object",
        required: ["name", "email", "password", "confirmPassword", "role"],
        properties: {
          name: { type: "string", minLength: 2 },
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 6 },
          confirmPassword: { type: "string" },
          role: { type: "string", enum: ["CLIENT", "PROVIDER"] },
          cpfCnpj: { type: "string" },
          whatsapp: { type: "string" },
          cep: { type: "string" },
          street: { type: "string" },
          number: { type: "string" },
          city: { type: "string" },
          state: { type: "string", maxLength: 2 },
          bio: { type: "string", maxLength: 600 },
          radiusKm: { type: "number" },
        },
      },
      BookingInput: {
        type: "object",
        required: [
          "providerId",
          "serviceId",
          "scheduledAt",
          "address",
          "cep",
          "lat",
          "lng",
          "amount",
        ],
        properties: {
          providerId: { type: "string" },
          serviceId: { type: "string" },
          scheduledAt: { type: "string", format: "date-time" },
          address: { type: "string", minLength: 3 },
          cep: { type: "string", minLength: 8 },
          lat: { type: "number" },
          lng: { type: "number" },
          amount: { type: "number" },
          paymentMethod: { type: "string", enum: ["CARD", "PIX"] },
          notes: { type: "string", maxLength: 1000 },
        },
      },
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
          status: { type: "integer" },
        },
      },
    },
  },
}

const outPath = path.resolve(__dirname, "..", "public", "openapi.json")
writeFileSync(outPath, JSON.stringify(apiDoc, null, 2))
console.log(`OpenAPI spec generated at ${outPath}`)
console.log(`Total paths: ${Object.keys(paths).length}`)
