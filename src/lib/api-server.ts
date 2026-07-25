import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Server-side helpers for API route handlers.
 * (Foundation `src/lib/api.ts` is a client-side typed fetch wrapper —
 * DO NOT import this file from client components; it touches `db`.)
 */

// ---------------------------------------------------------------------------
// Public-safe user shape — never expose passwordHash
// ---------------------------------------------------------------------------
export const USER_PUBLIC_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  cpfCnpj: true,
  whatsapp: true,
  phone: true,
  avatarUrl: true,
  bio: true,
  coverUrl: true,
  lat: true,
  lng: true,
  radiusKm: true,
  cep: true,
  street: true,
  number: true,
  complement: true,
  district: true,
  city: true,
  state: true,
  verified: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function publicUser<T extends { passwordHash?: string }>(user: T): Omit<T, "passwordHash"> {
  const { passwordHash: _ignored, ...rest } = user;
  return rest;
}

// ---------------------------------------------------------------------------
// Error helpers — throw these inside handlers; `handleError` maps them to JSON
// ---------------------------------------------------------------------------
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export const badRequest = (msg = "Requisição inválida") => new HttpError(400, msg);
export const unauthorized = (msg = "Não autorizado") => new HttpError(401, msg);
export const forbidden = (msg = "Acesso proibido") => new HttpError(403, msg);
export const notFound = (msg = "Recurso não encontrado") => new HttpError(404, msg);
export const conflict = (msg = "Conflito de estado") => new HttpError(409, msg);

/**
 * Map any thrown error to a JSON response. Auth errors thrown by
 * `requireUser`/`requireRole` (`UNAUTHORIZED` / `FORBIDDEN` strings) are
 * mapped to 401/403. Zod errors → 400 with issue details.
 */
export function handleError(e: unknown) {
  if (e instanceof HttpError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  if (e instanceof ZodError) {
    return NextResponse.json({ error: "Dados inválidos", details: e.issues }, { status: 400 });
  }
  if (e instanceof Error) {
    if (e.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }
    if (e.message === "FORBIDDEN") {
      return NextResponse.json({ error: "Acesso proibido" }, { status: 403 });
    }
  }
  logger.error("handleError — unhandled error", undefined, e);
  return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 });
}

// ---------------------------------------------------------------------------
// Pagination helper — parse page/limit from URLSearchParams (1-indexed)
// ---------------------------------------------------------------------------
export function parsePagination(searchParams: URLSearchParams) {
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") ?? "20") || 20));
  return { page, limit, skip: (page - 1) * limit, take: limit };
}

// ---------------------------------------------------------------------------
// Category tree — return all descendant ids (including the given one).
// Used by provider/service filters that need to match the whole sub-tree.
// ---------------------------------------------------------------------------
export async function getCategoryDescendants(categoryId: string): Promise<string[]> {
  const all = await db.category.findMany({
    select: { id: true, parentId: true },
  });
  const childrenOf = new Map<string, string[]>();
  for (const c of all) {
    if (c.parentId) {
      const arr = childrenOf.get(c.parentId) ?? [];
      arr.push(c.id);
      childrenOf.set(c.parentId, arr);
    }
  }
  const result: string[] = [categoryId];
  const queue = [categoryId];
  while (queue.length) {
    const current = queue.shift() as string;
    const children = childrenOf.get(current) ?? [];
    for (const child of children) {
      result.push(child);
      queue.push(child);
    }
  }
  return result;
}
