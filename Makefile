# ============================================================================
# Severinno Marketplace — Makefile de Infraestrutura
# ============================================================================
# Comandos centralizados para DevOps, deploy e manutenção.
# ============================================================================

.PHONY: help infra infra-full infra-down build deploy backup backup-s3 restore \
        dlq-monitor logs db-studio db-migrate db-seed test test-e2e lint clean \
        setup health workers

# ── Cores ──────────────────────────────────────────────────────────────────
CYAN  := \033[0;36m
GREEN := \033[0;32m
YELLOW:= \033[1;33m
RED   := \033[0;31m
NC    := \033[0m

# Infra real (PostGIS + Redis + RabbitMQ + OpenSearch + MinIO + Realtime + GlitchTip)
# mora no docker-compose.dev.yml — o docker-compose.yml só tem app+redis.
COMPOSE_INFRA := -f docker-compose.dev.yml
# App (Next.js) — build/deploy do serviço `app`
COMPOSE_APP   := -f docker-compose.yml
# OSRM é opcional (profile routing) — só sobe com --profile routing
COMPOSE_ROUTING := --profile routing
COMPOSE_FULL  := --profile full
COMPOSE_WORKERS := --profile workers

# ═════════════════════════════════════════════════════════════════════════════
help:
	@echo ""
	@echo "$(CYAN)Severinno Marketplace — Comandos de Infraestrutura$(NC)"
	@echo ""
	@echo "$(GREEN)Infraestrutura Docker:$(NC)"
	@echo "  make infra          Sobe PostgreSQL + Redis + MinIO"
	@echo "  make infra-full     Sobe infra + RabbitMQ + Workers"
	@echo "  make infra-down     Derruba toda a infraestrutura"
	@echo ""
	@echo "$(GREEN)Build & Deploy:$(NC)"
	@echo "  make build          Builda a aplicação Next.js"
	@echo "  make deploy         Build + rolling restart"
	@echo "  make workers        Sobe workers (email+notificacao+search)"
	@echo ""
	@echo "$(GREEN)Banco de Dados:$(NC)"
	@echo "  make backup         Backup local do PostgreSQL"
	@echo "  make backup-s3      Backup + upload para S3/R2"
	@echo "  make restore        Restaura do backup mais recente"
	@echo "  make test-restore   Valida o backup restaurando em banco descartavel"
	@echo "  make db-studio      Abre Prisma Studio"
	@echo "  make db-migrate     Aplica migrations pendentes"
	@echo "  make db-seed        Popula banco com dados demo"
	@echo ""
	@echo "$(GREEN)Monitoramento:$(NC)"
	@echo "  make dlq-monitor    Verifica filas DLQ do RabbitMQ"
	@echo "  make logs           Logs dos containers"
	@echo "  make health         Verifica saude da aplicacao"
	@echo "  make setup          Setup completo (check + infra + seed)"
	@echo ""
	@echo "$(GREEN)Testes & Qualidade:$(NC)"
	@echo "  make test           Testes unitarios (Vitest)"
	@echo "  make test-e2e       Testes E2E (Playwright)"
	@echo "  make lint           ESLint + TypeScript check"
	@echo "  make qa             Suite completa de QA (lint + typecheck + test + barrel-lint)"
	@echo "  make pr-ready       Valida tudo para PR (qa + build)"
	@echo "  make guard          Executa encoding guards locais"
	@echo "  make analyze        Executa o Next.js Bundle Analyzer"
	@echo "  make smoke          Executa smoke test unificado pos-deploy"
	@echo "  make search-reindex Reindexa catalogo no OpenSearch"
	@echo ""
	@echo "$(GREEN)Manutencao:$(NC)"
	@echo "  make backup-auto    Executa backup automatico com verificacao"
	@echo "  make clean          Limpa builds, caches e containers"
	@echo "  make reset          Destroi tudo e recria do zero"
	@echo ""

# ═════════════════════════════════════════════════════════════════════════════
infra:
	@echo "$(CYAN)[..] Subindo infraestrutura (postgis + redis + rabbitmq + realtime + minio)...$(NC)"
	docker compose $(COMPOSE_INFRA) up -d postgis redis rabbitmq realtime minio
	@echo "$(GREEN)[OK] PostgreSQL/PostGIS + Redis + RabbitMQ + Realtime + MinIO pronto$(NC)"

infra-full:
	@echo "$(CYAN)[..] Subindo infraestrutura completa (inclui OpenSearch + GlitchTip + OSRM)...$(NC)"
	docker compose $(COMPOSE_INFRA) $(COMPOSE_ROUTING) up -d
	@echo "$(GREEN)[OK] Infraestrutura completa pronta$(NC)"

infra-down:
	@echo "$(YELLOW)[..] Derrubando infraestrutura...$(NC)"
	docker compose $(COMPOSE_INFRA) down
	@echo "$(GREEN)[OK] Infraestrutura derrubada$(NC)"

workers:
	@echo "$(CYAN)[..] Iniciando worker (consumidor de filas)...$(NC)"
	bun run consumer
	@echo "$(GREEN)[OK] Worker iniciado$(NC)"

# ═════════════════════════════════════════════════════════════════════════════
build:
	@echo "$(CYAN)[..] Buildando aplicacao...$(NC)"
	docker compose $(COMPOSE_APP) build app
	@echo "$(GREEN)[OK] Build concluido$(NC)"

deploy: build
	@echo "$(CYAN)[..] Realizando rolling update...$(NC)"
	docker compose $(COMPOSE_APP) up -d --no-deps --build app
	@echo "$(GREEN)[OK] Deploy concluido$(NC)"

# ═════════════════════════════════════════════════════════════════════════════
backup:
	@echo "$(CYAN)[..] Iniciando backup do PostgreSQL...$(NC)"
	bash scripts/backup-db.sh
	@echo "$(GREEN)[OK] Backup concluido$(NC)"

backup-s3:
	@echo "$(CYAN)[..] Iniciando backup + upload S3...$(NC)"
	bash scripts/backup-db.sh --s3
	@echo "$(GREEN)[OK] Backup + upload S3 concluido$(NC)"

restore:
	@echo "$(YELLOW)[..] Restaurando banco do backup mais recente...$(NC)"
	bash scripts/restore-db.sh --latest

test-restore:
	@echo "$(CYAN)[..] Testando restore do backup em banco descartavel...$(NC)"
	bash scripts/test-restore.sh
	@echo "$(GREEN)[OK] Teste de restore concluido$(NC)"

db-studio:
	@echo "$(CYAN)[..] Abrindo Prisma Studio...$(NC)"
	bunx prisma studio

db-migrate:
	@echo "$(CYAN)[..] Aplicando migrations...$(NC)"
	bunx prisma migrate deploy
	@echo "$(GREEN)[OK] Migrations aplicadas$(NC)"

db-seed:
	@echo "$(CYAN)[..] Populando banco...$(NC)"
	bun run db:seed
	@echo "$(GREEN)[OK] Seed concluido$(NC)"

# ═════════════════════════════════════════════════════════════════════════════
dlq-monitor:
	@echo "$(CYAN)[..] Verificando dead-letter queues...$(NC)"
	bash scripts/dlq-monitor.sh
	@echo "$(GREEN)[OK] Monitoramento DLQ concluido$(NC)"

logs:
	docker compose $(COMPOSE_INFRA) logs -f

health:
	@echo "$(CYAN)[..] Verificando saude da aplicacao...$(NC)"
	@curl -sf http://localhost:3000/api/health | python3 -m json.tool 2>/dev/null || \
	curl -sf http://localhost:3000/api/health 2>/dev/null || \
	echo "$(RED)App nao responde na porta 3000$(NC)"

# ═════════════════════════════════════════════════════════════════════════════
setup: infra
	@echo "$(CYAN)[..] Rodando setup completo...$(NC)"
	bash scripts/setup.sh --quick
	@echo "$(GREEN)[OK] Setup concluido! App em http://localhost:3000$(NC)"

# ═════════════════════════════════════════════════════════════════════════════
test:
	@echo "$(CYAN)[..] Rodando testes unitarios...$(NC)"
	bun run test:run
	@echo "$(GREEN)[OK] Testes concluidos$(NC)"

test-e2e:
	@echo "$(CYAN)[..] Rodando testes E2E...$(NC)"
	bun run e2e

lint:
	@echo "$(CYAN)[..] Rodando linter + typecheck...$(NC)"
	bun run lint
	npx tsc --noEmit
	@echo "$(GREEN)[OK] Lint + typecheck concluidos$(NC)"

qa:
	@echo "$(CYAN)[..] Executando suite completa de QA...$(NC)"
	bun run qa
	@echo "$(GREEN)[OK] Suite de QA aprovada!$(NC)"

pr-ready: qa
	@echo "$(CYAN)[..] Verificando build de producao...$(NC)"
	bun run build
	@echo "$(GREEN)[OK] PR pronto para envio!$(NC)"

guard:
	@echo "$(CYAN)[..] Executando encoding guards...$(NC)"
	bash scripts/run-encoding-guards.sh
	@echo "$(GREEN)[OK] Encoding guards aprovados!$(NC)"

analyze:
	@echo "$(CYAN)[..] Executando Next.js Bundle Analyzer...$(NC)"
	bun run build:analyze
	@echo "$(GREEN)[OK] Analise de bundle concluida!$(NC)"

smoke:
	@echo "$(CYAN)[..] Executando Smoke Test unificado...$(NC)"
	node scripts/smoke-test.mjs
	@echo "$(GREEN)[OK] Smoke test aprovado!$(NC)"

search-reindex:
	@echo "$(CYAN)[..] Executando reindexacao do OpenSearch...$(NC)"
	node scripts/search-reindex.mjs
	@echo "$(GREEN)[OK] Reindexacao concluida!$(NC)"

benchmark-multi-cache:
	@echo "$(CYAN)[..] Executando benchmark de concorrencia do cache multi-nivel...$(NC)"
	node scripts/benchmark-multi-cache.mjs
	@echo "$(GREEN)[OK] Benchmark do cache aprovado!$(NC)"

backup-auto:
	@echo "$(CYAN)[..] Executando backup automatico com verificacao...$(NC)"
	bash scripts/backup-cron.sh
	@echo "$(GREEN)[OK] Backup automatico concluido!$(NC)"

# ═════════════════════════════════════════════════════════════════════════════
clean:
	@echo "$(YELLOW)[..] Limpando builds e caches...$(NC)"
	rm -rf .next node_modules/.cache
	rm -rf .backups
	docker compose $(COMPOSE_INFRA) down --remove-orphans 2>/dev/null || true
	docker compose $(COMPOSE_APP) down --remove-orphans 2>/dev/null || true
	@echo "$(GREEN)[OK] Limpeza concluida$(NC)"

reset:
	@echo "$(RED)[..] ATENCAO: Isso vai destruir todos os dados!$(NC)"; \
	echo ""; \
	echo -n "Digite 'RESET' para confirmar: "; \
	read CONFIRM; \
	if [ "$$CONFIRM" = "RESET" ]; then \
		echo "$(RED)[..] Destruindo tudo...$(NC)"; \
		docker compose $(COMPOSE_INFRA) down -v 2>/dev/null || true; \
		docker compose $(COMPOSE_APP) down -v 2>/dev/null || true; \
		rm -rf .next node_modules; \
		bun install; \
		echo "$(GREEN)[OK] Reset concluido. Execute 'make setup' para comecar.$(NC)"; \
	else \
		echo "$(YELLOW)Operacao cancelada.$(NC)"; \
	fi
