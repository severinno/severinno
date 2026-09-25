/**
 * required-checks-apply-cli.test.ts
 *
 * O CALL SITE do `--apply` — o ÚNICO ponto do repositório que ESCREVE
 * `ci/required-checks-applied.json` — exercitado inteiro contra uma forja DUBLÊ.
 *
 * O QUE ESTAVA FORA, E POR QUE ISSO IMPORTAVA: as outras testemunhas provam a
 * RÉGUA da declaração (as funções que a montam, importadas do guard) e o veredito
 * do PR sobre o arquivo. O CAMINHO que produz o arquivo — autenticar na forja,
 * mandar a escrita, e só então declarar — vivia declarado como limite: exigia
 * token e uma forja de verdade. Só que é exatamente ali que mora a regressão
 * silenciosa: um applier que declare ANTES de aplicar (ou que declare depois de a
 * forja RECUSAR) deixa o repositório afirmando que o merge está protegido
 * enquanto a forja continua exigindo o contexto velho.
 *
 * POR QUE UM SERVIDOR HTTP DE VERDADE (e não um `fetch` dublado): o que precisa
 * ser provado é a ORDEM e o CONTRATO DE FIO — quem recebe o quê, com qual verbo e
 * qual corpo, e o que o arquivo diz depois. Um dublê de função provaria a
 * intenção do meu próprio código; o servidor local prova que a CLI fala Gitea e
 * GitHub de fato. Mesmo padrão de `required-checks-drift-issue-gitea.test.ts`.
 *
 * POR QUE `execFile` E NÃO `spawnSync`: o servidor roda NESTE processo —
 * `spawnSync` bloqueia o event loop e o filho ficaria pendurado até o timeout
 * (medido, e anotado naquele outro arquivo). Aqui o loop fica livre.
 *
 * A CREDENCIAL É DESCARTÁVEL, E ISSO É DELIBERADO: o dublê aceita QUALQUER token
 * (ele só confere que o header existe), então a prova não exige — nem toca —
 * credencial real. O token é um literal, e o caso SEM token existe para o outro
 * lado da mesma promessa: sem credencial a CLI recusa ANTES de falar com a forja
 * e não declara nada.
 */

import { execFile } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { afterAll, afterEach, describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const APPLIER = join(ROOT, "scripts", "apply-required-checks.mjs")
const GUARD = join(ROOT, "scripts", "check-required-checks.mjs")
const REPO = "org/repo"
const GITHUB_WF = ".github/workflows/pr.yml"
const GITEA_WF = ".gitea/workflows/ci.yml"
const DECLARACAO = "ci/required-checks-applied.json"
/** O contexto do GitHub derivado do fixture (o `name:` do job `lint`). */
const CTX_GITHUB = "Lint guard"
/** O contexto do Gitea derivado do fixture (o `name:` do job `guards`). */
const CTX_GITEA = "Repo Guards"
/** O que a proteção da forja exigia ANTES (o rename não reaplicado). */
const CTX_VELHO_GITHUB = "Lint guard (5)"
const CTX_VELHO_GITEA = "Repo Guards (27)"

const HOJE = new Date().toISOString().slice(0, 10)

const temporarios: string[] = []
const servidores: Server[] = []

afterEach(() => {
  for (const s of servidores.splice(0)) s.close()
})

afterAll(() => {
  for (const dir of temporarios) rmSync(dir, { recursive: true, force: true })
})

// ── a forja dublê (estado em memória, rotas reais das duas APIs) ─────────────

interface ProtecaoGithub {
  contexts: string[]
  strict: boolean
}
interface ProtecaoGitea {
  status_check_contexts: string[]
  enable_status_check: boolean
}
interface Requisicao {
  forge: "github" | "gitea"
  method: string
  path: string
  /** O header de autenticação, como a forja o viu (não é credencial de verdade). */
  auth: string | null
  body: unknown
}

/**
 * O dublê das DUAS forjas num servidor só, separadas por prefixo de caminho
 * (`/gh` para a API do GitHub, `/gt` para a do Gitea) — é o que permite exercitar
 * `--forge all` sem duas fixtures e sem tocar a rede de verdade.
 */
async function comForja({ recusaEscritaNoGitea = false } = {}) {
  const github: ProtecaoGithub = { contexts: [CTX_VELHO_GITHUB], strict: true }
  const gitea: Record<string, ProtecaoGitea> = {
    main: { status_check_contexts: [CTX_VELHO_GITEA], enable_status_check: false },
  }
  const requisicoes: Requisicao[] = []

  const json = (res: ServerResponse, status: number, data: unknown) => {
    const corpo = JSON.stringify(data)
    res.writeHead(status, { "Content-Type": "application/json" })
    res.end(corpo)
  }

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on("data", (c: Buffer) => chunks.push(c))
    req.on("end", () => {
      const cru = Buffer.concat(chunks).toString("utf8")
      const url = req.url ?? ""
      const metodo = req.method ?? ""
      const auth = (req.headers.authorization as string | undefined) ?? null

      // ── GitHub: /gh/repos/<owner>/<repo>/branches/<branch>/protection/... ──
      const gh =
        /^\/gh\/repos\/([^/]+)\/([^/]+)\/branches\/([^/]+)\/protection\/required_status_checks$/.exec(
          url,
        )
      if (gh) {
        const body = cru === "" ? null : JSON.parse(cru)
        requisicoes.push({ forge: "github", method: metodo, path: url, auth, body })
        if (metodo === "GET")
          return json(res, 200, { contexts: github.contexts, strict: github.strict })
        if (metodo === "PATCH") {
          github.contexts = body.contexts
          github.strict = body.strict
          return json(res, 200, { contexts: github.contexts, strict: github.strict })
        }
        return json(res, 405, { message: `metodo nao mapeado: ${metodo}` })
      }

      // ── Gitea: /gt/api/v1/repos/<owner>/<repo>/branch_protections[/<branch>] ──
      const gt = /^\/gt\/api\/v1\/repos\/([^/]+)\/([^/]+)\/branch_protections(?:\/([^/]+))?$/.exec(
        url,
      )
      if (gt) {
        const branch = gt[3] ?? null
        const body = cru === "" ? null : JSON.parse(cru)
        requisicoes.push({ forge: "gitea", method: metodo, path: url, auth, body })
        if (metodo === "GET") {
          const lista = Object.entries(gitea).map(([nome, p]) => ({ branch_name: nome, ...p }))
          return json(res, 200, lista)
        }
        if (metodo === "POST" || metodo === "PATCH") {
          const alvo = branch ?? (body.branch_name as string)
          // A RECUSA: a forja não aceita a escrita (permissão, plano, 500 real).
          if (recusaEscritaNoGitea) {
            return json(res, 500, { message: "o dublê RECUSOU a escrita do branch protection" })
          }
          gitea[alvo] = {
            status_check_contexts: body.status_check_contexts,
            enable_status_check: body.enable_status_check,
          }
          return json(res, metodo === "POST" ? 201 : 200, { branch_name: alvo, ...gitea[alvo] })
        }
        return json(res, 405, { message: `metodo nao mapeado: ${metodo}` })
      }

      requisicoes.push({ forge: "gitea", method: metodo, path: url, auth, body: null })
      return json(res, 404, { message: `nao mapeado: ${metodo} ${url}` })
    })
  })

  servidores.push(server)
  // O `listen` é assíncrono: pedir a URL antes do evento `listening` dava
  // `address() === null` (medido) — a prova falharia no dublê, não no produto.
  await new Promise<void>((pronto) => server.listen(0, "127.0.0.1", pronto))
  return {
    requisicoes,
    github,
    gitea,
    url: () => {
      const addr = server.address()
      if (addr === null || typeof addr === "string") throw new Error("o dublê não subiu")
      return `http://127.0.0.1:${addr.port}`
    },
    /** As requisições que ESCREVERAM (o que a forja de fato aceitou). */
    escritas: () => requisicoes.filter((r) => r.method === "PATCH" || r.method === "POST"),
  }
}

// ── a fixture: um checkout com manifesto, workflows e a declaração ───────────

function montar() {
  const dir = mkdtempSync(join(tmpdir(), "required-apply-"))
  temporarios.push(dir)
  mkdirSync(join(dir, "ci"), { recursive: true })
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true })
  mkdirSync(join(dir, ".gitea", "workflows"), { recursive: true })

  const workflow = (jobs: Array<[string, string]>): string =>
    `name: Fixture\non: [push]\njobs:\n${jobs
      .map(
        ([id, nome]) =>
          `  ${id}:\n    name: ${nome}\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n`,
      )
      .join("")}`

  writeFileSync(
    join(dir, "ci", "required-checks.json"),
    `${JSON.stringify(
      {
        version: 1,
        branches: ["main"],
        forges: {
          github: { workflow: GITHUB_WF, jobs: ["lint"] },
          gitea: { workflow: GITEA_WF, jobs: ["guards"] },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
  writeFileSync(join(dir, GITHUB_WF), workflow([["lint", CTX_GITHUB]]), "utf8")
  writeFileSync(join(dir, GITEA_WF), workflow([["guards", CTX_GITEA]]), "utf8")

  // A DECLARAÇÃO ANTERIOR: os contextos VELHOS, com contagem, dos dois lados — o
  // estado exato de um rename que ninguém reaplicou. É o que torna a reescrita
  // observável (com a declaração já em sincronia não haveria nada a escrever, e a
  // ordem não teria como ser medida).
  writeFileSync(
    join(dir, DECLARACAO),
    `${JSON.stringify(
      {
        version: 1,
        appliedAt: "2026-01-01",
        forges: {
          github: { workflow: GITHUB_WF, branches: ["main"], contexts: [CTX_VELHO_GITHUB] },
          gitea: { workflow: GITEA_WF, branches: ["main"], contexts: [CTX_VELHO_GITEA] },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
  return dir
}

/** A declaração como ela está no disco (a comparação byte a byte mora aqui). */
const declaracaoCrua = (dir: string) => readFileSync(join(dir, DECLARACAO), "utf8")
const declaracao = (dir: string) => JSON.parse(declaracaoCrua(dir))

/**
 * O ambiente MÍNIMO do filho: o que a CLI precisa para rodar é o PATH (o node é
 * absoluto) — nada de `.env` do checkout entra na prova, para que a credencial
 * seja SÓ a que este arquivo declara.
 */
const ambienteBase = (): NodeJS.ProcessEnv => ({
  NODE_ENV: process.env.NODE_ENV ?? "test",
  PATH: process.env.PATH ?? "",
})

/** O ambiente do filho: a forja é o dublê local e a credencial é descartável. */
function ambiente(url: string, { comToken = true } = {}): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {
    ...ambienteBase(),
    GITHUB_API_URL: `${url}/gh`,
    GITHUB_REPOSITORY: REPO,
    GITEA_URL: `${url}/gt`,
    GITEA_REPOSITORY: REPO,
  }
  if (comToken) {
    base.GITHUB_TOKEN = "token-descartavel-do-duble"
    base.GITEA_TOKEN = "token-descartavel-do-duble"
  }
  return base
}

/** Roda a CLI de verdade (o processo que o CI executa), sem shell. */
async function rodar(
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ status: number; out: string }> {
  try {
    const r = await execFileAsync(process.execPath, [script, ...args], { env, encoding: "utf8" })
    return { status: 0, out: `${r.stdout}${r.stderr}` }
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string }
    return {
      status: typeof e.code === "number" ? e.code : 1,
      out: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    }
  }
}

// ── a prova ─────────────────────────────────────────────────────────────────

describe("apply-required-checks --apply contra uma forja dublê", () => {
  it("CONTROLE: a fixture começa em DRIFT (o guard reprova o rename sem reaplicação)", async () => {
    const dir = montar()
    const r = await rodar(GUARD, ["--root", dir], ambienteBase())
    // Sem este controle, um fixture já em sincronia passaria nos casos abaixo sem
    // que houvesse nada a aplicar — a prova seria do vazio.
    expect(r.status).toBe(1)
    expect(r.out).toContain(CTX_GITEA)
  })

  it("a forja RECEBE a escrita antes da declaração: o --apply manda os contextos derivados e só então reescreve o arquivo", async () => {
    const dir = montar()
    const forja = await comForja()
    const r = await rodar(APPLIER, ["--apply", "--root", dir], ambiente(forja.url()))

    expect(r.out).toContain("📌")
    expect(r.status).toBe(0)

    // 1) A FORJA FOI ESCRITA — com o que o manifesto deriva, e com a exigência
    // LIGADA (os contextos anotados sem o booleano não bloqueiam nada).
    const gh = forja.requisicoes.find((q) => q.forge === "github" && q.method === "PATCH")
    const gt = forja.requisicoes.find((q) => q.forge === "gitea" && q.method === "PATCH")
    expect(gh?.body).toMatchObject({ strict: true, contexts: [CTX_GITHUB] })
    expect(gt?.body).toMatchObject({
      status_check_contexts: [CTX_GITEA],
      enable_status_check: true,
    })
    // O dublê aceita qualquer token: nenhuma credencial real entra nesta prova.
    expect(gh?.auth).toMatch(/^Bearer token-descartavel-do-duble$/)
    expect(gt?.auth).toBe("token token-descartavel-do-duble")

    // 2) SÓ DEPOIS a declaração existe — e ela é o que a forja ACEITOU.
    const record = declaracao(dir)
    expect(record.appliedAt).toBe(HOJE)
    expect(record.forges.github.contexts).toEqual([CTX_GITHUB])
    expect(record.forges.gitea.contexts).toEqual([CTX_GITEA])
    expect(declaracaoCrua(dir)).not.toContain("(27)")
    expect(record.forges.gitea.contexts).toEqual(forja.gitea.main.status_check_contexts)
    expect(record.forges.github.contexts).toEqual(forja.github.contexts)

    // 3) E o ciclo fecha: com a declaração reescrita, o guard do PR sai verde.
    const guarda = await rodar(GUARD, ["--root", dir], ambienteBase())
    expect(guarda.status).toBe(0)
  })

  it("a forja que RECUSA a escrita não deixa declaração: o arquivo fica byte a byte o de antes", async () => {
    const dir = montar()
    const antes = declaracaoCrua(dir)
    const forja = await comForja({ recusaEscritaNoGitea: true })
    const r = await rodar(
      APPLIER,
      ["--apply", "--forge", "gitea", "--root", dir],
      ambiente(forja.url()),
    )

    expect(r.status).toBe(1)
    expect(r.out).toContain("HTTP 500")
    // A tentativa EXISTIU (o vermelho não é "nada aconteceu")...
    expect(forja.escritas().length).toBe(1)
    // ...e a declaração NÃO se moveu: declarar aqui seria o repositório afirmando
    // um merge protegido que a forja acabou de recusar.
    expect(declaracaoCrua(dir)).toBe(antes)
    const guarda = await rodar(GUARD, ["--root", dir], ambienteBase())
    expect(guarda.status).toBe(1)
  })

  it("o modo --check lê a forja e NÃO escreve a declaração (o veredito é de leitura)", async () => {
    const dir = montar()
    const antes = declaracaoCrua(dir)
    const forja = await comForja()
    const r = await rodar(APPLIER, ["--check", "--root", dir], ambiente(forja.url()))

    expect(r.status).toBe(1)
    expect(r.out).toContain("Drift")
    expect(forja.escritas()).toEqual([])
    expect(declaracaoCrua(dir)).toBe(antes)
  })

  it("sem token a CLI recusa antes de tocar a forja e não escreve nada", async () => {
    const dir = montar()
    const antes = declaracaoCrua(dir)
    const forja = await comForja()
    const r = await rodar(
      APPLIER,
      ["--apply", "--forge", "gitea", "--root", dir],
      ambiente(forja.url(), { comToken: false }),
    )

    expect(r.status).toBe(1)
    expect(r.out).toContain("GITEA_TOKEN")
    // Nenhuma requisição: a recusa é ANTES da rede, não uma resposta do dublê.
    expect(forja.requisicoes).toEqual([])
    expect(declaracaoCrua(dir)).toBe(antes)
  })
})
