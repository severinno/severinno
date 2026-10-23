# OSRM Data Directory

Este diretório contém os arquivos compilados da malha viária OpenStreetMap para o motor OSRM (Multi-Level Dijkstra - MLD).

## Gestão de Binários

Os arquivos compilados (`*.osrm*`) e arquivos brutos de malha (`*.osm`, `*.pbf`) são binários pesados e são ignorados pelo Git via `.gitignore` para manter o repositório leve e rápido.

## Como Gerar ou Sincronizar os Dados Localmente / VPS:

Execute o script de sincronização com lock de concorrência:

```bash
bash scripts/sync-osrm-data.sh
```

Ou execute o script de compilação inicial para baixar a malha viária e compilar o MLD via container Docker OSRM:

```bash
bash scripts/setup-osrm.sh
```
