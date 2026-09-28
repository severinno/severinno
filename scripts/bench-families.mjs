#!/usr/bin/env node

// =============================================================================
// bench-families.mjs
//
// A RÉGUA das FAMÍLIAS do bench e os nomes dos arquivos dele — a parte PURA do
// `bench-guard-timing.mjs`, extraída para um módulo que NÃO faz I/O no import.
//
// POR QUE ESTA EXTRAÇÃO EXISTE (defeito real, medido): o `bench-guard-timing.mjs`
// resolve, na CARGA do módulo, o comando canônico do lint a partir do
// `package.json` (`lintEntry()`) e os call sites dele nos workflows. Quem só
// precisava perguntar "quais famílias este arquivo declara medidas?" — o doctor,
// pelo fato da idade da régua — arrastava esse trabalho junto, e passava a exigir
// um `package.json` para carregar. Medido: o teste da recursão do bring-up roda o
// doctor sobre uma cópia do repositório em /tmp e o import morria com
// `ENOENT: ... /package.json`. A régua não pode depender do que ela julga: aqui
// ficam as perguntas puras sobre o relatório, e o MÓDULO do bench segue sendo o
// dono do que exige ler o repositório.
//
// A RÉGUA É UMA SÓ: o `bench-guard-timing.mjs` importa e REEXPORTA daqui (o
// contrato dele não muda), a comparação de tempo, a procedência, a idade da régua
// (`bench-freshness.mjs`) e o doctor leem a MESMA tabela. Duas noções de "família
// medida" divergiriam no dia em que alguém ajustasse uma delas, e a divergência
// apareceria como "a baseline diz que mediu e o veredito diz que não" — sem teste
// vermelho.
//
// AQUI TAMBÉM AS DUAS RÉGUAS PURAS DO REGISTRO: `comMetadesDaMatriz` (a coluna de
// metades de cada forma é DERIVADA da matriz, nunca herdada do ato que mediu o
// custo) e `mutationWhatItAdded` (a frase da família). Elas moram na folha pelo
// mesmo motivo de todo o resto: são puras, e quem as consome sem ser o ato — o
// fixture da prova do pre-commit, que precisa aplicar o MESMO remédio que o ato
// aplicaria — não pode arrastar o módulo que lê o repositório inteiro.
//
// Usage:
//   node scripts/bench-families.mjs            # as famílias e o que cada arquivo declara
//   node scripts/bench-families.mjs --json     # o mesmo, como dados
//   node scripts/bench-families.mjs --help
//
// Exit codes:
//   0 — a régua foi impressa (é uma CONSULTA: não julga repositório nenhum)
//   3 — uso inválido
// =============================================================================

import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import process from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"

import { metadesDeclaradas } from "./metades.mjs"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(SCRIPT_DIR, "..")

/**
 * Os DOIS arquivos do bench (versionados em `docs/benchmarks/`).
 *
 * EXPORTADOS porque a cadeia de herança, a idade da régua e os testes precisam
 * NOMEAR a fonte de cada família — um literal repetido seria uma segunda fonte da
 * mesma verdade.
 */
export const LATEST_FILE = "guard-timing-latest.json"
export const BASELINE_FILE = "guard-timing-baseline.json"

/** O caminho versionado do registro do ato (a âncora é resolvida por ele). */
export const REGISTRO_VERSIONADO = `docs/benchmarks/${BASELINE_FILE}`

/**
 * A ÂNCORA do registro do ato, quando ela NÃO é gravável no próprio arquivo.
 *
 * O DEFEITO QUE ISTO FECHA (a re-ancoragem em DOIS commits, medido em 27/09/2026):
 * a baseline gravava `meta.commit = <topo>` — o PAI do commit que a carrega —,
 * porque o `--baseline` roda com a matriz já na ÁRVORE e o commit que a carrega
 * ainda não existe. Só que a árvore do PAI não carrega a matriz que o registro
 * declara ter medido (a suíte nova entra no commit SEGUINTE), e o
 * `check-act-origin` — corretamente — recusa o commit em que a origem não carrega
 * a matriz. O remédio era rodar o ato DE NOVO na árvore já commitada: DOIS
 * commits para uma medição só.
 *
 * UM COMMIT NÃO PODE CONTER O PRÓPRIO HASH — o campo entra no blob, o blob no
 * tree, o tree no commit. Então o hash do PORTADOR (o commit que carrega o
 * registro) não é GRAVÁVEL dentro dele, em commit nenhum: a âncora tem de ser
 * RESOLVIDA pela história, não digitada. É o que este módulo faz — o registro
 * declara `meta.anchor = "carrier"` e quem lê resolve o portador (`git log`).
 */
export const ANCORA_PORTA = "carrier"

/**
 * O COMMIT QUE CARREGA um caminho — o PORTADOR: o último commit de `head` que
 * tocou o arquivo. É a âncora do registro que declara `meta.anchor = "carrier"`.
 *
 * FAIL-CLOSED: sem `git`, sem `head`, sem o caminho na história ou com o git
 * respondendo vazio, devolve `null` — "não sei qual commit carrega" NUNCA vira um
 * hash inventado, e um portador nulo é dívida declarada (a régua acusa), não
 * verde por omissão.
 *
 * @param {{path?: string, head?: string, cwd?: string, run?: Function}} [o]
 * @returns {string|null} o hash COMPLETO do portador, ou `null`
 */
export function commitQueCarrega({
  path = REGISTRO_VERSIONADO,
  head = "HEAD",
  cwd = REPO_ROOT,
  run = spawnSync,
} = {}) {
  if (!path) return null
  try {
    const res = run("git", ["log", "-1", "--format=%H", String(head), "--", path], {
      cwd,
      encoding: "utf8",
      timeout: 15_000,
    })
    if (res?.status !== 0) return null
    const hash = String(res.stdout ?? "").trim()
    return hash === "" ? null : hash
  } catch {
    return null
  }
}

/**
 * A ORIGEM de um registro do bench — a âncora RESOLVIDA, com a procedência dita.
 *
 * Três casos, e o `via` diz qual deles respondeu (nunca um fallback silencioso):
 *   · `meta.commit`   — esquema v6: o hash está gravado no próprio arquivo;
 *   · `carrier`       — esquema v7: a âncora é o PORTADOR, resolvido da história
 *                      (`meta.commit` não é gravável dentro do próprio commit);
 *   · `ausente`       — o registro não declara âncora: a origem é NULA, e a régua
 *                      que lê isto acusa — não presume.
 *
 * O `parent` é a PROCEDÊNCIA (o topo sobre o qual o ato rodou): ele não é a
 * âncora, e por isso tem nome próprio.
 *
 * @param {unknown} registro  o registro do bench JÁ PARSEADO
 * @param {{head?: string, path?: string, cwd?: string, run?: Function}} [o]
 * @returns {{commit: string|null, via: "meta.commit"|"carrier"|"ausente", parent: string|null}}
 */
export function origemDoRegistro(
  registro,
  { head = "HEAD", path = REGISTRO_VERSIONADO, cwd = REPO_ROOT, run = spawnSync } = {},
) {
  const meta = registro?.meta ?? {}
  const parent =
    (typeof meta.parentCommit === "string" && meta.parentCommit.trim()) ||
    (typeof meta.commit === "string" && meta.commit.trim()) ||
    null
  if (typeof meta.commit === "string" && meta.commit.trim() !== "") {
    return { commit: meta.commit.trim(), via: "meta.commit", parent }
  }
  if (meta.anchor === ANCORA_PORTA) {
    return { commit: commitQueCarrega({ path, head, cwd, run }), via: "carrier", parent }
  }
  return { commit: null, via: "ausente", parent }
}

/**
 * O ATO que mediu cada familia, como fato de primeira classe.
 *
 * Uma familia pode chegar ao relatorio por tres caminhos, e o numero so e
 * comparavel se o caminho estiver dito: `measured` (esta rodada rodou o comando
 * dela), `reused` (herdada de outra rodada por `--merge`, com a origem marcada) e
 * `not-measured` (nao rodou aqui e nao havia de onde herdar — `--only`,
 * `--no-tests`, ou um arquivo anterior que tambem nao a tinha).
 *
 * A REGUA DE "FOI MEDIDA?" E UMA SO: as mesmas perguntas que a comparacao usa
 * para dizer que falta COBERTURA (`faltantes`, em `compareTimings`). Duas nocoes
 * de "medida" divergiriam no dia em que alguem ajustasse uma delas, e a
 * divergencia apareceria como "a baseline diz que mediu e o veredito diz que nao"
 * — sem teste vermelho.
 *
 * O `hook` responde pela MEDICAO declarada (`measured: true`) e nao pela secao
 * existir: uma secao presente com as ancoras sumidas nao mediu nada, e chama-la
 * de medida seria a mesma mentira que o `null` existe para evitar.
 *
 * @type {Record<string, (report: object|null|undefined) => boolean>}
 */
export const FAMILY_MEASURED = {
  battery: (report) => (report?.guards?.length ?? 0) > 0 || report?.doctor != null,
  lint: (report) => report?.lint != null,
  typecheck: (report) => report?.rulers?.typecheck != null,
  tests: (report) => report?.rulers?.tests != null,
  hook: (report) => report?.hook?.measured === true,
  mutations: (report) => report?.mutations?.measured === true,
}

/**
 * As familias que um ARQUIVO do bench declara medidas — a régua aplicada.
 *
 * @param {object|null|undefined} report
 * @returns {string[]} os nomes, na ordem declarada da tabela
 */
export function measuredFamilies(report) {
  return Object.keys(FAMILY_MEASURED).filter((family) => FAMILY_MEASURED[family](report))
}

// ---------------------------------------------------------------------------
// A FONTE de cada FORMA medida — "de qual arquivo esta forma veio?"
// ---------------------------------------------------------------------------
//
// POR QUE ISTO EXISTE (o defeito real, medido em 22/09/2026): o ato grava o
// commit de ORIGEM da medição (`meta.commit`/`meta.families`), mas uma FORMA
// pode ter sido medida numa árvore que aquele commit NÃO tem — foi o que
// aconteceu com a `doc-hashes`: a suíte existia (no ÍNDICE) quando o ato rodou e
// o commit gravado como origem não a tem. O número, então, descreve uma matriz
// que o commit não carrega, e nada no repositório olhava isso: a régua da idade
// mede quantos commits de HEAD separam a origem, não o que a origem CONTÉM.
//
// A RÉGUA É UMA SÓ e mora aqui (pura, sem I/O) porque DUAS partes fazem a mesma
// pergunta em momentos diferentes: o ATO (contra a árvore que ele acabou de
// medir) e a RÉGUA DA IDADE (contra o commit de origem). Duas derivações da
// mesma fonte divergiriam no dia em que uma delas fosse ajustada, e a divergência
// apareceria como "o ato diz que está no commit e a régua diz que não".

/** O master dos sub-tests: o arquivo que DECLARA id→script de cada forma da matriz. */
export const MASTER_DOS_SUBTESTS = "scripts/test-mutation-guards.sh"

/**
 * A seção de FORMAS de cada família, num relatório do bench.
 *
 * A tabela existe para as duas pontas que perguntam "as formas estão no commit
 * de origem?" — o ATO (a rodada que ele acabou de medir) e a RÉGUA da idade (o
 * arquivo versionado) — caminharem sobre as MESMAS formas. Uma segunda lista
 * divergiria no dia em que uma família nova entrasse, e a divergência apareceria
 * como uma família que o ato julga e a régua não vê.
 *
 * @type {Record<string, (report: any) => any[]>}
 */
export const FORM_SECTION = {
  battery: (r) => r?.guards ?? [],
  lint: (r) => r?.lint?.forms ?? [],
  typecheck: (r) => r?.rulers?.typecheck?.forms ?? [],
  tests: (r) => r?.rulers?.tests?.forms ?? [],
  hook: (r) => r?.hook?.forms ?? [],
  mutations: (r) => r?.mutations?.forms ?? [],
}

/**
 * Como cada FAMÍLIA nomeia a fonte das suas formas.
 *
 * `null` NÃO é "sem problema": é **não julgada** — a família mede COMANDOS (o
 * hook, o lint, o tsc, a suíte unitária) e as formas dela não nomeiam arquivo
 * próprio, então não há o que perguntar ao commit de origem. O limite é
 * DECLARADO em vez de virar um verde silencioso (ver `fonteDaForma`).
 *
 * @type {Record<string, {via: string, master?: string}|null>}
 */
export const FONTE_DAS_FORMAS = {
  mutations: { via: "subtest-do-master", master: MASTER_DOS_SUBTESTS },
  battery: null,
  lint: null,
  typecheck: null,
  tests: null,
  hook: null,
}

/**
 * O mapa `id → script` do `SUBTESTS=(...)` de um master (o texto do arquivo, de
 * QUALQUER commit — a régua lê o do commit de origem, o ato lê o da árvore).
 *
 * Leitor MÍNIMO de propósito: o que ele responde é só "de qual script é esta
 * forma". O `check-mutation-count` lê o MESMO array para um trabalho DIFERENTE —
 * a violação da descrição escrita à mão no formato antigo (`id|descrição|script`)
 * e o count da matriz —, e por isso ele tem o parser dele, com as regras dele.
 *
 * @param {string} masterSrc
 * @returns {Map<string, string>} id → script (vazio quando o array não está lá)
 */
export function mapaDoMaster(masterSrc) {
  const mapa = new Map()
  const texto = String(masterSrc ?? "")
  const inicio = texto.indexOf("SUBTESTS=(")
  if (inicio === -1) return mapa
  const bloco = texto.slice(inicio)
  const fim = bloco.indexOf("\n)")
  const corpo = bloco.slice("SUBTESTS=(".length, fim === -1 ? undefined : fim)
  for (const linha of corpo.split("\n")) {
    // A forma antiga (`id|descrição|script`) vem PRIMEIRO: no formato de dois
    // campos ela casaria a descrição como se fosse o caminho. O meio é GREEDY e o
    // caminho sai do ÚLTIMO separador: uma descrição que cite um pipe (o caso real
    // — as descrições citam `echo $OUT | grep -Fq`) senão empurraria o começo do
    // caminho para dentro dela e a forma mediria um arquivo que não existe.
    const velho = linha.match(/^\s*"([^"|]+)\|(.+)\|([^"|]+)"\s*$/)
    if (velho) {
      mapa.set(velho[1].trim(), velho[3].trim())
      continue
    }
    const m = linha.match(/^\s*"([^"|]+)\|([^"]+)"\s*$/)
    if (m) mapa.set(m[1].trim(), m[2].trim())
  }
  return mapa
}

/**
 * A COLUNA DE METADES de cada sub-test da MATRIZ — derivada, nunca herdada.
 *
 * POR QUE ELA MORA AQUI (o defeito medido em 23/09/2026): a coluna de metades do
 * registro versionado saía da rodada que mediu o custo, e uma unidade
 * acrescentada à suíte DEPOIS daquela medição ficava invisível — o registro dizia
 * `8 metades` para uma suíte que já declarava dez, e o número sobrevivia porque
 * ninguém o comparava com a matriz. A régua da contagem já existia
 * (`scripts/metades.mjs`, lida pelo master e pela doc); o que faltava era o
 * caminho DA MATRIZ até a coluna: esta função lê o `SUBTESTS` do master
 * (`mapaDoMaster`) e, para cada suíte citada, a contagem declarada no bloco
 * `METADES=(...)` DELA — a mesma leitura da tabela por sub-test e da doc.
 *
 * O ato usa esta função para GRAVAR a coluna, e o `check-mutation-count` para
 * JULGÁ-LA: uma segunda derivação divergiria no dia em que uma das duas fosse
 * ajustada, e a divergência apareceria como "o registro está certo para o ato e
 * errado para o guard" — sem teste vermelho.
 *
 * @param {{masterSrc: string, lerSuite?: (script: string) => string|null}} opts
 *   `lerSuite` devolve o TEXTO da suíte, ou `null` quando ela não está lá (a
 *   suíte citada e ausente é resposta, não exceção: o chamador diz o que fazer).
 * @returns {Map<string, {script: string, count: number, motivo: string|null}>} id → derivação
 */
export function metadesDaMatriz({ masterSrc, lerSuite = () => null } = /** @type {any} */ ({})) {
  const derivadas = new Map()
  const mapa = mapaDoMaster(masterSrc)
  for (const [id, script] of mapa) {
    const texto = lerSuite(script)
    if (texto === null || texto === undefined) {
      // Suíte citada pelo master e AUSENTE: a contagem não é zero, é NÃO MEDIDA —
      // e quem julga é quem sabe o que fazer com isso (o guard nomeia o arquivo
      // que o commit aponta e não carrega; o ato grava sem coluna nova).
      derivadas.set(id, { script, count: 0, motivo: `\`${script}\` não está nesta árvore` })
      continue
    }
    const declaradas = metadesDeclaradas(String(texto))
    // O bloco ilegível (sem bloco, aspas duplas, id repetido) NÃO é zero: é
    // "não medida" — a mesma resposta da suíte ausente, e pelo mesmo motivo (o
    // guard é quem transforma isso em violação nomeada; o ato não inventa número).
    derivadas.set(id, {
      script,
      count: declaradas.ok ? declaradas.metades.length : 0,
      motivo: declaradas.ok ? null : declaradas.motivo,
    })
  }
  return derivadas
}

/**
 * A FONTE de UMA forma — o arquivo que ela mede, ou o motivo de não haver o que
 * julgar.
 *
 * A ORDEM É DELIBERADA: a forma que declara o PRÓPRIO `script` (o campo que o
 * ato passou a gravar) responde por si — é o dado mais próximo; sem ele, a
 * família que tem um mapa (`mutations`) nomeia pelo `id`; e o id que NÃO está no
 * mapa daquele master é uma resposta, não uma ausência: a forma foi medida numa
 * árvore cuja matriz aquele commit não tem (o caso da `doc-hashes`).
 *
 * @param {string} family
 * @param {{role?: string, id?: string, script?: string}} form
 * @param {{scripts?: Map<string, string>|null}} [opts]  o mapa do master DAQUELE commit
 * @returns {{path: string|null, via: string, id?: string}|null}  `null` = família sem fonte própria (não julgada)
 */
export function fonteDaForma(family, form, { scripts = null } = {}) {
  const declarado = typeof form?.script === "string" ? form.script.trim() : ""
  if (declarado !== "") return { path: declarado, via: "form.script" }

  const regra = FONTE_DAS_FORMAS[family] ?? null
  if (regra === null) return null

  if (regra.via === "subtest-do-master") {
    const id = String(form?.role ?? form?.id ?? "").trim()
    if (id === "") return null
    // SEM o master daquele commit a pergunta não é respondida — e isso é
    // DIFERENTE da família que não nomeia fonte nenhuma: uma é a pergunta que
    // não deu para fazer (o commit não tem o mapa), a outra é o limite por
    // desenho. O chamador conta as duas separado; misturá-las faria o limite da
    // régua engolir uma pergunta que ficou sem resposta.
    if (!(scripts instanceof Map)) return { path: null, via: "sem-master", id }
    const path = scripts.get(id) ?? null
    if (path !== null) return { path, via: "subtest-do-master", id }
    return { path: null, via: "ausente-do-master", id }
  }

  return null
}

/**
 * A frase da família: os extremos, a mediana e o que o PRÓXIMO sub-test
 * acrescenta.
 *
 * A primeira linha é MEDIDA (cada sub-test, um a um); a última é PROJEÇÃO —
 * derivada dos dois lados medidos (a média dos scripts que existem e o harness por
 * sub-test), e dita como projeção. Chamar a projeção de medição seria a mesma
 * classe de erro que o `measured: false` existe para evitar: um número que não foi
 * medido passando por medido.
 *
 * @param {{forms?: {label?: string, role?: string, flake?: boolean, tentativas?: number, infra?: boolean, exit1?: number, exit2?: number|null}[], deltas?: {subtestsMs?: number, harnessMs?: number, totalMs?: number, proximoSubtestProjetadoMs?: number, maisCaro?: string|null, maisCaroMs?: number|null, medianaMs?: number|null}, subtests?: number, metades?: number}} [opts]
 * @returns {string[]}
 */
export function mutationWhatItAdded({ forms = [], deltas = {}, subtests = 0, metades = 0 } = {}) {
  if (forms.length === 0) return ["NÃO MEDIDO: nenhum sub-test"]
  const seg = (ms) => `${((ms ?? 0) / 1000).toFixed(1)}s`
  const nome = (f) => f.label ?? f.role ?? "(forma sem id)"
  const linhas = [
    `MEDIDO, sub-test a sub-test: ${subtests} sub-test(s) · ${metades} metade(s) · ${seg(deltas.subtestsMs)} de sub-tests + ${seg(deltas.harnessMs)} de harness = ${seg(deltas.totalMs)}`,
    `o mais caro: ${deltas.maisCaro} (${seg(deltas.maisCaroMs)}) · a mediana: ${seg(deltas.medianaMs)}`,
    `o PRÓXIMO sub-test acrescenta ~${seg(deltas.proximoSubtestProjetadoMs)} (PROJEÇÃO: a média dos scripts medidos + o harness por sub-test) — e entra MEDIDO na primeira rodada que o tiver, sem conta à mão`,
  ]
  // ── AS TENTATIVAS, no registro versionado ─────────────────────────────
  // A re-medição do master (ver o cabeçalho dele) só vale como disciplina se o
  // REGISTRO a publicar: sem estas linhas, o arquivo versionado diria "medido,
  // tudo certo" sobre um sub-test que se contradisse entre duas medições da
  // MESMA árvore — e o custo (`ms` = SOMA das tentativas) pareceria o de um
  // tiro só.
  const flaky = forms.filter((f) => f?.flake === true)
  if (flaky.length > 0)
    linhas.push(
      `🌀 ${flaky.length} forma(s) FLAKY: ${flaky.map(nome).join(", ")} — cada uma reprovou na 1ª tentativa e PASSOU na 2ª, na MESMA árvore: o veredito do master vai a 2 (INDETERMINADO, nunca "passou") e o ms dela é a SOMA das duas tentativas`,
    )
  // ── A INFRA, dita à parte do vermelho ──────────────────────────────────
  // A suíte que sai com o exit 2 declarado no cabeçalho NÃO MEDIU (git/node/
  // bancada ausentes, fail-closed): o que existe não é um defeito da árvore, é o
  // instrumento que não respondeu. Sem esta linha, a não-medição viraria a
  // mesma coisa que a regressão — e o registro versionado afirmaria "o
  // vermelho repetiu" sobre um tiro que nunca foi disparado.
  const naoMedidas = forms.filter((f) => f?.infra === true)
  if (naoMedidas.length > 0)
    linhas.push(
      `🚧 ${naoMedidas.length} forma(s) NÃO MEDIRAM (INFRA): ${naoMedidas.map(nome).join(", ")} — a suíte saiu com o exit 2 que ela declara como INFRA (git/node/bancada ausentes, fail-closed), então NÃO HÁ veredito a publicar: o veredito do master vai a 2 (INDETERMINADO) e o registro NÃO grava isto como defeito da árvore — re-rode onde o instrumento responde`,
    )
  // ── As RE-MEDIDAS, com a repetição MEDIDA nas duas tentativas ──────────
  // A frase original afirmava "o vermelho REPETIU na 2ª tentativa (é da árvore,
  // não do ambiente)" para toda forma com duas tentativas — e um exit 2 na 2ª
  // não repete nada: ele diz que a medição não aconteceu. A classe vai à parte.
  const remedidas = forms.filter(
    (f) =>
      (f?.tentativas ?? 1) > 1 &&
      f?.flake !== true &&
      f?.infra !== true &&
      !tentativaNaoMediu(f?.exit1) &&
      !tentativaNaoMediu(f?.exit2),
  )
  if (remedidas.length > 0)
    linhas.push(
      `↺ ${remedidas.length} forma(s) RE-MEDIDA(s): ${remedidas.map(nome).join(", ")} — o vermelho REPETIU na 2ª tentativa (é da árvore, não do ambiente), e o ms publicado soma as duas`,
    )
  const remedidasSemMedicao = forms.filter(
    (f) =>
      (f?.tentativas ?? 1) > 1 &&
      f?.flake !== true &&
      f?.infra !== true &&
      (tentativaNaoMediu(f?.exit1) || tentativaNaoMediu(f?.exit2)),
  )
  if (remedidasSemMedicao.length > 0)
    linhas.push(
      `↺ ${remedidasSemMedicao.length} forma(s) RE-MEDIDA(s) com UMA tentativa que NÃO MEDIU (exit 2/126/127): ${remedidasSemMedicao.map(nome).join(", ")} — o veredito é o da tentativa que MEDIU e o ms é a soma das duas; a não-medição NÃO conta como repetição do vermelho`,
    )
  return linhas
}

/**
 * OS EXITS QUE DIZEM "ESTA TENTATIVA NÃO MEDIU".
 *
 * O contrato é do CÁBEÇALHO de cada suíte da matriz: **exit 2 = INFRA** — a
 * suíte não conseguiu medir e sai fail-closed (`git`/`node`/`python3` ausentes,
 * o checkout contendido, a bancada que não monta). Os dois últimos são os que
 * NEM RODARAM (126 = não executável, 127 = comando não encontrado).
 *
 * A DISTINÇÃO É O PONTO: um vermelho é uma MEDIÇÃO (a régua não viu a mutação);
 * um exit 2 é a AUSÊNCIA dela. Tratar os dois como o mesmo veredito grava "o
 * vermelho REPETIU — é da árvore" sobre o instrumento que não respondeu, que é
 * a acusação ao que não foi medido.
 */
export const EXITS_NAO_MEDIDOS = new Set([2, 126, 127])

/**
 * A tentativa MEDIU? (`exit` de uma tentativa que ACONTECEU — `null`, de uma
 * re-medição que não houve, não é "não mediu", é "não houve tentativa").
 *
 * @param {unknown} exit
 * @returns {boolean} true quando o exit declara que a suíte NÃO mediu
 */
export function tentativaNaoMediu(exit) {
  return exit !== null && exit !== undefined && EXITS_NAO_MEDIDOS.has(Number(exit))
}

/**
 * A COLUNA DE METADES do registro: DERIVADA da MATRIZ, na hora de gravar.
 *
 * O DEFEITO (medido em 23/09/2026): a coluna saía da rodada que mediu o CUSTO.
 * Numa rodada completa isso coincide, porque o master conta as metades da mesma
 * árvore; mas numa gravação que HERDA a família (`--merge`/`--only`) a coluna
 * viajava junto com o custo — e uma unidade acrescentada à suíte DEPOIS daquela
 * medição ficava escrita como a unidade anterior (o registro dizia `8 metades`
 * para uma suíte que já declarava dez). O custo é herdar; a UNIDADE não é: ela
 * descreve a suíte, e a suíte está nesta árvore.
 *
 * O QUE É DERIVADO AQUI, e o que NÃO é:
 *   - a coluna `metades` de cada forma (casada pelo `role`, que é o id do
 *     sub-test no master) e o TOTAL da família são reescritos pela matriz;
 *   - o CUSTO (`ms`, `forms[].ms`, `deltas`) não é tocado; a procedência da
 *     família (`meta.reused`) descreve o custo, e continua verdadeira — é o
 *     custo que veio daquela rodada, não a contagem;
 *   - a forma cujo id a derivação NÃO conhece (um sub-test que saiu da matriz e
 *     continua no registro) fica INTOCADA e é DITA em `metadesDaMatriz.semDerivacao`:
 *     inventar um número seria pior que declarar o que não foi derivado;
 *   - a forma cujo id a matriz conhece e NÃO conseguiu medir (a suíte citada e
 *     ausente, um bloco `METADES` ilegível) fica INTOCADA e é DITA em
 *     `metadesDaMatriz.naoMedidas`: zero alí apagaria o número que o registro já
 *     tinha, e "não medido" não é "zero metades".
 *
 * A frase da família (`whatItAdded`) é REGERADA com os números derivados — ela
 * narra o resultado, e uma frase que diz `231 metade(s)` ao lado de uma coluna
 * que soma 236 é a mesma classe de incoerência que o `measured: false` existe
 * para evitar.
 *
 * SEM derivação não há reescrita NEM procedência: a família sai pela MESMA
 * referência, e o CLI DIZ em voz alta que a coluna não foi derivada (derivar
 * "nada" viraria um zero silencioso).
 *
 * COM a derivação, a família devolvida é sempre OUTRA — mesmo quando nada
 * precisava ser corrigido. Isso é deliberado: a marca `metadesDaMatriz` (quantas
 * formas a matriz corrigiu) é o dado que sustenta "a coluna é derivada", e uma
 * rodada que não corrigiu nada tem `atualizadas: 0` — um fato, não a ausência de
 * fato. Sem essa marca, "nada mudou" e "a derivação não rodou" ficariam com a
 * mesma cara no arquivo versionado.
 *
 * PURA: recebe a família e a derivação (o CLI lê as duas).
 *
 * @param {object|null} mutations a família `mutations` do resultado
 * @param {Map<string, {count: number}>|null} derivadas id → o que a matriz declara
 * @returns {object|null} a mesma família com a coluna derivada e a procedência
 *   (`null`/`Map` vazia = "não medida", nunca "vazia" de verdade)
 */
export function comMetadesDaMatriz(mutations, derivadas) {
  if (!mutations || !Array.isArray(mutations.forms)) return mutations
  if (!(derivadas instanceof Map) || derivadas.size === 0) return mutations

  const semDerivacao = []
  const naoMedidas = []
  let atualizadas = 0
  const forms = mutations.forms.map((f) => {
    const id = typeof f?.role === "string" ? f.role.trim() : ""
    const derivada = derivadas.get(id)
    if (derivada === undefined) {
      semDerivacao.push(id === "" ? "(forma sem role)" : id)
      return f
    }
    // A unidade que a matriz NÃO conseguiu medir (suíte citada e ausente, bloco
    // `METADES` ilegível) não é zero: `count: 0` aqui significa "não medida", e
    // gravar 0 apagaria o número que o registro já tinha. A forma fica como
    // está e o motivo é DITO — quem transforma isso em violação é o guard.
    if (!(derivada.count > 0)) {
      naoMedidas.push({ id, motivo: derivada.motivo ?? "a matriz não declara a unidade" })
      return f
    }
    const anotada = Number.isFinite(f?.metades) ? Number(f.metades) : null
    if (anotada === derivada.count) return f
    atualizadas += 1
    return { ...f, metades: derivada.count }
  })
  const metades = forms.reduce(
    (s, f) => s + (Number.isFinite(f?.metades) ? Number(f.metades) : 0),
    0,
  )

  return {
    ...mutations,
    forms,
    metades,
    // A PROCEDÊNCIA DA COLUNA (não do custo): quem a escreveu foi a matriz desta
    // árvore, e quantas formas ela corrigiu fica DITO no próprio registro — "a
    // coluna é derivada" deixa de ser uma promessa da prosa e passa a ser dado.
    metadesDaMatriz: { total: metades, atualizadas, semDerivacao, naoMedidas },
    whatItAdded: mutationWhatItAdded({
      forms,
      deltas: mutations.deltas ?? {},
      subtests: mutations.subtests ?? forms.length,
      metades,
    }),
  }
}

// ---------------------------------------------------------------------------
// Main (uma CONSULTA: não lê repositório nenhum, não tem veredito)
// ---------------------------------------------------------------------------

export const USAGE = "Uso: node scripts/bench-families.mjs [--json] [--help]"

/** SÍNCRONO de propósito: um módulo-folha com top-level await contagiaria todo
 * importador com a carga assíncrona — e esta consulta não tem o que esperar. */
function main() {
  const argv = process.argv.slice(2)
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE)
    console.log(
      '\n  Imprime a RÉGUA das famílias do bench: os nomes, o critério de "foi medida?"\n' +
        "  de cada uma e os dois arquivos do bench (latest/baseline). É a tabela que a\n" +
        "  comparação, a procedência, a idade da régua (`bench-freshness.mjs`) e o doctor\n" +
        "  leem — o comando existe para ela ser consultável em vez de reconstruída de memória.",
    )
    return 0
  }
  const desconhecido = argv.find((a) => a !== "--json")
  if (desconhecido !== undefined) {
    console.error(`❌ argumento desconhecido: ${desconhecido}`)
    console.error(USAGE)
    return 3
  }

  const familias = Object.keys(FAMILY_MEASURED).map((family) => ({
    family,
    criterio: String(FAMILY_MEASURED[family]),
    fonteDasFormas: FONTE_DAS_FORMAS[family] ?? null,
  }))
  if (argv.includes("--json")) {
    console.log(
      JSON.stringify(
        {
          families: familias,
          latest: LATEST_FILE,
          baseline: BASELINE_FILE,
          masterDosSubtests: MASTER_DOS_SUBTESTS,
        },
        null,
        2,
      ),
    )
    return 0
  }
  console.log("📐 Régua das famílias do bench:")
  for (const f of familias) {
    const fonte = f.fonteDasFormas
      ? `formas nomeadas por \`${f.fonteDasFormas.via}\` (${f.fonteDasFormas.master})`
      : "formas SEM fonte própria (não julgadas contra o commit de origem)"
    console.log(`   · ${f.family}: ${f.criterio}`)
    console.log(`       ${fonte}`)
  }
  console.log(`   arquivos: ${LATEST_FILE} (run) · ${BASELINE_FILE} (a régua)`)
  return 0
}

const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (IS_DIRECT_RUN) {
  let code = 3
  try {
    code = main()
  } catch (error) {
    console.error(`❌ ${error.message}`)
    code = 3
  }
  process.exit(code)
}
