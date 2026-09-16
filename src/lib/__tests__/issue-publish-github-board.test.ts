/**
 * issue-publish-github-board.test.ts
 *
 * Prova a LEITURA do board do GitHub pela API REST — o canal que a FORJA usa,
 * porque lá a CLI `gh` não está instalada.
 *
 * POR QUE ESTE TESTE EXISTE: nem toda dívida nasce na forja. A auditoria reversa
 * do README e a tendência de mutação são crons do `.github/`, e as issues delas
 * existem SÓ no board do GitHub. O doctor lê os dois boards (seção 6/7) pela
 * MESMA mecânica dos publicadores (`listIssuesByLabel`) — e no runner da forja o
 * único canal possível é a API. Sem ele, a leitura daquele board falhava e a
 * prontidão reportava "NÃO foi lida" todo santo cron, com duas dívidas reais
 * invisíveis atrás disso.
 *
 * QUATRO camadas:
 *
 *   1. O CANAL (`githubReadConfig`) — a decisão api × CLI, e a armadilha do
 *      contexto EMULADO: o runner da forja define `GITHUB_REPOSITORY` e
 *      `GITHUB_TOKEN` apontando para o GITEA. Aceitá-los apontaria a leitura para
 *      o board errado, então só `GH_*` é aceito.
 *   2. O LEITOR (`makeGithubReader`, exercitado por `listIssuesByLabel`) contra um
 *      board falso: o filtro por label, as PULL REQUESTS (que no modelo do GitHub
 *      são issues), os COMENTÁRIOS (onde mora o marcador de um problema que
 *      mudou) e a data de abertura.
 *   3. O ERRO quando nenhum canal serve: nomeia os DOIS e o que falta em cada um —
 *      em vez de devolver lista vazia ("sem dívida" sobre um board não lido).
 *   4. A PONTA (`readOpenDebt` → veredito): a dívida que só existe no GitHub
 *      aparece com número, idade e o canal declarado, e vira INDETERMINADA na
 *      prontidão em vez de invisível.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { describe, expect, it } from "vitest"

import { readOpenDebt, openDebtUnknowns } from "../../../scripts/forge-doctor.mjs"
import {
  describeGithubRead,
  githubReadConfig,
  listIssuesByLabel,
} from "../../../scripts/issue-publish.mjs"

const REPO = "org/repo"
const NOW = Date.parse("2026-09-13T00:00:00Z")

// ── O board falso: as DUAS forjas no mesmo servidor (rotas distintas) ──────

interface GiteaIssue {
  number: number
  title: string
  body: string
  created_at: string | null
  labels: { name: string }[]
}

interface GithubIssue extends GiteaIssue {
  /** Presente quando o item é uma PULL REQUEST (no GitHub, ela é uma issue). */
  pull_request?: { url: string }
}

function makeBoard() {
  const gitea: GiteaIssue[] = []
  const github: GithubIssue[] = []
  const comments: Record<string, { body: string }[]> = {}
  const requests: { method: string; path: string; query: string }[] = []
  let failStatus = 0

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1")
    requests.push({ method: req.method ?? "", path: url.pathname, query: url.search })

    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" })
      res.end(JSON.stringify(payload))
    }

    if (failStatus) return json(failStatus, { message: "rate limited" })

    // Comentários: a rota difere entre as forjas (`/api/v1` na do Gitea).
    const comment = url.pathname.match(/^\/(?:api\/v1\/)?repos\/.+\/issues\/(\d+)\/comments$/)
    if (comment) return json(200, comments[comment[1]] ?? [])

    // Gitea: a API devolve as issues ABERTAS e o BACKEND filtra pelo rótulo —
    // responder tudo é o comportamento fiel (um filtro do lado errado passaria
    // despercebido num dublê "gentil").
    if (url.pathname.startsWith("/api/v1/") && url.pathname.endsWith("/issues")) {
      return json(200, gitea)
    }

    // GitHub: aqui o rótulo É filtrado pelo servidor (`labels=`), como na API.
    if (url.pathname.startsWith("/repos/") && url.pathname.endsWith("/issues")) {
      const label = url.searchParams.get("labels")
      const state = url.searchParams.get("state") ?? "open"
      return json(
        200,
        github.filter(
          (issue) => state === "open" && (issue.labels ?? []).some((entry) => entry.name === label),
        ),
      )
    }

    return json(404, { message: "not found" })
  })

  return {
    gitea,
    github,
    comments,
    requests,
    fail(status: number) {
      failStatus = status
    },
    listen: () =>
      new Promise<string>((resolveUrl) => {
        server.listen(0, "127.0.0.1", () => {
          const address = server.address()
          const port = typeof address === "object" && address ? address.port : 0
          resolveUrl(`http://127.0.0.1:${port}`)
        })
      }),
    close: () => new Promise<void>((done) => server.close(() => done())),
  }
}

/** O board falso já no ar, com o endereço das duas APIs. */
type Board = ReturnType<typeof makeBoard> & { url: string }

/** As duas forjas apontadas para o MESMO board falso. */
function boardEnv(url: string): Record<string, string> {
  return {
    GITEA_TOKEN: "token-de-teste",
    GITEA_URL: url,
    GITEA_REPOSITORY: REPO,
    GH_TOKEN: "token-de-teste",
    GH_REPOSITORY: REPO,
    GH_API_URL: url,
  }
}

async function withBoard<T>(fn: (board: Board) => Promise<T>): Promise<T> {
  const board = makeBoard()
  const url = await board.listen()
  try {
    return await fn(Object.assign(board, { url }))
  } finally {
    await board.close()
  }
}

// ── 1. O CANAL ────────────────────────────────────────────────────────────

describe("githubReadConfig — qual canal lê o board do GitHub", () => {
  it("com GH_TOKEN + GH_REPOSITORY → api (o único canal que existe na forja)", () => {
    const read = githubReadConfig({ env: { GH_TOKEN: "t", GH_REPOSITORY: REPO } })
    expect(read.via).toBe("api")
    expect(read.repo).toBe(REPO)
    expect(read.why).toBeNull()
    expect(read.baseUrl).toBe("https://api.github.com")
    expect(describeGithubRead(read)).toContain("GH_TOKEN + GH_REPOSITORY")
  })

  it("o contexto EMULADO do runner (GITHUB_*) NÃO é aceito — ele fala do GITEA", () => {
    // O act_runner define GITHUB_REPOSITORY e GITHUB_TOKEN com os valores DA
    // FORJA. Aceitá-los faria a leitura apontar para o repositório errado (ou
    // para um token que não autentica no GitHub) — e a falha apareceria como
    // "não lida", sem dizer por quê.
    const read = githubReadConfig({
      env: { GITHUB_TOKEN: "token-do-gitea", GITHUB_REPOSITORY: "org/repo-do-gitea" },
    })
    expect(read.via).toBe("cli")
    expect(read.token).toBeNull()
    expect(read.why).toContain("GH_TOKEN")
    expect(describeGithubRead(read)).toContain("CLI `gh`")
  })

  it("sem um dos dois, o motivo NOMEIA só o que falta (o remédio é exato)", () => {
    expect(githubReadConfig({ env: { GH_TOKEN: "t" } }).why).toBe("sem GH_REPOSITORY")
    expect(githubReadConfig({ env: { GH_REPOSITORY: REPO } }).why).toBe("sem GH_TOKEN")
    expect(githubReadConfig({ env: {} }).why).toBe("sem GH_TOKEN e GH_REPOSITORY")
  })

  it("--repo (do CLI) tem precedência, e GH_API_URL existe para o dublê", () => {
    const read = githubReadConfig({
      env: { GH_TOKEN: "t", GH_REPOSITORY: "outro/repo", GH_API_URL: "http://127.0.0.1:9/" },
      repo: REPO,
    })
    expect(read.repo).toBe(REPO)
    expect(read.baseUrl).toBe("http://127.0.0.1:9")
  })
})

// ── 2. O LEITOR ───────────────────────────────────────────────────────────

describe("listIssuesByLabel (github) — a leitura pela API", () => {
  it("filtra por label e estado, e traz número, título, corpo e created_at (ISO)", async () => {
    await withBoard(async (board) => {
      board.github.push(
        {
          number: 12,
          title: "Alvo morto no README",
          body: "<!-- readme-drift:QUJD -->",
          created_at: "2026-08-01T00:00:00Z",
          labels: [{ name: "readme-drift" }],
        },
        {
          number: 13,
          title: "Outro assunto",
          body: "",
          created_at: "2026-08-02T00:00:00Z",
          labels: [{ name: "outra-label" }],
        },
      )

      const issues = await listIssuesByLabel({
        forge: "github",
        label: "readme-drift",
        env: boardEnv(board.url),
      })

      expect(issues.map((i) => i.number)).toEqual([12])
      expect(issues[0].createdAt).toBe("2026-08-01T00:00:00Z")
      const query = board.requests.find((r) => r.path.startsWith("/repos/"))
      expect(query?.query).toContain("labels=readme-drift")
      expect(query?.query).toContain("state=open")
    })
  })

  it("uma PULL REQUEST com a label NÃO é dívida (no GitHub ela também é uma issue)", async () => {
    await withBoard(async (board) => {
      board.github.push(
        {
          number: 77,
          title: "chore: remove o alvo morto",
          body: "<!-- readme-drift:QUJD -->",
          created_at: "2026-09-01T00:00:00Z",
          labels: [{ name: "readme-drift" }],
          pull_request: { url: "https://api.github.com/repos/org/repo/pulls/77" },
        },
        {
          number: 12,
          title: "Alvo morto",
          body: "<!-- readme-drift:QUJD -->",
          created_at: "2026-08-01T00:00:00Z",
          labels: [{ name: "readme-drift" }],
        },
      )

      const issues = await listIssuesByLabel({
        forge: "github",
        label: "readme-drift",
        env: boardEnv(board.url),
      })

      // Sem o filtro de `pull_request`, o PR de conserto viraria "dívida aberta"
      // — e o veredito diria que a dívida cresceu justo quando alguém a conserta.
      expect(issues.map((i) => i.number)).toEqual([12])
    })
  })

  it("os COMENTÁRIOS entram: é neles que mora o marcador de um problema que mudou", async () => {
    await withBoard(async (board) => {
      board.github.push({
        number: 12,
        title: "Alvo morto",
        body: "corpo sem marcador",
        created_at: "2026-08-01T00:00:00Z",
        labels: [{ name: "readme-drift" }],
      })
      board.comments["12"] = [{ body: "<!-- readme-drift:NOVA -->" }]

      const issues = await listIssuesByLabel({
        forge: "github",
        label: "readme-drift",
        env: boardEnv(board.url),
      })

      const comments = issues[0].comments as { body: string }[]
      expect(comments.map((c) => c.body)).toEqual(["<!-- readme-drift:NOVA -->"])
      const commentCall = board.requests.find((r) => r.path.endsWith("/issues/12/comments"))
      expect(commentCall, "a leitura não buscou os comentários da issue").toBeTruthy()
    })
  })

  it("resposta != 200 é ERRO (a lista vazia seria 'sem dívida' sobre um board ilegível)", async () => {
    await withBoard(async (board) => {
      board.fail(403)
      await expect(
        listIssuesByLabel({ forge: "github", label: "readme-drift", env: boardEnv(board.url) }),
      ).rejects.toThrow(/HTTP 403/)
    })
  })
})

// ── 3. QUANDO NENHUM CANAL SERVE ──────────────────────────────────────────

describe("listIssuesByLabel (github) — sem canal, o erro nomeia os dois", () => {
  it("sem credencial e com a CLI falhando, a mensagem diz o que falta e o porquê", async () => {
    const cliList = () => {
      throw new Error("gh issue list falhou (exit null) (spawnSync gh ENOENT)")
    }
    await expect(
      listIssuesByLabel({
        forge: "github",
        label: "readme-drift",
        env: {},
        deps: { cliList },
      }),
    ).rejects.toThrow(/sem GH_TOKEN e GH_REPOSITORY para a API, e a CLI `gh` falhou/)
  })

  it("a mensagem sai numa LINHA só (o relatório é lido em terminal e colado em issue)", async () => {
    const cliList = () => {
      throw new Error("primeira linha\nsegunda linha\ne ainda outra")
    }
    const error = await listIssuesByLabel({
      forge: "github",
      label: "readme-drift",
      env: {},
      deps: { cliList },
    }).catch((e: Error) => e)
    expect((error as Error).message).not.toContain("\n")
    expect((error as Error).message).toContain("e ainda outra")
  })
})

// ── 4. A PONTA: a dívida que só existe no GitHub entra no veredito ─────────

describe("readOpenDebt — o board do GitHub deixa de ser ponto cego", () => {
  it("a dívida de README (só no GitHub) aparece, com a idade e o CANAL declarado", async () => {
    await withBoard(async (board) => {
      board.github.push({
        number: 12,
        title: "Alvo morto no README",
        body: "<!-- readme-drift:QUJD -->",
        created_at: "2026-08-01T00:00:00Z",
        labels: [{ name: "readme-drift" }],
      })

      const debt = await readOpenDebt({ env: boardEnv(board.url), deps: { now: () => NOW } })

      const reads = debt.reads as { forge: string; state: string; via: string | null }[]
      expect(reads.map((r) => [r.forge, r.state, r.via])).toEqual([
        ["gitea", "read", null],
        ["github", "read", "api"],
      ])
      // COMO leu é fato do relatório: a forja não tem `gh`, então a leitura do
      // board de lá só pode ter acontecido pela API.
      expect((reads[1] as unknown as { detail: string }).detail).toContain(
        "lida por a API do GitHub (GH_TOKEN + GH_REPOSITORY)",
      )

      const item = debt.items[0] as { label: string; ours: number; issues: { days: number }[] }
      expect(item.label).toBe("readme-drift")
      expect(item.ours).toBe(1)
      expect(item.issues[0].days).toBe(43)
      // E o peso no veredito é o mesmo dos outros assuntos: INDETERMINADA com a
      // issue nomeada (os unknowns são o que o `summarize` transforma em veredito).
      expect(openDebtUnknowns(debt).join(" ")).toContain("#12")
    })
  })

  it("sem GH_TOKEN/GH_REPOSITORY → partial, o motivo NOMEADO e o GitHub nunca consultado", async () => {
    await withBoard(async (board) => {
      const env = boardEnv(board.url)
      delete env.GH_TOKEN
      delete env.GH_REPOSITORY

      const debt = await readOpenDebt({ env, deps: { now: () => NOW } })

      expect(debt.state).toBe("partial")
      const unread = (debt.reads as { forge: string; state: string; detail: string }[]).find(
        (r) => r.forge === "github",
      )
      expect(unread?.state).toBe("unread")
      // O remédio, não um "não lida" mudo — e o canal ERRADO nunca é tentado.
      expect(unread?.detail).toContain("GH_TOKEN")
      expect(unread?.detail).toContain("GH_REPOSITORY")
      expect(
        board.requests.filter((r) => r.path.startsWith("/repos/")),
        "a leitura tentou o board do GitHub sem credencial",
      ).toEqual([])
    })
  })

  it("o canal resolvido é o MESMO que o relatório declara (uma verdade, não duas)", async () => {
    // Sem `deps.githubChannel` o doctor resolve pelo mesmo `githubReadConfig` que
    // a leitura usa: um relatório que declarasse "api" enquanto a leitura tentou
    // a CLI seria a mentira mais cara deste fato.
    await withBoard(async (board) => {
      const env = boardEnv(board.url)
      const debt = await readOpenDebt({ env, deps: { now: () => NOW } })
      const github = (debt.reads as { forge: string; via: string | null }[]).find(
        (r) => r.forge === "github",
      )
      expect(github?.via).toBe(githubReadConfig({ env }).via)
    })
  })

  it("o canal declarado vem do AMBIENTE, não de uma suposição do relatório", async () => {
    // Sem credencial, o resolvedor diz `cli` — e é ISSO que o fato tem de
    // declarar, mesmo que a leitura tenha dado certo (aqui por um `list`
    // dublado). Um relatório que dissesse `api` estaria declarando um canal que
    // a leitura não usou: uma segunda cópia da regra, otimista, sobre o campo
    // que existe justamente para distinguir "li" de "não li".
    const list = async () => []
    const debt = await readOpenDebt({ env: {}, deps: { list, now: () => NOW } })
    const github = (
      debt.reads as { forge: string; state: string; via: string | null; detail: string }[]
    ).find((r) => r.forge === "github")
    expect(github?.state).toBe("read")
    expect(github?.via).toBe("cli")
    expect(github?.detail).toContain("lida por a CLI `gh`")
  })
})

// ── 5. O CANAL DA FORJA NÃO DEPENDE DA CLI ────────────────────────────────

describe("a leitura do board do GitHub não depende do `gh`", () => {
  it("com GH_TOKEN/GH_REPOSITORY, a CLI nem é procurada", async () => {
    await withBoard(async (board) => {
      const cliList = () => {
        throw new Error("a CLI não deveria ter sido chamada")
      }
      const issues = await listIssuesByLabel({
        forge: "github",
        label: "readme-drift",
        env: boardEnv(board.url),
        deps: { cliList },
      })
      expect(issues).toEqual([])
    })
  })
})
