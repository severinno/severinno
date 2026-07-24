# ============================================================================
# Setup OSRM — Governador Valadares, MG
# ============================================================================
# Downloads OSM data and processes it for OSRM routing.
# Usage: powershell -File scripts/setup-osrm.ps1
# ============================================================================

$ErrorActionPreference = "Stop"
$IMAGE = "ghcr.io/project-osrm/osrm-backend:latest"
$DATA_DIR = Join-Path $PSScriptRoot ".." "osrm-data"
$OSM_FILE = "governador-valadares.osm"
$OSRM_FILE = "governador-valadares.osrm"

# Bounding box: urban core of Governador Valadares
$BBOX = "-18.89,-41.98,-18.82,-41.90"
$OVERPASS_URL = "https://overpass.private.coffee/api/interpreter"

Write-Host "=== OSRM Setup: Governador Valadares ===" -ForegroundColor Green

# 1. Create data directory
if (-not (Test-Path $DATA_DIR)) {
    New-Item -ItemType Directory -Path $DATA_DIR | Out-Null
}

# 2. Download OSM data via Overpass API
$osmPath = Join-Path $DATA_DIR $OSM_FILE
if (-not (Test-Path $osmPath) -or (Get-Item $osmPath).Length -lt 1000) {
    Write-Host "[1/4] Downloading OSM data..." -ForegroundColor Cyan
    $query = "[out:xml][timeout:120];(node($BBOX);way($BBOX);relation($BBOX););out;>;out;"
    curl.exe --globoff -o $osmPath "$OVERPASS_URL/api/interpreter?data=$query"
    
    $size = (Get-Item $osmPath).Length
    if ($size -lt 1000) {
        Write-Host "ERROR: Download failed (file too small: $size bytes)" -ForegroundColor Red
        Write-Host "Try again later — Overpass servers may be busy." -ForegroundColor Yellow
        exit 1
    }
    $sizeMB = [math]::Round($size / 1MB, 1)
    Write-Host "  Downloaded: $sizeMB MB" -ForegroundColor Green
} else {
    Write-Host "[1/4] OSM data already exists, skipping download." -ForegroundColor Yellow
}

# 3. Extract
Write-Host "[2/4] Extracting road network..." -ForegroundColor Cyan
docker run --rm -v "${DATA_DIR}:/data" $IMAGE `
    osrm-extract -p /usr/local/share/osrm/profiles/car.lua "/data/$OSM_FILE"

# 4. Partition
Write-Host "[3/4] Partitioning graph..." -ForegroundColor Cyan
docker run --rm -v "${DATA_DIR}:/data" $IMAGE `
    osrm-partition "/data/$OSRM_FILE"

# 5. Customize
Write-Host "[4/4] Customizing weights..." -ForegroundColor Cyan
docker run --rm -v "${DATA_DIR}:/data" $IMAGE `
    osrm-customize "/data/$OSRM_FILE"

Write-Host ""
Write-Host "=== OSRM ready! ===" -ForegroundColor Green
Write-Host "Start with: docker compose --profile routing up -d osrm" -ForegroundColor Cyan
Write-Host "Test with:  curl http://localhost:5000/route/v1/driving/-41.9481,-18.8505;-41.943,-18.848" -ForegroundColor Cyan
