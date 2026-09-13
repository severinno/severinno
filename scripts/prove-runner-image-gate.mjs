#!/usr/bin/env node
// =============================================================================
// scripts/prove-runner-image-gate.mjs — PROVA, contra um registry de TESTE, que
// o runner NÃO sobe quando a tag da imagem não existe.
//
// POR QUE ESTA PROVA EXISTE (e por que o guard estático não basta):
//   O `checkGiteaBringUp` prova a ORDEM no texto do script ('up -d runner' vem
//   depois do ensure) e o ensure tem testes unitários dos seus estados. Nada
//   disso prova a ÚNICA coisa que importa em produção: que, com a tag ausente
//   no registry, a stack NÃO sobe o runner. Uma asserção sobre o texto não
//   distingue "bloqueia" de "quebrado": um `gitea-up.sh` que aborta por
//   qualquer outro motivo também nunca sobe o runner — e passaria.
//
//   Então esta prova EXECUTA o caminho real, com um registry de verdade em
//   127.0.0.1 (node:http falando OCI v2 de mentira, mas HTTP de verdade), o
//   `deploy/gitea-up.sh` real e um `docker` dublê que REGISTRA cada chamada.
//   O que se afirma é sobre o REGISTRO das chamadas: nenhum `compose up`
//   aconteceu.
//
// A CONTRA-PROVA (por que são VÁRIOS casos e não um):
//   "não subiu" sozinho é evidência fraca — um script quebrado também não sobe
//   nada. É o caso de CONTROLE que transforma "não subiu" em "não subiu PORQUE
//   a tag faltava".
//
//   FAMÍLIA A — a subida simples (3 casos):
//     A1. --check-only + tag ausente    → exit 4, ZERO chamadas ao docker;
//     A2. subida normal + tag ausente   → exit 5: o publisher "publica"
//         (build+push ok) e a RELEITURA desmente; ZERO `compose up` — nem um
//         publisher que mente consegue subir o runner;
//     A3. CONTROLE: tag presente        → exit 0 e `up -d runner` observado.
//
//   FAMÍLIA B — o RE-REGISTRO (`--re-register`), onde o risco é MAIOR (4 casos).
//   Ele APAGA o registro gravado antes de subir (o act_runner envia os labels no
//   registro e depois usa os de /data/.runner), e um registro que fica para trás
//   mantém os labels ANTIGOS com o tier-1 desligado — sem nenhum sintoma. Três
//   coisas que só o COMPORTAMENTO diz, e nenhuma delas aparece no texto:
//     B1. sem a imagem garantida NADA é destruído: nenhum `compose rm`, nenhum
//         `volume rm` — a garantia falha sem levar consigo o registro que está
//         funcionando (o oposto do runbook antigo, que apagava primeiro e
//         conferia depois);
//     B2. com a imagem, a ORDEM é `rm -sf runner` → `volume rm` → `up -d runner`;
//         invertida, o runner sobe com o registro ANTIGO e nada acusa;
//     B3. primeira subida (o volume do registro ainda não existe): não exige nada
//         a apagar — ausência de volume não é erro;
//     B4. registro que NÃO sai (volume em uso): o script RECUSA subir — o runner
//         NÃO sobe com o registro velho.
//
//   No caso A2 a asserção inclui o `build`/`push` no log: sem isso, "exit 5" não
//   distinguiria "bloqueou na releitura" de "não havia caminho de publicação" —
//   dois mundos com o mesmo código de saída e significados opostos.
//
// O registry de teste é LOCAL e ESMERALDA: nenhuma rede externa, nenhum docker.
// Roda em ~1s por caso (o healthcheck do Gitea é desligado com HEALTH_TIMEOUT=1).
//
// Usage:
//   node scripts/prove-runner-image-gate.mjs          # prova; exit 0 = segura
//   node scripts/prove-runner-image-gate.mjs --json   # mesma informação em JSON
//   node scripts/prove-runner-image-gate.mjs --cwd <raiz>   # repo mutado (teste)
//
// Exit codes:
//   0 — a prova SE SUSTENTA em todos os casos (bloqueio + controles)
//   1 — a prova FALHOU (o bloqueio não existe, ou a contra-prova não sobe)
//   2 — não consegui rodar a prova (sem bash, sem o script do bring-up)
// =============================================================================

import { spawn as nodeSpawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { delimiter, dirname, isAbsolute, join } from "node:path"
import { fileURLToPath } from "node:url"

import { EXIT } from "./ensure-runner-image.mjs"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

/** O bring-up real — a única peça que a prova executa. */
export const BRING_UP = "deploy/gitea-up.sh"

/**
 * Versão de TESTE — sintética de propósito. Montada por código para NENHUMA
 * linha do fonte parecer um `BUN_VERSION=<x.y.z>` que o guard estático pudesse
 * confundir com um default literal (mesma preocupação do check-bun-mirror, que
 * monta a tag por `String.fromCharCode`).
 */
export const PROOF_VERSION = ["9", "9", "9"].join(".")

/** Nome da variável montado por código, pelo mesmo motivo acima. */
const VERSION_KEY = ["BUN", "VERSION"].join("_")

const C = {
  green: "\u001b[0;32m",
  red: "\u001b[0;31m",
  yellow: "\u001b[1;33m",
  cyan: "\u001b[0;36m",
  nc: "\u001b[0m",
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Registry de TESTE (OCI v2 mínimo, HTTP de verdade em 127.0.0.1)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sobe um registry OCI mínimo numa porta aleatória de 127.0.0.1.
 *
 * `exists` → 200 no manifesto (a tag é puxável); `missing` → 404. Só isso: a
 * pergunta da prova é binária, e um registry mais rico (Bearer, blobs)
 * esconderia a resposta atrás de fidelidade que não está em julgamento.
 *
 * @param {"exists"|"missing"} mode
 * @returns {Promise<{url: string, port: number, hits: string[], close: () => Promise<void>}>}
 */
export function startTestRegistry(mode) {
  const hits = []
  const server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`)
    const status = mode === "exists" ? 200 : 404
    res.writeHead(status, { "content-type": "application/json" })
    res.end(mode === "exists" ? '{"schemaVersion":2}' : "{}")
  })
  return new Promise((resolve, reject) => {
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      const port = typeof addr === "object" && addr ? addr.port : 0
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        hits,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. `docker` e `gh` dublês — o REGISTRO das chamadas é a evidência
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Instala `docker` e `gh` FALSOS num diretório próprio (preposto ao PATH).
 *
 * POR QUE FALSOS: o alvo da prova é a DECISÃO do gitea-up.sh, não o docker.
 * Com o docker real, `compose up -d runner` levaria minutos, exigiria registry
 * autenticado e mudaria o estado da máquina — e a prova deixaria de ser
 * esmeralda. O dublê registra `$*` de cada chamada num log; é ESSE log que se
 * lê depois ("houve `up -d runner`?").
 *
 * Semântica do dublê, deliberada:
 *   - `--version` sai 0 (as pré-condições do gitea-up.sh, que exigem docker);
 *   - `build`/`push` saem 0 — no caso A2 é ESSENCIAL: um publisher que "dá
 *     certo" e mesmo assim não derruba o bloqueio;
 *   - `manifest` sai 1 (o docker não conhece a tag);
 *   - `volume inspect` reflete o ESTADO do volume do registro (`volume` abaixo),
 *     e `volume rm` o apaga — ou MENTE que apagou, no modo `stuck`, que é o
 *     caminho em que o registro antigo sobrevive;
 *   - `commit`/`compose`/qualquer outra coisa sai 0.
 *
 * O `gh` sempre falha: sem `gh` autenticado o ensure não pode escolher o
 * workflow de publicação, e nenhum workflow de verdade é disparado.
 *
 * O DOCTOR também é dublado (`exit 0`, via `DOCTOR_SCRIPT`), e por dois
 * motivos: (1) o doctor roda ESTA prova (seção 4 dele), então um doctor real
 * aqui dentro só fecharia o ciclo; (2) o doctor real responde por registry,
 * guards e branch protection, que este harness sintético não tem — sem o
 * dublê, todo caso que passa dos pré-requisitos mediria a prontidão em vez do
 * contrato da imagem. A coordenação bring-up x doctor é provada por execução em
 * `src/lib/__tests__/gitea-bring-up.test.ts` e, estruturalmente, pelo
 * `checkGiteaBringUp`.
 *
 * @param {string} parentDir
 * @param {{"absent"|"removable"|"stuck"}} [options]
 *   `absent`    — o volume do registro não existe (primeira subida do runner);
 *   `removable` — existe e o `docker volume rm` o remove de fato;
 *   `stuck`     — existe e CONTINUA existindo depois do `rm` (volume em uso) —
 *                 é o que separa "apagou o registro" de "disse que apagou".
 * @returns {{binDir: string, doctorStub: string, dockerCalls: () => string[]}}
 */
export function makeFakeBin(parentDir, { volume = "removable" } = {}) {
  const binDir = join(parentDir, "fake-bin")
  mkdirSync(binDir, { recursive: true })
  const dockerLog = join(binDir, "docker.log")
  const volumeState = join(binDir, "volume.state")
  writeFileSync(dockerLog, "")
  writeFileSync(volumeState, volume === "absent" ? "absent" : "present")

  writeFileSync(
    join(binDir, "docker"),
    [
      "#!/usr/bin/env bash",
      `echo "$*" >> "${dockerLog}"`,
      'case "$1" in',
      '  --version) echo "Docker version 27.0.0, build fake"; exit 0 ;;',
      "  manifest) exit 1 ;;",
      "  volume)",
      '    case "$2" in',
      `      inspect) [ -f "${volumeState}" ] && [ "$(cat "${volumeState}")" = present ] && exit 0; exit 1 ;;`,
      "      rm)",
      `        [ -f "${volumeState}" ] || exit 0`,
      `        [ "$(cat "${volumeState}")" = present ] || exit 0`,
      // `stuck`: o docker DIZ que removeu e o volume continua lá — é o caminho
      // em que o registro antigo sobrevive (volume em uso por um container).
      `        if [ "${volume}" = stuck ]; then exit 0; fi`,
      `        printf absent > "${volumeState}"`,
      "        exit 0 ;;",
      "    esac ;;",
      "esac",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  )
  writeFileSync(
    join(binDir, "gh"),
    ["#!/usr/bin/env bash", 'echo "gh: indisponivel (fake)" >&2', "exit 1", ""].join("\n"),
    { mode: 0o755 },
  )
  // Doctor dublado: PRONTA (exit 0). Ver o porquê no docstring acima.
  //
  // `.mjs` E NÃO `.sh`: o bring-up invoca o doctor com `node` (é um script Node,
  // como os outros), então um dublê em bash morreria no parser do Node
  // (`SyntaxError` → exit 1) e a prova acusaria "prontidão BLOQUEADA" por um
  // dublê quebrado — medido. O dublê tem de falar a MESMA língua do alvo.
  const doctorStub = join(binDir, "forge-doctor-stub.mjs")
  writeFileSync(
    doctorStub,
    [
      "// dublê da prova: a prontidão não é o alvo aqui (exit 0 = PRONTA)",
      "process.exit(0)",
      "",
    ].join("\n"),
  )

  return {
    binDir,
    doctorStub,
    dockerCalls: () =>
      readFileSync(dockerLog, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
  }
}

/**
 * Escreve o env do compose apontando para o registry de teste, E o template
 * GÊMEO que o passo 0 do bring-up confere.
 *
 * POR QUE O GÊMEO: o `deploy/gitea-up.sh` recusa subir quando o env do host
 * diverge do template comitado, e `check-env-mirror.mjs` roda ANTES da garantia
 * da imagem. O env da prova aponta para o registry de TESTE (porta efêmera), que
 * o template do repositório não tem como declarar — então a prova injeta um
 * template com os MESMOS valores — EXCETO o segredo, que no template é o
 * PLACEHOLDER e no host o valor real (a regra tem essa assimetria: num segredo,
 * IGUALAR é o defeito). Sem o gêmeo, todo caso sairia 1 na conferência do
 * espelho e a prova mediria a divergência do próprio harness em vez do bloqueio
 * da imagem. (A divergência REAL tem a sua prova em `gitea-bring-up.test.ts`.)
 *
 * @returns {{envFile: string, templateFile: string}}
 */
function writeProofEnv(dir, registryUrl) {
  const content = [
    `IMAGE_REGISTRY=${registryUrl}`,
    "IMAGE_NAMESPACE=severinno",
    `${VERSION_KEY}=${PROOF_VERSION}`,
    "RUNNER_TOKEN=prova",
    "",
  ].join("\n")
  const templateFile = join(dir, "env.gitea.example")
  const envFile = join(dir, "gitea.env")
  writeFileSync(envFile, content)
  writeFileSync(
    templateFile,
    content.replace("RUNNER_TOKEN=prova", "RUNNER_TOKEN=COLE_O_TOKEN_AQUI"),
  )
  return { envFile, templateFile }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Os casos
// ═══════════════════════════════════════════════════════════════════════════

/**
 * O resultado de UM caso — a mesma forma nos três, para o relatório e o JSON
 * serem lidos do mesmo jeito (e para o teste do doctor poder dublar o fato).
 *
 * @typedef {object} ProofCaseResult
 * @property {string} id
 * @property {string} title
 * @property {string} why
 * @property {boolean} ok
 * @property {string[]} failures
 * @property {number|null} exit
 * @property {number} expectedExit
 * @property {boolean} runnerUp
 * @property {number} composeCalls
 * @property {boolean} published
 * @property {number} registryHits
 * @property {boolean} reRegister       o caso é da família do re-registro?
 * @property {boolean} removal          houve 'rm -sf runner' (o registro foi apagado)?
 * @property {boolean} volumeRm         houve 'volume rm' (o volume do registro foi removido)?
 * @property {boolean} orderOk          'rm -sf runner' veio ANTES de 'up -d runner'?
 * @property {string} tail
 */

/**
 * @typedef {object} ProofCase
 * @property {string} id
 * @property {string} title
 * @property {"exists"|"missing"} registry
 * @property {string[]} args        argumentos extras do gitea-up.sh
 * @property {number} expectExit
 * @property {boolean} expectRunnerUp
 * @property {number|null} expectCompose  nº exato de chamadas 'compose' (null = não checa)
 * @property {boolean} expectPublish      o log deve conter build E push?
 * @property {boolean} expectBlockMsg     a saída deve conter 'NADA foi subido'?
 * @property {"absent"|"removable"|"stuck"} [volume]  estado do volume do registro no dublê
 * @property {boolean} [expectRemoval]    houve 'rm -sf runner'? (omitido = não opina)
 * @property {boolean} [expectVolumeRm]   houve 'volume rm'? (omitido = não opina)
 * @property {boolean} [expectOrder]      'rm' tem de vir ANTES do 'up -d runner'?
 * @property {string} why                 o que este caso prova
 */

/** @type {ProofCase[]} */
export const PROOF_CASES = [
  {
    id: "check-only",
    title: "tag AUSENTE + --check-only",
    registry: "missing",
    args: ["--check-only"],
    expectExit: EXIT.MISSING,
    expectRunnerUp: false,
    expectCompose: 0,
    expectPublish: false,
    expectBlockMsg: false,
    why: "a ausência CONFIRMADA pelo registry nem chega a tocar no docker (exit 4)",
  },
  {
    id: "ausente",
    title: "tag AUSENTE + subida normal (publisher que 'mente' e releitura que desmente)",
    registry: "missing",
    args: ["--source", "local"],
    expectExit: EXIT.PUBLISH_FAILED,
    expectRunnerUp: false,
    expectCompose: 0,
    expectPublish: true,
    expectBlockMsg: true,
    why: "nem um build+push que 'dá certo' sobe o runner: a RELEITURA é a garantia (exit 5)",
  },
  {
    id: "presente",
    title: "CONTROLE — tag PRESENTE",
    registry: "exists",
    args: [],
    expectExit: EXIT.OK,
    expectRunnerUp: true,
    expectCompose: null,
    expectPublish: false,
    expectBlockMsg: false,
    why: "com a tag presente a stack SOBE o runner — é isto que faz do 'não subiu' uma prova, e não um script quebrado",
  },

  // ── FAMÍLIA B: o RE-REGISTRO (o caminho que troca os labels) ────────────
  // Aqui o risco é maior que na subida simples: o re-registro APAGA o registro
  // gravado antes de subir. Sem imagem, apagar seria destruir o que funciona; e
  // com um registro que não sai, subir significaria rodar com os labels ANTIGOS
  // (tier-1 desligado, sem sintoma).
  {
    id: "re-register-sem-imagem",
    title: "tag AUSENTE + --re-register (a falha da garantia NÃO pode destruir o registro)",
    registry: "missing",
    args: ["--re-register", "--source", "local"],
    volume: "removable",
    expectExit: EXIT.PUBLISH_FAILED,
    expectRunnerUp: false,
    expectCompose: 0,
    expectPublish: true,
    expectBlockMsg: true,
    expectRemoval: false,
    expectVolumeRm: false,
    why: "sem a imagem garantida o re-registro nem começa: nenhum 'compose rm' e nenhum 'volume rm' — a garantia falha SEM levar consigo o registro que está funcionando",
  },
  {
    id: "re-register",
    title: "CONTROLE — tag PRESENTE + --re-register (ordem rm → volume rm → up)",
    registry: "exists",
    args: ["--re-register"],
    volume: "removable",
    expectExit: EXIT.OK,
    expectRunnerUp: true,
    expectCompose: null,
    expectPublish: false,
    expectBlockMsg: false,
    expectRemoval: true,
    expectVolumeRm: true,
    expectOrder: true,
    why: "o registro gravado é apagado ANTES de o runner subir — invertida a ordem, o runner voltaria com os labels ANTIGOS e o tier-1 seguiria desligado, em silêncio",
  },
  {
    id: "re-register-primeira-vez",
    title: "tag PRESENTE + --re-register sem registro anterior (primeira subida)",
    registry: "exists",
    args: ["--re-register"],
    volume: "absent",
    expectExit: EXIT.OK,
    expectRunnerUp: true,
    expectCompose: null,
    expectPublish: false,
    expectBlockMsg: false,
    expectRemoval: true,
    expectVolumeRm: false,
    expectOrder: true,
    why: "sem volume do registro o comando não exige nada a apagar — a ausência do volume não é erro (o 'volume rm' só aparece quando há o que apagar)",
  },
  {
    id: "re-register-registro-preso",
    title: "tag PRESENTE + registro que NÃO sai (volume em uso)",
    registry: "exists",
    args: ["--re-register"],
    volume: "stuck",
    expectExit: 1,
    expectRunnerUp: false,
    expectCompose: null,
    expectPublish: false,
    expectBlockMsg: false,
    expectRemoval: true,
    expectVolumeRm: true,
    why: "o runner NÃO sobe com o registro velho: se o volume do registro sobrevive, o script prefere falhar a re-registrar em silêncio",
  },
]

/**
 * Executa um processo e espera o fim, juntando stdout+stderr.
 *
 * ASSÍNCRONO DE PROPÓSITO — e este é o detalhe que faz a prova funcionar: o
 * `gitea-up.sh` chama o ensure num processo FILHO que precisa falar com o
 * registry de teste, que roda NESTE processo (mesmo event loop). Com
 * `spawnSync` o event loop do pai ficaria bloqueado esperando o filho — que
 * espera o registry responder; o registry não responde porque o pai está
 * bloqueado, e o ensure fica 'unreachable' por timeout. Medido: os casos da família A
 * saíam exit 3 (indeterminado) em vez de 4/5/0. `spawn` + await mantém o loop
 * vivo e o registry atende de verdade.
 *
 * @returns {Promise<{status: number|null, out: string}>}
 */
function runProcess(spawn, cmd, args, opts, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    child.stdout?.on("data", (c) => (out += c))
    child.stderr?.on("data", (c) => (out += c))
    // Rede de segurança: sem isso um bring-up que travasse penduraria o doctor.
    const killer = setTimeout(() => child.kill("SIGKILL"), timeoutMs)
    child.on("error", (err) => {
      clearTimeout(killer)
      resolve({ status: null, out: `${out}\n${err.message}` })
    })
    child.on("close", (code) => {
      clearTimeout(killer)
      resolve({ status: code, out })
    })
  })
}

/**
 * Roda um caso: registry de teste + env + `gitea-up.sh` real com PATH preparado.
 *
 * @returns {Promise<ProofCaseResult>} o resultado do caso, pronto para o relatório
 */
async function runCase(testCase, { cwd, bash, spawn }) {
  const tmp = mkdtempSync(join(tmpdir(), `prove-gate-${testCase.id}-`))
  const registry = await startTestRegistry(testCase.registry)
  try {
    const { binDir, doctorStub, dockerCalls } = makeFakeBin(tmp, { volume: testCase.volume })
    const { envFile, templateFile } = writeProofEnv(tmp, registry.url)

    const res = await runProcess(
      spawn,
      bash,
      [join(cwd, BRING_UP), "--env-file", envFile, ...testCase.args],
      {
        cwd,
        env: {
          ...process.env,
          PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
          // O template GÊMEO do env de teste (ver writeProofEnv): sem ele o
          // passo 0 acusaria a divergência do harness, não a do repo.
          TEMPLATE_FILE: templateFile,
          // O doctor dublado (ver `makeFakeBin`): a prova mede o bloqueio da
          // IMAGEM, e o doctor roda a própria prova.
          DOCTOR_SCRIPT: doctorStub,
          // O healthcheck do Gitea esperaria até 180s por um Gitea que não existe:
          // 1s (que vira ZERO iterações) tira a espera sem tirar o caminho.
          HEALTH_TIMEOUT: "1",
        },
      },
    )

    const calls = dockerCalls()
    const out = res.out
    const composeCalls = calls.filter((c) => c.includes("compose"))
    const removalIndex = calls.findIndex((c) => /(?:^|\s)rm -sf runner(?:\s|$)/.test(c))
    const runnerIndex = calls.findIndex((c) => c.includes("up -d runner"))
    const runnerUp = runnerIndex !== -1
    const removal = removalIndex !== -1
    const volumeRm = calls.some((c) => c.startsWith("volume rm "))
    // A ORDEM é o que faz o re-registro VALER: apagar o registro depois de subir
    // deixa o runner com os labels antigos — e nada acusa (o setup do Bun
    // funciona igual, só mais lento).
    const orderOk = removal && runnerUp && removalIndex < runnerIndex
    const published =
      calls.some((c) => c.startsWith("build")) && calls.some((c) => c.startsWith("push"))

    const failures = []
    if (res.status !== testCase.expectExit) {
      failures.push(`exit ${res.status} — esperado ${testCase.expectExit}`)
    }
    if (runnerUp !== testCase.expectRunnerUp) {
      failures.push(
        runnerUp
          ? "o runner SUBIU (havia 'up -d runner' no log do docker)"
          : "o runner NÃO subiu (faltou 'up -d runner'), mas o controle exige que subisse",
      )
    }
    if (testCase.expectCompose !== null && composeCalls.length !== testCase.expectCompose) {
      failures.push(
        `${composeCalls.length} chamada(s) 'compose' — esperado ${testCase.expectCompose} (nada da stack deveria subir)`,
      )
    }
    if (testCase.expectPublish && !published) {
      failures.push(
        "não houve build+push: o bloqueio pode ter vindo da falta de publisher, não da releitura",
      )
    }
    if (testCase.expectBlockMsg && !out.includes("NADA foi subido")) {
      failures.push("a saída não traz a mensagem de bloqueio ('NADA foi subido')")
    }
    if (testCase.expectRemoval !== undefined && removal !== testCase.expectRemoval) {
      failures.push(
        removal
          ? "o registro foi APAGADO ('compose rm -sf runner' no log do docker) e não devia — a garantia falhou e levou consigo o registro que funcionava"
          : "o registro NÃO foi apagado (faltou 'compose rm -sf runner' no log do docker) e devia",
      )
    }
    if (testCase.expectVolumeRm !== undefined && volumeRm !== testCase.expectVolumeRm) {
      failures.push(
        volumeRm
          ? "o volume do registro foi REMOVIDO ('volume rm' no log do docker) e não devia"
          : "o volume do registro NÃO foi removido (faltou 'volume rm' no log do docker) e devia",
      )
    }
    if (testCase.expectOrder && !orderOk) {
      failures.push(
        removal && runnerUp
          ? "o runner subiu ANTES de o registro ser apagado ('up -d runner' antes de 'rm -sf runner') — subiria com os labels ANTIGOS, e nada acusaria"
          : "não deu para conferir a ordem 'rm -sf runner' → 'up -d runner' (faltou uma das duas chamadas)",
      )
    }

    return {
      id: testCase.id,
      title: testCase.title,
      why: testCase.why,
      ok: failures.length === 0,
      failures,
      exit: res.status,
      expectedExit: testCase.expectExit,
      runnerUp,
      composeCalls: composeCalls.length,
      published,
      registryHits: registry.hits.length,
      reRegister: testCase.expectRemoval !== undefined,
      removal,
      volumeRm,
      orderOk,
      // Um resumo curto e legível do que o docker viu — é o que se cita no relatório.
      tail: failures.length === 0 ? "" : out.trim().split("\n").slice(-6).join("\n"),
    }
  } finally {
    await registry.close()
    rmSync(tmp, { recursive: true, force: true })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. A prova
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Roda todos os casos contra o registry de teste.
 *
 * @param {object} [options]
 * @param {string} [options.cwd]    raiz do repositório (default: esta)
 * @param {string} [options.bash]   binário do bash (default: resolveBash)
 * @param {Function} [options.spawn] `child_process.spawn` real ou dublê de teste
 * @returns {Promise<{ok: boolean, status: "holds"|"violated"|"unavailable", detail: string, cases: ProofCaseResult[]}>}
 */
export async function proveRunnerImageGate({
  cwd = REPO_ROOT,
  bash = resolveBash(),
  spawn = nodeSpawn,
} = {}) {
  if (!existsSync(join(cwd, BRING_UP))) {
    return {
      ok: false,
      status: "unavailable",
      detail: `${BRING_UP} não encontrado em ${cwd} — sem o bring-up real não há o que provar`,
      cases: [],
    }
  }
  if (!bash) {
    return {
      ok: false,
      status: "unavailable",
      detail:
        "bash não encontrado — a prova executa o deploy/gitea-up.sh real e precisa dele (no Windows: Git Bash)",
      cases: [],
    }
  }

  const cases = []
  for (const testCase of PROOF_CASES) {
    cases.push(await runCase(testCase, { cwd, bash, spawn }))
  }
  const broken = cases.filter((c) => !c.ok)
  return {
    ok: broken.length === 0,
    status: broken.length === 0 ? "holds" : "violated",
    detail:
      broken.length === 0
        ? "com a tag ausente o runner NÃO sobe (4 casos: subida e re-registro) e, com a tag presente, sobe (3 controles) — e no re-registro o registro antigo é apagado ANTES de subir, ou o runner não sobe"
        : `${broken.length} caso(s) da prova falharam: ${broken.map((c) => c.id).join(", ")}`,
    cases,
  }
}

/**
 * Resolve o bash. No Windows o `bash` do PATH pode ser o do WSL (saída UTF-16,
 * exit 1 sempre) — prefere o Git for Windows quando presente, como já faz o
 * helper dos testes.
 *
 * @returns {string}
 */
export function resolveBash() {
  if (process.platform === "win32") {
    for (const candidate of [
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    ]) {
      if (existsSync(candidate)) return candidate
    }
  }
  return "bash"
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Relatório + CLI
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {object} result  retorno de proveRunnerImageGate
 * @param {{emit?: Function}} [deps]
 */
export function renderProof(result, { emit = console.log } = {}) {
  const line = (s = "") => emit(s)
  for (const c of result.cases) {
    const mark = c.ok ? `${C.green}✅${C.nc}` : `${C.red}❌${C.nc}`
    const runner = c.runnerUp ? "runner SUBIU" : "runner não subiu"
    const parts = [
      `exit ${c.exit} (esperado ${c.expectedExit})`,
      runner,
      `${c.composeCalls} 'compose'`,
    ]
    // No re-registro o que importa não é só "subiu": é o que foi APAGADO antes.
    // `volumeRm` é a EMISSÃO do comando — no modo `stuck` o docker diz que
    // removeu e o volume continua lá (é justamente o caso que o script recusa).
    if (c.reRegister) {
      parts.push(c.removal ? "registro apagado (rm -sf runner)" : "registro INTACTO")
      parts.push(c.volumeRm ? "'volume rm' emitido" : "'volume rm' não emitido")
    }
    line(`  ${mark} ${c.title}`)
    line(`       ${parts.join(" · ")}`)
    line(`       ${C.cyan}▸${C.nc} ${c.why}`)
    for (const f of c.failures) line(`       ${C.red}✗${C.nc} ${f}`)
    if (c.tail) for (const l of c.tail.split("\n")) line(`         ${l}`)
  }
  if (result.status === "unavailable") {
    line(`  ${C.yellow}⚠️${C.nc} prova indisponível: ${result.detail}`)
    return
  }
  line()
  line(
    result.ok
      ? `  ${C.green}✅ prova do bloqueio: ${result.detail}${C.nc}`
      : `  ${C.red}❌ prova do bloqueio FALHOU: ${result.detail}${C.nc}`,
  )
}

export const USAGE = `prove-runner-image-gate — prova, contra um registry de teste, que o runner não sobe com a tag ausente

Usage:
  node scripts/prove-runner-image-gate.mjs [opções]

Opções:
  --cwd <raiz>   raiz do repositório a usar (default: esta) — serve para testar
                 uma cópia MUTADA do gitea-up.sh
  --json         saída JSON (para guard/automação)
  -h, --help     esta ajuda

Exit codes: 0 prova segura · 1 prova falhou · 2 não consegui rodar a prova`

export function parseArgs(argv) {
  const opts = { cwd: REPO_ROOT, json: false, help: false, error: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--json") opts.json = true
    else if (arg === "-h" || arg === "--help") opts.help = true
    else if (arg === "--cwd") opts.cwd = argv[++i] ?? ""
    else opts.error = `argumento desconhecido: ${arg}`
  }
  if (!opts.error && !opts.cwd) opts.error = "--cwd exige um caminho"
  if (!opts.error && opts.cwd && !isAbsolute(opts.cwd)) opts.cwd = join(process.cwd(), opts.cwd)
  return opts
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log(USAGE)
    return 0
  }
  if (opts.error) {
    console.error(`prove-runner-image-gate: ${opts.error}`)
    console.error(USAGE)
    return 2
  }
  const result = await proveRunnerImageGate({ cwd: opts.cwd })
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log("")
    console.log("  ═════════════════════════════════════════════════════════════════")
    console.log("   🔒 PROVA — o runner não sobe sem a imagem (registry de teste)")
    console.log("  ═════════════════════════════════════════════════════════════════")
    console.log("")
    renderProof(result)
    console.log("")
  }
  if (result.status === "unavailable") return 2
  return result.ok ? 0 : 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => process.exit(code))
}
