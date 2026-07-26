<#
.SYNOPSIS
    Severinno Dashboard (PowerShell)
.DESCRIPTION
    Shows real-time service status.
    Usage: dashboard.ps1 [-Once] [-Interval N]
#>

param([switch]$Once, [int]$Interval = 3)

$gp = 0; $gf = 0; $gw = 0

function Stat($n, $s, $d) {
    $c = if ($s -match "ok|healthy|PONG") { "Green" }
    elseif ($s -match "error|unhealthy") { "Red" }
    elseif ($s -match "starting") { "Yellow" }
    else { "DarkGray" }
    $ic = if ($c -eq "Green") { " +" } elseif ($c -eq "Red") { " !" } elseif ($c -eq "Yellow") { " ~" } else { " ." }
    Write-Host ("  ${ic}  {0,-22} {1}" -f $n, $d) -ForegroundColor $c
}

function Dash {
    $gp = 0; $gf = 0; $gw = 0
    Clear-Host
    Write-Host "== Severinno Dashboard ==" -ForegroundColor Cyan
    Write-Host (Get-Date -Format "HH:mm:ss") -ForegroundColor DarkGray
    Write-Host ""

    # DOCKER
    Write-Host "-- Docker Containers --" -ForegroundColor Cyan
    $raw = docker ps --format '{{.Names}}|{{.Status}}|{{.Ports}}' 2>$null
    if (-not $raw) {
        Write-Host "  . no containers" -ForegroundColor DarkGray; $gw++
    } else {
        foreach ($line in ($raw -split "`n" | Where-Object { $_ })) {
            $parts = $line -split '\|'
            $nn = $parts[0]
            $ss = if ($parts.Count -gt 1) { $parts[1] } else { "?" }
            $pp = if ($parts.Count -gt 2) { ($parts[2] -split ',')[0].Trim() } else { "" }
            if ($ss -match "healthy") { Stat $nn "ok" $ss; $gp++ }
            elseif ($ss -match "unhealthy") { Stat $nn "error" $ss; $gf++ }
            elseif ($ss -match "starting") { Stat $nn "starting" $ss; $gw++ }
            elseif ($ss -match "Exit|exited") { Stat $nn "error" "exited"; $gf++ }
            else { Write-Host ("  . $nn [$ss]") -ForegroundColor DarkGray }
        }
    }

    # DB & CACHE
    Write-Host "-- Database & Cache --" -ForegroundColor Cyan
    $pg = docker ps --format '{{.Names}}' 2>$null | Where-Object { $_ -match "postgis|postgres" } | Select-Object -First 1
    if ($pg) {
        $r = docker exec $pg pg_isready -U severinno -d severinno 2>&1
        if ($r -match "accepting") {
            $tc = docker exec $pg psql -U severinno -d severinno -Atc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" 2>$null
            if (-not $tc) { $tc = "0" }
            $gv = docker exec $pg psql -U severinno -d severinno -Atc "SELECT PostGIS_Version()" 2>$null
            if (-not $gv) { $gv = "?" }
            $gv = $gv -replace ' .*', ''
            Stat "PostgreSQL" "ok" ("tables: $tc | PostGIS $gv")
            $gp++
        } else { Stat "PostgreSQL" "error" "not responding"; $gf++ }
    } else { Stat "PostgreSQL" "off" "not found"; $gw++ }

    $rd = docker ps --format '{{.Names}}' 2>$null | Where-Object { $_ -match "redis|valkey" } | Select-Object -First 1
    if ($rd) {
        $cmd = if ($rd -match "valkey") { "valkey-cli" } else { "redis-cli" }
        $ping = docker exec $rd $cmd ping 2>$null
        if ($ping -match "PONG") { Stat "Redis" "ok" "PONG"; $gp++ }
        else { Stat "Redis" "error" "no ping"; $gf++ }
    } else { Stat "Redis" "off" "not found"; $gw++ }

    $mi = docker ps --format '{{.Names}}' 2>$null | Where-Object { $_ -match "minio" -and $_ -notmatch "init" } | Select-Object -First 1
    if ($mi) {
        try {
            $req = [System.Net.WebRequest]::Create("http://localhost:9000/minio/health/live")
            $req.Timeout = 2000; $resp = $req.GetResponse(); $resp.Close()
            Stat "MinIO S3" "ok" "port 9000"; $gp++
        } catch { Stat "MinIO S3" "error" "port 9000 down"; $gw++ }
    } else { Stat "MinIO S3" "off" "not found"; $gw++ }

    # APP
    Write-Host "-- Application Server --" -ForegroundColor Cyan
    try {
        $req = [System.Net.WebRequest]::Create("http://localhost:3000")
        $req.Timeout = 2000; $resp = $req.GetResponse(); $code = [int]$resp.StatusCode; $resp.Close()
        if ($code -eq 200) { Stat "Next.js" "ok" "HTTP 200"; $gp++ }
        else { Stat "Next.js" "error" "HTTP $code"; $gf++ }
    } catch { Stat "Next.js" "off" "port 3000"; $gw++ }

    # SYSTEM RESOURCES
    Write-Host "-- System Resources --" -ForegroundColor Cyan

    # Disk - with percentage-based coloring
    try {
        $drv = Get-PSDrive C -ErrorAction SilentlyContinue | Select-Object Used,Free
        if ($drv) {
            $usedGB = [math]::Round($drv.Used / 1GB, 1)
            $freeGB = [math]::Round($drv.Free / 1GB, 1)
            $totalGB = $usedGB + $freeGB
            $pct = [math]::Round(($drv.Used / ($drv.Used + $drv.Free)) * 100, 0)
            $diskStatus = if ($pct -ge 90) { "error" } elseif ($pct -ge 70) { "starting" } else { "ok" }
            Stat "Disk (C:)" $diskStatus ("${usedGB}GB / ${totalGB}GB (${pct}%)  ${freeGB}GB free")
        }
    } catch {}

    # Docker system disk
    $ds = docker system df 2>$null | Select-Object -Last 1
    if ($ds) { Stat "Docker Disk" "ok" ($ds -replace '\s+', ' ') }

    # Container CPU/Mem
    $stats = docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}' 2>$null
    if ($stats) {
        Write-Host "  Container CPU/Memory:" -ForegroundColor DarkGray
        foreach ($line in ($stats -split "`n" | Where-Object { $_ -notmatch "glitchtip" })) {
            $parts = $line -split '\|'
            if ($parts.Count -ge 4) {
                $sn = $parts[0] -replace '^severinno-', '' -replace '-1$', ''
                Write-Host ("    {0,-16} {1,-7} {2,-20} {3}" -f $sn, $parts[1], $parts[2], $parts[3]) -ForegroundColor DarkGray
            }
        }

        # Total container mem
        $totalMem = docker stats --no-stream --format '{{.MemUsage}}' 2>$null
        if ($totalMem) {
            $totalVal = 0
            foreach ($m in $totalMem) {
                $num = $m -replace '^[^0-9.]*([0-9.]+).*', '$1' -as [double]
                if ($m -match 'GiB') { $totalVal += $num * 1024 }
                elseif ($m -match 'MiB') { $totalVal += $num }
                elseif ($m -match 'KiB') { $totalVal += $num / 1024 }
            }
            Stat "Total Mem" "ok" ("{0:N0} MiB across containers" -f $totalVal)
        }
    }
    Write-Host ""

    # SUMMARY
    Write-Host "-- Summary --" -ForegroundColor Cyan
    $tt = $gp + $gf + $gw
    Write-Host ("  PASS: {0}  FAIL: {1}  WARN: {2}  Total: {3}" -f $gp, $gf, $gw, $tt)
    if ($gf -eq 0 -and $gw -eq 0) { Write-Host "  All healthy" -ForegroundColor Green }
    elseif ($gf -eq 0) { Write-Host "  With warnings" -ForegroundColor Yellow }
    else { Write-Host ("  {0} failure(s)" -f $gf) -ForegroundColor Red }
    Write-Host ""
}

$dir = Split-Path $PSCommandPath -Parent
Set-Location (Resolve-Path "$dir\..")
try {
    if ($Once) { Dash }
    else { while ($true) { Dash; Start-Sleep $Interval } }
} finally { Set-Location $dir }
