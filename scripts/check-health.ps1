<#
.SYNOPSIS
    Severinno Marketplace — Health Check & Pre-flight Diagnostic (PowerShell)
.DESCRIPTION
    Versão PowerShell do scripts/check-health.sh.
    Detecta problemas ANTES deles quebrarem o build.

    Usage:
        .\scripts\check-health.ps1              # Verificação completa
        .\scripts\check-health.ps1 -Quick        # Só o essencial
        .\scripts\check-health.ps1 -Fix          # Tenta corrigir problemas
        .\scripts\check-health.ps1 -Watch        # Monitora em loop (30s)
#>

param(
    [switch]$Quick,
    [switch]$Fix,
    [switch]$Watch
)

$ErrorActionPreference = "Continue"

# ── Cores ────────────────────────────────────────────────────────────
$Red = "Red"; $Green = "Green"; $Yellow = "Yellow"
$Cyan = "Cyan"; $White = "White"; $Gray = "DarkGray"

# ── Contadores ───────────────────────────────────────────────────────
$script:PassCount = 0; $script:FailCount = 0; $script:WarnCount = 0
$script:CriticalFail = $false
$script:Errors = @()

function Write-Step { param([string]$T) Write-Host "`n$("═" * 45)" -ForegroundColor $Gray; Write-Host "  $T" -ForegroundColor $Cyan; Write-Host "$("═" * 45)" -ForegroundColor $Gray }
function Write-Pass { $script:PassCount++; Write-Host "  [PASS]" -ForegroundColor $Green -NoNewline; Write-Host " $($args -join ' ')" }
function Write-Fail { $script:FailCount++; $script:Errors += "$($args -join ' ')"; Write-Host "  [FAIL]" -ForegroundColor $Red -NoNewline; Write-Host " $($args -join ' ')" }
function Write-Warn { $script:WarnCount++; Write-Host "  [WARN]" -ForegroundColor $Yellow -NoNewline; Write-Host " $($args -join ' ')" }
function Write-Detail { param([string]$M) Write-Host "         $M" -ForegroundColor $Gray }

function Find-Python {
    try { $null = python3 --version 2>&1; return "python3" } catch {}
    try { $null = python --version 2>&1; return "python" } catch {}
    return $null
}

function Test-PortInUse {
    param([int]$Port)
    $connections = netstat -ano | findstr ":$Port" | findstr "LISTEN" 2>$null
    return ($null -ne $connections -and $connections.Trim() -ne "")
}

function Get-PidOnPort {
    param([int]$Port)
    $line = netstat -ano | findstr ":$Port" | findstr "LISTEN" 2>$null | Select-Object -First 1
    if ($line) {
        $parts = $line -split '\s+'
        $pid = $parts[-1]
        if ($pid -match '^\d+$') { return [int]$pid }
    }
    return $null
}

function Run-HealthCheck {
    $script:PassCount = 0; $script:FailCount = 0; $script:WarnCount = 0
    $script:CriticalFail = $false; $script:Errors = @()

    Write-Host "Severinno Health Check v1.0 (PowerShell)" -ForegroundColor $Cyan
    $modeName = if ($Quick) { 'Rápido' } else { 'Completo' }
    Write-Host "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') — Modo: $modeName" -ForegroundColor $Gray
    Write-Host ""

    # ══════════════════════════════════════════════════════════════════
    # 1. PRÉ-REQUISITOS
    # ══════════════════════════════════════════════════════════════════
    Write-Step "1. Pré-requisitos"

    # Bun
    $ver = bun --version 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0) { Write-Pass "Bun $($ver.Trim())" }
    else { Write-Fail "Bun nao instalado" }

    # Node modules
    if (Test-Path "node_modules") {
        try {
            $nextVer = bun run next --version 2>&1
            if ($nextVer -match "^Next\.js") {
                Write-Pass "node_modules: $($nextVer.Trim())"
            } elseif (Test-Path "node_modules/next/package.json") {
                Write-Pass "node_modules: Next.js encontrado"
            } elseif (Test-Path "node_modules/.pnpm") {
                $pnpmNext = Get-ChildItem "node_modules/.pnpm" -Filter "next*" -ErrorAction SilentlyContinue | Select-Object -First 1
                if ($pnpmNext) {
                    Write-Pass "node_modules: Next.js (pnpm hoisted)"
                } else {
                    Write-Warn "node_modules: estrutura incompleta"
                }
            } else {
                Write-Warn "node_modules: estrutura incompleta"
                if ($Fix) { Write-Detail "Execute: bun install" }
            }
        } catch {
            Write-Warn "node_modules: não foi possível verificar Next.js"
        }
    } else {
        Write-Fail "node_modules não existe"
        if ($Fix) { Write-Detail "Execute: bun install" }
    }

    # Docker
    $null = docker info 2>&1
    if ($LASTEXITCODE -eq 0) { Write-Pass "Docker Desktop: rodando" }
    else { Write-Fail "Docker Desktop nao esta rodando"; $script:CriticalFail = $true }

    $ver = docker compose version 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0 -and $ver) { Write-Pass "Docker Compose disponível" }
    else { Write-Fail "Docker Compose nao disponivel"; $script:CriticalFail = $true }

    # ══════════════════════════════════════════════════════════════════
    # 2. ARQUIVO .env
    # ══════════════════════════════════════════════════════════════════
    Write-Step "2. Variáveis de ambiente"

    if (Test-Path ".env") {
        Write-Pass ".env existe"
        $envContent = Get-Content ".env" -Raw

        $missingVars = @()
        foreach ($var in @("DATABASE_URL", "SESSION_SECRET")) {
            # (?m) = multiline: ^ matches start of each line
            if ($envContent -match "(?m)^${var}=") { } else { $missingVars += $var }
        }

        if ($missingVars.Count -gt 0) {
            Write-Fail "Variáveis obrigatórias ausentes: $($missingVars -join ', ')"
        } else {
            Write-Pass "Variáveis obrigatórias: OK"
        }

        # Verificar SESSION_SECRET length
        if ($envContent -match '^SESSION_SECRET="?(.+?)"?$') {
            $secretLen = $Matches[1].Length
            if ($secretLen -lt 32) {
                Write-Warn "SESSION_SECRET muito curta ($secretLen caracteres, mínimo 32)"
            }
        }
    } else {
        Write-Fail ".env não existe"
        $script:CriticalFail = $true
        if ($Fix) { Write-Detail "Execute: .\scripts\setup.ps1 para criar automaticamente" }
    }

    if ($Quick) { Write-Detail "Modo rápido — pulando verificações de porta, container e banco"; return }

    # ══════════════════════════════════════════════════════════════════
    # 3. PORTAS
    # ══════════════════════════════════════════════════════════════════
    Write-Step "3. Portas"

    $portsToCheck = @(
        @{Port=5432; Service="PostgreSQL"},
        @{Port=6379; Service="Redis"},
        @{Port=6380; Service="Redis(dev)"},
        @{Port=3000; Service="Next.js"},
        @{Port=5672; Service="RabbitMQ"},
        @{Port=9000; Service="MinIO"},
        @{Port=9001; Service="MinIO Console"}
    )

    foreach ($entry in $portsToCheck) {
        if (Test-PortInUse -Port $entry.Port) {
            $pid = Get-PidOnPort -Port $entry.Port
            $procName = if ($pid) { (Get-Process -Id $pid -ErrorAction SilentlyContinue).ProcessName } else { "unknown" }
            Write-Pass "Porta $($entry.Port) ($($entry.Service)): ocupada por $procName"
        } else {
            Write-Warn "Porta $($entry.Port) ($($entry.Service)): ninguém ouvindo"
        }
    }

    # ══════════════════════════════════════════════════════════════════
    # 4. CONTAINERS DOCKER
    # ══════════════════════════════════════════════════════════════════
    Write-Step "4. Containers Docker"

    try {
        $containers = docker ps --format '{{.Names}}||{{.Image}}||{{.Status}}' 2>$null

        if (-not $containers) {
            Write-Fail "Nenhum container Docker rodando"
            $script:CriticalFail = $true
        } else {
            $healthy = 0; $unhealthy = 0
            foreach ($line in ($containers -split "`n" | Where-Object { $_ -ne "" })) {
                $parts = $line -split '\|\|'
                $name = $parts[0]; $status = if ($parts.Count -gt 2) { $parts[2] } else { "?" }

                if ($status -match "healthy") {
                    Write-Host "     ${name}  [${status}]" -ForegroundColor $Green
                    $healthy++
                } elseif ($status -match "unhealthy") {
                    Write-Host "     ${name}  [UNHEALTHY]" -ForegroundColor $Red
                    $unhealthy++
                } elseif ($status -match "Exit|exited") {
                    Write-Host "     ${name}  [EXITED]" -ForegroundColor $Red
                    $unhealthy++
                } else {
                    Write-Host "     ${name}  [$status]" -ForegroundColor $Gray
                }
            }
            Write-Pass "$healthy saudável(is)"
            if ($unhealthy -gt 0) { Write-Fail "$unhealthy não saudável(is)" }

            # Verificar containers essenciais
            $hasPg = $containers -match "postgis|postgres"
            $hasRedis = $containers -match "redis|valkey"

            if ($hasPg) { Write-Pass "Container PostgreSQL: presente" }
            else { Write-Fail "Nenhum container PostgreSQL rodando"; $script:CriticalFail = $true }

            if ($hasRedis) { Write-Pass "Container Redis/Valkey: presente" }
            else { Write-Fail "Nenhum container Redis rodando" }

            if ($containers -match "postgis") { Write-Pass "PostGIS detectado" }
        }
    } catch {
        Write-Fail "Erro ao verificar containers: $_"
    }

    # ══════════════════════════════════════════════════════════════════
    # 5. ENCODING UTF-8
    # ══════════════════════════════════════════════════════════════════
    Write-Step "5. Encoding UTF-8"

    $python = Find-Python
    if ($python) {
        $result = & $python -c @"
import os
bad = []
for root, dirs, files in os.walk('src'):
    for f in files:
        if not f.endswith(('.ts', '.tsx')):
            continue
        path = os.path.join(root, f)
        try:
            with open(path, 'rb') as fh:
                raw = fh.read()
            raw.decode('utf-8')
        except UnicodeDecodeError as e:
            bad.append(f'{path}: {e}')
print('OK' if not bad else '\n'.join(bad))
"@ 2>&1

        if ($result -eq "OK") {
            Write-Pass "Encoding UTF-8: todos os source files válidos"
        } else {
            $count = ($result -split "`n" | Where-Object { $_ -ne "" }).Count
            Write-Fail "$count arquivo(s) com encoding corrompido!"
            $result -split "`n" | Select-Object -First 5 | ForEach-Object { Write-Detail $_ }

            if ($Fix) {
                Write-Detail "Corrigindo arquivos corrompidos..."
                foreach ($line in ($result -split "`n" | Where-Object { $_ -ne "" })) {
                    $file = ($line -split ':')[0]
                    if (-not $file) { continue }
                    & $python -c @"
import sys
with open('$file', 'rb') as f:
    data = bytearray(f.read())
fixed = bytearray()
i = 0
while i < len(data):
    byte = data[i]
    if byte < 0x80: fixed.append(byte); i += 1
    elif 0xC2 <= byte <= 0xDF:
        if i+1 < len(data) and 0x80 <= data[i+1] <= 0xBF:
            fixed.extend(data[i:i+2]); i += 2
        else: fixed.append(ord('-')); i += 1
    elif 0xE0 <= byte <= 0xEF:
        if i+2 < len(data) and 0x80 <= data[i+1] <= 0xBF and 0x80 <= data[i+2] <= 0xBF:
            fixed.extend(data[i:i+3]); i += 3
        else: fixed.append(ord('-')); i += 1
    else: fixed.append(ord('-')); i += 1
with open('$file', 'wb') as f: f.write(bytes(fixed))
"@ 2>&1 | Out-Null
                }
                Write-Pass "UTF-8: correção automática aplicada"
            }
        }
    } else {
        Write-Warn "Python não disponível — verificação UTF-8 pulada"
    }

    # ══════════════════════════════════════════════════════════════════
    # 6. CONEXÃO COM BANCO DE DADOS
    # ══════════════════════════════════════════════════════════════════
    Write-Step "6. Conexão com banco de dados"

    $pgContainer = docker ps --format '{{.Names}}' 2>$null | Where-Object { $_ -match "postgis|postgres" } | Select-Object -First 1

    if ($pgContainer) {
        $pgReady = docker exec $pgContainer pg_isready -U severinno -d severinno 2>&1
        if ($pgReady -match "accepting") {
            Write-Pass "PostgreSQL aceitando conexões"

            # PostGIS check
            $postgisVer = docker exec $pgContainer psql -U severinno -d severinno -Atc "SELECT PostGIS_Version()" 2>$null
            if ($postgisVer -match "^\d") {
                Write-Pass "Extensão PostGIS ativa ($($postgisVer.Trim()))"
            } else {
                Write-Warn "PostGIS não está habilitado"
                if ($Fix) {
                    docker exec $pgContainer psql -U severinno -d severinno -c "CREATE EXTENSION IF NOT EXISTS postgis;" 2>$null
                    Write-Pass "PostGIS habilitado"
                }
            }

            # Table count
            $tableCount = docker exec $pgContainer psql -U severinno -d severinno -Atc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" 2>$null
            if ($tableCount -gt 0) {
                Write-Pass "Banco populado: $tableCount tabelas"
            } else {
                Write-Warn "Nenhuma tabela encontrada — execute: bun run db:seed"
            }
        } else {
            Write-Fail "PostgreSQL não está aceitando conexões"
        }
    } else {
        Write-Fail "Container PostgreSQL não encontrado"
    }

    # ══════════════════════════════════════════════════════════════════
    # 7. CONEXÃO REDIS
    # ══════════════════════════════════════════════════════════════════
    Write-Step "7. Conexão Redis"

    $redisContainer = docker ps --format '{{.Names}}' 2>$null | Where-Object { $_ -match "redis|valkey" } | Select-Object -First 1

    if ($redisContainer) {
        $redisCmd = if ($redisContainer -match "valkey") { "valkey-cli" } else { "redis-cli" }
        $ping = docker exec $redisContainer $redisCmd ping 2>$null
        if ($ping -match "PONG") {
            Write-Pass "Redis/Valkey: PONG"
        } else {
            Write-Warn "Redis: ping falhou"
        }
    } else {
        Write-Warn "Container Redis não encontrado"
    }

    # ══════════════════════════════════════════════════════════════════
    # 8. API HEALTH ENDPOINT
    # ══════════════════════════════════════════════════════════════════
    Write-Step "8. API Health"

    try {
        $req = [System.Net.WebRequest]::Create("http://localhost:3000")
        $req.Timeout = 5000
        $resp = $req.GetResponse()
        $statusCode = [int]$resp.StatusCode
        $resp.Close()

        if ($statusCode -eq 200) {
            Write-Pass "Next.js respondendo em http://localhost:3000"
            try {
                $healthReq = [System.Net.WebRequest]::Create("http://localhost:3000/api/health")
                $healthReq.Timeout = 5000
                $healthResp = $healthReq.GetResponse()
                $reader = New-Object System.IO.StreamReader($healthResp.GetResponseStream())
                $healthBody = $reader.ReadToEnd() | Select-Object -First 1
                $reader.Close(); $healthResp.Close()
                Write-Detail ($healthBody.Substring(0, [Math]::Min(120, $healthBody.Length)))
                Write-Pass "/api/health respondeu"
            } catch {
                Write-Warn "/api/health não respondeu"
            }
        } else {
            Write-Warn "Next.js: status $statusCode"
        }
    } catch {
        Write-Warn "Next.js não está rodando em http://localhost:3000"
    }

    # ══════════════════════════════════════════════════════════════════
    # SUMMARY
    # ══════════════════════════════════════════════════════════════════
    Write-Step "Resumo Final"

    $total = $script:PassCount + $script:FailCount + $script:WarnCount
    Write-Host ""
    Write-Host "  PASS: $($script:PassCount)   FAIL: $($script:FailCount)   WARN: $($script:WarnCount)   Total: $total" -ForegroundColor $White
    Write-Host ""

    if ($script:FailCount -eq 0 -and $script:WarnCount -eq 0) {
        Write-Host "  ✅ Sistema 100% saudável!" -ForegroundColor $Green
    } elseif ($script:FailCount -eq 0) {
        Write-Host "  ⚠️  Sistema saudável com ressalvas" -ForegroundColor $Yellow
    } elseif ($script:CriticalFail) {
        Write-Host "  ❌ Problemas críticos detectados" -ForegroundColor $Red
        Write-Host "     Execute: .\scripts\setup.ps1" -ForegroundColor $Red
    } else {
        Write-Host "  ⚠️  Problemas detectados (não críticos)" -ForegroundColor $Red
    }
    Write-Host ""
}

# ── Main ──────────────────────────────────────────────────────────────────

$ScriptPath = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $PSCommandPath }
$ProjectDir = Resolve-Path "$ScriptPath\.."
Set-Location $ProjectDir

if ($Watch) {
    Write-Detail "Modo watch — verificando a cada 30 segundos..."
    Write-Detail "Pressione Ctrl+C para sair"
    Write-Host ""
    while ($true) {
        Run-HealthCheck
        Write-Host "──────────────────────────────────────" -ForegroundColor $Gray
        Write-Host "Próxima verificação em 30s... Ctrl+C para sair" -ForegroundColor $Gray
        Write-Host ""
        Start-Sleep -Seconds 30
    }
} else {
    Run-HealthCheck
    if ($script:CriticalFail) { exit 1 }
    exit 0
}
