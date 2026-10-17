#!/usr/bin/env bash
# =============================================================================
# scripts/setup-ollama.sh — Orquestrador do Runtime Local de IA / SLM (Ollama)
# =============================================================================
# Detecta se o serviço Ollama já roda nativamente no host ou o inicializa
# via Docker Compose (docker-compose.ollama.yml) com limites de 2 vCPUs e 3GB RAM.
#
# Usage:
#   bash scripts/setup-ollama.sh [model_name]
#   Exemplos:
#     bash scripts/setup-ollama.sh qwen2.5-coder:1.5b   # Modelo nativo do host (~986MB)
#     bash scripts/setup-ollama.sh llama3.2:1b          # Padrão intermediário (~1.3GB)
#     bash scripts/setup-ollama.sh llama3.2:3b          # Raciocínio avançado (~2.0GB)
#
# Exit codes:
#   0 — sucesso
#   1 — falha na inicialização ou teste
# =============================================================================

set -euo pipefail

MODEL="${1:-qwen2.5-coder:1.5b}"
COMPOSE_FILE="docker-compose.ollama.yml"
OLLAMA_HOST="${OLLAMA_HOST:-127.0.0.1}"
OLLAMA_PORT="${OLLAMA_PORT:-11434}"
BASE_URL="http://${OLLAMA_HOST}:${OLLAMA_PORT}"

echo "🧠 === [1/4] Verificando disponibilidade do Runtime Ollama em ${BASE_URL} ==="
if curl -s "${BASE_URL}/api/tags" >/dev/null 2>&1; then
  echo "✅ Serviço Ollama já está em execução e respondendo no host (${BASE_URL})!"
else
  echo "Iniciando contêiner Ollama via Docker Compose (${COMPOSE_FILE})..."
  docker compose -f "$COMPOSE_FILE" up -d
fi

echo "⏳ === [2/4] Aguardando API do Ollama responder em ${BASE_URL} ==="
MAX_RETRIES=30
COUNT=0
until curl -s "${BASE_URL}/api/tags" >/dev/null 2>&1 || [ "$COUNT" -ge "$MAX_RETRIES" ]; do
  sleep 1
  COUNT=$((COUNT + 1))
done

if [ "$COUNT" -ge "$MAX_RETRIES" ]; then
  echo "❌ Erro: Timeout aguardando API do Ollama responder em ${BASE_URL}."
  exit 1
fi

echo "✅ Ollama online e respondendo a healthcheck!"

echo "📥 === [3/4] Baixando/verificando modelo SLM: ${MODEL} ==="
if grep -q "\"name\":\"${MODEL}" <<< "$(curl -s "${BASE_URL}/api/tags")"; then
  echo "✅ Modelo ${MODEL} já disponível no runtime!"
else
  echo "⏳ Baixando modelo ${MODEL} via Ollama API..."
  curl -s -X POST "${BASE_URL}/api/pull" -d "{\"name\": \"${MODEL}\"}"
  echo ""
  echo "✅ Download do modelo ${MODEL} concluído!"
fi

echo "🧪 === [4/4] Executando probe de inferência de teste ==="
RESPONSE=$(curl -s -X POST "${BASE_URL}/api/generate" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"${MODEL}\",
    \"prompt\": \"Responda apenas OK:\",
    \"stream\": false,
    \"options\": {
      \"num_predict\": 10,
      \"temperature\": 0.1
    }
  }")

if grep -q "response" <<< "$RESPONSE"; then
  echo "✅ Resposta da IA local obtida com sucesso!"
  echo "📄 Amostra: $(echo "$RESPONSE" | grep -o '\"response\":[^,]*' | cut -d':' -f2 | tr -d '\"')"
  echo "🚀 Runtime local do Ollama 100% operacional para uso pelo ai-client.ts!"
else
  echo "⚠️ Resposta inesperada da API: ${RESPONSE}"
  exit 1
fi
