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

# ── Variáveis ─────────────────────────────────────────────────────────────
COMPOSE_FILES := -f docker-compose.yml
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
	@echo ""
	@echo "$(GREEN)Manutencao:$(NC)"
	@echo "  make clean          Limpa builds, caches e containers"
	@echo "  make reset          Destroi tudo e recria do zero"
	@echo ""

# ═════════════════════════════════════════════════════════════════════════════
infra:
	@echo "$(CYAN)[..] Subindo infraestrutura...$(NC)"
	docker compose $(COMPOSE_FILES) up -d postgres redis minio pgbouncer
	@echo "$(GREEN)[OK] PostgreSQL + Redis + MinIO + PgBouncer pronto$(NC)"

infra-full:
	@echo "$(CYAN)[..] Subindo infraestrutura completa...$(NC)"
	docker compose $(COMPOSE_FILES) $(COMPOSE_FULL) up -d
	@echo "$(GREEN)[OK] Infraestrutura completa pronta$(NC)"

infra-down:
	@echo "$(YELLOW)[..] Derrubando infraestrutura...$(NC)"
	docker compose $(COMPOSE_FILES) down
	@echo "$(GREEN)[OK] Infraestrutura derrubada$(NC)"

workers:
	@echo "$(CYAN)[..] Subindo workers...$(NC)"
	docker compose $(COMPOSE_FILES) $(COMPOSE_WORKERS) up -d
	@echo "$(GREEN)[OK] Workers iniciados$(NC)"

# ═════════════════════════════════════════════════════════════════════════════
build:
	@echo "$(CYAN)[..] Buildando aplicacao...$(NC)"
	docker compose $(COMPOSE_FILES) build app
	@echo "$(GREEN)[OK] Build concluido$(NC)"

deploy: build
	@echo "$(CYAN)[..] Realizando rolling update...$(NC)"
	docker compose $(COMPOSE_FILES) up -d --no-deps --build app
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
	docker compose $(COMPOSE_FILES) logs -f

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
	bunx tsc --noEmit
	@echo "$(GREEN)[OK] Lint + typecheck concluidos$(NC)"

# ═════════════════════════════════════════════════════════════════════════════
clean:
	@echo "$(YELLOW)[..] Limpando builds e caches...$(NC)"
	rm -rf .next node_modules/.cache
	rm -rf .backups
	docker compose $(COMPOSE_FILES) down -v --remove-orphans 2>/dev/null || true
	docker system prune -f --volumes 2>/dev/null || true
	@echo "$(GREEN)[OK] Limpeza concluida$(NC)"

reset:
	@echo "$(RED)[..] ATENCAO: Isso vai destruir todos os dados!$(NC)"; \
	echo ""; \
	echo -n "Digite 'RESET' para confirmar: "; \
	read CONFIRM; \
	if [ "$$CONFIRM" = "RESET" ]; then \
		echo "$(RED)[..] Destruindo tudo...$(NC)"; \
		docker compose $(COMPOSE_FILES) down -v 2>/dev/null || true; \
		rm -rf .next node_modules; \
		bun install; \
		echo "$(GREEN)[OK] Reset concluido. Execute 'make setup' para comecar.$(NC)"; \
	else \
		echo "$(YELLOW)Operacao cancelada.$(NC)"; \
	fi
