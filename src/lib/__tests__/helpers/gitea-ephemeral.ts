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
 * O TEARDOWN É VEREDITO (não log): remover o container que o teste criou faz
 * parte do resultado, com três desfechos e nenhum em silêncio — `rm -f`;
 * parada por DENTRO quando o daemon nega o kill; e, se nem isso, FALHA nomeada
 * que LANÇA no `cleanup()` (reprova o arquivo) e deixa o código de saída da
 * execução não-zero no sweep. Medido neste host: sem isso, 669 containers
 * `gitea-ephemeral-*` ficaram Up (~33GB) e a suíte passou a morrer por OOM com
 * o vermelho longe da causa. A prova vive em
 * `gitea-ephemeral-teardown-falha.test.ts` (com a mutação que silencia o
 * veredito e faz a própria prova perder o efeito).
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
import { existsSync, readFileSync } from "node:fs"

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

/**
 * A rede do container que roda ESTE processo (a do job, na forja).
 *
 * O env HOSTNAME de um container Docker é o próprio ID (curto); fora de
 * container o env não existe e o retorno é vazio. É o MESMO critério do
 * `dockerRun` — extraído para o endereço do efêmero (IP direto na rede) usar a
 * MESMA fonte, nunca uma segunda implementação.
 */
function redeDoJob(): string {
  if (!process.env.HOSTNAME || !existsSync("/.dockerenv")) return ""
  return spawnSync(
    "sh",
    [
      "-c",
      "docker inspect $HOSTNAME --format '{{range $k,$_ := .NetworkSettings.Networks}}{{$k}}{{end}}'",
    ],
    { encoding: "utf8" },
  ).stdout.trim()
}

function dockerRun(args: string[]): string {
  // MESMA REDE do container que roda o teste (medido em 29/09): sem isso o
  // efêmero nasce na bridge DEFAULT (172.17) e o gateway dela não é alcançável
  // de um job container da forja (que vive em outra rede, ex. gitea_gitea-net,
  // 172.18) — 'Gitea not ready' em TODO gitea-real só dentro do job. O env
  // HOSTNAME de um container Docker é o próprio ID (curto); fora de container
  // o env não existe e a flag não é passada.
  const rede = redeDoJob()
  const redeArgs = rede ? ["--network", rede] : []
  const res = spawnSync("docker", ["run", "-d", ...redeArgs, ...args], { encoding: "utf8" })
  if (res.status !== 0) throw new Error(`docker run failed: ${res.stderr}`)
  return res.stdout.trim()
}

// ── O TEARDOWN: veredito, caminho alternativo e REPROVAÇÃO ───────────────
//
// O que existia: um `docker rm -f` que, quando falhava, escrevia UMA linha no
// stderr e seguia. O container ficava de pé, o teste terminava VERDE e só quem
// lesse o log sabia — na prática, ninguém: 669 containers `gitea-ephemeral-*`
// chegaram a ficar Up de uma vez neste host (~33GB), e o vermelho apareceu
// LONGE da causa (um worker do vitest saindo inesperadamente, sem nenhum teste
// reprovado, com swap esgotado). O `rm` que falha em silêncio é o defeito.
//
// O que passa a valer: remover o container é parte do VEREDITO do teste, com
// três desfechos e nenhum deles em silêncio.
//
//   1. `docker rm -f` funciona                        → removido (caminho normal);
//   2. o daemon NÃO consegue matar o container, mas o
//      PID 1 dele TRATA SIGTERM (o `s6-svscan` da imagem
//      do gitea trata)                                → ele para por DENTRO
//      (`docker exec <c> kill -TERM 1`), o container sai 0 sozinho, e um
//      container PARADO é removido sem passar pelo caminho de kill do daemon;
//   3. nem um nem outro                              → FALHA nomeada: o
//      `cleanup()` do teste LANÇA, o sweep deixa o código de saída da execução
//      não-zero, e o relatório traz o container, o motivo do daemon e a receita
//      de limpeza manual.
//
// O desfecho (2) não é teoria: MEDIDO neste host, onde `docker rm -f` falha com
// "could not kill container: permission denied" para QUALQUER container —
// inclusive um recém-criado pelo próprio daemon.

/** O que a remoção de UM container devolveu. */
export interface RemocaoDoContainer {
  /** O container deixou de existir? */
  ok: boolean
  /** Por que não saiu (só quando `ok === false`) — o motivo do daemon, literal. */
  motivo: string
  /**
   * Por QUAL caminho o container saiu: o normal (`rm`, que inclui "já não
   * existia"), a parada por DENTRO, ou nenhum.
   *
   * Existe porque "removeu" e "removeu mesmo com o daemon negando o kill" são
   * fatos diferentes: é este campo que deixa a prova do host real afirmar que o
   * sucesso, onde o `rm -f` cru falha, só é explicável pelo caminho alternativo.
   */
  caminho: "rm" | "parada-por-dentro" | "nao-removido"
}

/** Uma remoção que NÃO tirou o container de circulação. */
export interface TeardownFalha {
  container: string
  motivo: string
}

/**
 * Executa um comando do docker. É INJETÁVEL porque o teardown é MEDIDO com
 * roteiros (um daemon que nega o kill, um container que se recusa a sair) — e
 * é a MESMA porta que o `cleanup()` e o sweep usam, nunca uma segunda
 * implementação para o teste.
 */
export type DockerRunner = (
  args: string[],
  opts?: { timeoutMs?: number },
) => {
  status: number | null
  stdout: string
  stderr: string
}

function dockerPadrao(args: string[], opts: { timeoutMs?: number } = {}): ReturnType<DockerRunner> {
  const res = spawnSync("docker", args, { encoding: "utf8", timeout: opts.timeoutMs })
  return {
    status: res.status,
    stdout: res.stdout ?? "",
    // Um `docker` que não responde não devolve stderr nenhum: o motivo do
    // timeout é transformado em TEXTO, senão a falha sairia com motivo vazio.
    stderr: res.error ? `${res.stderr ?? ""}${res.error.message}`.trim() : (res.stderr ?? ""),
  }
}

/** Orçamento para o container SAIR sozinho depois do SIGTERM. */
const PARADA_TIMEOUT_MS = 5_000

/**
 * Orçamento do PRIMEIRO caminho (`docker rm -f`).
 *
 * MEDIDO: onde o daemon nega o kill, o `rm -f` não falha rápido — ele GASTA o
 * timeout de stop do daemon (10,02s por chamada, cronometrados neste host). O
 * estrago não é só o tempo: o teardown dos testes de integração roda em
 * `afterAll`, cujo timeout padrão do vitest é 10s — sem orçamento aqui, o hook
 * morreria por TIMEOUT antes de o caminho por dentro rodar, deixando o container
 * vivo e o vermelho apontando para o lugar errado (exatamente a classe de falha
 * que este teardown existe para eliminar).
 *
 * Um `rm -f` ABORTADO no meio não desiste do lado do daemon: a remoção continua
 * em curso por lá. É por isso que o veredito nunca é "não" na primeira resposta
 * negativa — a checagem final (`ESPERA_FINAL_MS`) espera o container SUMIR antes
 * de reprovar, e um `rm` que falha com "removal in progress" acaba virando
 * SUCESSO quando o daemon termina o que já tinha começado.
 */
const ORCAMENTO_RM_FORCADO_MS = 3_000

/**
 * Orçamento da CHECAGEM FINAL: quanto se espera o container sumir antes de
 * reprovar. Existe porque a remoção pode estar EM CURSO (um `rm -f` anterior
 * ainda no daemon, ou o `rm` que respondeu "removal in progress"): reprovar na
 * primeira negativa produziria um vermelho FALSO sobre um container que sai
 * sozinho um instante depois — e um vermelho falso ensina a ignorar o vermelho.
 */
const ESPERA_FINAL_MS = 3_000

/** Código de saída de uma execução que terminou com teardown FALHO. */
export const EXIT_TEARDOWN_FALHOU = 1

/**
 * Código de saída de uma execução ABORTADA por sinal com o teardown falhando:
 * 131 é 130 (`SIGINT`/`SIGTERM` canônico) + 1, para o vermelho do teardown não se
 * confundir com o vermelho do sinal que abortou o processo.
 */
export const EXIT_SINAL_COM_TEARDOWN_FALHO = 131

/** Remoções que falharam nesta execução (o sweep e o `cleanup` alimentam). */
const falhasDeTeardown: TeardownFalha[] = []

/** O que NÃO pôde ser removido nesta execução (vazio = nenhum vazamento). */
export function teardownFalhou(): readonly TeardownFalha[] {
  return falhasDeTeardown
}

/** A pausa do polling, sem event loop: parte do teardown roda no handler `exit`. */
function dormir(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function existeContainer(docker: DockerRunner, container: string): boolean {
  return docker(["inspect", container]).status === 0
}

function rodandoContainer(docker: DockerRunner, container: string): boolean {
  const res = docker(["inspect", "-f", "{{.State.Running}}", container])
  return res.status === 0 && res.stdout.trim() === "true"
}

/**
 * O caminho que NÃO passa pelo kill do daemon: o PID 1 recebe o SIGTERM por
 * DENTRO, desliga a árvore supervisionada e o container sai 0 — e um container
 * PARADO é removido sem `-f` (o `rm` sem forçar não precisa matar ninguém).
 * Nada é presumido: cada passo é confirmado pelo ESTADO, não pela mensagem.
 */
function pararDeDentro(docker: DockerRunner, container: string, esperaMs: number): void {
  if (!rodandoContainer(docker, container)) return
  // `docker exec` recusa container PAUSADO (um run interrompido pode deixar um
  // assim); o `unpause` de quem não está pausado só erra, o que é inofensivo.
  docker(["unpause", container])
  docker(["exec", container, "sh", "-c", "kill -TERM 1"])
  const fim = Date.now() + esperaMs
  while (Date.now() < fim) {
    if (!rodandoContainer(docker, container)) return
    dormir(200)
  }
}

/** O container sumiu dentro do orçamento? (a remoção pode estar em curso) */
function aguardarSumir(docker: DockerRunner, container: string, esperaMs: number): boolean {
  const fim = Date.now() + esperaMs
  for (;;) {
    if (!existeContainer(docker, container)) return true
    if (Date.now() >= fim) return false
    dormir(200)
  }
}

/** O motivo mais informativo que o daemon deu (o último, senão o primeiro). */
function motivoDoDaemon(...res: { stderr: string }[]): string {
  for (const r of [...res].reverse()) {
    const texto = (r.stderr || "").trim()
    if (texto) return texto
  }
  return "o daemon não informou motivo"
}

/**
 * O relatório de uma falha de teardown: container, motivo e receita de limpeza.
 *
 * A receita está aqui porque é o que faltava quando os containers vazavam: o
 * diagnóstico existia no log, mas não dizia a quem lia o que fazer — e o
 * caminho que funciona neste host (`kill -TERM 1` por dentro) não é óbvio.
 */
export function relatorioDeTeardown(container: string, motivo: string): string {
  return (
    `gitea-ephemeral: FALHA ao remover ${container} — o container CONTINUA VIVO.\n` +
    `   motivo do daemon: ${motivo}\n` +
    `   o teardown REPROVA a suíte: um container de pé consome ~100MB até alguém\n` +
    `   limpá-lo à mão (medido: 669 acumulados derrubaram a suíte inteira por OOM).\n` +
    `   para limpar agora: docker exec ${container} kill -TERM 1 && docker rm ${container}`
  )
}

/**
 * Remove um container de teste e devolve o VEREDITO.
 *
 * Os três desfechos, nesta ordem: `rm -f` → parada por dentro + `rm` → falha
 * nomeada. "Já não existe" é SUCESSO em qualquer ponto (outro sweep, remoção
 * por fora): o alvo do teardown é "nenhum container vivo", não "o meu `rm`
 * rodou".
 */
export function removerContainer(
  container: string,
  opts: { docker?: DockerRunner; esperaMs?: number; esperaFinalMs?: number } = {},
): RemocaoDoContainer {
  const docker = opts.docker ?? dockerPadrao

  const primeiro = docker(["rm", "-f", container], { timeoutMs: ORCAMENTO_RM_FORCADO_MS })
  if (primeiro.status === 0) return { ok: true, motivo: "", caminho: "rm" }
  if (!existeContainer(docker, container)) return { ok: true, motivo: "", caminho: "rm" }

  pararDeDentro(docker, container, opts.esperaMs ?? PARADA_TIMEOUT_MS)
  const segundo = docker(["rm", container])
  // O veredito NÃO é "não" na primeira resposta negativa: a remoção pode estar
  // em curso (o `rm -f` do daemon segue depois de um abort, e o `rm` responde
  // "removal in progress") — reprovar aqui daria um vermelho falso.
  const sucesso =
    segundo.status === 0 || aguardarSumir(docker, container, opts.esperaFinalMs ?? ESPERA_FINAL_MS)
  if (sucesso) return { ok: true, motivo: "", caminho: "parada-por-dentro" }

  return {
    ok: false,
    motivo: motivoDoDaemon(segundo, primeiro),
    caminho: "nao-removido",
  }
}

/**
 * Reporta a falha UMA vez por container e a guarda para o veredito da execução.
 *
 * Deduplicar não é cosmético: o caminho do setup e o sweep podem passar pelo
 * mesmo container, e um relatório repetido vira ruído que ensina a ignorá-lo.
 */
function registrarFalha(container: string, motivo: string): void {
  if (falhasDeTeardown.some((f) => f.container === container)) return
  falhasDeTeardown.push({ container, motivo })
  process.stderr.write(`${relatorioDeTeardown(container, motivo)}\n`)
}

/**
 * Remove SEM lançar: a falha vai para o relatório e para o CÓDIGO DE SAÍDA.
 *
 * É o caminho dos erros de setup, onde já existe uma causa para propagar — o
 * teardown que falha vira o vermelho do código de saída, sem engolir o erro
 * original que explica o teste nem ter começado.
 */
export function removerRegistrandoFalha(
  container: string,
  opts: { docker?: DockerRunner; esperaMs?: number; esperaFinalMs?: number } = {},
): RemocaoDoContainer {
  const remocao = removerContainer(container, opts)
  if (!remocao.ok) registrarFalha(container, remocao.motivo)
  return remocao
}

/**
 * Remove e REPROVA quando não conseguiu — a porta que o `cleanup()` do teste
 * usa. O relatório vai para o stderr (o fato fica no log) E a exceção derruba o
 * teste (o fato entra no veredito): um teardown que falha não termina verde.
 */
export function removerOuFalhar(
  container: string,
  opts: { docker?: DockerRunner; esperaMs?: number; esperaFinalMs?: number } = {},
): void {
  const remocao = removerRegistrandoFalha(container, opts)
  if (!remocao.ok) throw new Error(relatorioDeTeardown(container, remocao.motivo))
}

/**
 * O `trap EXIT` do helper: remove o que ficou vivo e ESVAZIA o registro.
 *
 * Esvaziar é o que torna o sweep IDEMPOTENTE — e sem isso ele rodava DUAS vezes
 * para o mesmo container: o handler do sinal chama `process.exit(130)`, o evento
 * `exit` dispara em seguida e o segundo sweep tentava remover de novo (no caminho
 * normal isso vira um "No such container" ruidoso; aqui, um falso diagnóstico de
 * falha para um container que já tinha sido removido).
 */
function sweepLiveContainers(): void {
  const pendentes = [...liveContainers]
  liveContainers.clear()
  for (const c of pendentes) removerRegistrandoFalha(c)
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

/**
 * Registra o sweep de containers no fim do processo (idempotente).
 *
 * Exportado porque o teste do teardown precisa da MESMA porta que a produção
 * usa para decidir o código de saída — uma segunda implementação do handler
 * mediria outra coisa.
 */
export function registrarSweepDeTeardown(): void {
  if (teardownRegistered) return
  teardownRegistered = true
  // `exit` roda na saída normal, no `process.exit()` e em exceção não tratada.
  // O CÓDIGO DE SAÍDA é parte do veredito: um teardown que falhou não sai 0
  // (medido: `process.exitCode` escrito dentro do handler `exit` muda o código,
  // inclusive depois de um `process.exit(0)` explícito).
  process.on("exit", () => {
    sweepLiveContainers()
    if (falhasDeTeardown.length > 0) process.exitCode = EXIT_TEARDOWN_FALHOU
  })
  // Sinal NÃO dispara `exit` por padrão: sem estes handlers, um SIGTERM
  // (timeout do runner) mataria o processo sem passar pelo sweep — que é
  // exatamente como os containers vazaram até aqui. O 131 separa "abortado com
  // teardown FALHO" de "abortado com teardown limpo" (130).
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      sweepLiveContainers()
      process.exit(falhasDeTeardown.length > 0 ? EXIT_SINAL_COM_TEARDOWN_FALHO : 130)
    })
  }
}

/**
 * Prazo de UMA tentativa de HTTP. Sem ele o laço abaixo MENTE: `fetch` não tem
 * timeout por padrão, e a porta publicada pelo docker aceita a conexão antes de
 * o processo dentro do container escutar (o encaminhador do daemon abre o socket
 * e só então descobre que não há backend) — a requisição fica pendurada para
 * SEMPRE, o `await` nunca volta e o laço nunca reavalia o deadline. O efeito é o
 * pior possível: o setup trava indefinidamente, o teste estoura o timeout do
 * runner e o container sobra (é uma das formas de o vazamento acontecer), com a
 * cara de "Gitea lento" em vez de "uma conexão pendurada".
 */
const HTTP_TIMEOUT_MS = 5_000

/** Prazo de uma requisição da API (token, repo) — mesma razão. */
const API_TIMEOUT_MS = 15_000

async function waitForGitea(url: string, timeoutMs = 30_000): Promise<void> {
  const alvo = new URL(url)
  const portas = [alvo.port || "80"]
  // Se o alvo foi escrito como ENDEREÇO DIRETO DO CONTAINER (a porta interna do
  // Gitea, 3000), a porta PUBLICADA no host é o segundo caminho — é ela que
  // chega no host direto e via gateway:porta-publicada. Medido em 30/09/2026 na
  // forja: o caminho gateway:porta-publicada foi NEGADO entre bridges distintas
  // (gateway da rede do job em 192.168.64.1, pool do 172.18 esgotado) enquanto o
  // caminho L2 (IP do container direto, mesma rede) passa — daí a ordem.
  if (alvo.port === "3000" && !portas.includes("80")) portas.push("80")
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (Date.now() >= deadline) break
    for (const p of portas) {
      try {
        alvo.port = p
        const res = await fetch(`${alvo.toString().replace(/\/$/, "")}/api/v1/version`, {
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        })
        if (res.ok) return
      } catch {
        // not ready yet — inclui o abort do timeout acima
      }
    }
    // Nenhuma porta respondeu: espera e tenta de novo (o `return` acima só
    // acontece no sucesso, então este sono é o ritmo de TODA tentativa falha).
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
  registrarSweepDeTeardown()

  // Resolve a porta real
  const portRes = spawnSync("docker", ["port", container, "3000/tcp"], { encoding: "utf8" })
  // docker port pode retornar múltiplas linhas; pegamos a primeira com IP:port
  const portLine = portRes.stdout.trim().split("\n")[0] ?? ""
  const match = portLine.match(/:(\d+)$/)
  if (!match) {
    liveContainers.delete(container)
    removerRegistrandoFalha(container)
    throw new Error(`Não conseguiu resolver a porta do container: ${portRes.stdout}`)
  }
  const hostPort = match[1]
  // ONDE O GITEA RESPONDE — três caminhos, e a ORDEM importa (medido em
  // 30/09/2026 na forja):
  //   1. IP DIRETO DO CONTAINER na rede compartilhada (dentro de job container):
  //      o `dockerRun` já sobe o efêmero na MESMA rede do job; falar com o IP do
  //      container NESSA rede é tráfego L2 puro — passa onde o NAT da porta
  //      publicada é negado (o caminho 2 falhou assim: gateway do job em
  //      192.168.64.1 — o pool do 172.18 esgotou — e o DNAT da porta publicada
  //      não atravessa a bridge). A porta é a INTERNA (3000).
  //   2. GATEWAY da rede do job (dentro de container, sem rede compartilhada):
  //      com `-p` a porta é publicada NO HOST; o gateway é o caminho até ela.
  //      Lido de /proc/net/route (a imagem do job NÃO tem `ip`/iproute2 —
  //      medido): a linha default é `eth0<TAB>00000000<TAB><GW hex LE>` —
  //      010012AC = 172.18.0.1. Sem binário externo, sem shell.
  //   3. 127.0.0.1:porta-publicada — máquina do GitHub runner / dev.
  // O `waitForGitea` tenta a porta do endereço dado primeiro e a publicada
  // junto — então o endereço direto sai com as duas portas vivas.
  const emContainer = existsSync("/.dockerenv") || existsSync("/run/.containerenv")
  let host = "127.0.0.1"
  let portaAlvo = hostPort
  if (emContainer) {
    // Caminho 1: o efêmero compartilha a rede do job (o `dockerRun` sobe com
    // `--network` de `redeDoJob()`) — o IP dele NESSA rede é L2 puro e passa
    // onde o NAT da porta publicada é negado entre bridges (medido na forja).
    const rede = redeDoJob()
    const ipDoContainer = rede
      ? (spawnSync(
          "docker",
          ["inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}", container],
          { encoding: "utf8" },
        )
          .stdout.trim()
          .split(/\s+/)
          .filter(Boolean)[0] ?? "")
      : ""
    if (ipDoContainer) {
      host = ipDoContainer
      portaAlvo = "3000"
    } else {
      // Caminho 2: gateway:porta-publicada (rede não compartilhada).
      try {
        const rota = readFileSync("/proc/net/route", "utf8")
          .split("\n")
          .find((l) => l.split("\t")[1] === "00000000")
        const hex = rota?.split("\t")[2]
        if (hex && hex.length === 8) {
          host = [3, 2, 1, 0].map((i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16)).join(".")
        }
      } catch {
        // sem /proc/net/route — segue 127.0.0.1 (host direto)
      }
    }
  }
  const baseUrl = `http://${host}:${portaAlvo}`

  try {
    // Espera o Gitea ficar pronto. O ORÇAMENTO de 90s (medido em 30/09/2026): o
    // cold start do Gitea sob a carga da forja — a suíte INTEIRA em paralelo
    // sobre poucas vCPUs, com NINE containers de serviços e efêmeros nascendo
    // junto — passa de 30s (o default anterior): os QUATRO testes gitea-real
    // morreram em 'Gitea not ready after 30000ms' enquanto o teste que pede
    // explicitamente 120s (gitea-ephemeral-signal) PASSOU no mesmo host. O
    // prontidão lenta é do AMBIENTE, não do Gitea — e o default tem de cobrir
    // o pior orçamento dos seus chamadores (o beforeAll deles é de 120s).
    await waitForGitea(baseUrl, opts.timeoutMs ?? 90_000)

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
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
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
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
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
        // LANÇA quando o container não sai: o teste que não conseguiu limpar o
        // que criou REPROVA em vez de terminar verde deixando lixo para trás.
        removerOuFalhar(container)
      },
    }
  } catch (err) {
    liveContainers.delete(container)
    // O teardown do setup que falhou também conta (código de saída), mas NÃO
    // engole o erro original: a causa do teste nem ter começado é ele.
    try {
      removerOuFalhar(container)
    } catch (teardownErr) {
      process.stderr.write(
        `gitea-ephemeral: o setup falhou E o teardown também: ${String(teardownErr)}\n`,
      )
    }
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
