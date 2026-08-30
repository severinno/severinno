/**
 * GraphQL API Route — serves the GraphQL schema via Yoga
 *
 * Endpoint: POST /api/graphql
 */
import { graphqlHandler } from "@/lib/graphql-schema"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  return graphqlHandler.handle(request, {})
}

export async function POST(request: Request) {
  return graphqlHandler.handle(request, {})
}
