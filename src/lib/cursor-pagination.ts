/**
 * Cursor pagination helpers for the providers API.
 *
 * Cursor encoding: base64url(JSON.stringify({ v: [...sortValues], i: providerId }))
 * - `v`: sort column values (in sort order)
 * - `i`: provider ID (tiebreaker, always ASC)
 *
 * Two cursor types:
 *   PostGIS:  { v: [distance], i: id }       — ORDER BY distance ASC, id ASC
 *   Standard: { v: [rating, distance], i: id } — ORDER BY rating DESC, distance ASC, id ASC
 */

import { z } from "zod"

const CursorSchema = z.object({
  v: z.array(z.number().nullable()),
  i: z.string(),
})

export type Cursor = z.infer<typeof CursorSchema>

/**
 * Encode a cursor object into an opaque string.
 */
export function encodeCursor(v: (number | null)[], id: string): string {
  return Buffer.from(JSON.stringify({ v, i: id })).toString("base64url")
}

/**
 * Decode a cursor string back into a cursor object.
 * Returns null for invalid/missing cursors.
 */
export function decodeCursor(raw: string | null): Cursor | null {
  if (!raw) return null
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8")
    return CursorSchema.parse(JSON.parse(json))
  } catch {
    return null
  }
}
