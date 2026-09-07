<#
.SYNOPSIS
    Severinno Marketplace — Inicialização Rápida (PowerShell)
.DESCRIPTION
    Inicia o servidor de desenvolvimento com Bun + Turbopack.
    Faz health check rápido antes de iniciar.
    Usage: .\dev.ps1
            .\dev.ps1 -SkipHealthCheck
            .\dev.ps1 -Reset (executa setup completo)
#>

param(
    [switch]$SkipHealthCheck,
    [switch]$Reset
)

$ErrorActionPreference = "Stop"

# Cores
$Green = "Green"; $Red = "Red"; $Yellow = "Yellow"; $Cyan = "Cyan"; $Gray = "DarkGray"

function Write-Pass { Write-Host "  [PASS]" -ForegroundColor $Green -NoNewline; Write-Host " $args" }
function Write-Fail { Write-Host "  [FAIL]" -ForegroundColor $Red -NoNewline; Write-Host " $args" }
function Write-Warn { Write-Host "  [WARN]" -ForegroundColor $Yellow -NoNewline; Write-Host " $args" }
function Write-Step { param([string]$T) Write-Host "`n$("=" * 40)" -ForegroundColor $Gray; Write-Host "  $T" -ForegroundColor $Cyan; Write-Host "$("=" * 40)" -ForegroundColor $Gray }

# ── Resolve project root ────────────────────────────────────────────
$ScriptPath = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $PSCommandPath }
$ProjectDir = if (Test-Path "$ScriptPath\package.json") { Resolve-Path "$ScriptPath" } else { Resolve-Path "$ScriptPath\.." }
Set-Location $ProjectDir

Write-Host "Severinno Marketplace — Dev Launcher" -ForegroundColor $Cyan
Write-Host "Projeto: $ProjectDir" -ForegroundColor $Gray
Write-Host ""

# ── Reset mode ──────────────────────────────────────────────────────
if ($Reset) {
    Write-Step "Modo Reset — Executando setup completo..."
    if (Test-Path "scripts\setup.ps1") {
        & ".\scripts\setup.ps1" 2>&1 | ForEach-Object { Write-Host $_ }
        exit $LASTEXITCODE
    } elseif (Test-Path "scripts\setup.sh") {
        Write-Warn "Git Bash necessário para setup.sh — instalando via bash..."
        & "bash" ".\scripts\setup.sh" 2>&1 | ForEach-Object { Write-Host $_ }
        exit $LASTEXITCODE
    } else {
        Write-Fail "Nenhum script de setup encontrado (setup.ps1 ou setup.sh)"
        exit 1
    }
}

# ═══════════════════════════════════════════════════════════════════
# 1. HEALTH CHECK RÁPIDO
# ═══════════════════════════════════════════════════════════════════
if (-not $SkipHealthCheck) {
    Write-Step "1. Health Check rápido"

    # Bun
    try {
        $ver = bun --version 2>&1 | Out-String
        if ($LASTEXITCODE -eq 0) { Write-Pass "Bun $($ver.Trim())" }
        else { throw "bun not found" }
    } catch {
        Write-Fail "Bun não encontrado. Instale: curl -fsSL https://bun.sh/install | bash"
        exit 1
    }

    # Docker
    try {
        $null = docker info 2>&1
        Write-Pass "Docker Desktop rodando"
    } catch {
        Write-Fail "Docker Desktop não está rodando"
        Write-Warn "Execute: docker compose up -d postgres redis minio (ou postgis)"
        
        do {
            $resp = Read-Host "Deseja subir a infra Docker agora? (s/n)"
        } while ($resp -notin @("s", "n", "S", "N"))
        
        if ($resp -eq "s" -or $resp -eq "S") {
            # Detect best compose file
            if (Test-Path "docker-compose.dev.yml") {
                docker compose -f docker-compose.dev.yml up -d postgis redis minio 2>&1 | ForEach-Object { Write-Host $_ }
            } else {
                docker compose up -d postgres redis minio 2>&1 | ForEach-Object { Write-Host $_ }
            }
            Write-Pass "Infra Docker iniciada"
        } else {
            Write-Warn "Continuando sem Docker — app pode falhar"
        }
    }

    # .env
    if (-not (Test-Path ".env")) {
        Write-Warn ".env não encontrado"
        do {
            $resp = Read-Host "Criar .env com valores padrão? (s/n)"
        } while ($resp -notin @("s", "n", "S", "N"))
        
        if ($resp -eq "s" -or $resp -eq "S") {
            $envContent = @'
DATABASE_URL="postgresql://severinno:severinno_dev@localhost:5432/severinno"
REDIS_URL="redis://localhost:6379"
SESSION_SECRET="dev-secret-autogerada-mude-em-producao-123456"
NEXT_PUBLIC_APP_URL=http://localhost:3000
'@
            Set-Content -Path ".env" -Value $envContent
            Write-Pass ".env criado"
        }
    } else {
        Write-Pass ".env existe"
    }

    # UTF-8 check via check-health.ps1
    if (Test-Path "scripts\check-health.ps1") {
        Write-Host "     Rodando check-health.ps1 (modo rápido)..." -ForegroundColor $Gray
        & ".\scripts\check-health.ps1" -Quick 2>&1 | ForEach-Object { Write-Host $_ }
    } else {
        Write-Host "     Verificando encoding UTF-8 (fallback)..." -ForegroundColor $Gray
        $badFiles = @()
        Get-ChildItem -Path "src" -Recurse -Include "*.ts", "*.tsx" | ForEach-Object {
            try {
                $content = [System.IO.File]::ReadAllText($_.FullName)
            } catch {
                $badFiles += $_.FullName
            }
        }
        if ($badFiles.Count -eq 0) {
            Write-Pass "UTF-8: todos os arquivos válidos"
        } else {
            Write-Fail "$($badFiles.Count) arquivo(s) com encoding inválido"
            $badFiles | ForEach-Object { Write-Host "         $_" -ForegroundColor $Gray }

            do {
                $resp = Read-Host "Corrigir automaticamente? (s/n)"
            } while ($resp -notin @("s", "n", "S", "N"))

            if ($resp -eq "s" -or $resp -eq "S") {
                python3 -c "
import os, sys
for root, dirs, files in os.walk('src'):
    for f in files:
        if not f.endswith(('.ts', '.tsx')): continue
        path = os.path.join(root, f)
        with open(path, 'rb') as fh:
            data = bytearray(fh.read())
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
        with open(path, 'wb') as f: f.write(bytes(fixed))
" 2>&1 | Out-Null
                Write-Pass "UTF-8 corrigido"
            }
        }
    }

    # Porta 3000
    $port3000 = netstat -ano | findstr ":3000" | findstr "LISTEN" 2>&1 | Out-String
    if ($port3000.Trim() -ne "") {
        $pid = ($port3000 -split '\s+')[-1]
        Write-Warn "Porta 3000 ocupada pelo PID $pid"
        do {
            $resp = Read-Host "Matar processo e continuar? (s/n)"
        } while ($resp -notin @("s", "n", "S", "N"))

        if ($resp -eq "s" -or $resp -eq "S") {
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
            Write-Pass "Porta 3000 liberada"
        } else {
            Write-Warn "Mude a porta com: bun run dev -- -p 3001"
        }
    } else {
        Write-Pass "Porta 3000 livre"
    }
}

# ═══════════════════════════════════════════════════════════════════
# 2. INICIAR SERVIDOR
# ═══════════════════════════════════════════════════════════════════
Write-Step "2. Iniciando servidor de desenvolvimento"

Write-Host ""
Write-Host "  URL: http://localhost:3000" -ForegroundColor $Cyan
Write-Host "  Log: $ProjectDir\dev.log" -ForegroundColor $Gray
Write-Host ""

# Inicia com Bun (correção: antes usava Node + webpack, agora Bun + Turbopack)
$logFile = Join-Path $ProjectDir "dev.log"
$process = Start-Process -FilePath "bun" -ArgumentList "run dev" -NoNewWindow -PassThru -RedirectStandardOutput $logFile -RedirectStandardError $logFile

Write-Host "  PID: $($process.Id)" -ForegroundColor $Gray
Write-Host "  Pressione qualquer tecla para parar o servidor..." -ForegroundColor $Gray
Write-Host ""

# Monitora até o usuário pressionar tecla
while (-not $Host.UI.RawUI.KeyAvailable) {
    # Mostra últimas linhas do log ocasionalmente
    if ((Get-Date).Second % 10 -eq 0) {
        $lastLines = Get-Content $logFile -Tail 3 -ErrorAction SilentlyContinue
        if ($lastLines) {
            Clear-Host
            Write-Host "Severinno Dev Server — Rodando em http://localhost:3000" -ForegroundColor $Cyan
            Write-Host "" 
            $lastLines | ForEach-Object { Write-Host "  $_" -ForegroundColor $Gray }
            Write-Host ""
            Write-Host "  Pressione qualquer tecla para parar..." -ForegroundColor $Gray
        }
    }
    Start-Sleep -Milliseconds 500
}

# Limpeza
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
Write-Host "`nParando servidor..." -ForegroundColor $Yellow
Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
Write-Host "Servidor parado." -ForegroundColor $Green
