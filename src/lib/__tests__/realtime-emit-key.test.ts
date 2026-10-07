/**
 * Testes de src/lib/realtime-emit-key.ts — fonte da REALTIME_EMIT_API_KEY.
 *
 * O contrato: _FILE (Docker Secret) tem precedência e NUNCA cai silenciosamente
 * para a env quando o arquivo não pôde ser lido (fail-closed — mount quebrado
 * não pode parecer "serviço sem chave"); a env direta é a fonte de dev/staging
 * (composes monolíticos que leem do .env).
 */
import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readRealtimeEmitKey } from "@/lib/realtime-emit-key"

let dir: string

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

function writeSecretFile(content: string): string {
  dir = mkdtempSync(join(tmpdir(), "emit-key-"))
  const path = join(dir, "realtime_emit_api_key")
  writeFileSync(path, content)
  return path
}

describe("readRealtimeEmitKey", () => {
  it("lê a chave do arquivo quando REALTIME_EMIT_API_KEY_FILE está definida (trim de newline)", () => {
    const path = writeSecretFile("abc123\n")
    const key = readRealtimeEmitKey({ REALTIME_EMIT_API_KEY_FILE: path })
    expect(key).toBe("abc123")
  })

  it("_FILE vence a env direta quando ambas estão definidas", () => {
    const path = writeSecretFile("do-secret\n")
    const key = readRealtimeEmitKey({
      REALTIME_EMIT_API_KEY_FILE: path,
      REALTIME_EMIT_API_KEY: "da-env",
    })
    expect(key).toBe("do-secret")
  })

  it("LANÇA quando _FILE aponta para arquivo inexistente (fail-closed, sem fallback)", () => {
    expect(() =>
      readRealtimeEmitKey({
        REALTIME_EMIT_API_KEY_FILE: "/run/secrets/nao-existe",
        REALTIME_EMIT_API_KEY: "da-env",
      }),
    ).toThrow(/não pôde ser lido.*Fail-closed/)
  })

  it("arquivo vazio cai para a env direta (não há chave no secret)", () => {
    const path = writeSecretFile("")
    const key = readRealtimeEmitKey({
      REALTIME_EMIT_API_KEY_FILE: path,
      REALTIME_EMIT_API_KEY: "da-env",
    })
    expect(key).toBe("da-env")
  })

  it("sem _FILE, usa a env direta (dev/staging)", () => {
    expect(readRealtimeEmitKey({ REALTIME_EMIT_API_KEY: "k-1" })).toBe("k-1")
  })

  it("sem nenhuma fonte, devolve undefined (boot do realtime avisa/falha)", () => {
    expect(readRealtimeEmitKey({})).toBeUndefined()
  })

  it("env direta vazia ou só espaços valem undefined", () => {
    expect(readRealtimeEmitKey({ REALTIME_EMIT_API_KEY: "" })).toBeUndefined()
    expect(readRealtimeEmitKey({ REALTIME_EMIT_API_KEY: "   " })).toBeUndefined()
  })
})
