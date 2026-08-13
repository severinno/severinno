/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest"

// Test the soft-delete middleware logic directly via the exported pure
// functions from the dedicated module (not db.ts, which depends on Prisma).

import {
  softDeleteReadFilter,
  softDeleteWriteInterceptor,
  applySoftDeleteMiddlewares,
  isSoftDeleteModel,
  SOFT_DELETE_MODELS,
} from "../soft-delete"

describe("isSoftDeleteModel", () => {
  it("returns true for User, Service, Booking", () => {
    for (const model of SOFT_DELETE_MODELS) {
      expect(isSoftDeleteModel(model)).toBe(true)
    }
  })

  it("returns false for other models (Review, Favorite, etc.)", () => {
    expect(isSoftDeleteModel("Review")).toBe(false)
    expect(isSoftDeleteModel("Favorite")).toBe(false)
    expect(isSoftDeleteModel("Category")).toBe(false)
    expect(isSoftDeleteModel("Message")).toBe(false)
  })
})

describe("softDeleteReadFilter", () => {
  it("adds deletedAt:null to User findMany", () => {
    const result = softDeleteReadFilter({
      model: "User",
      action: "findMany",
      args: { where: { role: "CLIENT" } },
    })

    expect(result.args as Record<string, unknown>).toMatchObject({
      where: { role: "CLIENT", deletedAt: null },
    })
  })

  it("adds deletedAt:null to Service findFirst", () => {
    const result = softDeleteReadFilter({
      model: "Service",
      action: "findFirst",
      args: { where: { active: true } },
    })

    expect(result.args as Record<string, unknown>).toMatchObject({
      where: { active: true, deletedAt: null },
    })
  })

  it("adds deletedAt:null to Booking count", () => {
    const result = softDeleteReadFilter({
      model: "Booking",
      action: "count",
      args: { where: { status: "PENDING" } },
    })

    expect(result.args as Record<string, unknown>).toMatchObject({
      where: { status: "PENDING", deletedAt: null },
    })
  })

  it("does NOT override explicit deletedAt query", () => {
    const result = softDeleteReadFilter({
      model: "User",
      action: "findMany",
      args: { where: { deletedAt: { not: null } } },
    })

    expect(result.args as Record<string, unknown>).toMatchObject({
      where: { deletedAt: { not: null } },
    })
    const where = (result.args as { where: Record<string, unknown> }).where
    expect(Object.keys(where).filter((k) => k === "deletedAt").length).toBe(1)
  })

  it("skips non-soft-delete models (Review)", () => {
    const result = softDeleteReadFilter({
      model: "Review",
      action: "findMany",
      args: { where: { rating: 5 } },
    })

    const where = (result.args as { where: Record<string, unknown> }).where
    expect(where).not.toHaveProperty("deletedAt")
  })

  it("handles missing args", () => {
    const result = softDeleteReadFilter({
      model: "User",
      action: "findMany",
      args: undefined,
    })

    expect(result.args as Record<string, unknown>).toMatchObject({
      where: { deletedAt: null },
    })
  })

  it("applies to findUnique", () => {
    const result = softDeleteReadFilter({
      model: "Booking",
      action: "findUnique",
      args: { where: { id: "booking-1" } },
    })

    expect(result.args as Record<string, unknown>).toMatchObject({
      where: { id: "booking-1", deletedAt: null },
    })
  })
})

describe("softDeleteWriteInterceptor", () => {
  it("converts User delete to update with deletedAt", () => {
    const result = softDeleteWriteInterceptor({
      model: "User",
      action: "delete",
      args: { where: { id: "user-1" } },
    })

    expect(result.action).toBe("update")
    const data = (result.args as { data: Record<string, unknown> }).data
    expect(data.deletedAt).toBeInstanceOf(Date)
  })

  it("converts Booking deleteMany to updateMany", () => {
    const result = softDeleteWriteInterceptor({
      model: "Booking",
      action: "deleteMany",
      args: { where: { providerId: "prov-1" } },
    })

    expect(result.action).toBe("updateMany")
    const data = (result.args as { data: Record<string, unknown> }).data
    expect(data.deletedAt).toBeInstanceOf(Date)
  })

  it("does NOT intercept Favorite delete", () => {
    const result = softDeleteWriteInterceptor({
      model: "Favorite",
      action: "delete",
      args: { where: { id: "fav-1" } },
    })

    expect(result.action).toBe("delete")
  })
})

describe("applySoftDeleteMiddlewares", () => {
  it("applies both middlewares in order", () => {
    const result = applySoftDeleteMiddlewares({
      model: "User",
      action: "delete",
      args: { where: { id: "user-1" } },
    })

    expect(result.action).toBe("update")
  })

  it("applies read filter + write interceptor to findMany", () => {
    const result = applySoftDeleteMiddlewares({
      model: "Booking",
      action: "findMany",
      args: { where: { status: "PENDING" } },
    })

    const where = (result.args as { where: Record<string, unknown> }).where
    expect(where.deletedAt).toBeNull()
    expect(where.status).toBe("PENDING")
  })
})
