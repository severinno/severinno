# 🚀 Severinno Marketplace — Load Testing

## Visão Geral

Testes de carga para validar a performance da API sob diferentes níveis de tráfego.

## Pré-requisitos

```bash
# Instalar k6
# macOS
brew install k6

# Linux
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D68
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6

# Windows
choco install k6
```

## Executar Testes

### Teste Básico
```bash
k6 run loadtest/k6-load-test.js
```

### Com Output JSON
```bash
k6 run --out json=loadtest/results.json loadtest/k6-load-test.js
```

### Com Output InfluxDB
```bash
k6 run --out influxdb=http://localhost:8086/k6 loadtest/k6-load-test.js
```

### Configurar URL Base
```bash
BASE_URL=https://staging.severinno.com.br k6 run loadtest/k6-load-test.js
```

## Thresholds (Critérios de Aprovação)

| Métrica | Threshold | Descrição |
|---------|-----------|-----------|
| `http_req_duration` | P95 < 2000ms | 95% das requests < 2s |
| `http_req_failed` | Rate < 1% | Taxa de erro < 1% |
| `health_duration` | P95 < 500ms | Health check P95 < 500ms |
| `providers_duration` | P95 < 3000ms | Providers P95 < 3s |
| `categories_duration` | P95 < 1000ms | Categories P95 < 1s |

## Cenários de Teste

### Ramp Up Gradual
```
30s → 10 VUs
1m  → 10 VUs (sustain)
30s → 50 VUs
2m  → 50 VUs (sustain)
30s → 100 VUs
1m  → 100 VUs (sustain)
30s → 0 VUs (ramp down)
```

### Total: ~7 minutos

## Métricas Coletadas

- **http_req_duration**: Latência de requests HTTP
- **http_req_failed**: Taxa de falha
- **health_duration**: Latência do health check
- **providers_duration**: Latência da listagem de providers
- **categories_duration**: Latência da listagem de categorias
- **errors**: Taxa de erro customizada

## Resultados

Os resultados são salvos em `loadtest/results-*.json` com o formato:

```json
{
  "timestamp": "2026-08-18T16:30:00.000Z",
  "duration": 420,
  "vus": { "max": 100 },
  "http": {
    "requests": 15000,
    "duration_p50": 150,
    "duration_p95": 800,
    "duration_p99": 1500,
    "failed_rate": 0.002
  },
  "custom": {
    "health_p95": 50,
    "providers_p95": 1200,
    "categories_p95": 300,
    "error_rate": 0.001
  },
  "thresholds_met": true
}
```

## Comparar Resultados

```bash
# Salvar baseline
k6 run --out json=loadtest/baseline.json loadtest/k6-load-test.js

# Rodar novamente
k6 run --out json=loadtest/current.json loadtest/k6-load-test.js

# Comparar (usando jq)
jq -s '.[0] as $base | .[1] | {
  duration: .duration,
  p50_diff: (.http.duration_p50 - $base.http.duration_p50),
  p95_diff: (.http.duration_p95 - $base.http.duration_p95),
  error_diff: (.http.failed_rate - $base.http.failed_rate)
}' loadtest/baseline.json loadtest/current.json
```

## Troubleshooting

### k6 não conecta na API
```bash
# Verificar se a API está rodando
curl http://localhost:3000/api/health

# Verificar logs
docker compose logs app
```

### Muitos erros 429 (Rate Limit)
```bash
# Aumentar rate limit no .env.staging
GLOBAL_RATE_LIMIT_MAX=1000
GLOBAL_RATE_LIMIT_WINDOW_MS=60000
```

### Memória insuficiente
```bash
# Reduzir VUs máximas
k6 run --vus 50 --duration 2m loadtest/k6-load-test.js
```
