<#
.SYNOPSIS
    Severinno Docker Infrastructure Diagnostic
.DESCRIPTION
    Verifica port bindings, healthchecks, redes e possiveis conflitos.
    Usage: .\scripts\diagnose-docker.ps1 [-Verbose]
.PARAMETER Verbose
    Exibe logs detalhados
#>

param([switch]$Verbose)

$script:PassCount = 0
$script:FailCount = 0
$script:WarnCount = 0
$script:StartTime = Get-Date

# Save and change directory
$ScriptPath = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $PSCommandPath }
$ProjectDir = Resolve-Path "$ScriptPath\.."
$OriginalDir = Get-Location
Set-Location $ProjectDir

# Trap ensures we restore the directory even on early exit
trap {
    Write-Warn "Erro inesperado: $_"
    Set-Location $OriginalDir
    break
}

# ── Helper Functions ─────────────────────────────────────────────────

function Write-Step {
    param([string]$Title)
    Write-Host "`n==============================" -ForegroundColor DarkGray
    Write-Host "  $Title" -ForegroundColor Cyan
    Write-Host "==============================" -ForegroundColor DarkGray
}

function Write-Pass  { param([string]$M) Write-Host "  [PASS] $M" -ForegroundColor Green; $script:PassCount++ }
function Write-Fail  { param([string]$M) Write-Host "  [FAIL] $M" -ForegroundColor Red; $script:FailCount++ }
function Write-Warn  { param([string]$M) Write-Host "  [WARN] $M" -ForegroundColor Yellow; $script:WarnCount++ }
function Write-Skip  { param([string]$M) Write-Host "  [SKIP] $M" -ForegroundColor DarkCyan }
function Write-Detail { param([string]$M) Write-Host "         $M" -ForegroundColor DarkGray }

function Write-Info {
    param([string]$M)
    if ($Verbose) { Write-Host "  [INFO] $M" -ForegroundColor White }
}

# Get compose project name from a running container's label
function Get-ComposeProjectName {
    $cid = (& docker compose ps -q app 2>$null | Out-String).Trim()
    if ($cid) {
        $name = (& docker container inspect $cid --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>$null | Out-String).Trim()
        if ($name) { return $name }
    }
    return ((Get-Item $ProjectDir).Name -replace '[^a-zA-Z0-9\-_]','').ToLower()
}

# ── Header ────────────────────────────────────────────────────────────

Write-Host "Severinno Docker Infrastructure Diagnostic" -ForegroundColor Cyan
Write-Host "Started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
Write-Host "Project: $ProjectDir" -ForegroundColor Gray
Write-Host ""

# ═══════════════════════════════════════════════════════════════════════
#  1. Pre-requisites
# ═══════════════════════════════════════════════════════════════════════
Write-Step "1. Pre-requisitos"

try {
    $ver = & docker --version 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0 -and $ver -match '\d+\.\d+') { Write-Pass "Docker CLI: $($ver.Trim())" }
    else { throw "Docker CLI not responding" }
} catch { Write-Fail "Docker CLI nao disponivel"; exit 1 }

try {
    $ver = & docker compose version 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0 -and $ver -match '\d+\.\d+') { Write-Pass "Docker Compose: $($ver.Trim())" }
    else { throw "Docker Compose not responding" }
} catch { Write-Fail "Docker Compose nao disponivel" }

try {
    $info = & docker info 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0 -and $info -match 'Server Version') { Write-Pass "Docker Desktop: rodando" }
    else { throw "Docker Desktop not running" }
} catch { Write-Fail "Docker Desktop nao esta rodando"; exit 1 }

try { $null = & curl.exe --version 2>&1; Write-Pass "curl.exe disponivel" }
catch { Write-Warn "curl.exe nao encontrado (healthchecks HTTP serao pulados)" }

# ═══════════════════════════════════════════════════════════════════════
#  2. Windows Port Exclusions (Hyper-V)
# ═══════════════════════════════════════════════════════════════════════
Write-Step "2. Portas excluidas pelo Windows (Hyper-V)"

try {
    $output = netsh int ipv4 show excludedportrange protocol=tcp 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0) {
        $expectedPorts = @(3000, 3003, 5432, 6379, 5672, 80, 443, 5000)
        $conflict = $false
        foreach ($line in ($output -split "`r`n|`n")) {
            if ($line -match '(\d+)\s*-\s*(\d+)') {
                $rs = [int]$Matches[1]; $re = [int]$Matches[2]
                foreach ($port in $expectedPorts) {
                    if ($port -ge $rs -and $port -le $re) {
                        Write-Warn "Porta $port esta em faixa de exclusao ${rs}-${re}"
                        $conflict = $true
                    }
                }
            }
        }
        if (-not $conflict) { Write-Pass "Nenhum conflito com portas do projeto" }
    } else { Write-Warn "netsh requer admin (portas excluidas nao verificadas)" }
} catch { Write-Warn "Erro: $_" }

# ═══════════════════════════════════════════════════════════════════════
#  3. Port Conflicts
# ═══════════════════════════════════════════════════════════════════════
Write-Step "3. Conflitos de porta no host"

$portDefs = @(
    @{P="3000";S="Next.js App"}, @{P="3003";S="Realtime (Socket.io)"},
    @{P="5432";S="PostgreSQL"}, @{P="6379";S="Redis"},
    @{P="5672";S="RabbitMQ"}, @{P="5000";S="OSRM (profile: routing)"}
)

foreach ($def in $portDefs) {
    $p = $def.P; $s = $def.S
    try {
        $out = netstat -ano | findstr ":$p" 2>&1 | Out-String
        $listen = @($out -split "`r`n|`n" | Where-Object { $_ -match 'LISTEN' })
        if ($listen.Count -eq 0) { Write-Warn "Porta $p ($s): ninguem ouvindo"; continue }

        $pids = @()
        foreach ($line in $listen) { if ($line -match '(\d+)\s*$') { $pids += [int]$Matches[1] } }
        $pids = $pids | Select-Object -Unique
        $nonDocker = @()
        foreach ($procId in $pids) {
            $name = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
            if ($name -notmatch 'com\.docker|docker') { $nonDocker += "${name} (PID ${procId})" }
        }
        if ($nonDocker.Count -gt 0) { Write-Warn "Porta $p ($s) ocupada por: $($nonDocker -join ', ')" }
        else { Write-Pass "Porta $p ($s): apenas Docker proxy" }
    } catch { Write-Warn "Erro porta ${p}: $_" }
}

# ═══════════════════════════════════════════════════════════════════════
#  4. Container Status
# ═══════════════════════════════════════════════════════════════════════
Write-Step "4. Status dos Containers"

try {
    $psOut = & docker compose ps --format '{{.Name}}||{{.Status}}||{{.Ports}}' 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($psOut)) {
        Write-Warn "Nenhum container rodando. Execute 'docker compose up -d'."
    } else {
        $lines = @($psOut -split "`r`n|`n" | Where-Object { $_.Trim() -ne '' })
        Write-Pass "$($lines.Count) container(s) encontrados"

        $groups = @{healthy=@();unhealthy=@();starting=@();exited=@();other=@()}
        foreach ($line in $lines) {
            $parts = $line -split '\|\|'
            $name = $parts[0].Trim(); $st = if ($parts.Count -gt 1) { $parts[1].Trim() } else { "?" }
            $po = if ($parts.Count -gt 2) { $parts[2].Trim() } else { "" }
            if ($st -match 'healthy') { $groups.healthy += @{N=$name;S=$st;P=$po} }
            elseif ($st -match 'unhealthy') { $groups.unhealthy += @{N=$name;S=$st;P=$po} }
            elseif ($st -match 'starting') { $groups.starting += @{N=$name;S=$st;P=$po} }
            elseif ($st -match 'Exit|exited') { $groups.exited += @{N=$name;S=$st;P=$po} }
            else { $groups.other += @{N=$name;S=$st;P=$po} }
        }

        foreach ($c in $groups.healthy) { Write-Host "     $($c.N)  [$($c.S)]" -ForegroundColor Green; if ($c.P) { Write-Detail "Ports: $($c.P)" } }
        foreach ($c in $groups.starting) { Write-Host "     $($c.N)  [$($c.S)]" -ForegroundColor Yellow }
        foreach ($c in $groups.unhealthy) { Write-Host "     $($c.N)  [UNHEALTHY]" -ForegroundColor Red; Write-Detail $c.S }
        foreach ($c in $groups.exited) { Write-Host "     $($c.N)  [EXITED]" -ForegroundColor Red }
        foreach ($c in $groups.other) { Write-Host "     $($c.N)  [$($c.S)]" -ForegroundColor White }

        if ($groups.unhealthy.Count -eq 0 -and $groups.exited.Count -eq 0) { Write-Pass "Todos saudaveis" }
        else {
            if ($groups.unhealthy.Count -gt 0) { Write-Fail "$($groups.unhealthy.Count) unhealthy" }
            if ($groups.exited.Count -gt 0) { Write-Fail "$($groups.exited.Count) exited" }
        }
    }
} catch { Write-Fail "Erro: $_" }

# ═══════════════════════════════════════════════════════════════════════
#  5. Port Bindings
# ═══════════════════════════════════════════════════════════════════════
Write-Step "5. Port Bindings"

$bindings = @(
    @{Svc="app";Port="3000/tcp";Opt=$false;Desc="Next.js App"},
    @{Svc="realtime";Port="3003/tcp";Opt=$false;Desc="Realtime WebSocket"},
    @{Svc="postgis";Port="5432/tcp";Opt=$false;Desc="PostgreSQL"},
    @{Svc="redis";Port="6379/tcp";Opt=$false;Desc="Redis"},
    @{Svc="rabbitmq";Port="5672/tcp";Opt=$false;Desc="RabbitMQ"},
    @{Svc="caddy";Port="80/tcp";Opt=$false;Desc="Caddy HTTP"},
    @{Svc="caddy";Port="443/tcp";Opt=$false;Desc="Caddy HTTPS"},
    @{Svc="osrm";Port="5000/tcp";Opt=$true;Desc="OSRM (profile: routing)"}
)

foreach ($b in $bindings) {
    $svc = $b.Svc; $portKey = $b.Port; $isOpt = $b.Opt; $desc = $b.Desc
    try {
        $cid = (& docker compose ps -q $svc 2>$null | Out-String).Trim()
        if ([string]::IsNullOrWhiteSpace($cid)) {
            if ($isOpt) { Write-Skip "$desc ($svc): nao rodando (opcional)" }
            else { Write-Warn "$desc ($svc): nao rodando" }
            continue
        }
        $json = (& docker container inspect $cid --format '{{json .NetworkSettings.Ports}}' 2>$null | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($json)) {
            Write-Warn "$desc ($svc): erro ao inspecionar"; continue
        }
        $obj = $json | ConvertFrom-Json
        $binding = $obj.$portKey
        if ($binding -and $binding.Count -gt 0 -and $binding[0].HostPort) {
            Write-Pass "$desc ($svc) -> $($binding[0].HostIp):$($binding[0].HostPort)"
        } else {
            Write-Warn "$desc ($svc): exposta mas nao publicada"
        }
    } catch { Write-Warn "$desc ($svc): erro: $_" }
}

# ═══════════════════════════════════════════════════════════════════════
#  6. Networks
# ═══════════════════════════════════════════════════════════════════════
Write-Step "6. Redes Docker"

$projectName = Get-ComposeProjectName
Write-Info "Compose project: $projectName"

foreach ($netName in @("frontend","backend")) {
    $fullName = "${projectName}_${netName}"
    try {
        $netInfo = & docker network inspect $fullName 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) { Write-Warn "Rede '$fullName' nao encontrada"; continue }
        $net = ($netInfo | ConvertFrom-Json)[0]
        $count = if ($net.Containers) { $net.Containers.PSObject.Properties.Count } else { 0 }
        Write-Host "     $netName ($fullName)" -ForegroundColor Cyan
        Write-Detail "Driver: $($net.Driver) | Internal: $($net.Internal) | Containers: $count"
        if ($net.Internal -eq $true) { Write-Detail "ATENCAO: Rede interna! Port bindings podem falhar no Windows." }
        foreach ($c in $net.Containers.PSObject.Properties) {
            Write-Detail "  + $($c.Value.Name) ($($c.Value.IPv4Address))"
        }
        Write-Pass "Rede '$netName' ok"
    } catch { Write-Warn "Erro rede '$fullName': $_" }
}

# ═══════════════════════════════════════════════════════════════════════
#  7. Healthcheck Endpoints
# ═══════════════════════════════════════════════════════════════════════
Write-Step "7. Healthcheck Endpoints"

$endpoints = @(
    @{Url="http://localhost:3003/health";Svc="Realtime"},
    @{Url="http://localhost:3000/api/health";Svc="Next.js App"}
)

foreach ($ep in $endpoints) {
    $url = $ep.Url; $svc = $ep.Svc
    try {
        $resp = & curl.exe -s --connect-timeout 5 $url 2>&1 | Out-String
        if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($resp)) {
            $trunc = $resp.Trim().Substring(0, [Math]::Min(80, $resp.Trim().Length))
            Write-Pass "${svc}: ${url} respondeu"
            Write-Detail $trunc
        } else { Write-Warn "${svc}: ${url} nao respondeu" }
    } catch { Write-Warn "${svc}: ${url} erro: $_" }
}

# ═══════════════════════════════════════════════════════════════════════
#  8. Docker Resources
# ═══════════════════════════════════════════════════════════════════════
Write-Step "8. Recursos do Docker"

try {
    $df = & docker system df 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0) {
        foreach ($line in ($df -split "`r`n|`n")) {
            if ($line -match '(Images|Containers|Local Volumes|Build Cache)') { Write-Detail $line.Trim() }
        }
        Write-Pass "Docker system df: ok"
    }
} catch { Write-Warn "Erro: $_" }

# ═══════════════════════════════════════════════════════════════════════
#  Summary
# ═══════════════════════════════════════════════════════════════════════
Write-Step "Resumo Final"

$dur = [math]::Round(((Get-Date) - $script:StartTime).TotalSeconds, 1)
$total = $script:PassCount + $script:FailCount + $script:WarnCount
Write-Host ""
Write-Host "  Duracao: ${dur}s" -ForegroundColor White
Write-Host "  Total: $total" -ForegroundColor White
Write-Host ""
Write-Host "  [PASS] $($script:PassCount)" -ForegroundColor Green
Write-Host "  [WARN] $($script:WarnCount)" -ForegroundColor Yellow
Write-Host "  [FAIL] $($script:FailCount)" -ForegroundColor Red
Write-Host ""

if ($script:FailCount -eq 0 -and $script:WarnCount -eq 0) {
    Write-Host "  Tudo ok! Infraestrutura Docker saudavel." -ForegroundColor Green
} elseif ($script:FailCount -eq 0) {
    Write-Host "  Com ressalvas. Verifique os WARNs acima." -ForegroundColor Yellow
} else {
    Write-Host "  $($script:FailCount) falha(s). Verifique os FAILs acima." -ForegroundColor Red
}

Set-Location $OriginalDir
