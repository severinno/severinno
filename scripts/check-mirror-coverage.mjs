#!/usr/bin/env node

// =============================================================================
// check-mirror-coverage.mjs
//
// A COBERTURA DO RECORTE DO COMMIT, derivada das TABELAS-FONTE dos espelhos.
//
// O DEFEITO QUE ISTO MEDE: cada guard de espelho declara a própria tabela de
// "onde o valor está espelhado" (`BUN_MIRRORS`, `IMAGE_MIRRORS`,
// `MIRROR_VARIABLE_RULES`), mas um espelho pode existir SÓ na varredura global —
// e aí um commit que troca ou APAGA aquela linha passa pelo pre-commit (o hook é
// o recorte) e só encontra o defeito no CI, quando encontra. A classe é a mesma
// que o `check-bun-mirror` fechou para o arg do build site e para o
// `packageManager`: o que o commit TIRA não aparece em linha adicionada nenhuma.
//
// POR QUE DERIVADA, E NÃO UMA LISTA À MÃO: a lista de espelhos é lida das
// PRÓPRIAS tabelas — um espelho novo entra na medição no commit em que é
// declarado, e um espelho que perca a linha no arquivo vira `ILEGÍVEL` (nunca
// "nada a medir"). Uma lista à mão divergiria da tabela no primeiro dia e o
// relatório declararia cobertura que não existe.
//
// A MEDIÇÃO É POR EXECUÇÃO, não por leitura:
//   1. num `git worktree` TEMPORÁRIO (o COMMIT PENDENTE — índice + working tree
//      via `git stash create` — com `node_modules` linkado) cada espelho é
//      MUTADO — a troca de valor e a REMOÇÃO da linha — e ESTAGIADO;
//   2. rodam-se os comandos do RECORTE, derivados da `fase_a()` do
//      `.husky/pre-commit` (só os que carregam `--staged`): um guard novo com
//      recorte entra na medição sem editar este arquivo;
//   3. o veredito por espelho é `detectadoPor: [...]` — vazio significa
//      "nenhuma regra no recorte do commit".
//
// O CONTRATO (fail-closed, na mesma direção do resto do repositório): cada
// espelho da tabela tem de DECIDIR — ou declara a regra do recorte
// (`recorte: {comando, regra}`), ou declara a ausência COM O MOTIVO
// (`recorte: null, motivo: "..."`). Um espelho sem decisão é violação: ele é um
// espelho novo que ninguém decidiu como cobrir. E a decisão é CONFERIDA contra a
// medição nos dois sentidos: declaração de regra que a medição não acha, e
// ausência declarada que a medição contradiz (um recorte passou a pegá-lo) são
// ambas violação — a decisão envelhecida é o defeito, não a medição.
//
// O QUE NÃO É MEDIDO AQUI (declarado, e por quê): o espelho do HOST
// (`deploy/.env.gitea`) é GITIGNORED — não existe no commit, então não há
// recorte a julgar (quem o cobre é o `check-env-mirror` no bring-up e o doctor);
// ele entra no relatório com `medivel: false` e o motivo, em vez de sair da
// conta.
//
// Usage:
//   node scripts/check-mirror-coverage.mjs                 # mede todas as tabelas
//   node scripts/check-mirror-coverage.mjs --only registry-source
//   node scripts/check-mirror-coverage.mjs --json          # relatório estruturado
//   node scripts/check-mirror-coverage.mjs -h              # esta ajuda
//
// O CONTROLE (e por que ele existe): antes de mutar qualquer coisa, os comandos
// do recorte rodam na árvore INTACTA. Um comando que falha ali falha por
// AMBIENTE (dependência não instalada, ferramenta fora do PATH) — e contá-lo como
// detector faria de uma suíte vermelha de ambiente uma cobertura verde. Ele sai
// da medição e o processo não termina verde (exit 2): a medição não responde a
// pergunta que ela diz responder.
//
// Exit codes:
//   0 — toda decisão confere com a medição (e nenhum espelho ficou sem decisão)
//   1 — violação: espelho sem decisão, decisão que a medição não confirma, ou
//       declaração de ausência que a medição contradiz
//   2 — falha de infra (worktree, tabela ilegível, comando do recorte ausente)
//       ou CONTROLE vermelho (comando que falha sem mutação: ambiente)
// =============================================================================

import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

import { BUN_MIRRORS } from "./bun-version.mjs"
import { IMAGE_MIRRORS, IMAGE_VARIABLES } from "./registry-source.mjs"
import { GITEA_ENV_DEPLOYED, GITEA_ENV_MIRROR, MIRROR_VARIABLE_RULES } from "./check-actrc-sync.mjs"
import { ENV_MIRROR_TABELA, envMirrors } from "./check-env-mirror.mjs"

/** A raiz do repositório (este arquivo vive em `scripts/`). */
export const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..")

/** O hook de onde os comandos do recorte são DERIVADOS. */
export const HOOK = ".husky/pre-commit"

/** O arquivo do HOST que o compose lê — gitignored, não versionado. */
export const HOST_MIRROR = GITEA_ENV_DEPLOYED[0]

/**
 * Saída da medição e do contrato.
 *
 * @typedef {{tabela: string, variavel: string, arquivo: string, medivel: boolean,
 *            motivoNaoMedivel?: string, recorte: {comando: string, regra: string}|null,
 *            motivo?: string|null, mutacoesIgnoradas?: Record<string, string>,
 *            linha?: string}} EspelhoDeclarado
 * @typedef {{espelho: EspelhoDeclarado, erro?: string, detectadoPor: string[],
 *            mutacoes: {swap: string[], remocao: string[]}}} Medicao
 */

/**
 * Os espelhos de TODAS as tabelas-fonte, na ordem em que são lidos.
 *
 * A derivação cobre as QUATRO tabelas dos guards que julgam espelhos:
 * `BUN_MIRRORS` (a versão do Bun), `IMAGE_MIRRORS` (host e namespace do
 * registry), a lista do `actrc-sync` (`MIRROR_VARIABLE_RULES`, que decide onde
 * cada variável é espelhada) e o `envMirrors()` do `check-env-mirror` (o par
 * template ↔ env do host, derivado das variáveis que o compose consome). O que
 * uma tabela declara e outra não NÃO é reconciliado aqui — cada guard cobra o
 * próprio contrato (`check-actrc-sync` compara os três arrays); aqui o que
 * interessa é a UNIÃO: todo espelho declarado em qualquer tabela entra na
 * medição do recorte, e o relatório diz, POR TABELA, o que ficou sem regra.
 *
 * @returns {EspelhoDeclarado[]}
 */
export function espelhosDeclarados() {
  const espelhos = []
  const vistos = new Set()
  const adiciona = (tabela, variavel, arquivo, decisao) => {
    const chave = `${tabela}|${variavel}|${arquivo}`
    if (vistos.has(chave)) return
    vistos.add(chave)
    espelhos.push({ tabela, variavel, arquivo, medivel: true, ...decisao })
  }

  for (const m of BUN_MIRRORS) {
    adiciona("bun-version", "BUN_VERSION", m.file, decisaoDe(m))
  }
  for (const variavel of IMAGE_VARIABLES) {
    for (const m of IMAGE_MIRRORS[variavel] ?? []) {
      adiciona("registry-source", variavel, m.file, decisaoDe(m))
    }
  }
  for (const [variavel, kinds] of Object.entries(MIRROR_VARIABLE_RULES)) {
    for (const kind of Object.keys(kinds)) {
      const arquivo = kind === "actrc" ? ".actrc" : GITEA_ENV_MIRROR
      adiciona("actrc-sync", variavel, arquivo, decisaoDe(kinds[kind]))
    }
  }
  // A quarta tabela: o par (template comitado ↔ env do host), derivado do
  // COMPOSE — a fonte de "quais nomes importam". Ela traz a variável que
  // nenhuma outra tabela cobre (o segredo) para a conta do recorte.
  for (const e of envMirrors()) {
    adiciona(ENV_MIRROR_TABELA, e.variavel, e.arquivo, e)
  }
  // O espelho do HOST: não versionado, logo fora do commit — entra declarado
  // (com o motivo) em vez de sumir da conta.
  espelhos.push({
    tabela: "actrc-sync",
    variavel: "BUN_VERSION",
    arquivo: HOST_MIRROR,
    medivel: false,
    motivoNaoMedivel:
      "GITIGNORED: não existe no commit, então não há recorte a julgar — quem o cobre é o `check-env-mirror` (bring-up) e o doctor",
    recorte: null,
    motivo:
      "o arquivo do HOST não é versionado; a comparação com o template é do `check-env-mirror`, na máquina onde a stack roda",
  })
  return espelhos
}

/**
 * Os espelhos FÍSICOS: um arquivo (mais a variável) é UM espelho, mesmo quando
 * três tabelas o declaram. A medição roda uma vez por espelho físico — medir
 * três vezes o mesmo arquivo seria custo sem informação —, mas a DECISÃO é
 * conferida por tabela: cada guard responde pelo próprio contrato, e uma tabela
 * que esqueceu de decidir não some atrás das outras.
 *
 * @param {EspelhoDeclarado[]} [espelhos]
 * @returns {{chave: string, variavel: string, arquivo: string, medivel: boolean,
 *            motivoNaoMedivel?: string, tabelas: string[],
 *            decisoes: {tabela: string, recorte: {comando: string, regra: string}|null, motivo: string|null}[]}[]}
 */
export function espelhosFisicos(espelhos = espelhosDeclarados()) {
  const porChave = new Map()
  for (const e of espelhos) {
    const chave = `${e.variavel}|${e.arquivo}`
    const atual = porChave.get(chave) ?? {
      chave,
      variavel: e.variavel,
      arquivo: e.arquivo,
      medivel: e.medivel,
      motivoNaoMedivel: e.motivoNaoMedivel,
      mutacoesIgnoradas: {},
      tabelas: [],
      decisoes: [],
    }
    if (!atual.tabelas.includes(e.tabela)) atual.tabelas.push(e.tabela)
    // Uma tabela que não consegue medir o espelho contamina o físico: o que as
    // duas veem é o MESMO arquivo, e se uma delas declara que a linha não existe
    // no commit (o caso do HOST), a medição do outro lado não inventa uma.
    if (e.medivel === false) {
      atual.medivel = false
      atual.motivoNaoMedivel = atual.motivoNaoMedivel ?? e.motivoNaoMedivel
    }
    for (const [mutacao, motivo] of Object.entries(e.mutacoesIgnoradas ?? {})) {
      atual.mutacoesIgnoradas[mutacao] = `${e.tabela}: ${motivo}`
    }
    atual.decisoes.push({ tabela: e.tabela, recorte: e.recorte, motivo: e.motivo })
    porChave.set(chave, atual)
  }
  return [...porChave.values()]
}

/**
 * A DECISÃO de recorte de uma entrada de tabela.
 *
 * A decisão mora AO LADO do espelho (é a tabela que diz onde o valor é
 * espelhado); este módulo só a lê. Ausência de campo = indecidido = violação
 * (fail-closed): um espelho novo não pode entrar em silêncio sem ninguém
 * decidir se o commit o julga.
 *
 * @param {{recorte?: {comando: string, regra: string}|null, motivo?: string}} entrada
 */
function decisaoDe(entrada) {
  return {
    recorte: entrada.recorte ?? null,
    motivo: entrada.motivo ?? null,
    medivel: entrada.medivel ?? true,
    motivoNaoMedivel: entrada.motivoNaoMedivel,
    mutacoesIgnoradas: entrada.mutacoesIgnoradas,
  }
}

/**
 * Os comandos do RECORTE, derivados da `fase_a()` do hook.
 *
 * Derivar (em vez de listar) é o que impede a medição de virar um relatório: um
 * guard `--staged` novo no hook entra na medição no mesmo commit, e um que saia
 * deixa de ser medido junto.
 *
 * @param {string} hookSource
 * @returns {{nome: string, comando: string}[]}
 */
export function comandosDoRecorte(hookSource) {
  const comandos = []
  for (const raw of hookSource.split(/\r?\n/)) {
    const linha = raw.trim()
    if (linha.startsWith("#") || !linha.includes("--staged")) continue
    const comando = linha
      .replace(/^\w+\(\)\s*\{.*$/, "")
      .replace(/\s*&\s*$/, "")
      .replace(/^\s*if\s+.*?\bthen\s+/, "")
      .trim()
    if (!comando.includes("--staged") || !/^(node|bun|bash)\b/.test(comando)) continue
    const nome = comando.replace(/^node\s+scripts\//, "").replace(/\.mjs.*$/, "")
    // O MESMO comando aparece mais de uma vez no hook (a fase A e a reexecução
    // depois do remédio, por exemplo): rodá-lo duas vezes por mutação mediria a
    // mesma coisa duas vezes e dobraria o custo da medição.
    if (comandos.some((c) => c.comando === comando)) continue
    comandos.push({ nome, comando })
  }
  if (comandos.length === 0) {
    throw new Error(
      `nenhum comando --staged derivado de ${HOOK}: o hook mudou de forma? A cobertura do recorte não tem o que medir.`,
    )
  }
  return comandos
}

/**
 * O valor capturado pela regex da tabela na linha do arquivo — a linha EXATA
 * que a mutação reescreve. `null` = o espelho não está no arquivo (o relatório
 * diz "ILEGÍVEL", nunca "nada a medir").
 *
 * @param {RegExp} re  a regex da tabela (um grupo de captura = o valor)
 * @param {string} content
 * @returns {{linha: string, valor: string}|null}
 */
export function linhaDoEspelho(re, content) {
  const m = re.exec(content)
  if (m === null) return null
  return { linha: m[0], valor: m[1] ?? m[0] }
}

/** O `git` do fixture (worktree temporário). */
function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
}

/**
 * Um worktree TEMPORÁRIO do COMMIT PENDENTE, com o `node_modules` do
 * repositório linkado.
 *
 * POR QUE O PENDENTE E NÃO O HEAD: as TABELAS são lidas VIVAS (o módulo é
 * importado da árvore de quem roda), então um espelho novo aparece na medição no
 * mesmo instante em que é declarado — mas a LINHA dele no arquivo pode ainda não
 * estar commitada. Medindo o HEAD, esse caso (o mais comum de todos: rodar a
 * bateria antes de commitar) sairia como "a tabela declara um espelho que o
 * arquivo não tem" — uma mentira sobre o arquivo, que TEM a linha. `git stash
 * create` sintetiza um commit com o estado do índice + working tree sem mexer em
 * nada (não entra na lista de stashes, não move ref nenhuma; só cria objetos), e
 * a medição passa a julgar o que o COMMIT VAI CONTER. Numa árvore limpa ele não
 * devolve nada e a base continua sendo o HEAD.
 *
 * O LIMITE, declarado: `git stash create` cobre arquivos RASTREADOS. Um espelho
 * em arquivo novo e não rastreado não entra na base (e o espelho nem existiria
 * para o commit antes do `git add`).
 *
 * O `node_modules` é linkado pelo caminho normal de resolução (igual ao
 * `hook-simulator`): um guard que importe uma dependência bare morreria com
 * "module not found" e o não-zero seria do FIXTURE, não do defeito.
 *
 * @param {string} root
 * @returns {{dir: string, limpar: () => void}}
 */
export function worktreeTemporario(root) {
  const dir = mkdtempSync(join(tmpdir(), "mirror-coverage-"))
  // O `git stash create` toma o lock do índice — e o doctor roda os gates CONCORRENTE
  // (a matriz de mutação leva ~18min no mesmo repositório; qualquer outro ator do
  // índice, inclusive um segundo gate, derruba este com "index.lock exists" no
  // primeiro try). Retentativa com ESPERA: 10× de 2s cobre os ~18s do lock mais
  // longo medido; o stderr do último try vai no erro (antes, a causa morria dentro
  // do execFileSync e a mensagem só dizia "Command failed").
  const pendente = (() => {
    const TENTATIVAS = 10
    let ultimoErro
    for (let i = 1; i <= TENTATIVAS; i++) {
      try {
        return git(root, ["stash", "create"]).trim()
      } catch (err) {
        ultimoErro = err
        if (i < TENTATIVAS) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000)
      }
    }
    throw new Error(
      `git stash create falhou após ${TENTATIVAS} tentativas (20s): ${ultimoErro?.stderr ?? ultimoErro?.message ?? ultimoErro}`,
    )
  })()
  git(root, ["worktree", "add", "-q", "--detach", dir, pendente === "" ? "HEAD" : pendente])
  const modulos = join(root, "node_modules")
  if (existsSync(modulos)) {
    try {
      symlinkSync(
        modulos,
        join(dir, "node_modules"),
        process.platform === "win32" ? "junction" : "dir",
      )
    } catch {
      // Um erro aqui é do fixture, não do defeito: o relatório da medição
      // continua, e o comando que precisasse da dependência sai `erro` — dito.
    }
  }
  return {
    dir,
    limpar: () => {
      try {
        git(root, ["worktree", "remove", "--force", dir])
      } catch {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  }
}

/**
 * Mede UM espelho: troca o valor e depois APAGA a linha, estagiando cada
 * mutação e rodando os comandos do recorte. O veredito por mutação é a lista de
 * comandos que FALHARAM (não-zero = a regra mordeu).
 *
 * @param {string} fixture
 * @param {EspelhoDeclarado} espelho
 * @param {{regex: RegExp, comandos: {nome: string, comando: string}[]}} opts
 * @returns {Medicao}
 */
function medirEspelho(fixture, espelho, { regex, comandos, ignoradas = {} }) {
  const abs = join(fixture, espelho.arquivo)
  const base = readFileSync(abs, "utf8")
  const alvo = linhaDoEspelho(regex, base)
  if (alvo === null) {
    return {
      espelho,
      erro: `a linha do espelho não existe em ${espelho.arquivo} — a tabela declara um espelho que o arquivo não tem`,
      detectadoPor: [],
      mutacoes: { swap: [], remocao: [] },
    }
  }
  if (!espelho.medivel) {
    return { espelho, detectadoPor: [], mutacoes: { swap: [], remocao: [] } }
  }
  const mutacoes = { swap: [], remocao: [] }
  const roda = () => {
    const detectores = []
    for (const c of comandos) {
      const r = spawnSync(c.comando, { cwd: fixture, shell: true, encoding: "utf8" })
      if (r.status !== 0) detectores.push(c.nome)
    }
    return detectores
  }
  const estagiar = () => {
    execFileSync("git", ["add", espelho.arquivo], { cwd: fixture, stdio: "ignore" })
  }
  const restaurar = () => {
    execFileSync("git", ["restore", "--staged", espelho.arquivo], { cwd: fixture, stdio: "ignore" })
    execFileSync("git", ["checkout", "--", espelho.arquivo], { cwd: fixture, stdio: "ignore" })
  }

  // A) a TROCA do valor (a linha reescrita com outro valor). Uma tabela pode
  // declarar que esta mutação NÃO é um defeito naquele espelho (o placeholder de
  // um segredo, por exemplo): medir uma mutação que não é defeito inventaria uma
  // lacuna, e a declaração do motivo é o que autoriza o pulo.
  if (!ignoradas.swap) {
    writeFileSync(
      abs,
      base.replace(alvo.linha, alvo.linha.replace(alvo.valor, "VALOR_TROCADO_9.9.9")),
      "utf8",
    )
    estagiar()
    mutacoes.swap = roda()
    restaurar()
  }
  // B) a REMOÇÃO da linha (o que o recorte das linhas `+` não vê)
  if (!ignoradas.remocao) {
    writeFileSync(
      abs,
      base
        .split(/\r?\n/)
        .filter((l) => l !== alvo.linha)
        .join("\n"),
      "utf8",
    )
    estagiar()
    mutacoes.remocao = roda()
    restaurar()
  }

  return {
    espelho,
    detectadoPor: [...new Set([...mutacoes.swap, ...mutacoes.remocao])],
    mutacoes,
  }
}

/**
 * A MEDIÇÃO da cobertura do recorte para os espelhos pedidos.
 *
 * @param {{root?: string, espelhos?: EspelhoDeclarado[], hookSource?: string|null,
 *          regexDe?: ((e: EspelhoDeclarado) => RegExp|null)|null}} [opts]
 * @returns {{medicoes: Medicao[], comandos: {nome: string, comando: string}[],
 *            controle: string[], erros: string[]}}
 */
export function medirCobertura({
  root = ROOT,
  espelhos = espelhosDeclarados(),
  hookSource = null,
  regexDe = null,
} = {}) {
  const fonte = hookSource ?? readFileSync(join(root, HOOK), "utf8")
  const comandos = comandosDoRecorte(fonte)
  const resolve = regexDe ?? regexDaTabela()
  const fisicos = espelhosFisicos(espelhos)
  const wt = worktreeTemporario(root)
  const medicoes = []
  const erros = []
  // O CONTROLE: roda os comandos do recorte ANTES de qualquer mutação, na árvore
  // intacta. Um comando que FALHA aqui falha por AMBIENTE (dependência não
  // instalada, ferramenta fora do PATH), não pelo defeito — e contá-lo como
  // detector transformaria suíte vermelha de ambiente em cobertura verde. Ele sai
  // da medição e o veredito fica INDETERMINADO em vez de falso.
  const controle = []
  try {
    for (const c of comandos) {
      const r = spawnSync(c.comando, { cwd: wt.dir, shell: true, encoding: "utf8" })
      if (r.status !== 0) controle.push(c.nome)
    }
  } catch (err) {
    erros.push(`o CONTROLE não pôde rodar: ${err?.message ?? err}`)
  }
  const confiaveis = comandos.filter((c) => !controle.includes(c.nome))
  try {
    for (const espelho of fisicos) {
      if (!espelho.medivel) continue
      // A regex vem da tabela que declarou o espelho — e QUALQUER uma das
      // tabelas que o declaram serve para achar a MESMA linha física (é o mesmo
      // arquivo e a mesma variável). Duas tabelas apontando para o mesmo
      // espelho com formas diferentes divergiriam na mutação, e é por isso que
      // a busca é a primeira que resolve, não uma regex nova montada aqui.
      const regex =
        espelho.tabelas
          .map((tabela) =>
            resolve({ tabela, variavel: espelho.variavel, arquivo: espelho.arquivo }),
          )
          .find((r) => r !== null) ?? null
      if (regex === null) {
        erros.push(
          `${espelho.variavel}@${espelho.arquivo} (${espelho.tabelas.join(", ")}) — sem regex na tabela: a mutação do espelho não tem como ser montada`,
        )
        continue
      }
      medicoes.push(
        medirEspelho(wt.dir, espelho, {
          regex,
          comandos: confiaveis,
          ignoradas: espelho.mutacoesIgnoradas,
        }),
      )
    }
  } finally {
    wt.limpar()
  }
  return { medicoes, comandos, controle, erros }
}

/**
 * A regex da LINHA de um espelho, vinda da tabela que o declarou — nunca uma
 * regex nova (duas formas de achar a mesma linha divergiriam no primeiro dia).
 *
 * @returns {(espelho: EspelhoDeclarado) => RegExp|null}
 */
export function regexDaTabela() {
  const deBun = new Map(BUN_MIRRORS.map((m) => [m.file, m.line]))
  const deImage = new Map()
  for (const variavel of IMAGE_VARIABLES) {
    for (const m of IMAGE_MIRRORS[variavel] ?? []) deImage.set(`${variavel}|${m.file}`, m.line)
  }
  return (espelho) => {
    if (espelho.tabela === "bun-version") return deBun.get(espelho.arquivo) ?? null
    if (espelho.tabela === "registry-source") {
      const direto = deImage.get(`${espelho.variavel}|${espelho.arquivo}`)
      if (direto) return direto
      return montaLinhaEnv(espelho.variavel)
    }
    if (espelho.tabela === "actrc-sync" || espelho.tabela === ENV_MIRROR_TABELA) {
      return espelho.arquivo === ".actrc"
        ? new RegExp(`^--var ${espelho.variavel}=(.+)$`, "m")
        : montaLinhaEnv(espelho.variavel)
    }
    return null
  }
}

/** A forma `KEY=valor` do env (o prefixo `--var` é do `.actrc`). */
function montaLinhaEnv(variavel) {
  return new RegExp(`^${variavel}=(.+)$`, "m")
}

/**
 * O CONTRATO: cada espelho decide, e a decisão confere com a medição.
 *
 * `opts.regexDe` é o resolvedor de linha (default: o das tabelas reais) e
 * `opts.controle` são os comandos que falharam SEM mutação (ambiente).
 *
 * @param {Medicao[]} medicoes
 * @param {EspelhoDeclarado[]} todos
 * @param {{regexDe?: ((e: EspelhoDeclarado) => RegExp|null)|null, controle?: string[]}} [opts]
 * @returns {string[]} violações (vazio = cobertura honesta)
 */
export function violacoesDeCobertura(
  medicoes,
  todos = espelhosDeclarados(),
  { regexDe = null, controle = [] } = {},
) {
  const violacoes = []
  const resolve = regexDe ?? regexDaTabela()
  const semAmbiente = new Set(controle)
  for (const espelho of todos) {
    const onde = `${espelho.tabela}:${espelho.variavel}@${espelho.arquivo}`
    // A AUSÊNCIA do campo é indecidido, como o valor `null`: uma tabela que
    // declara um espelho sem dizer nada sobre o recorte não pode ser lida como
    // "regra declarada" (o `undefined` passaria por `!== null` e estouraria o
    // relatório em vez de acusar a lacuna).
    const recorte = espelho.recorte ?? null
    const motivo = espelho.motivo ?? null
    if (recorte === null && !motivo) {
      violacoes.push(
        `${onde}: espelho SEM DECISÃO — ou declare a regra do recorte (recorte: {comando, regra}) ou a ausência com o motivo (recorte: null, motivo). Um espelho novo não pode entrar sem ninguém decidir se o commit o julga.`,
      )
      continue
    }
    // Uma mutação só pode ser PULADA com o motivo escrito: pulo sem motivo é a
    // porta pela qual uma lacuna deixa de ser medida sem ninguém decidir. E o
    // pulo das DUAS mutações é um verde por vazio — declarar medível e não medir
    // nada é pior que declarar que a linha não é medida.
    const ignoradas = espelho.mutacoesIgnoradas ?? {}
    for (const [mutacao, motivo] of Object.entries(ignoradas)) {
      if (!String(motivo ?? "").trim()) {
        violacoes.push(
          `${onde}: a mutação \`${mutacao}\` está IGNORADA sem motivo — um pulo sem razão esconde uma lacuna; declare por que ela não é um defeito neste espelho.`,
        )
      }
    }
    if (espelho.medivel && ignoradas.swap && ignoradas.remocao) {
      violacoes.push(
        `${onde}: espelho declarado MEDÍVEL com as duas mutações ignoradas — não sobrou nada a medir. Uma linha que não se mede entra como NAO-MEDIVEL com o motivo, e não como um verde por vazio.`,
      )
    }
    // Um comando que falha no CONTROLE (sem mutação) falha por ambiente: a
    // declaração que depende dele não pode ser confirmada NEM refutada aqui, e a
    // leitura honesta é essa — não um verde que veio de uma suíte quebrada.
    if (recorte !== null && semAmbiente.has(recorte.comando)) {
      violacoes.push(
        `${onde}: a decisão declara a regra \`${recorte.regra}\` (${recorte.comando}), e esse comando FALHA SEM MUTAÇÃO neste ambiente (falha de dependência/ferramenta) — a declaração não pode ser confirmada nem refutada aqui. Rode a medição onde os guards do recorte rodam (com as dependências instaladas).`,
      )
    }
    if (!espelho.medivel) continue
    // A tabela que declara um espelho medível tem de saber ACHAR a linha dele —
    // se ela não resolve a forma, o espelho que ela declara não é medido por
    // ninguém, e a cobertura declarada seria maior que a real.
    if (resolve(espelho) === null) {
      violacoes.push(
        `${onde}: a tabela \`${espelho.tabela}\` declara o espelho como medível mas não resolve a forma da linha dele — a mutação não tem como ser montada.`,
      )
      continue
    }
    const m = medicoes.find(
      (x) => x.espelho.variavel === espelho.variavel && x.espelho.arquivo === espelho.arquivo,
    )
    if (m === undefined) {
      violacoes.push(
        `${onde}: espelho DECLARADO medível mas fora da medição — a lista de espelhos e a medição divergiram.`,
      )
      continue
    }
    if (m.erro) {
      violacoes.push(`${onde}: ${m.erro}`)
      continue
    }
    if (recorte !== null) {
      if (!m.detectadoPor.includes(recorte.comando)) {
        violacoes.push(
          `${onde}: a decisão declara a regra do recorte \`${recorte.regra}\` (${recorte.comando}), e a MEDIÇÃO não a encontrou (detectado por: ${m.detectadoPor.join(", ") || "nenhum"}). Decisão envelhecida: ou a regra mudou de comando, ou ela parou de morder.`,
        )
      }
      continue
    }
    if (m.detectadoPor.length > 0) {
      violacoes.push(
        `${onde}: a decisão declara que NENHUMA regra do recorte o julga, e a medição o encontrou em ${m.detectadoPor.join(", ")} — declare a regra em vez da ausência.`,
      )
    }
  }
  return violacoes
}

/**
 * O resumo POR TABELA: quantos espelhos cada tabela declara, quantos têm regra
 * no recorte e QUAIS ficam sem regra (nomeados). É a resposta literal da
 * pergunta "quais espelhos de cada tabela o commit não julga" — e derivada das
 * tabelas, então uma entrada nova aparece aqui no commit em que é declarada.
 *
 * @param {EspelhoDeclarado[]} todos
 * @returns {{tabela: string, total: number, mediveis: number, comRegra: number, semRegra: string[], foraDoCommit: string[]}[]}
 */
export function resumoTabelas(todos = espelhosDeclarados()) {
  const porTabela = new Map()
  for (const e of todos) {
    const t = porTabela.get(e.tabela) ?? {
      tabela: e.tabela,
      total: 0,
      mediveis: 0,
      comRegra: 0,
      semRegra: [],
      foraDoCommit: [],
    }
    const nome = `${e.variavel}@${e.arquivo}`
    t.total += 1
    if (e.medivel === false) {
      t.foraDoCommit.push(nome)
    } else {
      t.mediveis += 1
      if (e.recorte !== null) t.comRegra += 1
      else t.semRegra.push(nome)
    }
    porTabela.set(e.tabela, t)
  }
  return [...porTabela.values()]
}

/** O relatório em texto (o mesmo conteúdo do relatório do guard dono). */
export function renderCobertura({ medicoes, todos = espelhosDeclarados() }) {
  const linhas = []
  const fisicos = espelhosFisicos(todos)
  const mediveis = fisicos.filter((e) => e.medivel)
  const comRecorte = fisicos.filter((e) => e.decisoes.some((d) => d.recorte !== null))
  linhas.push(
    `cobertura do recorte: ${comRecorte.length} de ${mediveis.length} espelho(s) medível(is) com REGRA no recorte; ${fisicos.length - mediveis.length} fora do commit (declarado).`,
  )
  linhas.push("por tabela:")
  for (const t of resumoTabelas(todos)) {
    const partes = [
      `${t.total} espelho(s)`,
      `${t.comRegra} com regra no recorte`,
      `${t.semRegra.length} sem regra (declarado)`,
    ]
    if (t.foraDoCommit.length > 0) partes.push(`${t.foraDoCommit.length} fora do commit`)
    linhas.push(`  ${t.tabela} — ${partes.join(" · ")}`)
    if (t.semRegra.length > 0) linhas.push(`      sem regra: ${t.semRegra.join(", ")}`)
    if (t.foraDoCommit.length > 0) linhas.push(`      fora do commit: ${t.foraDoCommit.join(", ")}`)
  }
  for (const m of medicoes) {
    const onde = `${m.espelho.variavel}@${m.espelho.arquivo}`
    if (m.erro) {
      linhas.push(`  ⛔ ${onde}: ${m.erro}`)
      continue
    }
    const decisao = m.espelho.decisoes
      .map((d) => (d.recorte ? `${d.tabela}: ${d.recorte.regra}` : `${d.tabela}: sem recorte`))
      .join(" · ")
    const porMutacao = ["swap", "remocao"]
      .map((mut) => {
        const ignorada = m.espelho.mutacoesIgnoradas?.[mut]
        if (ignorada) return `${mut}: ignorada (${ignorada})`
        const achou = m.mutacoes[mut] ?? []
        return `${mut}: ${achou.join(", ") || "nenhuma regra do recorte"}`
      })
      .join(" | ")
    linhas.push(`  ${onde} — ${decisao} | ${porMutacao}`)
    const motivo = m.espelho.decisoes.find((d) => d.motivo)?.motivo
    if (motivo) linhas.push(`      por quê: ${motivo}`)
  }
  return linhas.join("\n")
}

// ── CLI ─────────────────────────────────────────────────────────────────────

export const USAGE = `check-mirror-coverage — a cobertura do RECORTE do commit, derivada das tabelas de espelhos.

Mede por execução: num worktree temporário, cada espelho das tabelas é mutado
(troca de valor e remoção da linha), estagiado, e os comandos do recorte
(derivados da fase_a() do .husky/pre-commit) decidem se ele é julgado.

Usage:
  node scripts/check-mirror-coverage.mjs                 # todas as tabelas
  node scripts/check-mirror-coverage.mjs --only <tabela> # bun-version | registry-source | actrc-sync | env-mirror
  node scripts/check-mirror-coverage.mjs --json
  node scripts/check-mirror-coverage.mjs -h

Exit codes: 0 decisões conferem · 1 violação (sem decisão / decisão não confirmada) · 2 infra ou CONTROLE vermelho`

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  if (args.includes("-h") || args.includes("--help")) {
    console.log(USAGE)
    process.exit(0)
  }
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null
  const comoJson = args.includes("--json")
  const todos = espelhosDeclarados().filter((e) => only === null || e.tabela === only)
  if (only !== null && todos.length === 0) {
    console.error(
      `❌ --only ${only}: tabela desconhecida (bun-version, registry-source, actrc-sync, env-mirror).`,
    )
    process.exit(2)
  }
  let out
  try {
    out = medirCobertura({ espelhos: todos })
  } catch (err) {
    console.error(`❌ falha de infra na medição: ${err?.message ?? err}`)
    process.exit(2)
  }
  const violacoes = [
    ...violacoesDeCobertura(out.medicoes, todos, { controle: out.controle }),
    ...out.erros,
  ]
  if (comoJson) {
    console.log(
      JSON.stringify(
        {
          comandos: out.comandos,
          controle: out.controle,
          medicoes: out.medicoes.map((m) => ({
            variavel: m.espelho.variavel,
            arquivo: m.espelho.arquivo,
            medivel: m.espelho.medivel,
            tabelas: m.espelho.tabelas,
            decisoes: m.espelho.decisoes,
            detectadoPor: m.detectadoPor,
            mutacoes: m.mutacoes,
            erro: m.erro ?? null,
          })),
          porTabela: resumoTabelas(todos),
          violacoes,
        },
        null,
        2,
      ),
    )
  } else {
    console.log(renderCobertura({ medicoes: out.medicoes, todos }))
    for (const v of violacoes) console.error(`❌ ${v}`)
    if (out.controle.length > 0) {
      console.error(
        `⚠️  INDETERMINADO: ${out.controle.join(", ")} falha(m) na árvore INTACTA — é ambiente (dependência/ferramenta), não defeito. A medição não atribui nada a esses comandos.`,
      )
    } else if (violacoes.length === 0) {
      console.log(
        "✅ toda decisão de recorte confere com a medição (e nenhum espelho ficou sem decisão).",
      )
    }
  }
  // O CONTROLE vermelho tem precedência sobre o veredito do contrato: sem
  // ambiente, a medição não responde a pergunta que ela diz responder.
  if (out.controle.length > 0) process.exit(2)
  process.exit(violacoes.length === 0 ? 0 : 1)
}
