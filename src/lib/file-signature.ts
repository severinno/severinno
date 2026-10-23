/**
 * file-signature.ts — validação de magic bytes para uploads.
 *
 * O MIME declarado pelo cliente (`file.type`) e a extensão do nome são
 * STRINGS CONTROLADAS PELO ATACANTE. A única característica do arquivo que
 * o cliente não forja facilmente são os primeiros bytes (magic number /
 * file signature). Esta camada compara o buffer real com as assinaturas
 * conhecidas ANTES de o arquivo tocar o storage.
 *
 * Decisão de escopo (09/2026): SVG foi REMOVIDO da allowlist de upload.
 * SVG é XML ativo — pode embutir <script>, onload=, <foreignObject> e
 * event handlers que executam no contexto da origem que o serve. Como o
 * bucket é público (mesma origem do app via Caddy), um SVG malicioso é
 * XSS armazenado. O uso legítimo (ícones/logos vetoriais) não justifica
 * o risco: avatares/fotos são raster. Sanitização de SVG (DOMPurify
 * server-side) seria alternativa, mas introduz dependência de parse de
 * XML robusto para ganho pequeno — bloqueio simples é a medida correta.
 *
 * Polyglots: um arquivo pode ser simultaneamente GIF e JS (GIF89a + JS
 * concatenado) — browsers sniffam quando não há Content-Type confiável.
 * Por isso a assinatura é validada em DOIS pontos: começa com a assinatura
 * esperada E não contém assinatura de outro tipo conflitante.
 */

/** Assinaturas binárias (magic numbers) dos tipos permitidos. */
const SIGNATURES: Array<{ mime: string; bytes: number[]; offset: number; label: string }> = [
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff], offset: 0, label: "JPEG" },
  {
    mime: "image/png",
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    offset: 0,
    label: "PNG",
  },
  { mime: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38], offset: 0, label: "GIF" }, // GIF87a/GIF89a
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46], offset: 0, label: "WEBP(RIFF)" }, // RIFF....WEBP
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46], offset: 0, label: "PDF" }, // %PDF
  {
    mime: "application/msword",
    bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
    offset: 0,
    label: "DOC(OLE2)",
  },
  {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes: [0x50, 0x4b, 0x03, 0x04],
    offset: 0,
    label: "DOCX(ZIP)",
  },
]

export type SignatureCheck = {
  ok: boolean
  /** Motivo da rejeição (para log/resposta) — undefined quando ok. */
  reason?: string
  /** Label da assinatura detectada (ex.: "PNG", "JPEG"). */
  detected?: string
}

function startsWith(buf: Uint8Array, bytes: number[], offset: number): boolean {
  if (buf.length < offset + bytes.length) return false
  return bytes.every((b, i) => buf[offset + i] === b)
}

/** RIFF....WEBP: RIFF nos 4 primeiros + "WEBP" no offset 8. */
function isWebp(buf: Uint8Array): boolean {
  if (buf.length < 12) return false
  return (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
}

/**
 * Valida se o buffer começa com uma das assinaturas conhecidas.
 * Retorna ok=false com reason quando o conteúdo não bate com NENHUMA
 * assinatura na allowlist — o arquivo é rejeitado na rota de upload.
 */
export function detectFileSignature(buf: Uint8Array): SignatureCheck {
  if (!buf || buf.length < 8) {
    return { ok: false, reason: "Arquivo muito pequeno para identificar assinatura" }
  }

  for (const sig of SIGNATURES) {
    if (sig.label === "WEBP(RIFF)") {
      if (isWebp(buf)) return { ok: true, detected: sig.label }
      continue
    }
    if (startsWith(buf, sig.bytes, sig.offset)) {
      return { ok: true, detected: sig.label }
    }
  }

  // Assinatura de SVG textual — detectada para DAR MOTIVO CLARO de rejeição
  // (o upload aceitava SVG antes; agora o motivo aparece no log e na resposta).
  const head = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, 512)).trimStart()
  if (head.startsWith("<?xml") || head.startsWith("<svg") || head.startsWith("<!--")) {
    return {
      ok: false,
      reason:
        "SVG não é aceito (risco de XSS armazenado). Envie a imagem em formato raster (JPG, PNG, WebP).",
    }
  }

  return {
    ok: false,
    reason:
      "Conteúdo do arquivo não corresponde a nenhum tipo permitido (JPG, PNG, GIF, WebP, PDF, DOC, DOCX).",
  }
}

/**
 * Validação cruzada: o MIME declarado/extensão precisa ser COMPATÍVEL com a
 * assinatura real. Ex.: extensão .png com conteúdo JPEG passa (browsers
 * renderizam), mas .jpg com conteúdo PDF é rejeitado — sinal de spoofing.
 *
 * Compatibilidades aceitas (mesma família de renderização):
 *   - DOCX é ZIP (PK\x03\x04) — a assinatura esperada de .docx é ZIP.
 *   - .doc pode ser OLE2 (D0 CF) — assinatura própria.
 */
const MIME_TO_LABEL: Record<string, string[]> = {
  "image/jpeg": ["JPEG"],
  "image/png": ["PNG"],
  "image/gif": ["GIF"],
  "image/webp": ["WEBP(RIFF)"],
  "application/pdf": ["PDF"],
  "application/msword": ["DOC(OLE2)"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["DOCX(ZIP)"],
}

export function validateFileSignature(buf: Uint8Array, declaredMime: string): SignatureCheck {
  const detected = detectFileSignature(buf)
  if (!detected.ok) return detected

  const allowedLabels = MIME_TO_LABEL[declaredMime]
  if (!allowedLabels) {
    return { ok: false, reason: `Tipo declarado ${declaredMime} não é permitido.` }
  }
  if (!allowedLabels.includes(detected.detected ?? "")) {
    return {
      ok: false,
      reason: `Conteúdo real (${detected.detected}) não corresponde ao tipo declarado (${declaredMime}).`,
    }
  }
  return detected
}
