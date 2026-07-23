import { describe, it, expect, vi, beforeEach } from 'vitest'

// The global vitest.setup.ts already mocks @prisma/client with $use as vi.fn().
// We intercept the $use calls by re-mocking with a capturing implementation.

type MiddlewareFn = (
  params: Record<string, unknown>,
  next: (p: Record<string, unknown>) => Promise<unknown>
) => Promise<unknown>

const middlewares: MiddlewareFn[] = []

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({
    $use: vi.fn((fn: MiddlewareFn) => middlewares.push(fn)),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
  })),
}))

// Force fresh import so our mock captures the middlewares
const { db } = await import('@/lib/db')

/** Run the registered middleware chain on a params object, returning the final transformed params. */
async function runMiddlewares(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const createNext =
    (i: number): ((p: Record<string, unknown>) => Promise<Record<string, unknown>>) =>
    async (p) => {
      if (i < middlewares.length) {
        return middlewares[i](p, createNext(i + 1)) as Promise<Record<string, unknown>>
      }
      return p
    }

  return middlewares[0](input, createNext(1)) as Promise<Record<string, unknown>>
}

describe('Soft Delete Middleware', () => {
  it('registered two middlewares (read filter + write intercept)', () => {
    expect(middlewares.length).toBe(2)
  })

  // ── READ filter tests ────────────────────────────────────────────────────

  describe('READ filter', () => {
    it('adds deletedAt:null to User findMany', async () => {
      const result = await runMiddlewares({
        model: 'User',
        action: 'findMany',
        args: { where: { role: 'CLIENT' } },
      })

      expect((result.args as Record<string, unknown>)).toMatchObject({
        where: { role: 'CLIENT', deletedAt: null },
      })
    })

    it('adds deletedAt:null to Service findFirst', async () => {
      const result = await runMiddlewares({
        model: 'Service',
        action: 'findFirst',
        args: { where: { active: true } },
      })

      expect((result.args as Record<string, unknown>)).toMatchObject({
        where: { active: true, deletedAt: null },
      })
    })

    it('adds deletedAt:null to Booking count', async () => {
      const result = await runMiddlewares({
        model: 'Booking',
        action: 'count',
        args: { where: { status: 'PENDING' } },
      })

      expect((result.args as Record<string, unknown>)).toMatchObject({
        where: { status: 'PENDING', deletedAt: null },
      })
    })

    it('does NOT override explicit deletedAt query', async () => {
      const result = await runMiddlewares({
        model: 'User',
        action: 'findMany',
        args: { where: { deletedAt: { not: null } } },
      })

      expect((result.args as Record<string, unknown>)).toMatchObject({
        where: { deletedAt: { not: null } },
      })
    })

    it('skips non-soft-delete models (Review)', async () => {
      const result = await runMiddlewares({
        model: 'Review',
        action: 'findMany',
        args: { where: { rating: 5 } },
      })

      const where = (result.args as { where: Record<string, unknown> }).where
      expect(where).not.toHaveProperty('deletedAt')
    })

    it('handles missing args', async () => {
      const result = await runMiddlewares({
        model: 'User',
        action: 'findMany',
        args: undefined,
      })

      expect((result.args as Record<string, unknown>)).toMatchObject({
        where: { deletedAt: null },
      })
    })

    it('applies to findUnique', async () => {
      const result = await runMiddlewares({
        model: 'Booking',
        action: 'findUnique',
        args: { where: { id: 'booking-1' } },
      })

      expect((result.args as Record<string, unknown>)).toMatchObject({
        where: { id: 'booking-1', deletedAt: null },
      })
    })
  })

  // ── WRITE intercept tests ────────────────────────────────────────────────

  describe('WRITE intercept (delete → soft delete)', () => {
    it('converts User delete to update with deletedAt', async () => {
      const result = await runMiddlewares({
        model: 'User',
        action: 'delete',
        args: { where: { id: 'user-1' } },
      })

      expect(result.action).toBe('update')
      const data = (result.args as { data: Record<string, unknown> }).data
      expect(data.deletedAt).toBeInstanceOf(Date)
    })

    it('converts Booking deleteMany to updateMany', async () => {
      const result = await runMiddlewares({
        model: 'Booking',
        action: 'deleteMany',
        args: { where: { providerId: 'prov-1' } },
      })

      expect(result.action).toBe('updateMany')
      const data = (result.args as { data: Record<string, unknown> }).data
      expect(data.deletedAt).toBeInstanceOf(Date)
    })

    it('does NOT intercept Favorite delete', async () => {
      const result = await runMiddlewares({
        model: 'Favorite',
        action: 'delete',
        args: { where: { id: 'fav-1' } },
      })

      expect(result.action).toBe('delete')
    })
  })
})
