# 📊 Severinno Marketplace — Monitoring Stack

## Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                     MONITORING STACK                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐    │
│  │   Grafana     │────▶│  Prometheus   │     │    Tempo     │    │
│  │  :3001        │     │    :9090      │     │    :3200     │    │
│  │  Dashboards   │     │   Metrics     │     │   Traces     │    │
│  └──────────────┘     └──────┬───────┘     └──────┬───────┘    │
│                              │                      │             │
│                              ▼                      ▼             │
│                     ┌──────────────┐     ┌──────────────┐       │
│                     │  Severinno    │     │  OTLP HTTP   │       │
│                     │    App        │────▶│   :4318      │       │
│                     │   :3000       │     │  (Traces)    │       │
│                     └──────────────┘     └──────────────┘       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Início Rápido

```bash
# 1. Iniciar o stack de monitoramento
docker compose -f docker-compose.monitoring.yml up -d

# 2. Acessar os serviços
# Grafana:     http://localhost:3001 (admin/admin)
# Prometheus:  http://localhost:9090
# Tempo:       http://localhost:3200

# 3. Verificar status
docker compose -f docker-compose.monitoring.yml ps
```

## Dashboards

### Overview Dashboard

O dashboard principal (`Severinno Marketplace — Overview`) inclui:

| Seção                  | Métricas                                            |
| ---------------------- | --------------------------------------------------- |
| **Overview**           | Response Time (P50/P95), Requests/sec, Error Rate   |
| **HTTP Requests**      | Requests by Status Code, Response Time by Endpoint  |
| **Database**           | DB Query Duration, Active DB Connections            |
| **Redis Cache**        | Cache Hit Ratio, Cache Size, Redis Operations       |
| **Business Metrics**   | Bookings by Status, Revenue (24h), Active Providers |
| **Distributed Traces** | Trace Search (Tempo)                                |

### Métricas Disponíveis

**HTTP Metrics:**

- `http_request_duration_ms_bucket` — Duration histogram
- `http_request_duration_ms_count` — Request count
- `http_request_duration_ms_sum` — Total duration

**Database Metrics:**

- `db_query_duration_ms_bucket` — Query duration histogram
- `pg_stat_activity_count` — Active connections

**Cache Metrics:**

- `redis_cache_hits` — Cache hits
- `redis_cache_misses` — Cache misses
- `redis_memory_used_bytes` — Memory usage

**Business Metrics:**

- `bookings_total` — Total bookings
- `payment_amount_total` — Payment amounts
- `providers_active_total` — Active providers

## Configuração

### Habilitar Métricas no App

Adicione ao `.env.production`:

```env
# Habilitar métricas Prometheus
METRICS_ENABLED=true

# Habilitar tracing OpenTelemetry
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://tempo:4318
OTEL_SERVICE_NAME=severinno-api
```

### Endpoints de Métricas

- `GET /api/metrics/prometheus` — Métricas no formato Prometheus
- `GET /api/health` — Status do sistema (inclui tracing)

## Troubleshooting

### Grafana não conecta ao Prometheus

```bash
# Verificar se Prometheus está rodando
docker compose -f docker-compose.monitoring.yml logs prometheus

# Testar conexão
curl http://localhost:9090/api/v1/targets
```

### Tempo não recebe traces

```bash
# Verificar se OTLP está habilitado
curl http://localhost:3200/ready

# Verificar logs do app
docker compose logs app | grep -i otel
```

### Métricas não aparecem no dashboard

```bash
# Verificar se o endpoint de métricas está acessível
curl http://localhost:3000/api/metrics/prometheus

# Verificar targets no Prometheus
curl http://localhost:9090/api/v1/targets
```

## Referências

- [Prometheus Documentation](https://prometheus.io/docs/)
- [Grafana Documentation](https://grafana.com/docs/)
- [Tempo Documentation](https://grafana.com/docs/tempo/)
- [OpenTelemetry JS](https://opentelemetry.io/docs/languages/js/)
