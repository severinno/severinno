/**
 * api-route.ts — wrapper composável de route handlers.
 *
 * Elimina o boilerplate repetido em todas as rotas de API:
 *
 *   export async function POST(request: Request) {
 *     return traceSpan("api.bookings.POST", async (span) => {
 *       try {
 *         // ... lógica ...
 *         return NextResponse.json(...)
 *       } catch (e) {
 *         return handleError(e)
 *       }
 *     })
 *   }
 *
 * vira:
 *
 *   export const POST = withRoute("api.bookings.POST", async (req, { span }) => {
 *     // ... lógica ...
 *     return NextResponse.json(...)
 *   })
 *
 * Contrato preservado:
 *   - Toda exceção cai em handleError() (HttpError, AuthError, domain errors,
 *     ZodError → 400, 500 com requestId; Cache-Control: no-store em erros);
 *   - O handler roda dentro de um span do OpenTelemetry com o nome dado;
 *   - Atributos OTel padronizados em TODA rota (sem que a rota toque em nada):
 *     http.request_id, http.request.method, http.route, url.path,
 *     http.response.status_code e http.duration_ms — inclusive no caminho de
 *     erro (status e duração do handleError também são medidos);
 *   - `export const dynamic = "force-dynamic"` continua necessário nos
 *     arquivos que o tinham (não é responsabilidade do wrapper).
 *
 * O contexto `{ request-id, params, span }` chega como 2º argumento do
 * handler — `params` já resolvido (await feito pelo wrapper), tipado por
 * rota via genérico:
 *
 *   export const GET = withRoute<{ id: string }>("api.bookings.GET",
 *     async (req, { params }) => { ... params.id ... })
 */

import { NextResponse } from "next/server"
import { handleError } from "./api-server"
import { traceSpan } from "./tracing"
import { establishRequestContext } from "./request-context"
import { requireMaintenanceAccessible } from "./maintenance-mode"
import type { Span } from "@opentelemetry/api"

/** Contexto entregue ao handler. `params` só existe em rotas dinâmicas. */
export type RouteContext<P> = {
  /** Span OTel do request — setAttribute à vontade. */
  span: Span
  /** Request id (x-request-id) estabelecido pelo proxy.ts. */
  requestId: string
  /** Params de rota dinâmica, JÁ RESOLVIDOS (o wrapper faz o await). */
  params: P
}

/** Segundo argumento do handler: params é opcional no call site. */
export type HandlerArgs<P> = Omit<RouteContext<P>, "params"> & {
  params?: P
}

type RouteHandler<P> = (request: Request, ctx: HandlerArgs<P>) => Promise<Response> | Response

type DynamicRouteHandler<P> = (
  request: Request,
  ctx: HandlerArgs<P> & { params: P },
) => Promise<Response> | Response

/**
 * pathname do request, best-effort: URL malformada (testes, chamadas sintéticas)
 * devolve string vazia em vez de derrubar o handler por causa de um atributo.
 */
function requestPathname(request: Request): string {
  try {
    return new URL(request.url).pathname
  } catch {
    return ""
  }
}

/**
 * Exporta um route handler com tracing + error handling padronizados.
 *
 * @param spanName  Nome do span OTel (convenção do projeto: "api.<recurso>.<METODO>").
 * @param handler   Lógica da rota. Erros NÃO tratados caem em handleError().
 *
 * Rotas estáticas (sem [param]):
 *   export const GET = withRoute("api.health.GET", async (req) => {...})
 *
 * Rotas dinâmicas ([id]):
 *   export const GET = withRoute<{ id: string }>("api.bookings.GET",
 *     async (req, { params }) => {...})
 */
export function withRoute<P = Record<string, never>>(
  spanName: string,
  handler: RouteHandler<P>,
): (request: Request, ctx?: { params?: Promise<P> }) => Promise<Response> {
  return async function routeHandler(request, ctx) {
    return traceSpan(spanName, async (span) => {
      // Atributos OTel padronizados de TODA rota convertida — a rota não
      // precisa (e não deve) setar nada disto por conta própria:
      //   http.request_id        — x-request-id (ou sintético, best-effort)
      //   http.request.method    — método HTTP do request
      //   http.route             — identidade canônica da rota (o spanName,
      //                            convenção "api.<recurso>.<METODO>")
      //   url.path               — pathname real do request (com [id] resolvido)
      //   http.response.status_code — status da Response (do handler OU do
      //                            handleError no caminho de erro)
      //   http.duration_ms       — duração total em ms (coerente com o nome
      //                            http_request_duration_ms do Prometheus)
      const startedAt = Date.now()
      const finish = (response: Response): Response => {
        span.setAttribute("http.response.status_code", response.status)
        span.setAttribute("http.duration_ms", Math.max(0, Date.now() - startedAt))
        return response
      }
      try {
        // Estabelece request context (mesma função que requireUser chamava)
        // para que getRequestId() funcione nos logs do handleError.
        const requestId = await establishRequestContext()
        span.setAttribute("http.request_id", requestId)
        span.setAttribute("http.request.method", request.method)
        span.setAttribute("http.route", spanName)
        const pathname = requestPathname(request)
        span.setAttribute("url.path", pathname)

        // ── Chave de manutenção (um clique no painel admin) ────────────────
        // Com a chave LIGADA, toda a API fica INACESSÍVEL ao público — responde
        // 503 — e apenas sessões ADMIN atravessam (o painel continua operável
        // para DESLIGAR a chave). Fora do corte, de propósito: `/api/webhooks/*`
        // são callbacks de provedores externos (barrar na janela de manutenção
        // pode corromper conciliação) e `/api/health` é o sinal de vida que o
        // monitoramento consulta — a tela de manutenção É o estado observable.
        if (!pathname.startsWith("/api/webhooks/") && pathname !== "/api/health") {
          await requireMaintenanceAccessible(request)
        }

        // Rotas dinâmicas do Next 16 passam `params` como Promise.
        const params = (ctx?.params ? await ctx.params : undefined) as P | undefined

        return finish(
          await handler(request, {
            span,
            requestId,
            ...(params !== undefined ? { params } : {}),
          }),
        )
      } catch (e) {
        // O caminho de erro TAMBÉM é observado: status do handleError +
        // duração. (traceSpan marca o span como ERROR só quando a exceção
        // ESCAPA — aqui ela é mapeada para Response dentro do wrapper.)
        return finish(handleError(e))
      }
    })
  }
}

/**
 * Variante para rotas DINÂMICAS ([param]) — params obrigatório no handler,
 * já resolvido. Diferença apenas de tipo: deixa o compilador exigir que o
 * handler declare `params: P` (não opcional), evitando `params!`.
 */
export function withParams<P>(
  spanName: string,
  handler: DynamicRouteHandler<P>,
): (request: Request, ctx: { params?: Promise<P> }) => Promise<Response> {
  return withRoute<P>(spanName, async (request, ctx) => {
    // Invariante: rotas dinâmicas do Next SEMPRE entregam params. Se algum
    // dia chegar undefined (mudança de contrato do framework), 500 explícito
    // em vez de TypeError no meio do handler.
    if (!ctx.params) {
      return NextResponse.json({ error: "Parâmetros de rota ausentes" }, { status: 500 })
    }
    return handler(request, ctx as HandlerArgs<P> & { params: P })
  })
}
