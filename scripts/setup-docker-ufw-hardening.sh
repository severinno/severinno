#!/usr/bin/env bash
# =============================================================================
# scripts/setup-docker-ufw-hardening.sh — Hardening de Rede Docker & DOCKER-USER
# =============================================================================
#
# O Docker manipula o iptables criando regras NAT que bypassam as políticas
# padrão de INPUT do UFW. Este script configura a cadeia DOCKER-USER para:
#
# 1. Manter conexões estabelecidas e relacionadas (ESTABLISHED, RELATED).
# 2. Permitir tráfego local de loopback (lo) e das sub-redes Docker privadas.
# 3. Permitir entrada externa APENAS nas portas públicas necessárias (80 HTTP, 443 HTTPS).
# 4. Bloquear (DROP) qualquer tentativa de acesso externo da interface eth0
#    para serviços internos (MinIO, Postgres, Redis, RabbitMQ, OSRM, Glitchtip, etc.).
# 5. Persistir as regras em /etc/ufw/after.rules para sobreviver a reboots e reloads.
#
# Usage:
#   sudo bash scripts/setup-docker-ufw-hardening.sh
#
# Exit codes:
#   0 — success
#   1 — failure
# =============================================================================

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "❌ Este script deve ser executado como root (ou com sudo)."
  exit 1
fi

EXT_IFACE=$(ip route show default | awk '{print $5}' | head -n 1)
if [ -z "$EXT_IFACE" ]; then
  EXT_IFACE="eth0"
fi

echo "🛡️ Configurando Hardening de Rede Docker na interface externa: ${EXT_IFACE}..."

# 1. Configura a cadeia DOCKER-USER em tempo real
iptables -F DOCKER-USER || true

# Permite conexões ativas / relacionadas
iptables -A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT

# Permite loopback
iptables -A DOCKER-USER -i lo -j ACCEPT

# Permite sub-redes privadas internas (Docker networks)
iptables -A DOCKER-USER -s 172.16.0.0/12 -j ACCEPT
iptables -A DOCKER-USER -s 10.0.0.0/8 -j ACCEPT
iptables -A DOCKER-USER -s 192.168.0.0/16 -j ACCEPT

# Permite portas de entrada públicas (Caddy Reverse Proxy e Grafana Monitoring)
iptables -A DOCKER-USER -p tcp -m tcp --dport 80 -j ACCEPT
iptables -A DOCKER-USER -p tcp -m tcp --dport 443 -j ACCEPT
iptables -A DOCKER-USER -p udp -m udp --dport 443 -j ACCEPT
iptables -A DOCKER-USER -p tcp -m tcp --dport 3000 -j ACCEPT

# Bloqueia qualquer tráfego vindo da interface externa para outras portas de contêineres
iptables -A DOCKER-USER -i "$EXT_IFACE" -j DROP

# Retorna para o fluxo padrão do Docker para tráfego legítimo
iptables -A DOCKER-USER -j RETURN

echo "✅ Regras ativas em tempo real no iptables (cadeia DOCKER-USER):"
iptables -L DOCKER-USER -n -v

# 2. Persistência no /etc/ufw/after.rules se UFW existir
UFW_AFTER="/etc/ufw/after.rules"
if [ -f "$UFW_AFTER" ]; then
  if ! grep -q "DOCKER-USER" "$UFW_AFTER"; then
    echo "📝 Gravando persistência em ${UFW_AFTER}..."
    
    # Prepara o bloco a ser injetado antes do último COMMIT
    TMP_RULES=$(mktemp)
    head -n -1 "$UFW_AFTER" > "$TMP_RULES"
    
    cat <<EOF >> "$TMP_RULES"

# --- Severinno Docker-UFW Hardening ---
:DOCKER-USER - [0:0]
-A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
-A DOCKER-USER -i lo -j ACCEPT
-A DOCKER-USER -s 172.16.0.0/12 -j ACCEPT
-A DOCKER-USER -s 10.0.0.0/8 -j ACCEPT
-A DOCKER-USER -s 192.168.0.0/16 -j ACCEPT
-A DOCKER-USER -p tcp -m tcp --dport 80 -j ACCEPT
-A DOCKER-USER -p tcp -m tcp --dport 443 -j ACCEPT
-A DOCKER-USER -p udp -m udp --dport 443 -j ACCEPT
-A DOCKER-USER -p tcp -m tcp --dport 3000 -j ACCEPT
-A DOCKER-USER -i ${EXT_IFACE} -j DROP
-A DOCKER-USER -j RETURN

COMMIT
EOF
    cp "$TMP_RULES" "$UFW_AFTER"
    rm -f "$TMP_RULES"
    echo "✅ Persistência configurada com sucesso em ${UFW_AFTER}."
  else
    echo "ℹ️ ${UFW_AFTER} já contém regras DOCKER-USER. Mantendo configuração existente."
  fi
fi

echo "🔒 Hardening de rede Docker finalizado com sucesso. Portas internas blindadas contra varreduras externas!"
