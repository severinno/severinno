/**
 * remedy-canal/run-syntax.mjs
 *
 * A DECLARAÇÃO DO CANAL do remendo dos corpos `run:` — o que o comentário do PR
 * publica quando o gate `bash -n` acusa a cicatriz.
 *
 * UMA DECLARAÇÃO POR REMENDO, DESCOBERTA PELO NOME DO ARQUIVO (como as classes do
 * pre-commit em `scripts/remedy-classes/`). O `id` desta declaração é o MESMO id
 * da classe correspondente — `scripts/remedy-classes/run-syntax.mjs` — e é esse
 * par que faz a descoberta (`scripts/pr-fixers.mjs`) montar o canal sem registro
 * escrito à mão: o comando do `--fix`, a ordem e o guard DONO saem da CLASSE; a
 * prosa do comentário, daqui. O dono não é repetido aqui de propósito (duas
 * cópias do caminho do guard divergiriam na primeira troca de superfície).
 *
 * ESTE MÓDULO É UMA FOLHA (não importa nada): é o que impede o ciclo de import
 * que trava o node com o `top-level await` da descoberta — a régua está escrita
 * no cabeçalho de `scripts/remedy-canal.mjs`. Se este arquivo passar a importar
 * um guard (para medir o próprio patch, por exemplo), o hook de pre-commit
 * MORRE: medido com `exit` 13 e zero saída.
 *
 * O CONTRATO DO BLOCO (validado em `pr-fixers.mjs`, fail-closed):
 *   - `id`     — igual ao nome do arquivo, e igual ao id da classe do pre-commit;
 *   - `marker` — comentário HTML ÚNICO entre os fixers: a reconciliação no PR é
 *                POR marcador, e dois fixers com o mesmo se retirariam um ao
 *                outro;
 *   - `gateJob`— o nome do check (a coluna "o que rodou" do corpo);
 *   - `titulo`, `naoCobre`, `rodape` — texto não vazio;
 *   - `achado` — FUNÇÃO de N: a prosa do achado conta as remendas encontradas;
 *   - `default`— `true` em EXATAMENTE um fixer: é o que o `fixerOf()` sem
 *                argumento publica. Zero é "ninguém sabe qual é o default"; dois
 *                é a escolha feita por ordem de arquivo, que muda entre hosts.
 */

export default {
  id: "run-syntax",
  // O default do `fixerOf()` sem argumento: a CLI chamada sem `--fixer`.
  default: true,
  marker: "<!-- run-syntax-remedy -->",
  gateJob: "Workflow run syntax (bash -n)",
  titulo: "🩹 Remendo mecânico — o gate `bash -n` dos corpos `run:`",
  achado: (n) =>
    `O check **Workflow run syntax (bash -n)** encontrou **${n}** corpo(s) de passo com a` +
    "\n**cicatriz mecânica** que este repositório já sabe remendar: um **operador pendente**" +
    "\nno fim do bloco `run: |` (a reescrita em massa deixou `&&`, `|`, `\\`, `<<<`…).",
  naoCobre:
    "O fixer remenda UMA linha ancorada no bloco `run: |`; estes casos têm motivo próprio e" +
    "\n**precisam de mão**:",
  rodape:
    "> O remendo tira a **cicatriz** que impedia o parsing — ele **NÃO reconstrói a linha" +
    "\n> engolida** pela reescrita: **o diff é o que se revisa**.",
}
