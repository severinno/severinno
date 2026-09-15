/**
 * gitea-ephemeral.ts
 *
 * Helper compartilhado para subir um Gitea efêmero em Docker e provar o
 * comportamento REAL do servidor no ciclo de criar, comentar e fechar issues.
 *
 * POR QUE EXISTE: os testes de issue-publish usavam um HTTP stub em memória
 * (createServer + estado em array). O stub prova o CONTRATO do protocolo
 * (verbo, path, body, status), mas não prova que o Gitea REAL aceita o
 * request — campos renomeados, auth por token, filtros de label, o 201/409
 * do label em corrida. Um Gitea efêmero fecha essa lacuna.
 *
 * COMO FUNCIONA:
 *   1. `docker run -d` do gitea/gitea em porta aleatória
 *   2. Poll do `/api/v1/version` até o Gitea responder
 *   3. Cria admin com API token via CLI do container
 *   4. Cria repo de teste
 *   5. Devolve { url, token, repo, cleanup }
 *
 * CUSTO: ~3-5s de cold start (Gitea é leve), ~1s de teardown.
 *
 * Uso:
 *   import { makeEphemeralGitea } from "./helpers/gitea-ephemeral"
 *
 *   let gitea: EphemeralGitea
 *   beforeAll(async () => { gitea = await makeEphemeralGitea() }, 30_000)
 *   afterAll(async () => { await gitea.cleanup() })
 */

import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"

export interface EphemeralGitea {
  /** URL base do Gitea (ex.: http://127.0.0.1:32789) */
  url: string
  /** Token de autenticação do admin */
  token: string
  /** owner/repo (ex.: test-admin/test-repo) */
  repo: string
  /** Username do admin criado */
  adminUser: string
  /** Remove o container */
  cleanup: () => Promise<void>
}

const GITEA_IMAGE = "gitea/gitea:1.22"
const CONTAINER_PREFIX = "gitea-ephemeral-test"

function dockerRun(args: string[]): string {
  const res = spawnSync("docker", ["run", "-d", ...args], { encoding: "utf8" })
  if (res.status !== 0) throw new Error(`docker run failed: ${res.stderr}`)
  return res.stdout.trim()
}

function dockerRm(container: string): void {
  spawnSync("docker", ["rm", "-f", container], { encoding: "utf8" })
}

/**
 * Containers criados NESTA execução e ainda vivos.
 *
 * O `cleanup()` devolvido ao teste é o caminho normal, mas ele NÃO roda quando
 * o processo é ABORTADO (timeout do runner, SIGINT/SIGTERM, crash do vitest):
 * aí o container fica órfão PARA SEMPRE (~80MB cada; dezenas se acumulam em
 * alguns runs interrompidos). Este registro é o `trap EXIT` do helper — o
 * MESMO padrão que os scripts de mutação do repo usam no shell.
 */
const liveContainers = new Set<string>()
let teardownRegistered = false

/** Registra o sweep de containers no fim do processo (idempotente). */
function registerTeardown(): void {
  if (teardownRegistered) return
  teardownRegistered = true
  // `exit` roda na saída normal, no `process.exit()` e em exceção não tratada.
  process.on("exit", () => {
    for (const c of liveContainers) dockerRm(c)
  })
  // Sinal NÃO dispara `exit` por padrão: sem estes handlers, um SIGTERM
  // (timeout do runner) mataria o processo sem passar pelo sweep — que é
  // exatamente como os containers vazaram até aqui.
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      for (const c of liveContainers) dockerRm(c)
      process.exit(130)
    })
  }
}

async function waitForGitea(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/v1/version`)
      if (res.ok) return
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Gitea not ready at ${url} after ${timeoutMs}ms`)
}

/**
 * Sobe um Gitea efêmero em Docker.
 *
 * O container é nomeado com um sufixo aleatório para evitar colisão entre
 * testes paralelos. O Gitea é configurado em modo SQLite (sem deps externas)
 * com `INSTALL_LOCK=true` e `OFFLINE_MODE=true` (sem checagem de versão).
 */
export async function makeEphemeralGitea(
  opts: { image?: string; timeoutMs?: number } = {},
): Promise<EphemeralGitea> {
  const image = opts.image ?? GITEA_IMAGE
  const suffix = randomBytes(4).toString("hex")
  const container = `${CONTAINER_PREFIX}-${suffix}`
  const adminUser = "test-admin"
  const adminPass = "TestPass123!"
  const repoName = "test-repo"

  // Verifica que a imagem existe localmente
  const imgCheck = spawnSync("docker", ["image", "inspect", image], { encoding: "utf8" })
  if (imgCheck.status !== 0) {
    throw new Error(
      `Imagem '${image}' não existe localmente. Faça docker pull ${image} antes de rodar os testes.`,
    )
  }

  // Porta aleatória (o kernel escolhe)
  const port = "0"

  // Sobe o Gitea
  dockerRun([
    "--name",
    container,
    "-e",
    "GITEA__database__DB_TYPE=sqlite3",
    "-e",
    "GITEA__server__ROOT_URL=http://127.0.0.1:3000/",
    "-e",
    "GITEA__server__HTTP_PORT=3000",
    "-e",
    "GITEA__security__INSTALL_LOCK=true",
    "-e",
    "GITEA__service__DISABLE_REGISTRATION=false",
    "-e",
    "GITEA__service__REQUIRE_SIGNIN_VIEW=false",
    "-e",
    "GITEA__repository__DEFAULT_BRANCH=main",
    "-e",
    "USER_UID=1000",
    "-e",
    "USER_GID=1000",
    "-p",
    `${port}:3000`,
    image,
  ])
  // A partir daqui o container EXISTE: registrar o sweep antes do 1º passo que
  // pode falhar garante que um erro no meio do setup também não vaze.
  liveContainers.add(container)
  registerTeardown()

  // Resolve a porta real
  const portRes = spawnSync("docker", ["port", container, "3000/tcp"], { encoding: "utf8" })
  // docker port pode retornar múltiplas linhas; pegamos a primeira com IP:port
  const portLine = portRes.stdout.trim().split("\n")[0] ?? ""
  const match = portLine.match(/:(\d+)$/)
  if (!match) {
    dockerRm(container)
    throw new Error(`Não conseguiu resolver a porta do container: ${portRes.stdout}`)
  }
  const hostPort = match[1]
  const baseUrl = `http://127.0.0.1:${hostPort}`

  try {
    // Espera o Gitea ficar pronto
    await waitForGitea(baseUrl, opts.timeoutMs ?? 30_000)

    // Cria o admin via CLI do container — como o user `git` (UID 1000),
    // pois o gitea recusa rodar como root.
    const createUser = spawnSync(
      "docker",
      [
        "exec",
        "-u",
        "git",
        container,
        "gitea",
        "admin",
        "user",
        "create",
        "--username",
        adminUser,
        "--password",
        adminPass,
        "--email",
        `${adminUser}@test.local`,
        "--admin",
        "--must-change-password=false",
      ],
      { encoding: "utf8" },
    )
    if (createUser.status !== 0 && !createUser.stderr.includes("already exists")) {
      throw new Error(`Falha ao criar admin: ${createUser.stderr}`)
    }

    // Gera o token via API (login + create access token)
    const loginRes = await fetch(`${baseUrl}/api/v1/users/${adminUser}/tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${adminUser}:${adminPass}`).toString("base64")}`,
      },
      body: JSON.stringify({
        name: `test-token-${suffix}`,
        scopes: ["all"],
      }),
    })
    if (!loginRes.ok) {
      const body = await loginRes.text()
      throw new Error(`Falha ao criar token: ${loginRes.status} ${body}`)
    }
    const tokenData = (await loginRes.json()) as { sha1?: string }
    const token = tokenData.sha1
    if (!token) throw new Error("Token não retornado")

    // Cria o repo de teste
    const createRepo = await fetch(`${baseUrl}/api/v1/user/repos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `token ${token}`,
      },
      body: JSON.stringify({
        name: repoName,
        auto_init: true,
        default_branch: "main",
        description: "Repo efêmero para testes de issue-publish",
      }),
    })
    if (!createRepo.ok && createRepo.status !== 409) {
      const body = await createRepo.text()
      throw new Error(`Falha ao criar repo: ${createRepo.status} ${body}`)
    }

    return {
      url: baseUrl,
      token,
      repo: `${adminUser}/${repoName}`,
      adminUser,
      cleanup: async () => {
        liveContainers.delete(container)
        dockerRm(container)
      },
    }
  } catch (err) {
    dockerRm(container)
    throw err
  }
}

/**
 * Verifica se o Docker está disponível. Os testes que dependem do Gitea
 * efêmero devem pular (skip) quando o Docker não está presente, em vez de
 * falhar — o CI pode não ter docker em todos os runners.
 */
export function isDockerAvailable(): boolean {
  const res = spawnSync("docker", ["info"], { encoding: "utf8", timeout: 5_000 })
  return res.status === 0
}
