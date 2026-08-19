import { writeFileSync } from "fs"
import path from "path"

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
  paths: {
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
  },
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
