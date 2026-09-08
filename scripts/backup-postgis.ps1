<#
.SYNOPSIS
    Script de Backup e Restauração Automatizada do PostgreSQL + PostGIS (Windows / Docker)
.DESCRIPTION
    Realiza dump completo do banco PostGIS via container Docker ou restaura um dump existente.

    Usage:
      .\scripts\backup-postgis.ps1
      .\scripts\backup-postgis.ps1 -Restore -File .\backups\severinno_2026-09-08.sql

    Exit code:
      0 — success
      1 — failure (container not found, restore failed, etc.)
.EXAMPLE
    .\scripts\backup-postgis.ps1
    .\scripts\backup-postgis.ps1 -Restore -File .\backups\severinno_2026-09-08_025000.sql
#>

[CmdletBinding()]
param(
    [switch]$Restore,
    [string]$File,
    [string]$ContainerName = "severinno-postgis-1",
    [string]$DbUser = "severinno",
    [string]$DbName = "severinno",
    [string]$BackupDir = "$PSScriptRoot\..\backups"
)

$ErrorActionPreference = "Stop"

function Write-Log([string]$Message, [string]$Color = "Cyan") {
    $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    Write-Host "[$ts] $Message" -ForegroundColor $Color
}

# ── Localizar Container PostGIS se não especificado ou se o nome padrão variar ──
$runningPostgres = docker ps --filter "ancestor=postgis/postgis" --format "{{.Names}}" | Select-Object -First 1
if (-not $runningPostgres) {
    $runningPostgres = docker ps --filter "name=postgis" --format "{{.Names}}" | Select-Object -First 1
}
if ($runningPostgres) {
    $ContainerName = $runningPostgres
}

# ── MODO RESTORE ─────────────────────────────────────────────────────────────
if ($Restore) {
    if (-not $File -or -not (Test-Path $File)) {
        Write-Log "ERRO: Arquivo de dump não especificado ou não encontrado: '$File'" "Red"
        exit 1
    }

    Write-Log "Iniciando restauração no container '$ContainerName' a partir de '$File'..." "Yellow"

    $resolvedPath = Resolve-Path $File
    Get-Content $resolvedPath | docker exec -i $ContainerName psql -U $DbUser -d $DbName

    Write-Log "Restauração concluída! Verificando extensões PostGIS..." "Green"
    $version = docker exec $ContainerName psql -U $DbUser -d $DbName -t -c "SELECT PostGIS_Version();"
    Write-Log "PostGIS Version: $($version.Trim())" "Green"
    exit 0
}

# ── MODO BACKUP ──────────────────────────────────────────────────────────────
if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}

$dateStr = (Get-Date).ToString("yyyy-MM-dd_HHmmss")
$dumpPath = Join-Path $BackupDir "severinno_${dateStr}.sql"

Write-Log "Iniciando backup da base '${DbName}' do container '${ContainerName}'..." "Cyan"

docker exec $ContainerName pg_dump -U $DbUser -d $DbName --no-owner --no-privileges --no-comments -F p > $dumpPath

if (Test-Path $dumpPath) {
    $size = (Get-Item $dumpPath).Length / 1KB
    Write-Log "Backup gerado com sucesso: $dumpPath ($([math]::Round($size, 2)) KB)" "Green"

    # Verificar extensões no dump
    $hasPostgis = Select-String -Path $dumpPath -Pattern "postgis" -Quiet
    if ($hasPostgis) {
        Write-Log "Extensão PostGIS detectada e preservada no dump." "Green"
    }
} else {
    Write-Log "ERRO: Falha ao gerar arquivo de dump." "Red"
    exit 1
}
