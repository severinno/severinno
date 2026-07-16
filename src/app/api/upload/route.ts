import { NextResponse } from "next/server"
import { randomUUID } from "crypto"
import path from "path"
import { promises as fs } from "fs"
import sharp from "sharp"
import { requireUser } from "@/lib/auth"
import { badRequest, handleError } from "@/lib/api-server"

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads")
const MAX_FILE_SIZE = 8 * 1024 * 1024 // 8 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]

// Authenticated: upload an image, returns its public URL.
// Saves an optimized (webp, max 1200px) version under /public/uploads.
export async function POST(request: Request) {
  try {
    await requireUser()

    // formData() throws if Content-Type isn't multipart — handle gracefully.
    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      throw badRequest("Envie o arquivo como multipart/form-data (campo 'file')")
    }

    const file = formData.get("file")
    if (!(file instanceof File)) {
      throw badRequest("Arquivo ausente (campo 'file')")
    }
    if (file.size === 0) throw badRequest("Arquivo vazio")
    if (file.size > MAX_FILE_SIZE) {
      throw badRequest("Arquivo muito grande (máx 8MB)")
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      throw badRequest("Tipo de arquivo não suportado")
    }

    // Ensure dir exists
    await fs.mkdir(UPLOAD_DIR, { recursive: true })

    const buffer = Buffer.from(await file.arrayBuffer())
    const id = randomUUID()
    const fileName = `${id}.webp`
    const filePath = path.join(UPLOAD_DIR, fileName)

    // Resize/compress to webp (max width 1200, quality 80).
    // sharp throws on invalid input — translate to a 400.
    try {
      await sharp(buffer)
        .resize({ width: 1200, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(filePath)
    } catch {
      throw badRequest("Imagem inválida ou corrompida")
    }

    const url = `/uploads/${fileName}`
    return NextResponse.json({ url }, { status: 201 })
  } catch (e) {
    return handleError(e)
  }
}
