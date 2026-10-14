#!/usr/bin/env bash
# =============================================================================
# scripts/setup-geo-engine.sh — Inicializador da Infraestrutura Geo 100% Open Source
# =============================================================================
# Prepara os diretórios, baixa dados da malha viária brasileira do OpenStreetMap (Geofabrik)
# e processa os dados para o OSRM e Valhalla rodarem 100% offline e locais.
#
# Usage:
#   bash scripts/setup-geo-engine.sh [region]
#
# Exit codes:
#   0 — success
#   1 — failure
# =============================================================================

set -euo pipefail

REGION="${1:-sudeste}" # default: sudeste (SP, RJ, MG, ES) — mais leve e rápido (~1.5GB)
DATA_DIR="$(pwd)/data/osrm"
VALHALLA_DIR="$(pwd)/data/valhalla"

echo "=== [1/4] Criando diretórios para OSRM e Valhalla ==="
mkdir -p "$DATA_DIR"
mkdir -p "$VALHALLA_DIR"

PBF_FILE="${REGION}-latest.osm.pbf"
PBF_PATH="${DATA_DIR}/${PBF_FILE}"

echo "=== [2/4] Verificando dados OpenStreetMap para região: ${REGION} ==="
if [ ! -f "$PBF_PATH" ]; then
  echo "Baixando malha viária oficial Geofabrik (${PBF_FILE})..."
  wget -c "https://download.geofabrik.de/south-america/brazil/${PBF_FILE}" -O "$PBF_PATH"
else
  echo "Arquivo ${PBF_PATH} já presente. Pulando download."
fi

echo "=== [3/4] Pré-processando malha com OSRM Backend (Multi-Level Dijkstra) ==="
echo "Executando osrm-extract via container temporário..."
docker run --rm -v "${DATA_DIR}:/data" ghcr.io/project-osrm/osrm-backend:v5.27.1 \
  osrm-extract -p /opt/car.lua "/data/${PBF_FILE}"

echo "Executando osrm-partition..."
docker run --rm -v "${DATA_DIR}:/data" ghcr.io/project-osrm/osrm-backend:v5.27.1 \
  osrm-partition "/data/${REGION}-latest.osrm"

echo "Executando osrm-customize..."
docker run --rm -v "${DATA_DIR}:/data" ghcr.io/project-osrm/osrm-backend:v5.27.1 \
  osrm-customize "/data/${REGION}-latest.osrm"

# Cria symlink para o nome padrão esperado pelo docker-compose.geo.yml
if [ "$REGION" != "brazil" ]; then
  ln -sf "${REGION}-latest.osrm" "${DATA_DIR}/brazil-latest.osrm" || true
fi

echo "=== [4/4] Inicialização concluída com sucesso! ==="
echo "Para subir os serviços soberanos:"
echo "  docker compose -f docker-compose.geo.yml up -d"
echo "O OSRM estará disponível em: http://127.0.0.1:5000"
echo "O Valhalla estará disponível em: http://127.0.0.1:8002"
