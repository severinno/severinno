<#
.SYNOPSIS
    Backup automatizado do banco PostgreSQL para o Severinno Marketplace (Windows/PowerShell).
.DESCRIPTION
    Realiza o dump do banco de dados PostgreSQL via container Docker ou comando pg_dump local,
    comprime o arquivo com gzip e aplica política de retenção para limpeza de backups antigos.
    
    Usage:
      powershell .\scripts\backup-db.ps1
      powershell .\scripts\backup-db.ps1 -RetentionDays 14 -BackupDir ".\backups"

    Exit codes:
      0 — Sucesso
      1 — Falha na execução do dump ou compressão
#>

[CmdletBinding()]
param(
    [string]$BackupDir = ".\backups",
    [int]$RetentionDays = 7,
    [string]$PostgresUser = "severinno",
    [string]$PostgresDb = "severinno"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$tempSqlFile = Join-Path $BackupDir "severinno_temp_${timestamp}.sql"
$finalZipFile = Join-Path $BackupDir "severinno_backup_${timestamp}.sql.gz"

Write-Host "📦 [$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))] Iniciando backup do banco '$PostgresDb'..." -ForegroundColor Cyan

$dockerAvailable = $false
try {
    $dockerContainers = docker ps --format "{{.Names}}" 2>$null
    if ($dockerContainers -match "postgres|postgis") {
        $dockerAvailable = $true
        $containerName = ($dockerContainers -split "`n" | Where-Object { $_ -match "postgres|postgis" })[0].Trim()
    }
} catch {}

if ($dockerAvailable) {
    Write-Host "🐳 Executando pg_dump via container Docker '$containerName'..." -ForegroundColor Green
    docker exec -t $containerName pg_dump -U $PostgresUser -d $PostgresDb --no-owner --clean --if-exists | Out-File -FilePath $tempSqlFile -Encoding utf8
} else {
    Write-Host "🐘 Tentando executar pg_dump nativo..." -ForegroundColor Green
    & pg_dump -U $PostgresUser -d $PostgresDb --no-owner --clean --if-exists > $tempSqlFile
}

if (-not (Test-Path $tempSqlFile) -or (Get-Item $tempSqlFile).Length -eq 0) {
    Write-Error "❌ Falha ao gerar o arquivo de dump SQL."
    exit 1
}

# Comprimir com GzipStream nativo do .NET
Write-Host "🗜️ Comprimindo arquivo de backup..." -ForegroundColor Gray
$inputStream = [System.IO.File]::OpenRead($tempSqlFile)
$outputStream = [System.IO.File]::Create($finalZipFile)
$gzipStream = New-Object System.IO.Compression.GZipStream($outputStream, [System.IO.Compression.CompressionMode]::Compress)

$inputStream.CopyTo($gzipStream)

$gzipStream.Close()
$outputStream.Close()
$inputStream.Close()

Remove-Item $tempSqlFile -Force

$sizeMb = [math]::Round((Get-Item $finalZipFile).Length / 1MB, 2)
Write-Host "✅ Backup concluído com sucesso: $finalZipFile ($sizeMb MB)" -ForegroundColor Green

# Rotação e limpeza de backups antigos
Write-Host "🧹 Aplicando política de retenção ($RetentionDays dias)..." -ForegroundColor Gray
$cutoffDate = (Get-Date).AddDays(-$RetentionDays)
Get-ChildItem -Path $BackupDir -Filter "severinno_backup_*.sql.gz" | Where-Object {
    $_.LastWriteTime -lt $cutoffDate
} | ForEach-Object {
    Write-Host "🗑️ Removendo backup antigo: $($_.Name)" -ForegroundColor Yellow
    Remove-Item $_.FullName -Force
}

Write-Host "🏁 Processo finalizado." -ForegroundColor Cyan
