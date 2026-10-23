import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

/**
 * GET /api/docs — Documentação Interativa de APIs (OpenAPI 3.1 & Scalar)
 *
 * Renderiza o portal interativo de documentação das rotas do Severinno,
 * consumindo a especificação pública gerada em /openapi.json.
 * Em produção, é ocultado por padrão para evitar reconnaissance de superfície de ataque,
 * a menos que EXPOSE_DOCS="true" esteja explicitamente configurado.
 */
export async function GET() {
  if (process.env.NODE_ENV === "production" && process.env.EXPOSE_DOCS !== "true") {
    return new NextResponse("Not Found", { status: 404 })
  }
  const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <title>Severinno Marketplace — Documentação da API</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="/favicon.ico" />
    <style>
      body { margin: 0; background-color: #022c22; font-family: system-ui, -apple-system, sans-serif; }
    </style>
  </head>
  <body>
    <script
      id="api-reference"
      data-url="/openapi.json"
      data-theme="emerald"
      data-layout="modern"
      src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"
    ></script>
  </body>
</html>`

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  })
}
