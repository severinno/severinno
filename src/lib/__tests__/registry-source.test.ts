/**
 * registry-source.test.ts
 *
 * O CONTRATO do resolvedor (`scripts/registry-source.mjs`): de onde sai o
 * registry/namespace que cada script usa, o que acontece quando não há de onde
 * tirar, e a RÉGUA de default que o guard do registry consome.
 *
 * POR QUE ele existe: os scripts cravavam o literal de reserva
 * (`process.env.IMAGE_REGISTRY || "ghcr.io"`) — e um literal de reserva
 * sobrevive à migração de registry: depois de trocar a variável para outro
 * host, o script continua puxando do VELHO, e como a imagem continua existindo
 * lá, nada fica vermelho. O resolvedor troca o literal por ORDEM (env → espelho
 * declarado → erro nomeado), e o teste trava as três metades:
 *   - a ordem (o env vence; sem ele, o espelho; sem os dois, LANÇA);
 *   - o que NÃO é default (valor vazio, outro nome de variável, prosa);
 *   - que os scripts migrados não voltaram a cravar o literal.
 *
 * Execução focada:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/registry-source.test.ts
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { resolveImageRef } from "../../../scripts/ensure-runner-image.mjs"
import {
  DEFAULT_FORMS_BY_FAMILY,
  IMAGE_MIRRORS,
  IMAGE_NAMESPACE_VAR,
  IMAGE_REGISTRY_VAR,
  IMAGE_VARIABLES,
  declaredImageMirrors,
  declaredImageValue,
  defaultValueVerdict,
  defaultsInLine,
  imageRefOf,
  mirrorTextOf,
  mirrorsOf,
  requireImageSource,
  resolveImageSource,
} from "../../../scripts/registry-source.mjs"

/** A raiz do repositório real (o guard e os scripts resolvem a partir dela). */
const REPO_ROOT = process.cwd()

/**
 * O valor DECLARADO de uma variável no repositório REAL — o próprio objeto da
 * comparação por valor. Falha ALTO se o espelho não declarar: um `undefined`
 * vazando para o veredito passaria como "nenhum valor" e o teste mediria outra
 * coisa (é o defeito que este arquivo existe para pegar no guard).
 */
function valorDeclarado(nome: string): string {
  const d = declaredImageValue(REPO_ROOT, nome)
  if (!d?.value) throw new Error(`o repositório real não declara ${nome}`)
  return d.value
}

/** Árvore sintética com os arquivos que o resolvedor lê. */
function treeOf(files: Record<string, string>, prefix = "registry-source-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel)
    mkdirSync(join(full, ".."), { recursive: true })
    writeFileSync(full, content, "utf8")
  }
  return dir
}

/** O template da aplicação declarando os dois valores (a forma canônica). */
const APP_TEMPLATE = {
  ".env.production.example": "IMAGE_REGISTRY=ghcr.io\nIMAGE_NAMESPACE=severinno\n",
}

describe("os espelhos declarados de cada variável", () => {
  it("são as DUAS variáveis da imagem, na ordem em que as mensagens as citam", () => {
    expect(IMAGE_VARIABLES).toEqual(["IMAGE_REGISTRY", "IMAGE_NAMESPACE"])
    expect(Object.keys(IMAGE_MIRRORS)).toEqual(IMAGE_VARIABLES)
  })

  it("IMAGE_REGISTRY tem o `.actrc` (o espelho do act local) como PRIMEIRO espelho", () => {
    expect(mirrorsOf("IMAGE_REGISTRY").map((m: { file: string }) => m.file)).toEqual([
      ".actrc",
      "deploy/env.gitea.example",
      ".env.production.example",
    ])
  })

  it("IMAGE_NAMESPACE não vive no `.actrc` (o act resolve por `github.repository_owner`)", () => {
    // Declarar um espelho que ninguém mantém seria um aviso permanente — e um
    // guard que não pode ficar verde é um guard desligado.
    expect(mirrorsOf("IMAGE_NAMESPACE").map((m: { file: string }) => m.file)).toEqual([
      "deploy/env.gitea.example",
      ".env.production.example",
    ])
  })

  it("um nome desconhecido não tem espelho nenhum (e a mensagem fica vazia)", () => {
    expect(mirrorsOf("NAO_EXISTE")).toEqual([])
    expect(mirrorTextOf("NAO_EXISTE")).toBe("")
  })
})

describe("declaredImageValue — o valor DECLARADO e o arquivo que o declara", () => {
  it("lê o primeiro espelho que declara a variável e nomeia o arquivo", () => {
    const dir = treeOf(APP_TEMPLATE)
    try {
      expect(declaredImageValue(dir, "IMAGE_REGISTRY")).toEqual({
        value: "ghcr.io",
        file: ".env.production.example",
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("a ORDEM dos espelhos é a precedência (o `.actrc` vence o template)", () => {
    const dir = treeOf({
      ".actrc": "--var IMAGE_REGISTRY=git.severinno.cloud\n",
      ...APP_TEMPLATE,
    })
    try {
      expect(declaredImageValue(dir, "IMAGE_REGISTRY")).toEqual({
        value: "git.severinno.cloud",
        file: ".actrc",
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("nenhum espelho declarando ⇒ null (a leitura não inventa valor)", () => {
    const dir = treeOf({ "README.md": "nada aqui\n" })
    try {
      expect(declaredImageValue(dir, "IMAGE_REGISTRY")).toBeNull()
      expect(declaredImageMirrors(dir)).toEqual({
        IMAGE_REGISTRY: [],
        IMAGE_NAMESPACE: [],
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("os dois valores declarados são lidos de uma vez, por variável", () => {
    const dir = treeOf(APP_TEMPLATE)
    try {
      expect(declaredImageMirrors(dir)).toEqual({
        IMAGE_REGISTRY: [{ file: ".env.production.example", value: "ghcr.io" }],
        IMAGE_NAMESPACE: [{ file: ".env.production.example", value: "severinno" }],
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("resolveImageSource — a ordem: ambiente, espelho declarado, nada", () => {
  it("o AMBIENTE vence o espelho (é assim que o CI entrega a variable resolvida)", () => {
    const dir = treeOf(APP_TEMPLATE)
    try {
      const r = resolveImageSource({
        root: dir,
        env: { IMAGE_REGISTRY: "registry.exemplo", IMAGE_NAMESPACE: "time" },
      })
      expect(r.registry).toBe("registry.exemplo")
      expect(r.namespace).toBe("time")
      expect(r.sources.IMAGE_REGISTRY).toContain("a variável do ambiente")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("sem o ambiente, o valor vem do ESPELHO — e a procedência nomeia o arquivo", () => {
    const dir = treeOf(APP_TEMPLATE)
    try {
      const r = resolveImageSource({ root: dir, env: {} })
      expect(r.registry).toBe("ghcr.io")
      expect(r.sources.IMAGE_REGISTRY).toContain(".env.production.example")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("um ambiente com espaço em branco NÃO é valor (cai para o espelho)", () => {
    const dir = treeOf(APP_TEMPLATE)
    try {
      expect(resolveImageSource({ root: dir, env: { IMAGE_REGISTRY: "   " } }).registry).toBe(
        "ghcr.io",
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("sem ambiente e sem espelho, o resultado é null — não há default de reserva", () => {
    const dir = treeOf({ "README.md": "nada\n" })
    try {
      const r = resolveImageSource({ root: dir, env: {} })
      expect(r.registry).toBeNull()
      expect(r.namespace).toBeNull()
      expect(r.sources).toEqual({ IMAGE_REGISTRY: null, IMAGE_NAMESPACE: null })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("as DUAS variáveis resolvem de forma independente (uma pode existir sozinha)", () => {
    const dir = treeOf({ ".env.production.example": "IMAGE_NAMESPACE=severinno\n" })
    try {
      const r = resolveImageSource({ root: dir, env: {} })
      expect(r.registry).toBeNull()
      expect(r.namespace).toBe("severinno")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("o repositório REAL resolve (o resolvedor não depende de env para funcionar)", () => {
    const r = resolveImageSource({ root: REPO_ROOT, env: {} })
    // O VALOR não é cravado aqui de propósito: o que este teste prova é que o
    // resolvedor ACHA a declaração no repo real sem env. Cravar o registry faz
    // o teste envelhecer junto com a virada do registry (etapa 1 do corte do
    // GitHub) e acusar o repositório por estar certo — a expectativa vem da
    // mesma declaração que o resolvedor lê.
    expect(r.registry).toBe(declaredImageValue(REPO_ROOT, "IMAGE_REGISTRY")?.value)
    expect(r.namespace).toBe(declaredImageValue(REPO_ROOT, "IMAGE_NAMESPACE")?.value)
    // E o resolvido É um host de registry (não um vazio que passaria no toBe acima).
    expect(r.registry).toMatch(/^[a-z0-9][a-z0-9.-]*(:\d+)?$/)
  })
})

describe("requireImageSource — o script que não pode ter default silencioso", () => {
  it("devolve os dois valores quando há de onde tirar", () => {
    const dir = treeOf(APP_TEMPLATE)
    try {
      expect(requireImageSource({ root: dir, env: {} })).toEqual({
        registry: "ghcr.io",
        namespace: "severinno",
        sources: {
          IMAGE_REGISTRY: "o espelho `.env.production.example`",
          IMAGE_NAMESPACE: "o espelho `.env.production.example`",
        },
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("LANÇA nomeando as variáveis, os espelhos e por que não existe reserva", () => {
    const dir = treeOf({ "README.md": "nada\n" })
    try {
      let erro: Error | null = null
      try {
        requireImageSource({ root: dir, env: {} })
      } catch (e) {
        erro = e as Error
      }
      expect(erro).toBeInstanceOf(Error)
      expect(erro!.message).toContain("IMAGE_REGISTRY e IMAGE_NAMESPACE não declarados")
      expect(erro!.message).toContain(".actrc") // os espelhos onde declarar
      expect(erro!.message).toContain("Não existe default de reserva")
      expect(erro!.message).toContain("puxando do VELHO") // o efeito, não só a regra
      expect(erro!.message).toContain(IMAGE_REGISTRY_VAR) // o remédio do CI
      expect(erro!.message).toContain(IMAGE_NAMESPACE_VAR)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("nomeia só a variável que falta (e não as duas)", () => {
    const dir = treeOf({ ".env.production.example": "IMAGE_NAMESPACE=severinno\n" })
    try {
      expect(() => requireImageSource({ root: dir, env: {} })).toThrowError(
        /^IMAGE_REGISTRY não declarado:/,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("imageRefOf — a referência montada do jeito que o compose monta", () => {
  it("junta registry, namespace, repo e tag", () => {
    expect(
      imageRefOf({ registry: "ghcr.io", namespace: "severinno" }, "ubuntu-bun", "1.3.14"),
    ).toBe("ghcr.io/severinno/ubuntu-bun:1.3.14")
  })

  it("absorve as barras de sobra (o valor não tem de vir limpo)", () => {
    expect(imageRefOf({ registry: "ghcr.io/", namespace: "/severinno/" }, "x", "1")).toBe(
      "ghcr.io/severinno/x:1",
    )
  })
})

describe("defaultsInLine — a régua única de 'o que conta como default'", () => {
  it("lê as três formas canônicas, cada uma com a sua família declarada", () => {
    expect(defaultsInLine("IMAGE_REGISTRY", "image: ${IMAGE_REGISTRY:-ghcr.io}/x")).toEqual([
      { value: "ghcr.io", form: "subst" },
    ])
    expect(
      defaultsInLine("IMAGE_REGISTRY", 'const r = process.env.IMAGE_REGISTRY || "ghcr.io"'),
    ).toEqual([{ value: "ghcr.io", form: "js" }])
    expect(defaultsInLine("IMAGE_REGISTRY", "env.IMAGE_REGISTRY ?? 'ghcr.io'")).toEqual([
      { value: "ghcr.io", form: "js" },
    ])
    expect(defaultsInLine("IMAGE_REGISTRY", 'process.env["IMAGE_REGISTRY"] || "ghcr.io"')).toEqual([
      { value: "ghcr.io", form: "js" },
    ])
    expect(defaultsInLine("IMAGE_REGISTRY", "${{ vars.IMAGE_REGISTRY || 'ghcr.io' }}")).toEqual([
      { value: "ghcr.io", form: "expr" },
    ])
  })

  it("VALOR VAZIO não é default (é o idioma de coalescência, não uma afirmação)", () => {
    // `${NOME:-}` e `|| ""` não têm valor para envelhecer — contá-los daria ao
    // guard a única classe de violação que ele não pode ter: a falsa.
    expect(defaultsInLine("IMAGE_REGISTRY", 'process.env.IMAGE_REGISTRY || ""')).toEqual([])
    expect(defaultsInLine("IMAGE_REGISTRY", "image: ${IMAGE_REGISTRY:-}/x")).toEqual([])
    expect(defaultsInLine("IMAGE_REGISTRY", "${{ vars.IMAGE_REGISTRY || '' }}")).toEqual([])
  })

  it("não confunde outra variável da MESMA família", () => {
    expect(
      defaultsInLine("IMAGE_REGISTRY", 'const n = process.env.IMAGE_NAMESPACE || "severinno"'),
    ).toEqual([])
    expect(defaultsInLine("IMAGE_REGISTRY", "image: ${IMAGE_NAMESPACE:-severinno}/x")).toEqual([])
  })

  it("lê TODOS os defaults de uma linha, na ordem em que aparecem", () => {
    const line = "image: ${IMAGE_REGISTRY:-ghcr.io}/${IMAGE_REGISTRY:-outro}/x"
    expect(defaultsInLine("IMAGE_REGISTRY", line).map((d) => d.value)).toEqual(["ghcr.io", "outro"])
  })

  it("o valor sai sem espaço pendurado", () => {
    expect(defaultsInLine("IMAGE_REGISTRY", "image: ${IMAGE_REGISTRY:- ghcr.io }/x")).toEqual([
      { value: "ghcr.io", form: "subst" },
    ])
  })
})

describe("DEFAULT_FORMS_BY_FAMILY — a forma de default vale por LINGUAGEM", () => {
  it("cada família tem a sua forma, e a tabela é a fonte única", () => {
    expect(DEFAULT_FORMS_BY_FAMILY).toEqual({
      compose: ["subst"],
      shell: ["subst"],
      js: ["js"],
      workflow: ["expr"],
    })
  })

  it("a MESMA linha casa formas diferentes: quem decide é a família do arquivo", () => {
    // O caso real que a tabela resolve: o payload de uma prova por mutação (um
    // `printf` de shell com o texto de um fallback de YAML) era julgado como
    // default do YAML — o guard opinando sobre a linha de outro gênero.
    const linhaDeShell = "printf '%s' \"${{ vars.IMAGE_REGISTRY || 'registry.velho' }}\""
    const formas = defaultsInLine("IMAGE_REGISTRY", linhaDeShell).map((d) => d.form)
    expect(formas).toEqual(["expr"])
    expect(DEFAULT_FORMS_BY_FAMILY.shell.includes("expr")).toBe(false)
    // E no YAML de verdade ela é o default da família dele.
    expect(DEFAULT_FORMS_BY_FAMILY.workflow.includes("expr")).toBe(true)
  })
})

describe("defaultValueVerdict — o veredito de três estados (nunca dois)", () => {
  it("igual ao declarado ⇒ proven, nomeando o arquivo", () => {
    const dir = treeOf(APP_TEMPLATE)
    try {
      const v = defaultValueVerdict("IMAGE_REGISTRY", "ghcr.io", { root: dir })
      expect(v.state).toBe("proven")
      expect(v.declared).toEqual({ value: "ghcr.io", file: ".env.production.example" })
      expect(v.detail).toContain(".env.production.example")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("divergente ⇒ violated, com os DOIS valores e o efeito", () => {
    const dir = treeOf(APP_TEMPLATE)
    try {
      const v = defaultValueVerdict("IMAGE_REGISTRY", "registry.velho", { root: dir })
      expect(v.state).toBe("violated")
      expect(v.detail).toContain("registry.velho")
      expect(v.detail).toContain("ghcr.io")
      expect(v.detail).toContain("não é a que o repositório declara")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("NENHUM arquivo declarando ⇒ indeterminate: é o default que passa a valer", () => {
    const dir = treeOf({ "README.md": "nada\n" })
    try {
      const v = defaultValueVerdict("IMAGE_REGISTRY", "ghcr.io", { root: dir })
      expect(v.state).toBe("indeterminate")
      expect(v.declared).toBeNull()
      expect(v.detail).toContain("não há contra o que comparar")
      expect(v.detail).toContain(".env.production.example") // o remédio
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("no repositório REAL, os defaults declarados são proven (o guard não acusa o repo)", () => {
    expect(defaultValueVerdict("IMAGE_REGISTRY", "ghcr.io", { root: REPO_ROOT }).state).toBe(
      "proven",
    )
    expect(defaultValueVerdict("IMAGE_NAMESPACE", "severinno", { root: REPO_ROOT }).state).toBe(
      "proven",
    )
  })
})

describe("os scripts migrados derivam do resolvedor (e não voltaram ao literal)", () => {
  const MIGRADOS = [
    "scripts/bench-setup-bun.mjs",
    "scripts/bench-guard-timing.mjs",
    "scripts/ensure-runner-image.mjs",
  ]

  it.each(MIGRADOS)("%s importa o resolvedor", (rel) => {
    const src = readFileSync(join(REPO_ROOT, rel), "utf8")
    expect(src).toMatch(/from "\.\/registry-source\.mjs"/)
  })

  it.each(MIGRADOS)("%s não crava o literal de reserva", (rel) => {
    const src = readFileSync(join(REPO_ROOT, rel), "utf8")
    // A forma que a migração eliminou — se ela voltar, o script puxa do host
    // velho em silêncio depois da próxima migração (o guard dinâmico também
    // acusa, mas aqui a prova é da LINHA, não do efeito).
    expect(src).not.toMatch(/process\.env\.IMAGE_REGISTRY\s*\|\|/)
    expect(src).not.toMatch(/process\.env\.IMAGE_NAMESPACE\s*\|\|/)
  })

  it("o `resolveImageRef` do ensure usa o valor DECLARADO como default (não uma constante)", () => {
    // A prova comportamental: apontando a raiz para uma árvore que declara
    // OUTRO registry, o default que o script monta é o declarado — a constante
    // `DEFAULT_REGISTRY` que vivia no módulo (e sobrevivia à migração) não tem
    // mais como existir.
    const dir = treeOf({
      ".env.production.example": "IMAGE_REGISTRY=registry.exemplo\nIMAGE_NAMESPACE=time\n",
    })
    try {
      const r = resolveImageRef({ BUN_VERSION: "1.3.14" }, { root: dir })
      if ("error" in r) throw new Error(`esperava ref, veio erro: ${r.error}`)
      expect(r.ref).toBe("registry.exemplo/time/ubuntu-bun:1.3.14")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("sem nenhum valor declarado e sem env, o ensure FALHA em vez de inventar host", () => {
    const dir = treeOf({ "README.md": "nada\n" })
    try {
      const r = resolveImageRef({ BUN_VERSION: "1.3.14" }, { root: dir })
      if (!("error" in r)) throw new Error(`esperava erro, veio ref: ${r.ref}`)
      expect(r.error).toContain("nenhum arquivo comitado declara o valor")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
