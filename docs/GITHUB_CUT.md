#### Ato 1a — o flip do valor declarado (feito em 2026-09-20, neste commit)

O valor saiu de `ghcr.io` em **todos** os lugares onde o repositório AFIRMA um valor
(não só onde ele o consome):

| onde                                                                                           | o que mudou                                                                                                    |
| :--------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------- |
| `.actrc`                                                                                       | `--var IMAGE_REGISTRY=git.severinno.cloud` (o espelho local do act)                                            |
| `deploy/env.gitea.example`, `.env.production.example`                                          | o valor declarado dos dois templates (o GHCR passou a ser a linha de ROLLBACK, com o motivo escrito)           |
| `deploy/docker-compose.gitea.yml` + `docker-compose.prod.yml` + `docker-compose.hostinger.yml` | 10 defaults `${IMAGE_REGISTRY:-…}` (inclusive os `GITEA_RUNNER_LABELS`, que decidem a imagem que roda os jobs) |
| `scripts/setup-bun-ci.sh`, `scripts/act-startup-bench.sh`, `scripts/publish-ubuntu-bun.sh`     | o default/resolução do registry (este último tinha `ghcr.io` CRAVADO — sobrevivia à virada)                    |
| 10 workflows (8 GitHub + 2 Gitea)                                                              | 13 fallbacks declarados `\|\| 'ghcr.io'`                                                                       |

**Evidência medida** (o guard, no mesmo commit): a classe `ghcr-images` do inventário caiu
de **63 → 50** (`check:github-dependencies --update` é o ato que congela o número; o último
dos 13 caiu quando a checagem de `RepoDigest` do publisher passou a comparar contra o
registry DECLARADO em vez do literal), e a
régua de valor continua verde — `check:registry-source`: **27 defaults em 14 arquivos,
nenhum divergente do declarado**, com o render do compose provado (`declarado =
deploy/env.gitea.example`). O `--update` também registrou **420 → 419** em
`actions-plane`, e a ocorrência que caiu é um `vars.IMAGE_REGISTRY` citado num COMENTÁRIO
(a contagem lê o arquivo inteiro) — está escrito no `porque` da classe.

#### Ato 1b — a publicação das duas imagens (evidência executada aqui)

Os dois artefatos foram publicados num **registry OCI de verdade** (`registry:2`, a mesma
forma que o `image-contract:prove` usa), com a tag local REMOVIDA antes do pull-back — o
que se lê abaixo é o artefato que o registry serve, não o cache local:

| imagem                  | ref publicada                        | digest servido     | evidência DENTRO do artefato puxado                                         |
| :---------------------- | :----------------------------------- | :----------------- | :-------------------------------------------------------------------------- |
| `ubuntu-bun` (o runner) | `<registry>/prova/ubuntu-bun:1.3.14` | `sha256:fd027ee7…` | `bun --version` → `1.3.14`                                                  |
| mirror do Bun           | `<registry>/prova/bun:1.3.14`        | `sha256:e497cb4d…` | `docker create`+`docker cp` → `bun --version` → `1.3.14` (91.802.480 bytes) |

O mirror é publicado como `scratch` (o consumidor é o `docker cp` do tier-3 do
`setup-bun-ci.sh`), então a evidência dele é a EXTRAÇÃO do artefato publicado e a versão
que sai do binário extraído — rodar a imagem inteira não é o caminho do consumidor
e falha por desenho (não há libc no `scratch`).

Fato do host onde o ato rodou: o daemon **recusou matar o container** do registry de prova
(`permission denied` em `kill`/`stop`) — a MESMA limitação que o `image-contract:prove` já
declara (e a razão da porta FIXA `5177` com reuso, em vez de porta sorteada). O container
fica vivo naquela porta e quem tiver permissão o remove com
`docker rm -f prova-publicacao-registry`; nada da prova depende dele depois do pull.
