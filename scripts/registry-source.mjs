#!/usr/bin/env node

// =============================================================================
// registry-source.mjs
//
// A resolução do REGISTRY e do NAMESPACE das imagens PARA OS SCRIPTS — o único
// caminho pelo qual um script do repositório descobre de onde puxar (e para onde
// publicar) sem cravar um literal.
//
// A CADEIA (mesma forma do `bun-version.mjs`, de quem este módulo empresta a
// máquina de leitura dos espelhos — uma implementação só, duas famílias de
// variável):
//
//   1. o ambiente do processo (`IMAGE_REGISTRY`/`IMAGE_NAMESPACE`): é assim que o
//      CI entrega a repository variable resolvida aos passos que a recebem por
//      `env:`, e como o operador roda localmente o caminho que o compose faria;
//   2. os ESPELHOS DECLARADOS no repositório — `.actrc` (o `--var` do act local,
//      que só espelha o registry) e os templates `deploy/env.gitea.example` e
//      `.env.production.example`. São os MESMOS arquivos que o
//      `check-registry-source.mjs` compara por VALOR contra os defaults do
//      compose: um arquivo versionado é derivação legítima da variável, não um
//      segundo ponto de verdade;
//   3. nada. Quem não encontra NÃO recebe default silencioso: `resolveImageSource`
//      devolve `null` e `requireImageSource` LANÇA nomeando os espelhos.
//
// POR QUE ISSO É UM RESOLVEDOR E NÃO UM `|| "ghcr.io"`: o literal de reserva
// sobrevive à migração de registry. Depois de trocar a variável para outro host,
// o script continua puxando do registry VELHO — e como a imagem continua
// existindo lá, nada fica vermelho; o sintoma aparece longe da causa (uma imagem
// antiga puxada, um push para o registry errado).
//
// Usage:
//   import { resolveImageSource, requireImageSource, declaredImageValue, defaultsInLine } from "./registry-source.mjs"
//
//   const { registry, namespace, sources } = requireImageSource({ root: process.cwd() })
//   console.log(`puxando de ${registry}/${namespace} (${sources.IMAGE_REGISTRY})`)
//
//   // e a COMPARAÇÃO DE VALOR de um default embutido (compose, shell, workflow):
//   import { defaultValueVerdict } from "./registry-source.mjs"
//   const v = defaultValueVerdict("IMAGE_REGISTRY", "ghcr.io", { root })
//   // v.state: "proven" | "violated" | "indeterminate"
//
// Exit codes:
//   (nenhum) — este módulo NÃO é uma CLI: não chama process.exit nem imprime.
//   Quem decide o que fazer com a ausência do valor é o CONSUMIDOR:
//     - `resolveImageSource` devolve `registry: null` / `namespace: null`;
//     - `requireImageSource` LANÇA — o script que o usa traduz para o próprio
//       código de saída (a convenção dos scripts deste repo: 2 = uso/infra).
//
// O módulo é node-puro e importa apenas `node:*` e o `bun-version.mjs` (a folha
// da leitura de espelhos): não puxa o guard nem nada que dependa do repositório.
// =============================================================================

import { mirrorListText, readMirrorValues } from "./bun-version.mjs"

/** A referência da repository variable do registry (a FONTE ÚNICA do host). */
export const IMAGE_REGISTRY_VAR = "${{ vars.IMAGE_REGISTRY }}"

/** A referência da repository variable do namespace (a FONTE ÚNICA do owner). */
export const IMAGE_NAMESPACE_VAR = "${{ vars.IMAGE_NAMESPACE }}"

/** As variáveis resolvidas por este módulo, na ordem em que as mensagens as citam. */
export const IMAGE_VARIABLES = ["IMAGE_REGISTRY", "IMAGE_NAMESPACE"]

/**
 * Os espelhos DECLARADOS de cada variável, na ordem em que são lidos.
 *
 * A lista é a fonte única de "onde o valor está declarado": o resolvedor
 * (leitura), a comparação por valor do guard e o bump/migração têm de concordar
 * sobre ela — dois espelhos declarados num lugar e comparados noutro é a
 * assimetria silenciosa (mesmo raciocínio do `BUN_MIRRORS`).
 *
 * `IMAGE_NAMESPACE` NÃO vive no `.actrc`: os workflows a usam com o fallback
 * dinâmico `|| github.repository_owner` e o act local resolve por ele — o
 * contrato está escrito no `check-registry-source` (MIRROR_VARIABLE_RULES) e
 * cobrá-la aqui seria um aviso permanente que o procedimento não silencia.
 */
export const IMAGE_MIRRORS = {
  IMAGE_REGISTRY: [
    {
      file: ".actrc",
      line: /^--var IMAGE_REGISTRY=(.+)$/m,
      format: (v) => `--var IMAGE_REGISTRY=${v}`,
    },
    {
      file: "deploy/env.gitea.example",
      line: /^IMAGE_REGISTRY=(.+)$/m,
      format: (v) => `IMAGE_REGISTRY=${v}`,
    },
    {
      file: ".env.production.example",
      line: /^IMAGE_REGISTRY=(.+)$/m,
      format: (v) => `IMAGE_REGISTRY=${v}`,
    },
  ],
  IMAGE_NAMESPACE: [
    {
      file: "deploy/env.gitea.example",
      line: /^IMAGE_NAMESPACE=(.+)$/m,
      format: (v) => `IMAGE_NAMESPACE=${v}`,
    },
    {
      file: ".env.production.example",
      line: /^IMAGE_NAMESPACE=(.+)$/m,
      format: (v) => `IMAGE_NAMESPACE=${v}`,
    },
  ],
}

/** Os espelhos de UMA variável (lista vazia para um nome desconhecido). */
export function mirrorsOf(name) {
  return IMAGE_MIRRORS[name] ?? []
}

/** "`.actrc`, `deploy/env.gitea.example`" — para as mensagens de erro. */
export function mirrorTextOf(name) {
  return mirrorListText(mirrorsOf(name))
}

/**
 * O valor que cada espelho declara, por variável.
 *
 * Um espelho ausente ou sem a linha é OMITIDO (como no `bun-version.mjs`): a
 * leitura é a parte de baixo do contrato — quem cobra a EXISTÊNCIA da linha é o
 * guard estático.
 *
 * @param {string} [root]
 * @returns {Record<string, {file: string, value: string}[]>}
 */
export function declaredImageMirrors(root = process.cwd()) {
  const out = {}
  for (const name of IMAGE_VARIABLES) out[name] = readMirrorValues(root, mirrorsOf(name))
  return out
}

/**
 * O VALOR declarado de uma variável (o primeiro espelho que a declara), com o
 * arquivo de onde ele veio — a base da comparação de valor.
 *
 * @param {string} root
 * @param {string} name
 * @returns {{value: string, file: string}|null}
 */
export function declaredImageValue(root, name) {
  const [first] = readMirrorValues(root, mirrorsOf(name))
  return first ? { value: first.value, file: first.file } : null
}

/**
 * As formas em que um DEFAULT embutido carrega o valor, por família de arquivo.
 * Uma régua só para "o que conta como default": o guard de compose, o de shell e
 * o de workflow usam ESTA função em vez de reimplementar o regex.
 *
 * - `subst`  — `${NOME:-valor}` (compose, shell);
 * - `js`     — `X || "valor"` / `X ?? 'valor'` sobre a variável (script): a
 *              forma que EXISTIA no repositório e que a migração eliminou;
 * - `expr`   — `vars.NOME || 'valor'` (workflow).
 *
 * QUEM VALE EM CADA FAMÍLIA é decisão do chamador e está escrita (o guard do
 * registry declara: em `.mjs` só a forma `js` é default — o `${NOME:-x}` ali
 * vive dentro de MENSAGEM, não é JS válido fora de string).
 *
 * VALOR VAZIO NÃO ENTRA (`X || ""`, `${NOME:-}`): é o idioma de coalescência de
 * um valor que pode faltar, não uma afirmação de valor — não há o que comparar
 * nem o que envelhecer. Contá-lo como default daria ao guard a única classe de
 * violação que ele não pode ter: a falsa.
 *
 * @param {string} name
 * @param {string} line
 * @returns {{value: string, form: "subst"|"js"|"expr"}[]}
 */
export function defaultsInLine(name, line) {
  const text = String(line ?? "")
  const out = []
  for (const m of text.matchAll(new RegExp(String.raw`\$\{${name}:-([^}]*)\}`, "g"))) {
    const value = m[1].trim()
    if (value !== "") out.push({ value, form: "subst" })
  }
  for (const m of text.matchAll(
    new RegExp(
      String.raw`(?:process\.env\.${name}|env\.${name}|values\.${name}|process\.env\[["']${name}["']\])\s*(?:\|\||\?\?)\s*["'\`]([^"'\`]*)["'\`]`,
      "g",
    ),
  )) {
    const value = m[1].trim()
    if (value !== "") out.push({ value, form: "js" })
  }
  for (const m of text.matchAll(new RegExp(String.raw`vars\.${name}\s*\|\|\s*'([^']*)'`, "g"))) {
    const value = m[1].trim()
    if (value !== "") out.push({ value, form: "expr" })
  }
  return out
}

/**
 * A FORMA de default que VALE em cada família de arquivo — a outra metade da
 * régua, e a que separa "default embutido" de "texto parecido com default".
 *
 * POR QUE É UMA TABELA ESCRITA: a varredura lia todas as formas em todos os
 * arquivos, e por isso acusou um `printf` de script shell como se fosse o
 * fallback de um workflow (`vars.NOME || 'x'` dentro do payload de um teste) — o
 * guard opinando sobre uma linha que não é do gênero que ele julga. A pergunta
 * "o que conta como default" tem UMA resposta por LINGUAGEM, e ela está aqui:
 *
 *   - `compose`/`shell` — `${NOME:-valor}` (a forma de interpolação do shell);
 *   - `js`              — `X || "valor"` / `X ?? 'valor'` (a forma que o
 *                         resolvedor substituiu);
 *   - `workflow`        — `vars.NOME || 'valor'` (a forma do YAML do runner).
 *
 * O que casa uma forma FORA da família é prosa (mensagem, fixture, here-doc) —
 * contado e dito no relatório, nunca julgado como valor.
 */
export const DEFAULT_FORMS_BY_FAMILY = {
  compose: ["subst"],
  shell: ["subst"],
  js: ["js"],
  workflow: ["expr"],
}

/**
 * O VEREDITO de um default contra o valor DECLARADO — a comparação de valor
 * ÚNICA do repositório para estas variáveis (o guard não tem a sua própria).
 *
 * INDETERMINADO não é "passou": sem nenhum arquivo comitado declarando a
 * variável não há contra o que comparar, e o guard não presume — o default
 * passa a ser a única fonte do que roda, e isso é dito.
 *
 * @param {string} name
 * @param {string} value   o default embutido (lido por `defaultsInLine`)
 * @param {{root?: string}} [opts]
 * @returns {{state: "proven"|"violated"|"indeterminate", declared: {value: string, file: string}|null, detail: string}}
 */
export function defaultValueVerdict(name, value, { root = process.cwd() } = {}) {
  const declared = declaredImageValue(root, name)
  if (declared === null) {
    return {
      state: "indeterminate",
      declared: null,
      detail:
        `nenhum arquivo comitado declara ${name}, então não há contra o que comparar o default '${value}' — ` +
        `onde a variável não existe é o default que vale, e ele passa a ser a única fonte do que roda (declare ${name} em ${mirrorTextOf(name)})`,
    }
  }
  if (value !== declared.value) {
    return {
      state: "violated",
      declared,
      detail:
        `o default é '${value}' e ${name} está declarado como '${declared.value}' em \`${declared.file}\` — ` +
        `onde a variável não existe (um env que não a declara, um host sem ela) o default vale, e a imagem que roda não é a que o repositório declara`,
    }
  }
  return {
    state: "proven",
    declared,
    detail: `'${value}' confere com \`${declared.file}\``,
  }
}

/**
 * O registry e o namespace, RESOLVIDOS. Nunca lança: devolve `null` no que não
 * houver de onde tirar (quem decide o que fazer com isso é o consumidor).
 *
 * @param {{root?: string, env?: Record<string, string|undefined>, mirrors?: typeof IMAGE_MIRRORS}} [opts]
 * @returns {{registry: string|null, namespace: string|null, sources: Record<string, string|null>}}
 */
export function resolveImageSource({
  root = process.cwd(),
  env = process.env,
  mirrors = IMAGE_MIRRORS,
} = {}) {
  const read = (name) => {
    const fromEnv = (env?.[name] ?? "").trim()
    if (fromEnv !== "") return { value: fromEnv, source: `a variável do ambiente (${name})` }
    const [first] = readMirrorValues(root, mirrors[name] ?? [])
    if (first) return { value: first.value, source: `o espelho \`${first.file}\`` }
    return null
  }
  const registry = read("IMAGE_REGISTRY")
  const namespace = read("IMAGE_NAMESPACE")
  return {
    registry: registry?.value ?? null,
    namespace: namespace?.value ?? null,
    sources: {
      IMAGE_REGISTRY: registry?.source ?? null,
      IMAGE_NAMESPACE: namespace?.source ?? null,
    },
  }
}

/**
 * Igual a `resolveImageSource`, mas LANÇA quando falta o valor — a forma que um
 * script usa quando um default silencioso seria pior que falhar.
 *
 * A mensagem nomeia os espelhos e o motivo: quem lê o erro sabe ONDE declarar e
 * POR QUE não existe reserva.
 *
 * @param {{root?: string, env?: Record<string, string|undefined>, mirrors?: typeof IMAGE_MIRRORS}} [opts]
 * @returns {{registry: string, namespace: string, sources: Record<string, string>}}
 */
export function requireImageSource(opts = {}) {
  const resolved = resolveImageSource(opts)
  const missing = []
  if (resolved.registry === null) missing.push("IMAGE_REGISTRY")
  if (resolved.namespace === null) missing.push("IMAGE_NAMESPACE")
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(" e ")} não declarado${missing.length > 1 ? "s" : ""}: nem no ambiente nem nos espelhos do repositório ` +
        `(${missing.map((n) => mirrorTextOf(n)).join("; ")}). ` +
        `Não existe default de reserva de propósito: um literal aqui envelhece em silêncio — ` +
        `depois de trocar de registry o script continua puxando do VELHO, e como a imagem continua existindo lá, nada fica vermelho. ` +
        `Declare o valor no espelho mais próximo (ou passe \`${IMAGE_REGISTRY_VAR}\`/\`${IMAGE_NAMESPACE_VAR}\` pelo \`env:\` do passo).`,
    )
  }
  return {
    registry: resolved.registry,
    namespace: resolved.namespace,
    sources: {
      IMAGE_REGISTRY: resolved.sources.IMAGE_REGISTRY,
      IMAGE_NAMESPACE: resolved.sources.IMAGE_NAMESPACE,
    },
  }
}

/**
 * A referência de imagem montada do jeito que o compose a monta
 * (`<registry>/<namespace>/<repo>:<tag>`), a partir do que foi RESOLVIDO.
 *
 * Existe para o consumidor não repetir a concatenação (e para o `trim` das
 * barras ficar num lugar só).
 *
 * @param {{registry: string, namespace: string}} source
 * @param {string} repo
 * @param {string} tag
 * @returns {string}
 */
export function imageRefOf(source, repo, tag) {
  const registry = source.registry.replace(/\/+$/, "")
  const namespace = source.namespace.replace(/^\/+|\/+$/g, "")
  return `${registry}/${namespace}/${repo}:${tag}`
}
