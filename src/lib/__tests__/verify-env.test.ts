import { describe, it, expect } from "vitest"
import { parseEnvContent, validateEnvMap, type EnvRule } from "../../../scripts/verify-env"

describe("verify-env utility", () => {
  it("should parse .env content correctly ignoring comments and trimming quotes", () => {
    const raw = `
      # Comentario
      KEY1=value1
      KEY2="quoted value"
      KEY3='single quoted'
      EMPTY=
    `
    const parsed = parseEnvContent(raw)
    expect(parsed.KEY1).toBe("value1")
    expect(parsed.KEY2).toBe("quoted value")
    expect(parsed.KEY3).toBe("single quoted")
    expect(parsed.EMPTY).toBe("")
    expect(parsed["# Comentario"]).toBeUndefined()
  })

  it("should validate map and detect missing required keys", () => {
    const rules: EnvRule[] = [
      { key: "REQ1", required: true, description: "Req 1" },
      { key: "OPT1", required: false, description: "Opt 1" },
    ]

    const result = validateEnvMap({}, rules)
    expect(result.valid).toBe(false)
    expect(result.missingKeys).toContain("REQ1")
    expect(result.missingKeys).not.toContain("OPT1")
  })

  it("should detect unreplaced placeholders", () => {
    const rules: EnvRule[] = [{ key: "SECRET", required: true, description: "Secret key" }]

    const envMap = {
      SECRET: "<MUDE_AQUI_SECRET>",
    }

    const result = validateEnvMap(envMap, rules)
    expect(result.valid).toBe(false)
    expect(result.unreplacedPlaceholders).toHaveLength(1)
    expect(result.unreplacedPlaceholders[0].key).toBe("SECRET")
  })

  it("should validate minLength and regex patterns", () => {
    const rules: EnvRule[] = [
      { key: "SHORT", required: true, minLength: 10, description: "Too short" },
      { key: "URL", required: true, pattern: /^https:\/\//, description: "Must be HTTPS" },
    ]

    const badMap = {
      SHORT: "12345",
      URL: "http://insecure.com",
    }

    const result = validateEnvMap(badMap, rules)
    expect(result.valid).toBe(false)
    expect(result.formatErrors).toHaveLength(2)
  })

  it("should return valid: true when all rules are satisfied", () => {
    const rules: EnvRule[] = [
      { key: "SECRET", required: true, minLength: 8, description: "Secret" },
      { key: "URL", required: true, pattern: /^https?:\/\//, description: "URL" },
    ]

    const goodMap = {
      SECRET: "super_secret_123",
      URL: "https://severinno.com.br",
    }

    const result = validateEnvMap(goodMap, rules)
    expect(result.valid).toBe(true)
    expect(result.missingKeys).toHaveLength(0)
    expect(result.unreplacedPlaceholders).toHaveLength(0)
    expect(result.formatErrors).toHaveLength(0)
  })
})
