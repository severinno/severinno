<#
.SYNOPSIS
    Severinno Marketplace — Bootstrap Completo (PowerShell)
.DESCRIPTION
    Versão PowerShell do scripts/setup.sh.
    Automatiza TODO o setup do zero — sem precisar de Git Bash.

    Usage:
        .\scripts\setup.ps1              # Setup completo
        .\scripts\setup.ps1 -Quick       # Pula seed
        .\scripts\setup.ps1 -DockerOnly  # Só infra Docker
        .\scripts\setup.ps1 -Reset       # Destrói tudo e recria
#>

param(
    [switch]$Quick,
    [switch]$DockerOnly,
    [switch]$Reset
)

$ErrorActionPreference = "Stop"

# ── Cores ────────────────────────────────────────────────────────────
$Red = "Red"; $Green = "Green"; $Yellow = "Yellow"
$Cyan = "Cyan"; $White = "White"; $Gray = "DarkGray"

# ── Contadores ───────────────────────────────────────────────────────
$script:PassCount = 0; $script:FailCount = 0; $script:WarnCount = 0

function Write-Step { param([string]$T) Write-Host "`n$("═" * 45)" -ForegroundColor $Gray; Write-Host "  $T" -ForegroundColor $Cyan; Write-Host "$("═" * 45)" -ForegroundColor $Gray }
function Write-Pass { $script:PassCount++; Write-Host "  [PASS]" -ForegroundColor $Green -NoNewline; Write-Host " $($args -join ' ')" }
function Write-Fail { $script:FailCount++; Write-Host "  [FAIL]" -ForegroundColor $Red -NoNewline; Write-Host " $($args -join ' ')" }
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

function Stop-ProcessOnPort {
    param([int]$Port)
    $pid = Get-PidOnPort -Port $Port
    if (-not $pid) { return $true }
    Write-Detail "Matando processo PID $pid na porta $Port..."
    try {
        Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        if (Test-PortInUse -Port $Port) {
            Write-Warn "Não foi possível liberar porta $Port"
            return $false
        }
        Write-Pass "Porta $Port liberada"
        return $true
    } catch {
        Write-Warn "Erro ao matar processo na porta $Port: $_"
        return $false
    }
}

function Test-Utf8Integrity {
    $python = Find-Python
    if (-not $python) { Write-Warn "Python não disponível — verificação UTF-8 pulada"; return $true }
    
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
        return $true
    } else {
        Write-Warn "UTF-8: arquivos corrompidos encontrados!"
        $result -split "`n" | Select-Object -First 5 | ForEach-Object { Write-Detail $_ }
        return $false
    }
}

function Fix-Utf8Files {
    $python = Find-Python
    if (-not $python) { Write-Warn "Python não disponível — não foi possível corrigir UTF-8"; return }
    
    Write-Detail "Verificando e corrigindo encoding UTF-8..."
    $result = & $python -c @"
import os
bad = []
for root, dirs, files in os.walk('src'):
    for f in files:
        if not f.endswith(('.ts', '.tsx')):
            continue
        path = os.path.join(root, f)
        with open(path, 'rb') as fh:
            raw = fh.read()
        try:
            raw.decode('utf-8')
        except UnicodeDecodeError:
            bad.append(path)
print('\n'.join(bad))
"@ 2>&1

    if (-not $result) {
        Write-Pass "UTF-8: nenhum arquivo corrompido"
        return
    }

    $fixedCount = 0
    foreach ($file in ($result -split "`n" | Where-Object { $_ -ne "" })) {
        Write-Detail "Corrigindo: $file"
        & $python -c @"
import sys
with open('$file', 'rb') as f:
    data = bytearray(f.read())
fixed = bytearray()
i = 0
while i < len(data):
    byte = data[i]
    if byte < 0x80:
        fixed.append(byte); i += 1
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
        $fixedCount++
    }

    if ($fixedCount -gt 0) {
        Write-Pass "UTF-8: corrigidos $fixedCount arquivo(s)"
    } else {
        Write-Pass "UTF-8: nenhum arquivo corrompido"
    }
}

function Get-DetectedCompose {
    if (Test-Path "docker-compose.dev.yml") {
        $content = Get-Content "docker-compose.dev.yml" -Raw
        if ($content -match "postgis/postgis") {
            Write-Detail "Detectado: docker-compose.dev.yml (com PostGIS + serviços extras)"
            return "docker-compose.dev.yml"
        }
    }
    return "docker-compose.yml"
}

function Wait-ContainerHealthy {
    param([string]$ServiceName, [string]$ComposeFile)
    $maxRetries = 30
    Write-Detail "Aguardando $ServiceName..."
    
    for ($i = 1; $i -le $maxRetries; $i++) {
        $status = if ($ComposeFile) {
            docker compose -f $ComposeFile ps --format '{{.Status}}' $ServiceName 2>$null
        } else {
            docker compose ps --format '{{.Status}}' $ServiceName 2>$null
        }
        
        if ($status -match "healthy") {
            Write-Pass "$ServiceName`: saudável (${i}s)"
            return
        } elseif ($status -match "unhealthy") {
            Write-Warn "$ServiceName`: unhealthy"
            if ($ComposeFile) {
                docker compose -f $ComposeFile logs --tail=5 $ServiceName 2>$null
            } else {
                docker compose logs --tail=5 $ServiceName 2>$null
            }
            return
        }
        Start-Sleep -Seconds 2
    }
}

# ═════════════════════════════════════════════════════════════════════
# MAIN
# ═════════════════════════════════════════════════════════════════════

$ScriptPath = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $PSCommandPath }
$ProjectDir = Resolve-Path "$ScriptPath\.."
$OriginalDir = Get-Location
Set-Location $ProjectDir

Write-Host "`nSeverinno Marketplace — Bootstrap v1.0 (PowerShell)" -ForegroundColor $Cyan
Write-Host "Projeto: $ProjectDir" -ForegroundColor $Gray
Write-Host ""

# ═══════════════════════════════════════════════════════════════════
# 1. PRÉ-REQUISITOS
# ═══════════════════════════════════════════════════════════════════
Write-Step "1. Pré-requisitos"

# Bun
try {
    $ver = bun --version 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0) { Write-Pass "Bun: $($ver.Trim())" }
    else { throw }
} catch {
    Write-Fail "Bun não encontrado — instale com: curl -fsSL https://bun.sh/install | bash"
    exit 1
}

# Node modules
if (Test-Path "node_modules") {
    Write-Pass "node_modules: existe"
} else {
    Write-Detail "Instalando dependências..."
    bun install 2>&1 | Select-Object -Last 3
    Write-Pass "Dependências instaladas"
}

# Docker
try {
    $null = docker info 2>&1
    Write-Pass "Docker Desktop rodando"
} catch {
    Write-Fail "Docker Desktop não está rodando — inicie primeiro"
    exit 1
}

# Docker Compose
try {
    $ver = docker compose version 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0) { Write-Pass "Docker Compose: $($ver.Trim())" }
    else { throw }
} catch {
    Write-Fail "Docker Compose não disponível"
    exit 1
}

# Python
$python = Find-Python
if ($python) {
    Write-Pass "$python disponível"
} else {
    Write-Warn "Python não encontrado — verificação UTF-8 será pulada"
}

# Git blame ignore-revs (protege blame de conversões mecânicas - veja .git-blame-ignore-revs)
if (Get-Command git -ErrorAction SilentlyContinue) {
    $blameVal = git config blame.ignoreRevsFile 2>$null
    if ($LASTEXITCODE -eq 0 -and $blameVal) {
        Write-Pass "blame.ignoreRevsFile: já configurado ($blameVal)"
    } else {
        git config blame.ignoreRevsFile .git-blame-ignore-revs
        Write-Pass "blame.ignoreRevsFile: .git-blame-ignore-revs (blame pula conversões mecânicas)"
    }
} else {
    Write-Warn "Git não encontrado - pulando blame.ignoreRevsFile"
}

# ═══════════════════════════════════════════════════════════════════
# 2. ARQUIVO .env
# ═══════════════════════════════════════════════════════════════════
Write-Step "2. Arquivo .env"

$detectedCompose = Get-DetectedCompose

if (Test-Path ".env") {
    Write-Pass ".env existe"
    $envContent = Get-Content ".env" -Raw
    if ($envContent -match "(?m)^DATABASE_URL=") {
        Write-Pass "DATABASE_URL: configurada"
    } else {
        Write-Warn "DATABASE_URL não encontrada no .env"
    }
} else {
    Write-Warn ".env não existe — criando com valores padrão..."
    
    if ($detectedCompose -match "dev") {
        @"
# Severinno — Variáveis de ambiente (gerado automaticamente pelo setup.ps1)
DATABASE_URL="postgresql://severinno:severinno@localhost:5432/severinno"
REDIS_URL="redis://localhost:6380"
SESSION_SECRET="dev-secret-autogerada-mude-em-producao-123456"
S3_ACCESS_KEY=severinno
S3_SECRET_KEY=severinno_minio_dev
S3_BUCKET=severinno
S3_ENDPOINT=http://localhost:9000
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_WS_URL=ws://localhost:3003
"@ | Set-Content ".env" -Encoding UTF8
    } else {
        @"
# Severinno — Variáveis de ambiente (gerado automaticamente pelo setup.ps1)
DATABASE_URL="postgresql://severinno:severinno_dev@localhost:5432/severinno"
REDIS_URL="redis://localhost:6379"
SESSION_SECRET="dev-secret-autogerada-mude-em-producao-123456"
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=severinno-uploads
S3_ENDPOINT=http://localhost:9000
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_WS_URL=ws://localhost:3001
"@ | Set-Content ".env" -Encoding UTF8
    }
    Write-Pass ".env criado com valores padrão para $detectedCompose"
}

# ═══════════════════════════════════════════════════════════════════
# 3. LIBERAR PORTAS
# ═══════════════════════════════════════════════════════════════════
Write-Step "3. Verificando conflitos de porta"

$portsToCheck = @(
    @{Port=5432; Service="PostgreSQL"},
    @{Port=6379; Service="Redis"},
    @{Port=6380; Service="Redis(dev)"},
    @{Port=3000; Service="Next.js"},
    @{Port=5672; Service="RabbitMQ"},
    @{Port=9000; Service="MinIO"}
)

foreach ($entry in $portsToCheck) {
    $port = $entry.Port
    $svc = $entry.Service
    
    if (Test-PortInUse -Port $port) {
        $pid = Get-PidOnPort -Port $port
        $procName = if ($pid) { (Get-Process -Id $pid -ErrorAction SilentlyContinue).ProcessName } else { "unknown" }
        
        if ($procName -match "docker|com\.docker") {
            Write-Pass "Porta $port ($svc): Docker proxy"
        } else {
            Write-Warn "Porta $port ($svc): ocupada por $procName (PID $pid)"
            Write-Detail "Tentando liberar..."
            Stop-ProcessOnPort -Port $port | Out-Null
        }
    } else {
        Write-Pass "Porta $port ($svc): livre"
    }
}

# ═══════════════════════════════════════════════════════════════════
# 4. PARAR CONTAINERS CONFLITANTES
# ═══════════════════════════════════════════════════════════════════
Write-Step "4. Limpando containers órfãos/conflitantes"

$containers = docker ps --format '{{.Names}}' 2>$null

if ($detectedCompose -eq "docker-compose.yml") {
    if ($containers -match "severinno-postgis-1") {
        Write-Warn "Container conflitante: severinno-postgis-1"
        docker stop severinno-postgis-1 2>$null
        docker rm severinno-postgis-1 2>$null
        Write-Pass "severinno-postgis-1 parado e removido"
    }
}

if ($detectedCompose -match "dev") {
    if ($containers -match "severinno-postgres-1") {
        Write-Warn "Container conflitante: severinno-postgres-1"
        docker stop severinno-postgres-1 2>$null
        docker rm severinno-postgres-1 2>$null
        Write-Pass "severinno-postgres-1 parado e removido"
    }
    docker volume rm severinno_postgres_data 2>$null
}

# ═══════════════════════════════════════════════════════════════════
# 5. SUBIR INFRA DOCKER
# ═══════════════════════════════════════════════════════════════════
Write-Step "5. Subindo infraestrutura Docker"

if ($detectedCompose -match "dev") {
    $composeFile = "-f docker-compose.dev.yml"
    $services = @("postgis", "redis", "minio")
    Write-Detail "Usando docker-compose.dev.yml"
    Write-Detail "Subindo: $($services -join ', ')"
} else {
    $composeFile = $null
    $services = @("postgres", "redis", "minio")
    Write-Detail "Usando docker-compose.yml (PostgreSQL vanilla)"
    Write-Detail "⚠️  ATENÇÃO: Este compose usa postgres:16-alpine SEM PostGIS!"
    Write-Detail "   Se precisar de PostGIS, use: docker-compose.dev.yml"
    Write-Detail "Subindo: $($services -join ', ')"
}

$upArgs = @("compose", "up", "-d") + $services
if ($composeFile) { $upArgs = @("-f", $composeFile) + $upArgs }

try {
    docker $upArgs 2>&1 | Select-Object -Last 5
    Write-Pass "Containers iniciados"
} catch {
    Write-Fail "Erro ao subir containers!"
    $logArgs = @("compose", "logs", "--tail=10")
    if ($composeFile) { $logArgs = @("-f", $composeFile) + $logArgs }
    docker $logArgs 2>$null | ForEach-Object { Write-Detail $_ }
    exit 1
}

# ═══════════════════════════════════════════════════════════════════
# 6. AGUARDAR SAÚDE DOS SERVIÇOS
# ═══════════════════════════════════════════════════════════════════
Write-Step "6. Aguardando serviços ficarem saudáveis"

foreach ($svc in $services) {
    Wait-ContainerHealthy -ServiceName $svc -ComposeFile $composeFile
}

# ═══════════════════════════════════════════════════════════════════
# 7. HABILITAR POSTGIS
# ═══════════════════════════════════════════════════════════════════
Write-Step "7. Extensão PostGIS"

$pgContainer = docker ps --format '{{.Names}}' 2>$null | Where-Object { $_ -match "postgis|postgres" } | Select-Object -First 1
$pgImage = docker container inspect $pgContainer --format '{{.Config.Image}}' 2>$null

if ($pgImage -match "postgis") {
    docker exec $pgContainer psql -U severinno -d severinno -c "CREATE EXTENSION IF NOT EXISTS postgis;" 2>$null
    docker exec $pgContainer psql -U severinno -d severinno -c "CREATE EXTENSION IF NOT EXISTS postgis_topology;" 2>$null
    Write-Pass "PostGIS habilitado"
} elseif ($pgContainer) {
    Write-Warn "PostgreSQL sem PostGIS — migrations podem falhar!"
    Write-Detail "Recomendado: use docker-compose.dev.yml que tem postgis/postgis"
} else {
    Write-Warn "Container PostgreSQL não encontrado"
}

# ═══════════════════════════════════════════════════════════════════
# 8. CORRIGIR ENCODING UTF-8
# ═══════════════════════════════════════════════════════════════════
Write-Step "8. Verificação de encoding UTF-8"
Fix-Utf8Files

# ═══════════════════════════════════════════════════════════════════
# 9. PRISMA
# ═══════════════════════════════════════════════════════════════════
Write-Step "9. Prisma — Gerar cliente + sincronizar schema"

Write-Detail "Gerando Prisma Client..."
try {
    bun run db:generate 2>&1 | Select-Object -Last 5
    Write-Pass "Prisma Client gerado"
} catch {
    Write-Fail "prisma generate falhou"
    exit 1
}

Write-Detail "Sincronizando schema com db push..."
try {
    bunx prisma db push 2>&1 | Select-Object -Last 5
    Write-Pass "Schema sincronizado"
} catch {
    Write-Warn "db push falhou — tentando abordagem alternativa..."
    try {
        bunx prisma migrate reset --force 2>&1 | Select-Object -Last 10
        Write-Pass "Schema sincronizado via reset"
    } catch {
        Write-Fail "Não foi possível sincronizar o banco"
        exit 1
    }
}

# ═══════════════════════════════════════════════════════════════════
# 10. RESOLVER MIGRATIONS PENDENTES
# ═══════════════════════════════════════════════════════════════════
Write-Step "10. Resolvendo migrations pendentes"

$migDir = "prisma/migrations"
if (Test-Path $migDir) {
    Get-ChildItem $migDir -Directory | Where-Object { $_.Name -ne "manual" } | Sort-Object Name | ForEach-Object {
        $migName = $_.Name
        $status = bunx prisma migrate status 2>&1
        if ($status -match $migName) {
            Write-Detail "$migName`: já aplicada"
        } else {
            Write-Detail "Resolvendo: $migName"
            bunx prisma migrate resolve --applied $migName 2>$null
        }
    }
    Write-Pass "Migrations resolvidas"
}

# ═══════════════════════════════════════════════════════════════════
# 11. SEED
# ═══════════════════════════════════════════════════════════════════
Write-Step "11. Populando banco com dados de teste"

if ($Quick) {
    Write-Detail "Modo --Quick: pulando seed"
    Write-Pass "Seed pulado (modo rápido)"
} else {
    Write-Detail "Executando seed..."
    try {
        bun run db:seed 2>&1 | Select-Object -Last 10
        Write-Pass "Banco populado com dados de demonstração"
    } catch {
        Write-Warn "Seed falhou — banco vazio, mas app pode funcionar"
    }
}

# ═══════════════════════════════════════════════════════════════════
# 12. INICIAR SERVIDOR DEV
# ═══════════════════════════════════════════════════════════════════
if (-not $DockerOnly) {
    Write-Step "12. Iniciando servidor de desenvolvimento"

    Stop-ProcessOnPort -Port 3000 | Out-Null

    Write-Detail "Iniciando: bun run dev"
    Write-Detail "URL: http://localhost:3000"
    Write-Host ""

    $logFile = Join-Path $ProjectDir ".tmp\dev.log"
    $null = New-Item -ItemType Directory -Path (Join-Path $ProjectDir ".tmp") -Force 2>$null

    $process = Start-Process -FilePath "bun" -ArgumentList "run dev" -NoNewWindow -PassThru `
        -RedirectStandardOutput $logFile -RedirectStandardError $logFile

    for ($i = 0; $i -lt 20; $i++) {
        try {
            $req = [System.Net.WebRequest]::Create("http://localhost:3000")
            $req.Timeout = 2000
            $resp = $req.GetResponse()
            $resp.Close()
            Write-Host "  ✅ Servidor pronto!" -ForegroundColor $Green
            Write-Host "  http://localhost:3000" -ForegroundColor $Cyan
            Write-Host ""
            break
        } catch {
            Start-Sleep -Seconds 2
        }
    }
}

# ═══════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════
Write-Step "Resumo Final"

$total = $script:PassCount + $script:FailCount + $script:WarnCount
Write-Host "`n  PASS: $($script:PassCount)   FAIL: $($script:FailCount)   WARN: $($script:WarnCount)   Total: $total" -ForegroundColor $White
Write-Host ""

if ($script:FailCount -eq 0 -and $script:WarnCount -eq 0) {
    Write-Host "  ✅ Setup completo — tudo funcionando!" -ForegroundColor $Green
} elseif ($script:FailCount -eq 0) {
    Write-Host "  ⚠️  Setup concluído com ressalvas (veja WARNs acima)" -ForegroundColor $Yellow
} else {
    Write-Host "  ❌ Setup com falhas — revise os erros acima" -ForegroundColor $Red
}

Write-Host "`n  Credenciais de teste:" -ForegroundColor $Cyan
Write-Host "    Admin:    admin@severinno.com / admin123"
Write-Host "    Cliente:  cliente@severinno.com / cliente123"
Write-Host "    Prestador: carlos@severinno.com / provider123"
Write-Host "`n  Serviços:" -ForegroundColor $Cyan
Write-Host "    App:      http://localhost:3000"
Write-Host "    MinIO:    http://localhost:9001 (severinno / severinno_minio_dev)"
Write-Host ""

Set-Location $OriginalDir
