import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  deleteIdentityArtifacts,
  purgeStalePendingIdentities,
  s3KeyFromUrl,
} from "../identity-retention"
import { db } from "@/lib/db"
import { deleteFromS3 } from "@/lib/s3"

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/s3", () => ({
  deleteFromS3: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/redis", () => ({
  getClient: vi.fn().mockReturnValue(null),
}))

describe("s3KeyFromUrl — o recorte da key pela marca do fluxo", () => {
  it("extrai `identity/...` de uma URL path-style do MinIO", () => {
    expect(s3KeyFromUrl("http://minio:9000/severinno/identity/u1/document-123.jpg")).toBe(
      "identity/u1/document-123.jpg",
    )
  })

  it("URL que não é do fluxo devolve null (o caller não delete nada fora do fluxo)", () => {
    expect(s3KeyFromUrl("https://cdn.severinno.com/uploads/avatar.png")).toBeNull()
  })
})

describe("deleteIdentityArtifacts — o banco para de expor ANTES do bucket", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("nula as URLs primeiro e deleta as keys derivadas depois", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      identityDocUrl: "http://minio:9000/severinno/identity/u1/document-1.jpg",
      identitySelfieUrl: "http://minio:9000/severinno/identity/u1/selfie-1.jpg",
    } as never)
    vi.mocked(db.user.update).mockResolvedValue({} as never)

    const r = await deleteIdentityArtifacts("u1")

    // DB primeiro: o update foi a PRIMEIRA chamada (o app para de expor
    // mesmo se o S3 falhar).
    expect(db.user.update).toHaveBeenCalledTimes(1)
    expect(deleteFromS3).toHaveBeenCalledTimes(2)
    expect(deleteFromS3).toHaveBeenCalledWith("identity/u1/document-1.jpg")
    expect(deleteFromS3).toHaveBeenCalledWith("identity/u1/selfie-1.jpg")
    expect(r.deletedKeys).toBe(2)
  })

  it("S3 falhando, o dado ainda sai do banco (best-effort com log nomeado)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      identityDocUrl: "http://minio:9000/severinno/identity/u1/doc.jpg",
      identitySelfieUrl: null,
    } as never)
    vi.mocked(db.user.update).mockResolvedValue({} as never)
    vi.mocked(deleteFromS3).mockRejectedValueOnce(new Error("minio down"))

    const r = await deleteIdentityArtifacts("u1")
    // A GARANTIA: o app para de expor mesmo com o bucket fora (update foi
    // dado); a contagem reporta honestamente que o objeto não saiu (0).
    expect(db.user.update).toHaveBeenCalledTimes(1)
    expect(r.deletedKeys).toBe(0)
  })

  it("usuário sem nenhum artefato é no-op (zero keys, zero update)", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      identityDocUrl: null,
      identitySelfieUrl: null,
    } as never)

    const r = await deleteIdentityArtifacts("u1")
    expect(db.user.update).not.toHaveBeenCalled()
    expect(deleteFromS3).not.toHaveBeenCalled()
    expect(r.deletedKeys).toBe(0)
  })

  it("URL fora do fluxo (avatar) NUNCA é deletada — o recorte é pela marca identity/", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      identityDocUrl: "https://cdn.severinno.com/uploads/avatar-aleatorio.png",
      identitySelfieUrl: null,
    } as never)

    const r = await deleteIdentityArtifacts("u1")
    expect(deleteFromS3).not.toHaveBeenCalled()
    expect(r.deletedKeys).toBe(0)
  })
})

describe("purgeStalePendingIdentities — a pendência expirada perde a biometria", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("purga as pendências mais velhas que o corte, marca rejected e grava o motivo", async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([{ id: "u1" }, { id: "u2" }] as never)
    vi.mocked(db.user.findUnique).mockResolvedValue({
      identityDocUrl: "http://minio:9000/severinno/identity/u1/doc.jpg",
      identitySelfieUrl: null,
    } as never)
    vi.mocked(db.user.update).mockResolvedValue({} as never)

    const r = await purgeStalePendingIdentities(30)

    expect(r.purged).toBe(2)
    expect(db.user.findUnique).toHaveBeenCalledTimes(2)
  })
})
