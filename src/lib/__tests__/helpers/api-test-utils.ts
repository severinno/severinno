/**
 * Testing utility helpers for API route tests.
 *
 * createMockRequest  — builds a Next.js Request-like object with optional search params / body.
 * parseResponse      — calls .json() on a NextResponse and returns status + body.
 */

import { NextResponse } from "next/server"

export type MockRequestOptions = {
  method?: string
  body?: unknown
  searchParams?: Record<string, string>
  headers?: Record<string, string>
}

/**
 * Create a minimal Next.js Request for use in route handler tests.
 */
export function createMockRequest(opts?: MockRequestOptions): Request {
  const { method = "GET", body, searchParams = {}, headers = {} } = opts ?? {}

  const url = new URL("http://localhost:3000")
  for (const [k, v] of Object.entries(searchParams)) {
    url.searchParams.set(k, v)
  }

  const init: RequestInit & { headers: Record<string, string> } = {
    method,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  }

  if (body !== undefined) {
    init.body = JSON.stringify(body)
  }

  return new Request(url.toString(), init)
}

/**
 * Parse a NextResponse into { status, body } for easy assertions.
 */
export async function parseResponse<T = Record<string, unknown>>(
  res: NextResponse | Response,
): Promise<{ status: number; body: T | null }> {
  const status = res.status
  let body: T | null = null
  try {
    body = (await res.json()) as T
  } catch {
    // response may have no body
  }
  return { status, body }
}
