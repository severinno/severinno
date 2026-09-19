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
//   FAMÍLIA C — o PRÉ-REQUISITO 0 (o env do host espelha o template comitado). É o
//   passo que roda ANTES de tudo — antes da imagem e antes de qualquer docker — e
//   é ele que o `checkGiteaBringUp` só provava no TEXTO ("o script invoca o guard
//   antes do ensure"). Texto não distingue bloquear de estar quebrado: um bring-up
//   que aborta por qualquer motivo também não sobe o runner. Os três casos usam um
//   env DIVERGENTE e a imagem PRESENTE — de propósito: se a imagem está lá e a
//   stack mesmo assim não sobe, a causa só pode ser o passo 0. E o ZERO de idas ao
//   registry é a prova da ORDEM (o ensure não chegou a rodar).
//     C0. CONTROLE — env EM SINCRONIA → a stack sobe (é o caso `presente`): sem
//         ele, "não subiu" seria satisfeito por um script quebrado;
//     C1. divergente + subida normal → exit 1, ZERO chamadas ao docker, ZERO idas
//         ao registry, com a mensagem do passo 0 na saída;
//     C2. divergente + `--check-only` → o mesmo (o passo 0 não é exclusivo do
//         caminho que sobe);
//     C3. SEGREDO IGUAL ao placeholder do template → exit 1: é a ASSIMETRIA da
//         regra (num segredo, IGUALAR é o defeito) — sem este caso, "recusa
//         qualquer diferença" passaria por "recusa o que a regra manda".
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
//   FAMÍLIA D — AS INSTRUÇÕES (o que o operador COPIA). O instalador
//   (`deploy/setup-gitea.sh`) e o runbook (`deploy/GITEA.md`) trazem comandos
//   prontos, e até aqui eles eram conferidos por TEXTO (`setupContent.includes
//   ("gitea-up.sh")`, `doc.includes("--re-register")`): um `$GITEA_DIR` trocado,
//   uma flag que o bring-up não conhece, uma ordem invertida — tudo isso contém
//   a string exigida e mesmo assim deixa o operador com um comando que não
//   funciona. Aqui a instrução é EXTRAÍDA do arquivo e RODADA (o instalador com
//   `$GITEA_DIR`/`$REPO_DIR` definidos, o runbook com as FLAGS que ele manda,
//   contra o registry de teste), e o caso só passa se o caminho que ele imprime
//   realmente chega ao bring-up e se comporta como ele promete.
//
//   AS FLAGS PASSOU A SER OBSERVADAS (não lidas): o mirror e o ensure são
//   envolvidos por ESPIÕES (que delegam ao script REAL do repositório, sem
//   mudar comportamento) e o doctor dublado já gravava a própria invocação.
//   Cada caso declara o que o bring-up TEM de ter passado — `--host`/`--template`
//   apontando para os arquivos DESTA subida, `--gitea-env <env>` (e nunca
//   `--env-file`, que é flag do Node e mataria o processo com exit 9),
//   `--check` no `--check-only`, o doctor com `--gitea-env` e SEM flags --no-* que escondam fatos,
//   e `--no-runner-labels` no `--re-register` — e o relatório MOSTRA a linha que
//   cada filho recebeu. Sem isso, "o bring-up passa --host" continuava sendo uma
//   asserção sobre o texto dele; com isso, é o argv medido do processo que rodou.
//
//   No caso A2 a asserção inclui o `build`/`push` no log: sem isso, "exit 5" não
//   distinguiria "bloqueou na releitura" de "não havia caminho de publicação" —
//   dois mundos com o mesmo código de saída e significados opostos.
//
//   A CADEIA QUE PRECISA SER FINITA (e o que a prova mede dela): o doctor roda
//   ESTA prova (seção 4 dele), esta prova EXECUTA o `deploy/gitea-up.sh` real e o
//   bring-up chama o doctor — `bring-up → doctor → prova → bring-up`. Quem a torna
//   finita é a DUBLAGEM do doctor: o env do filho leva `DOCTOR_SCRIPT` apontando
//   para um dublê que NÃO executa a prova. Por isso cada caso declara
//   `expectDoctorStub` e o dublê grava a própria invocação: o corte deixa de ser
//   um comentário e passa a ser um fato ASSERTADO em cada caso que chega ao passo
//   2 — e, nos que recusam antes, que o doctor NÃO foi invocado (a ordem provada
//   é a que executa). Sem isso, --no-proof no bring-up pareceria a única forma
//   de não recursar; com isso, o bring-up pode rodar o doctor INTEIRO. A cadeia
//   completa, com o doctor REAL dentro do bring-up, é provada por execução em
//   `src/lib/__tests__/prove-runner-image-gate.test.ts`.
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
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { delimiter, dirname, isAbsolute, join } from "node:path"
import { fileURLToPath } from "node:url"

import { EXIT } from "./ensure-runner-image.mjs"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

/** O bring-up real — a peça que a prova executa (e que as instruções invocam). */
export const BRING_UP = "deploy/gitea-up.sh"

/** O instalador da forja — é dele que saem as instruções que o operador copia. */
export const SETUP_SCRIPT = "deploy/setup-gitea.sh"

/** O runbook da forja — onde vive o procedimento de re-registro. */
export const RUNBOOK = "deploy/GITEA.md"

/** O guard do espelho e a garantia da imagem: os alvos dos ESPIÕES. */
export const MIRROR_SCRIPT = "scripts/check-env-mirror.mjs"
export const ENSURE_SCRIPT = "scripts/ensure-runner-image.mjs"

/** A FAMÍLIA do caso: a pergunta que ele responde (o relatório agrupa por ela). */
export const PROOF_FAMILIES = [
  { id: "image", title: "o PRÉ-REQUISITO 1 — a imagem existe no registry" },
  { id: "env-mirror", title: "o PRÉ-REQUISITO 0 — o env do host espelha o template" },
  { id: "re-register", title: "o RE-REGISTRO — apagar o registro gravado antes de subir" },
  { id: "instructions", title: "AS INSTRUÇÕES — o que o instalador e o runbook mandam rodar" },
  {
    id: "no-runner",
    title: "o MODO --no-runner — sobe Gitea/Caddy pula os pré-requisitos do runner",
  },
  { id: "contradiction", title: "COMBINAÇÕES CONTRADITÓRIAS — flags que não podem coexistir" },
]

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
 * O DOCTOR TAMBÉM É DUBLADO (`exit 0`, via `DOCTOR_SCRIPT`) — e agora isso não é
 * um detalhe do harness: é O CORTE DO CICLO. O doctor roda ESTA prova (seção 4
 * dele), esta prova EXECUTA o `deploy/gitea-up.sh` real, e o bring-up chama o
 * doctor: sem o dublê a cadeia
 *
 *     bring-up → doctor → prova → bring-up → doctor → prova → …
 *
 * não tem profundidade limite — não é um erro que aparece, é uma forca de
 * processos. O dublê (que NÃO executa a prova) é o que a torna finita em UM
 * nível, e por isso ele GRAVA a própria invocação: cada caso que chega ao passo
 * 2 exige `expectDoctorStub`, então "o de baixo foi o dublê" é um fato MEDIDO da
 * prova, não uma promessa do comentário. A cadeia inteira (o doctor REAL dentro
 * do bring-up) é provada por execução em
 * `src/lib/__tests__/prove-runner-image-gate.test.ts`.
 *
 * @param {string} parentDir
 * @param {{"absent"|"removable"|"stuck"}} [options.volume]
 *   `absent`    — o volume do registro não existe (primeira subida do runner);
 *   `removable` — existe e o `docker volume rm` o remove de fato;
 *   `stuck`     — existe e CONTINUA existindo depois do `rm` (volume em uso) —
 *                 é o que separa "apagou o registro" de "disse que apagou".
 * @param {string} [options.cwd]  raiz de onde saem os scripts REAIS que os espiões
 *   delegam (default: esta) — com `--cwd` de uma raiz mutada, o espião delega ao
 *   script DAQUELA raiz, e a mutação continua valendo.
 * @returns {{binDir: string, doctorStub: string, mirrorSpy: string, ensureSpy: string,
 *   doctorCalls: () => string[][], mirrorCalls: () => string[][], ensureCalls: () => string[][],
 *   dockerCalls: () => string[], trace: () => {tag: string, line: string}[]}}
 */
export function makeFakeBin(parentDir, { volume = "removable", cwd = REPO_ROOT } = {}) {
  const binDir = join(parentDir, "fake-bin")
  mkdirSync(binDir, { recursive: true })
  const dockerLog = join(binDir, "docker.log")
  const doctorLog = join(binDir, "doctor.log")
  const mirrorLog = join(binDir, "mirror.log")
  const ensureLog = join(binDir, "ensure.log")
  // O TRACE ordenado: cada dublê/espião anota a própria chamada NA ORDEM em que
  // ela aconteceu. É o que permite afirmar a ORDEM ("o doctor rodou antes do
  // 'up -d gitea'") — um log por binário não diz quem veio primeiro.
  const traceLog = join(binDir, "trace.log")
  const volumeState = join(binDir, "volume.state")
  writeFileSync(dockerLog, "")
  writeFileSync(doctorLog, "")
  writeFileSync(mirrorLog, "")
  writeFileSync(ensureLog, "")
  writeFileSync(traceLog, "")
  writeFileSync(volumeState, volume === "absent" ? "absent" : "present")

  writeFileSync(
    join(binDir, "docker"),
    [
      "#!/usr/bin/env bash",
      `echo "$*" >> "${dockerLog}"`,
      `printf 'docker\\t%s\\n' "$*" >> "${traceLog}"`,
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
  // Doctor dublado: PRONTA (exit 0) e — o que importa aqui — SEM executar a
  // prova. É ele que fecha o ciclo em um nível. Ver o docstring acima.
  //
  // `.mjs` E NÃO `.sh`: o bring-up invoca o doctor com `node` (é um script Node,
  // como os outros), então um dublê em bash morreria no parser do Node
  // (`SyntaxError` → exit 1) e a prova acusaria "prontidão BLOQUEADA" por um
  // dublê quebrado — medido. O dublê tem de falar a MESMA língua do alvo.
  //
  // E ele REGISTRA a invocação: sem isso, "o de baixo foi o dublê" continuaria
  // sendo uma afirmação sobre o código, e não um fato do caso.
  const doctorStub = join(binDir, "forge-doctor-stub.mjs")
  writeFileSync(
    doctorStub,
    [
      "// dublê da prova: a prontidão não é o alvo aqui (exit 0 = PRONTA) e ele",
      "// NÃO executa a prova — é isto que corta o ciclo em um nível.",
      'import { appendFileSync } from "node:fs"',
      `const LOG = ${JSON.stringify(doctorLog)}`,
      `const TRACE = ${JSON.stringify(traceLog)}`,
      "const argv = process.argv.slice(2)",
      'appendFileSync(LOG, JSON.stringify(argv) + "\\n")',
      'appendFileSync(TRACE, "doctor\\t" + argv.join(" ") + "\\n")',
      "process.exit(0)",
      "",
    ].join("\n"),
  )

  /**
   * Um ESPIÃO: grava o argv EXATO que recebeu, anota no trace e DELEGA ao script
   * REAL do repositório, propagando o exit code.
   *
   * POR QUE DELEGAR (em vez de só gravar): as FAMÍLIAS A/C julgam o
   * COMPORTAMENTO do script real do repositório (a recusa do passo 0, a releitura
   * do registry). Um dublê que só gravasse o argv trocaria esse comportamento por
   * um "sim" — e a prova mediria o harness. O espião mede as FLAGS sem tocar no
   * que elas decidem.
   *
   * `exit 96` é HARNESS (o alvo não existe), não bring-up: um espião que não acha
   * o script real não pode virar "o bring-up bloqueou por um motivo qualquer".
   */
  const writeSpy = (tag, log, rel) => {
    const path = join(binDir, `${tag}-spy.mjs`)
    writeFileSync(
      path,
      [
        `// espião de ${rel}: mede as FLAGS que o bring-up passa, sem mudar comportamento.`,
        'import { appendFileSync, existsSync } from "node:fs"',
        'import { spawnSync } from "node:child_process"',
        `const LOG = ${JSON.stringify(log)}`,
        `const TRACE = ${JSON.stringify(traceLog)}`,
        `const REAL = ${JSON.stringify(join(cwd, rel))}`,
        `const TAG = ${JSON.stringify(tag)}`,
        "const argv = process.argv.slice(2)",
        'appendFileSync(LOG, JSON.stringify(argv) + "\\n")',
        'appendFileSync(TRACE, TAG + "\\t" + argv.join(" ") + "\\n")',
        "if (!existsSync(REAL)) {",
        '  console.error("espiao sem o script real: " + REAL)',
        "  process.exit(96)",
        "}",
        'const res = spawnSync(process.execPath, [REAL, ...argv], { stdio: "inherit" })',
        "process.exit(res.status ?? (res.error ? 96 : 1))",
        "",
      ].join("\n"),
    )
    return path
  }

  const mirrorSpy = writeSpy("mirror", mirrorLog, MIRROR_SCRIPT)
  const ensureSpy = writeSpy("ensure", ensureLog, ENSURE_SCRIPT)

  const readRaw = (path) =>
    readFileSync(path, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)

  /** Cada linha é um JSON array (o argv do filho); ilegível vira [] — e a
   *  asserção exige as flags que precisa, então "[]" NÃO passa em silêncio. */
  const readArgv = (path) =>
    readRaw(path).map((l) => {
      try {
        const parsed = JSON.parse(l)
        return Array.isArray(parsed) ? parsed.map(String) : []
      } catch {
        return []
      }
    })

  return {
    binDir,
    doctorStub,
    mirrorSpy,
    ensureSpy,
    doctorCalls: () => readArgv(doctorLog),
    mirrorCalls: () => readArgv(mirrorLog),
    ensureCalls: () => readArgv(ensureLog),
    dockerCalls: () => readRaw(dockerLog),
    /** O registro ORDENADO das chamadas — é o que sustenta as asserções de ORDEM. */
    trace: () =>
      readRaw(traceLog).map((l) => {
        const [tag, ...rest] = l.split("\t")
        return { tag, line: rest.join("\t") }
      }),
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
 * @returns {{envFile: string, templateFile: string, divergent: boolean}}
 */
export function writeProofEnv(dir, registryUrl, mode = "sync") {
  const content = [
    `IMAGE_REGISTRY=${registryUrl}`,
    "IMAGE_NAMESPACE=severinno",
    `${VERSION_KEY}=${PROOF_VERSION}`,
    "RUNNER_TOKEN=prova",
    "",
  ].join("\n")
  const templateFile = join(dir, "env.gitea.example")
  const envFile = join(dir, "gitea.env")
  const secret = "COLE_O_TOKEN_AQUI"
  writeFileSync(templateFile, content.replace("RUNNER_TOKEN=prova", `RUNNER_TOKEN=${secret}`))
  // FAMÍLIA C: o host DIVERGE do template — e o motivo da divergência é
  // escolhido para responder uma pergunta específica (ver o bloco FAMÍLIA C no
  // cabeçalho). `divergent`: um valor COMUM diferente (a regra exige o do
  // template). `secret-equal`: o segredo com o MESMO valor do template — o
  // defeito que só existe na direção oposta (o template é comitado).
  const host =
    mode === "divergent"
      ? content.replace("IMAGE_NAMESPACE=severinno", "IMAGE_NAMESPACE=outro")
      : mode === "secret-equal"
        ? content.replace("RUNNER_TOKEN=prova", `RUNNER_TOKEN=${secret}`)
        : content
  writeFileSync(envFile, host)
  return { envFile, templateFile, divergent: mode !== "sync" }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2b. As INSTRUÇÕES do operador — o que se copia e se cola
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A FORMA de uma instrução executável do instalador: variáveis de ambiente,
 * depois `bash <caminho>...gitea-up.sh` e, opcionalmente, flags.
 *
 * É o FILTRO fail-closed da extração: prosa que menciona o script ("o gitea-up.sh
 * GARANTE a imagem...") não casa, e uma instrução com forma desconhecida NÃO é
 * executada — o caso falha dizendo o que veio, em vez de rodar outra coisa.
 *
 * Os TRÊS grupos são o que a instrução de fato CARREGA: as variáveis que ela
 * exporta, o script que ela invoca e as flags que ela passa.
 */
const INSTRUCTION_RE =
  /^((?:[A-Z_][A-Z0-9_]*=\S+\s+)*)bash\s+(\S*gitea-up\.sh)((?:\s+--[a-z][a-z-]*)*)$/

/**
 * Uma instrução JÁ QUEBRADA nas três partes que importam — ainda com os
 * placeholders (`$GITEA_DIR`/`$REPO_DIR`) que o instalador define.
 *
 * @typedef {{raw: string, env: Record<string,string>, script: string, flags: string[]}} Instruction
 */

/**
 * Resolve os placeholders do INSTALADOR (`$GITEA_DIR`/`$REPO_DIR`) contra os
 * diretórios reais do caso.
 *
 * FAIL-CLOSED: um `$` que sobrevive à substituição é erro, não string vazia — um
 * `$GITEA_DIR` escrito errado viraria `ENV_FILE=/.env` e a instrução executaria
 * outra coisa em silêncio (que é exatamente o que a extração existe para pegar).
 *
 * @param {Instruction} instruction
 * @param {{giteaDir: string, repoDir: string}} dirs
 * @returns {{env: Record<string,string>, script: string, flags: string[], errors: string[]}}
 */
export function resolveInstruction(instruction, { giteaDir, repoDir }) {
  const sub = (s) => s.split("$GITEA_DIR").join(giteaDir).split("$REPO_DIR").join(repoDir)
  const env = {}
  const errors = []
  for (const [k, v] of Object.entries(instruction.env)) {
    const value = sub(v)
    if (value.includes("$")) {
      errors.push(
        `${SETUP_SCRIPT}: a instrução exporta ${k}=${v} com uma variável que o instalador não define — a substituição deixaria um '$' literal no comando`,
      )
      continue
    }
    env[k] = value
  }
  const script = sub(instruction.script)
  if (script.includes("$")) {
    errors.push(
      `${SETUP_SCRIPT}: o caminho do bring-up na instrução tem variável desconhecida: ${instruction.script}`,
    )
  }
  return { env, script, flags: instruction.flags, errors }
}

/**
 * Junta as linhas de continuação (`\` no fim) de um trecho em linhas LÓGICAS.
 *
 * @param {string[]} lines
 * @returns {string[]}
 */
function joinContinuations(lines) {
  const out = []
  let pending = null
  for (const raw of lines) {
    const line = raw.trim()
    const cont = /\\$/.test(line)
    const text = line.replace(/\\$/, "").trim()
    pending = pending === null ? text : `${pending} ${text}`.trim()
    if (!cont) {
      out.push(pending)
      pending = null
    }
  }
  if (pending !== null) out.push(pending)
  return out
}

/**
 * As instruções que o INSTALADOR IMPRIME e que invocam o bring-up.
 *
 * POR QUE EXTRAIR E EXECUTAR (e não procurar a string 'gitea-up.sh'): o guard
 * estático `checkGiteaBringUp` prova que o instalador MENCIONA o bring-up — e
 * "menciona" não distingue "o caminho que ele imprime funciona" de "o caminho
 * que ele imprime está quebrado" (variável trocada, ordem errada, flag que o
 * bring-up não conhece). Aqui o comando sai DO ARQUIVO e é RODADO, com
 * `$GITEA_DIR`/`$REPO_DIR` definidos — o mesmo desenho do harness que extrai a
 * linha `run:` do YAML e a executa.
 *
 * Só linhas de `echo "..."` entram: elas são as que IMPRIMEM comando. A prosa do
 * script (comentário, mensagem de log) não é instrução, e executá-la mediria
 * outra coisa.
 *
 * @param {string} content  conteúdo de SETUP_SCRIPT
 * @returns {{instructions: Instruction[], full: Instruction|null, checkOnly: Instruction|null,
 *   missing: {full: string, checkOnly: string}}}
 *   `missing` é POR INSTRUÇÃO de propósito: o caso do `--check-only` não pode cair
 *   porque a instrução de SUBIDA sumiu (nem o contrário) — cada caso responde por
 *   uma pergunta, e uma ausência que não é a dele é ruído no diagnóstico.
 */
export function installerInstructions(content) {
  if (!content) {
    const msg = `${SETUP_SCRIPT}: ausente — sem o instalador não há instrução a executar`
    return { instructions: [], full: null, checkOnly: null, missing: { full: msg, checkOnly: msg } }
  }
  const echoed = []
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*echo\s+"((?:[^"\\]|\\.)*)"\s*$/)
    if (!m) continue
    // `\\` no fonte é um `\` IMPRESSO (é a continuação que o operador copia).
    echoed.push(m[1].replace(/\\\\/g, "\\"))
  }
  /** @type {Instruction[]} */
  const instructions = []
  for (const logical of joinContinuations(echoed)) {
    const collapsed = logical.replace(/\s+/g, " ").trim()
    const m = collapsed.match(INSTRUCTION_RE)
    if (!m) continue
    const env = {}
    for (const pair of m[1].trim().split(/\s+/).filter(Boolean)) {
      const at = pair.indexOf("=")
      env[pair.slice(0, at)] = pair.slice(at + 1)
    }
    instructions.push({
      raw: collapsed,
      env,
      script: m[2],
      flags: m[3].trim() === "" ? [] : m[3].trim().split(/\s+/),
    })
  }
  const checkOnly = instructions.find((i) => i.flags.includes("--check-only")) ?? null
  const full = instructions.find((i) => !i.flags.includes("--check-only")) ?? null
  const missing = {
    full: full
      ? ""
      : `${SETUP_SCRIPT}: nenhuma instrução impressa invoca o bring-up SEM --check-only — o instalador precisa levar o operador pelo caminho que SOBE a stack (formas aceitas: as variáveis de ambiente, 'bash <caminho>.../gitea-up.sh' e flags)`,
    checkOnly: checkOnly
      ? ""
      : `${SETUP_SCRIPT}: nenhuma instrução impressa invoca o bring-up com --check-only — quem só quer conferir (sem subir nada) precisa de um caminho que o instalador mostre`,
  }
  return { instructions, full, checkOnly, missing }
}

/**
 * As FLAGS que o RUNBOOK manda o operador passar ao bring-up.
 *
 * Prova por EXECUÇÃO o outro lado do `--re-register`: o guard de texto confere
 * que o `deploy/GITEA.md` menciona a flag; aqui as flags saem do bloco CERCADO
 * (o que se copia, não a prosa) e são executadas contra o registry de teste. Se
 * alguém ensinar uma flag que o bring-up não conhece, o caso fica vermelho — e
 * não num comentário.
 *
 * @param {string} content  conteúdo de RUNBOOK
 * @returns {{flags: string[], raw: string, errors: string[]}}
 */
export function runbookInvocation(content) {
  if (!content) return { flags: [], raw: "", errors: [`${RUNBOOK}: ausente`] }
  // Candidatos: invocações do bring-up que NÃO servem (sem --re-register, ou com
  // algo que não é flag). Eles só viram erro se NENHUM bloco trouxer o modo de
  // re-registro — a doc cita o bring-up em vários lugares, e o segundo bloco não
  // pode ser invalidado pelo primeiro.
  const candidates = []
  for (const block of content.matchAll(/```bash\r?\n([\s\S]*?)```/g)) {
    for (const line of joinContinuations(block[1].split(/\r?\n/))) {
      const m = line.match(/(?:^|\s)bash\s+\S*gitea-up\.sh(\s+.*)?$/)
      if (!m) continue
      const raw = (m[1] ?? "").trim()
      const flags = raw === "" ? [] : raw.split(/\s+/)
      const bad = flags.filter((f) => !/^--[a-z][a-z-]*$/.test(f))
      if (bad.length === 0 && flags.includes("--re-register")) {
        return { flags, raw: line, errors: [] }
      }
      candidates.push(
        bad.length > 0
          ? `'${line}' passa ${bad.map((b) => `'${b}'`).join(", ")} ao bring-up — não é flag (--minusculas-com-hifens)`
          : `'${line}' invoca o bring-up SEM --re-register`,
      )
    }
  }
  const errors = [
    `${RUNBOOK}: nenhum bloco \`\`\`bash invoca o bring-up com --re-register — sem o comando copiável o procedimento de re-registro volta a ser prosa${candidates.length > 0 ? ` (o que a doc traz: ${candidates.join("; ")})` : ""}`,
  ]
  return { flags: [], raw: "", errors }
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
 * @property {number} doctorStubCalls  quantas vezes o DOCTOR DUBLADO foi invocado (o corte do ciclo)
 * @property {boolean|null} expectDoctorStub  a expectativa do caso (null = o caso não opina)
 * @property {boolean} reRegister       o caso é da família do re-registro?
 * @property {boolean} removal          houve 'rm -sf runner' (o registro foi apagado)?
 * @property {boolean} volumeRm         houve 'volume rm' (o volume do registro foi removido)?
 * @property {boolean} orderOk          'rm -sf runner' veio ANTES de 'up -d runner'?
 * @property {string[]|null} mirrorArgs o argv EXATO que o espelho recebeu (espião)
 * @property {string[]|null} ensureArgs o argv EXATO que o ensure recebeu (espião)
 * @property {string[]|null} doctorArgs o argv EXATO que o doctor dublado recebeu
 * @property {string|null} invokedAs    como o caso invocou o bring-up (null = direto)
 * @property {boolean|null} doctorBeforeStack  o doctor rodou ANTES do 'up -d gitea'?
 * @property {{mirror: string|null, ensure: string|null, doctor: string|null}} flags
 *   a linha que cada filho RECEBEU (a evidência que o relatório cita)
 * @property {string} family            a família do caso (`PROOF_FAMILIES`)
 * @property {number} dockerCalls       quantas vezes o binário `docker` foi chamado
 * @property {boolean} mirrorRefused    a saída traz a RECUSA do passo 0?
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
 * @property {"image"|"env-mirror"|"re-register"|"instructions"|"no-runner"|"contradiction"} family
 * @property {"sync"|"divergent"|"secret-equal"} [env]  o env do host x o template
 * @property {number} [expectRegistryHits]  nº exato de idas ao registry (omitido = não checa)
 * @property {number} [expectDockerCalls]   nº exato de chamadas ao binário `docker` (omitido = não checa)
 * @property {boolean} [expectMirrorMsg]    a saída deve trazer a recusa do passo 0?
 * @property {boolean} [expectMirrorFlags]  o espelho tem de ter RECEBIDO --host e
 *                                          --template apontando para OS ARQUIVOS
 *                                          desta subida (medido no argv do espião)
 * @property {"invoked"|"not"} [expectEnsureFlags]  o ensure foi invocado (e com
 *                                          `--gitea-env <env>`, `--source <modo>`,
 *                                          `--check` no `--check-only` e NUNCA
 *                                          `--env-file`)? `not` = o caso recusa
 *                                          ANTES do passo 1 (a ORDEM)
 * @property {{giteaEnv?: boolean, noRunnerLabels?: boolean}} [expectDoctorArgs]
 *                                          o argv que o doctor TEM de ter recebido
 * @property {boolean} [expectDoctorBeforeStack]  o doctor tem de aparecer ANTES do
 *                                          'up -d gitea' no registro ORDENADO
 * @property {"installer-check-only"|"installer-full"|"runbook"} [invocation]
 *                                          o caso roda a INSTRUÇÃO de um documento
 *                                          (instalador/runbook) em vez do bring-up
 *                                          direto — e falha se ela não existir lá
 * @property {boolean} [expectDoctorStub]   o doctor DUBLADO rodou neste caso? O CORTE do ciclo:
 *                                          `true` = o caso chega ao passo 2 (o dublê tem de ter
 *                                          rodado); `false` = ele recusa ANTES, e um doctor
 *                                          invocado aqui significaria que a ordem provada não é a
 *                                          que executa.
 */

/** @type {ProofCase[]} */
export const PROOF_CASES = [
  // ── FAMÍLIA C: o PRÉ-REQUISITO 0 (o env do host espelha o template) ───────
  // A imagem está PRESENTE em todos os três, de propósito: o que se prova é que
  // a stack não sobe AINDA ASSIM — e que nada de docker foi sequer tocado.
  {
    id: "env-divergente",
    family: "env-mirror",
    title: "env do host DIVERGENTE + subida normal (a imagem EXISTE e a stack não sobe)",
    registry: "exists",
    env: "divergent",
    expectDoctorStub: false,
    args: [],
    expectExit: 1,
    expectRunnerUp: false,
    expectCompose: 0,
    expectPublish: false,
    expectBlockMsg: true,
    expectMirrorMsg: true,
    expectRegistryHits: 0,
    expectDockerCalls: 0,
    expectMirrorFlags: true,
    expectEnsureFlags: "not",
    why: "o passo 0 recusa ANTES de qualquer outra coisa: a imagem existe e mesmo assim a stack não sobe — e o ZERO de idas ao registry prova a ORDEM (o ensure nem chegou a rodar)",
  },
  {
    id: "env-divergente-check-only",
    family: "env-mirror",
    title: "env do host DIVERGENTE + --check-only",
    registry: "exists",
    env: "divergent",
    expectDoctorStub: false,
    args: ["--check-only"],
    expectExit: 1,
    expectRunnerUp: false,
    expectCompose: 0,
    expectPublish: false,
    expectBlockMsg: true,
    expectMirrorMsg: true,
    expectRegistryHits: 0,
    expectDockerCalls: 0,
    expectMirrorFlags: true,
    expectEnsureFlags: "not",
    why: "o passo 0 não vive só no caminho que sobe: a conferência isolada também recusa, e nenhuma chamada ao docker acontece",
  },
  {
    id: "env-segredo-igual-ao-template",
    family: "env-mirror",
    title: "SEGREDO igual ao placeholder do template (a ASIMETRIA da regra)",
    registry: "exists",
    env: "secret-equal",
    expectDoctorStub: false,
    args: [],
    expectExit: 1,
    expectRunnerUp: false,
    expectCompose: 0,
    expectPublish: false,
    expectBlockMsg: true,
    expectMirrorMsg: true,
    expectRegistryHits: 0,
    expectDockerCalls: 0,
    expectMirrorFlags: true,
    expectEnsureFlags: "not",
    why: "num SEGREDO, IGUALAR é o defeito (o template é comitado): sem este caso, 'recusa qualquer diferença' passaria por 'recusa o que a regra manda' — e um runner com o placeholder NÃO se registra",
  },

  // ── FAMÍLIA A: a subida simples ─────────────────────────────────────────
  {
    id: "check-only",
    family: "image",
    title: "tag AUSENTE + --check-only",
    registry: "missing",
    expectDoctorStub: false,
    args: ["--check-only"],
    expectExit: EXIT.MISSING,
    expectRunnerUp: false,
    expectCompose: 0,
    expectPublish: false,
    expectBlockMsg: false,
    expectMirrorFlags: true,
    expectEnsureFlags: "invoked",
    why: "a ausência CONFIRMADA pelo registry nem chega a tocar no docker (exit 4)",
  },
  {
    id: "ausente",
    family: "image",
    title: "tag AUSENTE + subida normal (publisher que 'mente' e releitura que desmente)",
    registry: "missing",
    expectDoctorStub: false,
    args: ["--source", "local"],
    expectExit: EXIT.PUBLISH_FAILED,
    expectRunnerUp: false,
    expectCompose: 0,
    expectPublish: true,
    expectBlockMsg: true,
    expectMirrorFlags: true,
    expectEnsureFlags: "invoked",
    why: "nem um build+push que 'dá certo' sobe o runner: a RELEITURA é a garantia (exit 5)",
  },
  {
    id: "presente",
    family: "image",
    title: "CONTROLE — tag PRESENTE (o env também está EM SINCRONIA)",
    registry: "exists",
    expectDoctorStub: true,
    args: [],
    expectExit: EXIT.OK,
    expectRunnerUp: true,
    expectCompose: null,
    expectPublish: false,
    expectBlockMsg: false,
    // O CONTROLE VALE PARA AS DUAS FAMÍLIAS: este caso roda com o env em
    // sincronia, então ele também é a contra-prova do passo 0 — é o contraste
    // entre ele e a família C que faz de "não subiu" um bloqueio, e não um
    // script quebrado.
    expectMirrorMsg: false,
    expectMirrorFlags: true,
    expectEnsureFlags: "invoked",
    expectDoctorArgs: { giteaEnv: true, noRunnerLabels: false },
    expectDoctorBeforeStack: true,
    why: "com a tag presente E o env em sincronia a stack SOBE o runner — é isto que faz do 'não subiu' uma prova (vale para a imagem e para o passo 0), e não um script quebrado",
  },

  // ── FAMÍLIA B: o RE-REGISTRO (o caminho que troca os labels) ────────────
  // Aqui o risco é maior que na subida simples: o re-registro APAGA o registro
  // gravado antes de subir. Sem imagem, apagar seria destruir o que funciona; e
  // com um registro que não sai, subir significaria rodar com os labels ANTIGOS
  // (tier-1 desligado, sem sintoma).
  {
    id: "re-register-sem-imagem",
    family: "re-register",
    title: "tag AUSENTE + --re-register (a falha da garantia NÃO pode destruir o registro)",
    registry: "missing",
    expectDoctorStub: false,
    args: ["--re-register", "--source", "local"],
    volume: "removable",
    expectExit: EXIT.PUBLISH_FAILED,
    expectRunnerUp: false,
    expectCompose: 0,
    expectPublish: true,
    expectBlockMsg: true,
    expectRemoval: false,
    expectVolumeRm: false,
    expectMirrorFlags: true,
    expectEnsureFlags: "invoked",
    why: "sem a imagem garantida o re-registro nem começa: nenhum 'compose rm' e nenhum 'volume rm' — a garantia falha SEM levar consigo o registro que está funcionando",
  },
  {
    id: "re-register",
    family: "re-register",
    title: "CONTROLE — tag PRESENTE + --re-register (ordem rm → volume rm → up)",
    registry: "exists",
    expectDoctorStub: true,
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
    expectMirrorFlags: true,
    expectEnsureFlags: "invoked",
    expectDoctorArgs: { giteaEnv: true, noRunnerLabels: true },
    expectDoctorBeforeStack: true,
    why: "o registro gravado é apagado ANTES de o runner subir — invertida a ordem, o runner voltaria com os labels ANTIGOS e o tier-1 seguiria desligado, em silêncio",
  },
  {
    id: "re-register-primeira-vez",
    family: "re-register",
    title: "tag PRESENTE + --re-register sem registro anterior (primeira subida)",
    registry: "exists",
    expectDoctorStub: true,
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
    expectMirrorFlags: true,
    expectEnsureFlags: "invoked",
    expectDoctorArgs: { giteaEnv: true, noRunnerLabels: true },
    why: "sem volume do registro o comando não exige nada a apagar — a ausência do volume não é erro (o 'volume rm' só aparece quando há o que apagar)",
  },
  {
    id: "re-register-registro-preso",
    family: "re-register",
    title: "tag PRESENTE + registro que NÃO sai (volume em uso)",
    registry: "exists",
    expectDoctorStub: true,
    args: ["--re-register"],
    volume: "stuck",
    expectExit: 1,
    expectRunnerUp: false,
    expectCompose: null,
    expectPublish: false,
    expectBlockMsg: false,
    expectRemoval: true,
    expectVolumeRm: true,
    expectMirrorFlags: true,
    expectEnsureFlags: "invoked",
    expectDoctorArgs: { giteaEnv: true, noRunnerLabels: true },
    expectDoctorBeforeStack: true,
    why: "o runner NÃO sobe com o registro velho: se o volume do registro sobrevive, o script prefere falhar a re-registrar em silêncio",
  },

  // ── FAMÍLIA D: AS INSTRUÇÕES (o que o operador COPIA) ───────────────────
  // A pergunta aqui não é "o documento menciona o bring-up?" (isso é o guard de
  // texto) e sim "o comando que ele manda copiar FUNCIONA?". O caso extrai a
  // instrução do documento e a RODA; se ela sumir de lá, o caso fica vermelho
  // dizendo que o instalador/runbook deixou de ensinar o caminho.
  {
    id: "installer-check-only",
    family: "instructions",
    title:
      "a instrução --check-only do INSTALADOR, rodada VERBATIM (o caminho que se copia confere e não sobe nada)",
    registry: "exists",
    invocation: "installer-check-only",
    expectDoctorStub: true,
    args: [],
    expectExit: EXIT.OK,
    expectRunnerUp: false,
    expectCompose: 0,
    expectPublish: false,
    expectBlockMsg: false,
    expectMirrorMsg: false,
    expectMirrorFlags: true,
    expectEnsureFlags: "invoked",
    expectDoctorArgs: { giteaEnv: true },
    why: "a instrução que o instalador imprime é EXTRAÍDA dele e executada com os `$GITEA_DIR`/`$REPO_DIR` dele: o caminho que o operador copia passa pelos três pré-requisitos e NÃO sobe nada — 'menciona o gitea-up.sh' não distinguia isso de um comando quebrado",
  },
  {
    id: "installer-subida",
    family: "instructions",
    title:
      "a instrução de SUBIDA do INSTALADOR, rodada VERBATIM (sobe a stack pelo caminho que ele imprime)",
    registry: "exists",
    invocation: "installer-full",
    expectDoctorStub: true,
    args: [],
    expectExit: EXIT.OK,
    expectRunnerUp: true,
    expectCompose: null,
    expectPublish: false,
    expectBlockMsg: false,
    expectMirrorMsg: false,
    expectMirrorFlags: true,
    expectEnsureFlags: "invoked",
    expectDoctorArgs: { giteaEnv: true, noRunnerLabels: false },
    expectDoctorBeforeStack: true,
    why: "a OUTRA instrução do instalador (a que sobe) também é executada: com ela a stack sobe — o `COMPOSE_FILE=$GITEA_DIR/docker-compose.yml` que ela exporta resolve no arquivo que o instalador copia (passo 4), e o veredito de prontidão vem ANTES de qualquer `up`",
  },
  {
    id: "runbook-re-register",
    family: "instructions",
    title: "as FLAGS do RUNBOOK (--re-register), executadas contra o registry de teste",
    registry: "exists",
    invocation: "runbook",
    volume: "removable",
    expectDoctorStub: true,
    args: [],
    expectExit: EXIT.OK,
    expectRunnerUp: true,
    expectCompose: null,
    expectPublish: false,
    expectBlockMsg: false,
    expectMirrorMsg: false,
    expectRemoval: true,
    expectVolumeRm: true,
    expectOrder: true,
    expectMirrorFlags: true,
    expectEnsureFlags: "invoked",
    expectDoctorArgs: { giteaEnv: true, noRunnerLabels: true },
    expectDoctorBeforeStack: true,
    why: "as flags saem do bloco CERCADO do `deploy/GITEA.md` (o que se copia) e são executadas: o comando que o runbook ensina re-registra DE FATO (apaga o registro antes de subir) e passa `--no-runner-labels` ao doctor — a prosa podia citar `--re-register` e ainda ensinar uma flag que o bring-up recusa",
  },

  // ── FAMÍLIA: --no-runner (sobe Gitea+Caddy, pula pré-requisitos do runner) ──
  // O `--no-runner` existe para quem só quer o Gitea no ar sem tocar no runner:
  // o env não é conferido, a imagem não é garantida, o doctor não roda. É o
  // caminho rápido — e a prova é que Gitea+Caddy subam enquanto o runner
  // NÃO sobe, com ZERO chamadas ao docker para o runner.
  {
    id: "no-runner",
    family: "no-runner",
    title: "--no-runner: Gitea+Caddy sobem, runner NÃO sobe (ZERO chamadas ao runner)",
    registry: "exists",
    args: ["--no-runner"],
    expectDoctorStub: false,
    expectExit: 0,
    expectRunnerUp: false,
    expectCompose: 1,
    expectPublish: false,
    expectBlockMsg: false,
    expectMirrorMsg: false,
    expectRegistryHits: 0,
    expectDockerCalls: 1,
    expectMirrorFlags: false,
    expectEnsureFlags: "not",
    why: "o --no-runner pula os TRÊS pré-requisitos do runner (env, imagem, doctor) — o único compose que acontece é o de gitea+caddy, e o runner NÃO sobe",
  },

  // ── FAMÍLIA: combinações contraditórias ──────────────────────────────────
  // O `gitea-up.sh` recusa explicitamente estas duas combinações: uma flags
  // diz "subir" e a outra diz "não subir" — sem um recurso de precedência
  // silenciosa. O caso prova que o exit happens ANTES de qualquer docker: ZERO
  // chamadas, ZERO idas ao registry. O docker exists no PATH é irrelevante;
  // a recusa é do bring-up, não do docker.
  {
    id: "re-register-check-only",
    family: "contradiction",
    title: "--re-register + --check-only (um re-registra, o outro não toca em nada)",
    registry: "exists",
    args: ["--re-register", "--check-only"],
    expectDoctorStub: false,
    expectExit: 1,
    expectRunnerUp: false,
    expectCompose: 0,
    expectPublish: false,
    expectBlockMsg: false,
    expectRegistryHits: 0,
    expectDockerCalls: 0,
    why: "o bring-up recusa ANTES de qualquer docker: --re-register pressupõe subir o runner e apagar o registro, mas --check-only não toca em nada — as duas flags se anulam",
  },
  {
    id: "re-register-no-runner",
    family: "contradiction",
    title: "--re-register + --no-runner (um sobe o runner, o outro o deixa de fora)",
    registry: "exists",
    args: ["--re-register", "--no-runner"],
    expectDoctorStub: false,
    expectExit: 1,
    expectRunnerUp: false,
    expectCompose: 0,
    expectPublish: false,
    expectBlockMsg: false,
    expectRegistryHits: 0,
    expectDockerCalls: 0,
    why: "o bring-up recusa ANTES de qualquer docker: --re-register quer subir o runner (apagando o registro), mas --no-runner diz que o runner não vai subir — o bring-up escolhe NÃO agir em silêncio",
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
 * O valor que segue uma flag no argv — `null` se a flag não está lá (ou é a
 * última). É o que transforma "o bring-up passa --gitea-env" de asserção sobre o
 * texto em medida do argv recebido.
 *
 * @param {string[]|null} args
 * @param {string} flag
 * @returns {string|null}
 */
function argValue(args, flag) {
  if (!Array.isArray(args)) return null
  const at = args.indexOf(flag)
  return at === -1 || at + 1 >= args.length ? null : args[at + 1]
}

/**
 * Duas formas de caminho são o MESMO arquivo?
 *
 * Não é igualdade de string de propósito: o valor pode vir do Node (forma nativa
 * do SO) ou da EXPRESSÃO da instrução extraída do instalador — e no Windows as
 * duas diferem em separador e prefixo de drive. Quando o caminho existe,
 * `realpath` resolve os dois para a mesma forma; quando não, exigimos o MESMO
 * nome de arquivo dentro do MESMO diretório imediato (nos casos da prova esse
 * diretório tem um sufixo aleatório, então o critério distingue "o arquivo desta
 * subida" de "outro arquivo" — o que ele NÃO distingue é um caminho mangled pelo
 * shell que preserve a cauda; é o preço de rodar também no Windows).
 *
 * @param {string} received
 * @param {string} expected
 * @returns {boolean}
 */
export function sameFile(received, expected) {
  if (typeof received !== "string" || typeof expected !== "string") return false
  if (received === expected) return true
  const canon = (p) => {
    try {
      return realpathSync(p)
    } catch {
      return null
    }
  }
  const a = canon(received)
  const b = canon(expected)
  if (a !== null && b !== null) {
    return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b
  }
  const norm = (p) => p.replace(/\\/g, "/").replace(/\/{2,}/g, "/")
  const na = norm(received)
  const nb = norm(expected)
  if (na === nb) return true
  const tail = (p) => p.split("/").filter(Boolean).slice(-2).join("/")
  return na.endsWith(`/${tail(nb)}`) || nb.endsWith(`/${tail(na)}`)
}

/**
 * Monta a INVOCAÇÃO do caso: o bring-up direto, ou a INSTRUÇÃO que o documento
 * manda o operador rodar.
 *
 * - `installer-*`  a instrução é EXTRAÍDA do instalador e executada com
 *   `$GITEA_DIR`/`$REPO_DIR` resolvidos para diretórios reais (o instalador copia
 *   o compose para `$GITEA_DIR/docker-compose.yml` e cria `$GITEA_DIR/.env` — é
 *   esse estado que a instrução pressupõe, e é ele que o caso monta);
 * - `runbook`      as FLAGS saem do bloco cercado do `deploy/GITEA.md` e são
 *   passadas ao bring-up; o env é o da prova (o caminho do VPS não existe aqui).
 *
 * @returns {{args: string[], env: Record<string,string>, envFile: string, checkOnly: boolean,
 *   invocation: string|null, errors: string[]}}
 */
function prepareInvocation(testCase, { cwd, tmp, envFile }) {
  /** @type {{args: string[], env: Record<string,string>, envFile: string, checkOnly: boolean, invocation: string|null, errors: string[]}} */
  const direct = {
    args: [join(cwd, BRING_UP), "--env-file", envFile, ...testCase.args],
    env: {},
    envFile,
    checkOnly: testCase.args.includes("--check-only"),
    invocation: null,
    errors: [],
  }
  if (!testCase.invocation) return direct

  if (testCase.invocation === "runbook") {
    const { flags, errors } = runbookInvocation(readFileSync(join(cwd, RUNBOOK), "utf8"))
    if (errors.length > 0) return { ...direct, errors }
    return {
      args: [join(cwd, BRING_UP), "--env-file", envFile, ...flags],
      env: {},
      envFile,
      checkOnly: flags.includes("--check-only"),
      invocation: `runbook ${flags.join(" ")}`,
      errors: [],
    }
  }

  const wantsCheckOnly = testCase.invocation === "installer-check-only"
  const { full, checkOnly, missing } = installerInstructions(
    readFileSync(join(cwd, SETUP_SCRIPT), "utf8"),
  )
  const wanted = wantsCheckOnly ? checkOnly : full
  if (!wanted) return { ...direct, errors: [wantsCheckOnly ? missing.checkOnly : missing.full] }
  const giteaDir = join(tmp, "gitea")
  mkdirSync(giteaDir, { recursive: true })
  copyFileSync(
    join(cwd, "deploy", "docker-compose.gitea.yml"),
    join(giteaDir, "docker-compose.yml"),
  )
  copyFileSync(envFile, join(giteaDir, ".env"))
  const resolved = resolveInstruction(wanted, { giteaDir, repoDir: cwd })
  if (resolved.errors.length > 0) return { ...direct, errors: resolved.errors }
  return {
    args: [resolved.script, ...resolved.flags],
    env: resolved.env,
    envFile: join(giteaDir, ".env"),
    checkOnly: resolved.flags.includes("--check-only"),
    invocation: `${testCase.invocation} — ${wanted.raw}`,
    errors: [],
  }
}

/**
 * O resultado de um caso que NÃO PÔDE ser executado: a instrução não foi
 * encontrada no documento, ou não deu para resolvê-la.
 *
 * POR QUE NÃO SEGUIR COM AS OUTRAS ASSERÇÕES: medir "exit null" e "o runner não
 * subiu" sobre uma invocação que não existiu encheria o relatório de falhas
 * DERIVADAS e esconderia a causa — a única coisa que importa aqui é o motivo, e
 * ele já vem pronto de quem extraiu a instrução.
 *
 * @returns {ProofCaseResult}
 */
function notRun(testCase, { failures, registryHits }) {
  return {
    id: testCase.id,
    title: testCase.title,
    why: testCase.why,
    ok: false,
    failures,
    exit: null,
    expectedExit: testCase.expectExit,
    runnerUp: false,
    composeCalls: 0,
    published: false,
    registryHits,
    family: testCase.family,
    dockerCalls: 0,
    doctorStubCalls: 0,
    expectDoctorStub: testCase.expectDoctorStub ?? null,
    mirrorRefused: false,
    reRegister: testCase.expectRemoval !== undefined,
    removal: false,
    volumeRm: false,
    orderOk: false,
    mirrorArgs: null,
    ensureArgs: null,
    doctorArgs: null,
    invokedAs: null,
    flags: { mirror: null, ensure: null, doctor: null },
    doctorBeforeStack: null,
    tail: "",
  }
}

/**
 * Roda um caso: registry de teste + env + a instrução (`gitea-up.sh` real, ou a
 * que o instalador/runbook manda) com PATH preparado.
 *
 * @returns {Promise<ProofCaseResult>} o resultado do caso, pronto para o relatório
 */
async function runCase(testCase, { cwd, bash, spawn }) {
  const tmp = mkdtempSync(join(tmpdir(), `prove-gate-${testCase.id}-`))
  const registry = await startTestRegistry(testCase.registry)
  try {
    const fake = makeFakeBin(tmp, { volume: testCase.volume, cwd })
    const {
      binDir,
      doctorStub,
      mirrorSpy,
      ensureSpy,
      doctorCalls,
      mirrorCalls,
      ensureCalls,
      dockerCalls,
      trace,
    } = fake
    const host = writeProofEnv(tmp, registry.url, testCase.env ?? "sync")
    const templateFile = host.templateFile

    const invocation = prepareInvocation(testCase, { cwd, tmp, envFile: host.envFile })
    const envFile = invocation.envFile
    if (invocation.errors.length > 0) {
      return notRun(testCase, { failures: invocation.errors, registryHits: registry.hits.length })
    }

    const res = await runProcess(spawn, bash, invocation.args, {
      cwd,
      env: {
        ...process.env,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
        // O template GÊMEO do env de teste (ver writeProofEnv): sem ele o
        // passo 0 acusaria a divergência do harness, não a do repo.
        TEMPLATE_FILE: templateFile,
        // O doctor dublado (ver `makeFakeBin`): a prova mede o bloqueio da
        // IMAGEM, e o doctor roda a própria prova. O dublê é o corte
        // PRIMÁRIO do ciclo; FORGE_DOCTOR_NESTED é a DEFESA EM
        // PROFUNDIDADE — se o stub falhar, o doctor recusa em vez de recursar.
        DOCTOR_SCRIPT: doctorStub,
        FORGE_DOCTOR_NESTED: "1",
        // Os ESPIÕES (ver `makeFakeBin`): medem o argv que o bring-up passa ao
        // mirror e ao ensure, delegando ao script REAL.
        MIRROR_SCRIPT: mirrorSpy,
        ENSURE_SCRIPT: ensureSpy,
        // O healthcheck do Gitea esperaria até 180s por um Gitea que não existe:
        // 1s (que vira ZERO iterações) tira a espera sem tirar o caminho.
        HEALTH_TIMEOUT: "1",
        // A instrução do instalador exporta o próprio ENV_FILE/COMPOSE_FILE (é
        // isso que ela CARREGA) — o resto do env do caso vem do processo.
        ...invocation.env,
      },
    })

    const calls = dockerCalls()
    const doctorRuns = doctorCalls()
    const mirrorRuns = mirrorCalls()
    const ensureRuns = ensureCalls()
    const traceEntries = trace()
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
      failures.push(
        // A invocação entra na mensagem quando ela veio de um DOCUMENTO: sem
        // isso, "exit 1 — esperado 0" num caso do runbook não diria que o exit
        // saiu da FLAG que a doc ensinou.
        `exit ${res.status} — esperado ${testCase.expectExit}${invocation.invocation ? ` (a invocação veio de: ${invocation.invocation})` : ""}`,
      )
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
    // ── FAMÍLIA C: o que só o COMPORTAMENTO diz sobre o passo 0 ────────────
    if (testCase.expectMirrorMsg === true && !out.includes("NÃO espelha o template comitado")) {
      failures.push(
        "a saída NÃO traz a recusa do passo 0 ('NÃO espelha o template comitado') — a stack não subiu, mas por outro motivo",
      )
    }
    if (testCase.expectMirrorMsg === false && out.includes("NÃO espelha o template comitado")) {
      failures.push(
        "o controle recusou com o env EM SINCRONIA — a recusa viria do harness, não do repositório",
      )
    }
    if (
      testCase.expectRegistryHits !== undefined &&
      registry.hits.length !== testCase.expectRegistryHits
    ) {
      failures.push(
        `${registry.hits.length} ida(s) ao registry — esperado ${testCase.expectRegistryHits}: com zero o ensure NEM RODOU, e é isso que prova que a recusa veio ANTES dele (a ORDEM), não depois`,
      )
    }
    if (testCase.expectDockerCalls !== undefined && calls.length !== testCase.expectDockerCalls) {
      failures.push(
        `${calls.length} chamada(s) ao binário 'docker' — esperado ${testCase.expectDockerCalls} (nenhuma parte da stack deveria ter sido tocada): ${calls.join(" | ")}`,
      )
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
    // ── O CORTE DO CICLO ────────────────────────────────────────────────
    // A cadeia bring-up → doctor → prova → bring-up só é finita porque o doctor
    // DO FILHO é o dublê. Aqui isso deixa de ser uma afirmação sobre o código:
    // se este caso chega ao passo 2, o log do dublê TEM de ter a invocação. Sem
    // esta asserção, apagar a dublagem do env do filho passaria despercebido —
    // até o dia em que a cadeia não terminasse.
    if (testCase.expectDoctorStub === true && doctorRuns.length === 0) {
      failures.push(
        "o doctor DUBLADO não foi invocado (log vazio): o passo 2 chamou OUTRO doctor — e o ciclo bring-up → doctor → prova perde o corte que o torna finito",
      )
    }
    if (testCase.expectDoctorStub === false && doctorRuns.length > 0) {
      failures.push(
        `o caso recusa ANTES do passo 2 e mesmo assim o doctor foi invocado (${doctorRuns.length}x) — a ordem que este caso prova não é a que executa`,
      )
    }
    if (testCase.expectOrder && !orderOk) {
      failures.push(
        removal && runnerUp
          ? "o runner subiu ANTES de o registro ser apagado ('up -d runner' antes de 'rm -sf runner') — subiria com os labels ANTIGOS, e nada acusaria"
          : "não deu para conferir a ordem 'rm -sf runner' → 'up -d runner' (faltou uma das duas chamadas)",
      )
    }

    // ── AS FLAGS RECEBIDAS ──────────────────────────────────────────────
    // O bring-up AFIRMA no texto que passa `--host`/`--template` ao espelho,
    // `--gitea-env` ao ensure e ao doctor, `--check` no `--check-only` e
    // `--no-runner-labels` no `--re-register`. Aqui as flags deixam de ser uma
    // afirmação sobre o script: são o ARGV GRAVADO pelo processo que rodou — o
    // espião do espelho, o do ensure e o dublê do doctor. Mutar o bring-up para
    // não passá-las derruba estes casos, e o relatório mostra a linha recebida.
    //
    // E a ORDEM `always (o ensure não roda quando o espelho recusa) deixa de ser
    // inferida do `expectRegistryHits`/`expectDockerCalls`: o caso diz, em uma
    // linha, se o passo 1 PODIA ter rodado.
    const mirrorArgs = mirrorRuns[0] ?? null
    const ensureArgs = ensureRuns[0] ?? null
    const doctorArgs = doctorRuns[0] ?? null
    const expectedSource = argValue(testCase.args, "--source") ?? "auto"
    let doctorBeforeStack = null

    if (testCase.expectMirrorFlags) {
      if (!mirrorArgs) {
        failures.push(
          `o guard do espelho (${MIRROR_SCRIPT}) NÃO foi invocado — sem ele o env do host não é conferido nesta subida (e a ordem 'espelho antes do ensure' não tem o que provar)`,
        )
      } else {
        const hostFlag = argValue(mirrorArgs, "--host")
        const tplFlag = argValue(mirrorArgs, "--template")
        if (hostFlag === null || tplFlag === null) {
          failures.push(
            `o guard do espelho recebeu '${mirrorArgs.join(" ")}' — sem --host E --template a descoberta pode achar outro arquivo e a comparação mede outra coisa que não esta subida`,
          )
        } else {
          if (!sameFile(hostFlag, envFile)) {
            failures.push(
              `o espelho conferiu '${hostFlag}' e esta subida usa '${envFile}' — a comparação mediu outro arquivo`,
            )
          }
          if (!sameFile(tplFlag, templateFile)) {
            failures.push(
              `o espelho comparou contra '${tplFlag}' e o template desta prova é '${templateFile}' — 'o que o repositório declara' seria outro arquivo`,
            )
          }
        }
      }
    }
    if (testCase.expectEnsureFlags === "not" && ensureArgs) {
      failures.push(
        `o ensure FOI invocado ('${ensureArgs.join(" ")}') e este caso recusa ANTES do passo 1 — a ordem que ele prova (o espelho primeiro) não é a que executa`,
      )
    }
    if (testCase.expectEnsureFlags === "invoked") {
      if (!ensureArgs) {
        failures.push(
          `o ensure (${ENSURE_SCRIPT}) NÃO foi invocado — sem a garantia a subida dependeria de a tag existir por sorte`,
        )
      } else {
        if (ensureArgs.includes("--env-file")) {
          failures.push(
            `o ensure recebeu --env-file ('${ensureArgs.join(" ")}'): é flag do PRÓPRIO Node e o runtime a consome antes do script — com o arquivo ausente o processo morreria em exit 9, sem a mensagem do bring-up`,
          )
        }
        const giteaEnv = argValue(ensureArgs, "--gitea-env")
        if (giteaEnv === null || !sameFile(giteaEnv, envFile)) {
          failures.push(
            `o ensure recebeu ${giteaEnv === null ? "sem --gitea-env" : `--gitea-env '${giteaEnv}'`} e esta subida usa '${envFile}' — ele garantiria a imagem de OUTRO env`,
          )
        }
        const source = argValue(ensureArgs, "--source")
        if (source !== expectedSource) {
          failures.push(
            `o ensure recebeu ${source === null ? "sem --source" : `--source '${source}'`} — esperado '${expectedSource}' (o modo desta subida)`,
          )
        }
        if (ensureArgs.includes("--check") !== invocation.checkOnly) {
          failures.push(
            `o ensure ${ensureArgs.includes("--check") ? "recebeu --check" : "NÃO recebeu --check"} e a invocação deste caso ${invocation.checkOnly ? "é" : "não é"} --check-only — a conferência e o resultado sairiam desalinhados`,
          )
        }
      }
    }
    if (testCase.expectDoctorArgs) {
      const want = testCase.expectDoctorArgs
      if (!doctorArgs) {
        failures.push(
          `o doctor DUBLADO não foi invocado — sem veredito não há prontidão, e a subida aconteceria assim mesmo`,
        )
      } else {
        const giteaEnv = argValue(doctorArgs, "--gitea-env")
        if (want.giteaEnv && (giteaEnv === null || !sameFile(giteaEnv, envFile))) {
          failures.push(
            `o doctor recebeu ${giteaEnv === null ? "sem --gitea-env" : `--gitea-env '${giteaEnv}'`} e esta subida usa '${envFile}' — o veredito mediria outro arquivo`,
          )
        }
        if (want.noRunnerLabels === true && !doctorArgs.includes("--no-runner-labels")) {
          failures.push(
            `o doctor NÃO recebeu --no-runner-labels ('${doctorArgs.join(" ")}'): o registro gravado velho é exatamente o que este modo conserta — o remédio ficaria travado pelo estado que ele cura`,
          )
        }
        if (want.noRunnerLabels === false && doctorArgs.includes("--no-runner-labels")) {
          failures.push(
            `a subida normal passou --no-runner-labels ('${doctorArgs.join(" ")}'): o registro gravado deixaria de ser conferido sem que nada estivesse consertando-o`,
          )
        }
      }
    }
    if (testCase.expectDoctorBeforeStack) {
      const doctorAt = traceEntries.findIndex((e) => e.tag === "doctor")
      const giteaUpAt = traceEntries.findIndex(
        (e) => e.tag === "docker" && e.line.includes("up -d gitea"),
      )
      doctorBeforeStack = doctorAt !== -1 && giteaUpAt !== -1 && doctorAt < giteaUpAt
      if (!doctorBeforeStack) {
        failures.push(
          `a ORDEM 'doctor ANTES de qualquer up' não se sustenta no registro ordenado (doctor na posição ${doctorAt}, 'up -d gitea' na ${giteaUpAt}) — a stack subiria mesmo com um veredito que ainda não existia (ou BLOQUEADO)`,
        )
      }
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
      family: testCase.family,
      dockerCalls: calls.length,
      doctorStubCalls: doctorRuns.length,
      expectDoctorStub: testCase.expectDoctorStub ?? null,
      mirrorRefused: out.includes("NÃO espelha o template comitado"),
      reRegister: testCase.expectRemoval !== undefined,
      removal,
      volumeRm,
      orderOk,
      mirrorArgs,
      ensureArgs,
      doctorArgs,
      invokedAs: invocation.invocation,
      doctorBeforeStack,
      // A linha que cada filho RECEBEU — é o que o relatório cita como evidência.
      flags: {
        mirror: mirrorArgs ? mirrorArgs.join(" ") : null,
        ensure: ensureArgs ? ensureArgs.join(" ") : null,
        doctor: doctorArgs ? doctorArgs.join(" ") : null,
      },
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
        ? "com a tag ausente o runner NÃO sobe (subida e re-registro) e, com a tag presente, sobe (controles) — no re-registro o registro antigo é apagado ANTES de subir; com o env do host DIVERGENTE o passo 0 RECUSA antes de qualquer docker (sem tocar no registry); e as INSTRUÇÕES do instalador e do runbook são EXTRAÍDAS dos documentos e EXECUTADAS — o comando que o operador copia funciona, com as flags medidas no argv de cada filho (--host/--template no espelho, --gitea-env no ensure e no doctor, e --no-runner-labels no --re-register)"
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
  // Agrupado por FAMÍLIA: cada uma responde uma pergunta diferente, e um caso
  // fora do grupo é um caso lido como se respondesse a outra coisa (o total
  // sozinho não deixa ver QUAL promessa caiu).
  for (const family of PROOF_FAMILIES) {
    const cases = result.cases.filter((c) => c.family === family.id)
    if (cases.length === 0) continue
    const broken = cases.filter((c) => !c.ok).length
    line()
    line(
      `  ${C.cyan}${family.title}${C.nc} — ${cases.length} caso(s), ${broken === 0 ? "todos ok" : `${C.red}${broken} com problema${C.nc}`}`,
    )
    for (const c of cases) {
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
      // No passo 0 o que importa é o ANTES: nenhuma chamada ao docker e nenhuma
      // ida ao registry dizem que a recusa veio antes de tudo.
      if (c.family === "env-mirror") {
        parts.push(`${c.dockerCalls} chamada(s) ao docker`)
        parts.push(`${c.registryHits} ida(s) ao registry`)
      }
      // O CORTE DO CICLO, visível: quem roda o doctor por último é o DUBLÊ — é
      // ele que faz de `bring-up → doctor → prova → bring-up` uma cadeia finita.
      if (c.expectDoctorStub !== null) {
        parts.push(
          c.expectDoctorStub
            ? `doctor DUBLADO invocado (${c.doctorStubCalls}x) — o corte do ciclo`
            : "parou ANTES do passo 2 · doctor não invocado",
        )
      }
      line(`    ${mark} ${c.title}`)
      line(`         ${parts.join(" · ")}`)
      // O ARGV RECEBIDO por cada filho — a evidência de que as flags exigidas
      // foram MEDIDAS (no processo que rodou), não lidas no texto do bring-up.
      const received = [
        c.invokedAs ? `invocado por ${c.invokedAs}` : null,
        c.flags?.mirror ? `espelho: ${c.flags.mirror}` : null,
        c.flags?.ensure ? `ensure: ${c.flags.ensure}` : null,
        c.flags?.doctor ? `doctor: ${c.flags.doctor}` : null,
      ].filter(Boolean)
      if (received.length > 0) line(`         ▸ argv recebido — ${received.join(" · ")}`)
      line(`         ${C.cyan}▸${C.nc} ${c.why}`)
      for (const f of c.failures) line(`         ${C.red}✗${C.nc} ${f}`)
      if (c.tail) for (const l of c.tail.split("\n")) line(`           ${l}`)
    }
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
