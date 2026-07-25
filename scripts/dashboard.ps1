<#
.SYNOPSIS
    Severinno Dashboard (PowerShell)
.DESCRIPTION
    Shows real-time service status with auto dark/light theme detection.
    Usage: dashboard.ps1 [-Once] [-Interval N] [-Dark] [-Light] [-Logs ContainerName] [-Compact] [-Json]
    Example: dashboard.ps1 -Logs redis    (show only redis logs)
    Example: dashboard.ps1 -Json          (export status as JSON)
#>

param([switch]$Once, [switch]$Dark, [switch]$Light, [string]$Logs = "", [int]$Interval = 3, [switch]$Compact, [switch]$Json)

$gp = 0; $gf = 0; $gw = 0

# ── Theme auto-detection ──────────────────────────────────────────────────
$autoDark = $false
if (-not $Dark -and -not $Light) {
    # Check env var override first
    $envDark = $env:SEVERINNO_DARK_MODE
    if ($envDark -match '^(1|true|yes|dark)$') {
        $autoDark = $true
    } elseif ($envDark -match '^(0|false|no|light)$') {
        $autoDark = $false
    } else {
        # Method 1: Windows Registry (AppsUseLightTheme)
        try {
            $regPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
            $regVal = (Get-ItemProperty -Path $regPath -Name AppsUseLightTheme -ErrorAction Stop).AppsUseLightTheme
            if ($regVal -eq 0) { $autoDark = $true }  # 0 = dark mode
        } catch {}

        # Method 2: Console host background color
        if (-not $autoDark) {
            $hostBg = $Host.UI.RawUI.BackgroundColor
            $darkBgs = @('Black', 'DarkBlue', 'DarkGreen', 'DarkCyan', 'DarkRed', 'DarkMagenta', 'DarkYellow')
            if ($darkBgs -contains [string]$hostBg) { $autoDark = $true }
        }
    }
}
$DarkMode = $Dark -or $autoDark

# PowerShell console colors: light mode uses darker variants (readable on white bg),
# dark mode uses brighter variants (readable on black bg)
$C_OK     = if ($DarkMode) { "Green" } else { "DarkGreen" }
$C_ERR    = if ($DarkMode) { "Red" } else { "DarkRed" }
$C_WARN   = if ($DarkMode) { "Yellow" } else { "DarkYellow" }
$C_OFF    = if ($DarkMode) { "DarkGray" } else { "Gray" }
$C_HEADER = if ($DarkMode) { "White" } else { "Cyan" }
$C_SUB    = if ($DarkMode) { "DarkGray" } else { "Cyan" }
$C_DIM    = if ($DarkMode) { "DarkGray" } else { "DarkGray" }
# $C_TEXT is purposefully omitted — all body text uses $C_DIM or $C_SUB

$IC_OK  = if ($DarkMode) { " ◉" } else { " +" }
$IC_ERR = if ($DarkMode) { " ◉" } else { " !" }
$IC_WARN= if ($DarkMode) { " ◉" } else { " ~" }
$IC_OFF = if ($DarkMode) { " ○" } else { " ." }

function Show-Header($t) {
    if ($DarkMode) {
        Write-Host ("  {0}" -f $t) -ForegroundColor White
        Write-Host ("  " + ("─" * 60)) -ForegroundColor DarkGray
    } else {
        Write-Host ("-- {0} --" -f $t) -ForegroundColor Cyan
    }
}

function Stat($n, $s, $d) {
    $c = if ($s -match "ok|healthy|PONG") { $C_OK }
    elseif ($s -match "error|unhealthy") { $C_ERR }
    elseif ($s -match "starting") { $C_WARN }
    else { $C_OFF }
    $ic = if ($c -eq $C_OK) { $IC_OK } elseif ($c -eq $C_ERR) { $IC_ERR } elseif ($c -eq $C_WARN) { $IC_WARN } else { $IC_OFF }
    Write-Host ("  {0}  {1,-22} {2}" -f $ic, $n, $d) -ForegroundColor $c
}

function Dash {
    $gp = 0; $gf = 0; $gw = 0
    Clear-Host
    $themeIcon = if ($DarkMode) { "🌙 Dark Mode" } else { "☀️ Light Mode" }
    if ($DarkMode) {
        Write-Host ("  {0}  Dashboard  [{1}]  (Ctrl+C)" -f $themeIcon, (Get-Date -Format "HH:mm:ss")) -ForegroundColor White
    } else {
        Write-Host ("  {0}  Dashboard  [{1}]  (Ctrl+C)" -f $themeIcon, (Get-Date -Format "HH:mm:ss")) -ForegroundColor Cyan
    }
    Write-Host ""

    # DOCKER
    Show-Header "Docker Containers"
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
            else {            Write-Host ("  {0} $nn [$ss]" -f $IC_OFF) -ForegroundColor $C_OFF }
        }
    }

    # DB & CACHE
    Show-Header "Database & Cache"
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
    Show-Header "Application Server"
    try {
        $req = [System.Net.WebRequest]::Create("http://localhost:3000")
        $req.Timeout = 2000; $resp = $req.GetResponse(); $code = [int]$resp.StatusCode; $resp.Close()
        if ($code -eq 200) { Stat "Next.js" "ok" "HTTP 200"; $gp++ }
        else { Stat "Next.js" "error" "HTTP $code"; $gf++ }
    } catch { Stat "Next.js" "off" "port 3000"; $gw++ }

    # SYSTEM RESOURCES (oculto em --compact)
    if (-not $Compact) {
        Show-Header "System Resources"

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
            Write-Host "  Container CPU/Memory:" -ForegroundColor $C_SUB
            foreach ($line in ($stats -split "`n" | Where-Object { $_ -notmatch "glitchtip" })) {
                $parts = $line -split '\|'
                if ($parts.Count -ge 4) {
                    $sn = $parts[0] -replace '^severinno-', '' -replace '-1$', ''
                    Write-Host ("    {0,-16} {1,-7} {2,-20} {3}" -f $sn, $parts[1], $parts[2], $parts[3]) -ForegroundColor $C_DIM
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
    }

    # LIVE LOGS (oculto em --compact)
    if (-not $Compact) {
        $llTitle = "Live Logs"
        if ($Logs) { $llTitle = "Live Logs ($Logs)" }
        Show-Header $llTitle

    # Docker container logs
    $logNames = docker ps --format '{{.Names}}' 2>$null | Where-Object { $_ -notmatch "glitchtip" }
    if ($logNames) {
        foreach ($cn in $logNames) {
            $sn = $cn -replace '^severinno-', '' -replace '-1$', ''

            # Apply -Logs filter if specified
            if ($Logs -ne "" -and $sn -notmatch $Logs) { continue }

            $logs = docker logs --tail 5 $cn 2>$null
            if ($logs) {
                Write-Host ("  {0}:" -f $sn) -ForegroundColor $C_HEADER
                foreach ($line in ($logs -split "`n" | Where-Object { $_ })) {
                    # Strip Docker ISO timestamp prefix
                    $line = $line -replace '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]+Z\s*', ''
                    # Truncate to 90 chars
                    if ($line.Length -gt 90) { $line = $line.Substring(0, 87) + "..." }
                    # Highlight errors/warnings
                    if ($line -match 'ERROR|FATAL|PANIC|TRACE') {
                        Write-Host ("    {0}" -f $line) -ForegroundColor $C_ERR
                    } elseif ($line -match 'WARN|WARNING') {
                        Write-Host ("    {0}" -f $line) -ForegroundColor $C_WARN
                    } else {
                        Write-Host ("    {0}" -f $line) -ForegroundColor $C_DIM
                    }
                }
            }
        }
    } else {
        Write-Host "  no containers" -ForegroundColor $C_OFF
    }

    # Next.js error check (runs locally, not in Docker)
    try {
        $req = [System.Net.WebRequest]::Create("http://localhost:3000/api/health")
        $req.Timeout = 1500
        $resp = $req.GetResponse()
        $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $body = $reader.ReadToEnd()
        $resp.Close(); $reader.Close()
        # Parse JSON fields
        $nextStatus = if ($body -match '"status":"([^"]+)"') { $matches[1] } else { "unknown" }
        $nextUptime = if ($body -match '"uptime":([0-9]+)') { $matches[1] } else { "0" }
        $nextColor = if ($nextStatus -eq 'ok') { $C_DIM } else { $C_ERR }
        Write-Host "  Next.js (local):" -ForegroundColor $C_HEADER
        Write-Host ("    status: {0}  uptime: {1}s" -f $nextStatus, $nextUptime) -ForegroundColor $nextColor
    } catch {
        Write-Host "  Next.js (local):" -ForegroundColor $C_HEADER
        Write-Host "    offline — start with: bun run dev" -ForegroundColor $C_OFF
    }

    # SUMMARY
    }
    Show-Header "Summary"
    $tt = $gp + $gf + $gw
    Write-Host ("  PASS: {0}  FAIL: {1}  WARN: {2}  Total: {3}" -f $gp, $gf, $gw, $tt)
    if ($gf -eq 0 -and $gw -eq 0) { Write-Host "  All healthy" -ForegroundColor $C_OK }
    elseif ($gf -eq 0) { Write-Host "  With warnings" -ForegroundColor $C_WARN }
    else { Write-Host ("  {0} failure(s)" -f $gf) -ForegroundColor $C_ERR }
    Write-Host ""
}

# ── Main ──────────────────────────────────────────────────────────────────
function Get-JsonStatus {
    <#
    .SYNOPSIS
        Collects all service status and outputs as JSON
    #>
    $timestamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $theme = if ($DarkMode) { 'dark' } else { 'light' }

    # ── Containers ─────────────────────────────────────────────────
    $containers = @()
    $raw = docker ps --format '{{.Names}}|{{.Status}}|{{.Ports}}' 2>$null
    if ($raw) {
        foreach ($line in ($raw -split "`n" | Where-Object { $_ })) {
            $parts = $line -split '\|'
            $name = $parts[0]
            $status = if ($parts.Count -gt 1) { $parts[1] } else { "?" }
            $ports = if ($parts.Count -gt 2) { ($parts[2] -split ',')[0].Trim() } else { "" }
            $sn = $name -replace '^severinno-', '' -replace '-1$', ''
            $health = 'unknown'
            if ($status -match 'healthy')   { $health = 'healthy' }
            elseif ($status -match 'unhealthy') { $health = 'unhealthy' }
            elseif ($status -match 'Exit|exited') { $health = 'exited' }
            elseif ($status -match 'starting') { $health = 'starting' }
            $containers += [PSCustomObject]@{
                name       = $name
                short_name = $sn
                status     = $status
                health     = $health
                ports      = $ports
            }
        }
    }

    # ── Database & Cache ───────────────────────────────────────────
    $pg = @{ status = 'off'; tables = 0 }
    $pgContainer = docker ps --format '{{.Names}}' 2>$null | Where-Object { $_ -match 'postgis|postgres' } | Select-Object -First 1
    if ($pgContainer) {
        $r = docker exec $pgContainer pg_isready -U severinno -d severinno 2>&1
        if ($r -match 'accepting') {
            $tc = docker exec $pgContainer psql -U severinno -d severinno -Atc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" 2>$null
            $gv = docker exec $pgContainer psql -U severinno -d severinno -Atc "SELECT PostGIS_Version()" 2>$null
            $pg.status = 'ok'
            $pg.tables = if ($tc) { [int]$tc } else { 0 }
            if ($gv) { $pg.postgis_version = ($gv -split ' ')[0] }
        } else {
            $pg.status = 'error'
            $pg.error = 'not responding'
        }
        $pg.container = $pgContainer
    }

    $rd = @{ status = 'off' }
    $rdContainer = docker ps --format '{{.Names}}' 2>$null | Where-Object { $_ -match 'redis|valkey' } | Select-Object -First 1
    if ($rdContainer) {
        $cmd = if ($rdContainer -match 'valkey') { 'valkey-cli' } else { 'redis-cli' }
        $ping = docker exec $rdContainer $cmd ping 2>$null
        if ($ping -match 'PONG') {
            $rd.status = 'ok'; $rd.ping = 'PONG'
        } else {
            $rd.status = 'error'; $rd.error = 'no response'
        }
        $rd.container = $rdContainer
    }

    $mi = @{ status = 'off' }
    $miContainer = docker ps --format '{{.Names}}' 2>$null | Where-Object { $_ -match 'minio' -and $_ -notmatch 'init' } | Select-Object -First 1
    if ($miContainer) {
        try {
            $req = [System.Net.WebRequest]::Create('http://localhost:9000/minio/health/live')
            $req.Timeout = 2000; $resp = $req.GetResponse(); $resp.Close()
            $mi.status = 'ok'
        } catch {
            $mi.status = 'error'; $mi.error = 'port 9000'
        }
        $mi.container = $miContainer
    }

    # ── Application Server ─────────────────────────────────────────
    $app = @{ status = 'off'; http_code = '000' }
    try {
        $req = [System.Net.WebRequest]::Create('http://localhost:3000')
        $req.Timeout = 2000; $resp = $req.GetResponse()
        $code = [int]$resp.StatusCode; $resp.Close()
        $app.http_code = $code
        if ($code -eq 200) {
            $app.status = 'ok'
            try {
                $hreq = [System.Net.WebRequest]::Create('http://localhost:3000/api/health')
                $hreq.Timeout = 2000
                $hresp = $hreq.GetResponse()
                $reader = New-Object System.IO.StreamReader($hresp.GetResponseStream())
                $app.health = $reader.ReadToEnd()
                $hresp.Close(); $reader.Close()
            } catch {}
        } else { $app.status = 'error' }
    } catch {}
    $app.url = 'http://localhost:3000'

    # ── System Resources ───────────────────────────────────────────
    $sys = @{ containers_stats = @() }
    try {
        $drv = Get-PSDrive C -ErrorAction SilentlyContinue | Select-Object Used,Free
        if ($drv) {
            $usedGB = [math]::Round($drv.Used / 1GB, 1)
            $freeGB = [math]::Round($drv.Free / 1GB, 1)
            $totalGB = $usedGB + $freeGB
            $pct = [math]::Round(($drv.Used / ($drv.Used + $drv.Free)) * 100, 0)
            $sys.disk = [PSCustomObject]@{
                total         = "${totalGB}G"
                used          = "${usedGB}G"
                available     = "${freeGB}G"
                used_percent  = $pct
            }
        }
    } catch {}

    $ds = docker system df 2>$null | Select-Object -Last 1
    if ($ds) { $sys.docker_disk = ($ds -replace '\s+', ' ') }

    $stats = docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}' 2>$null
    if ($stats) {
        foreach ($line in ($stats -split "`n" | Where-Object { $_ -notmatch 'glitchtip' })) {
            $parts = $line -split '\|'
            if ($parts.Count -ge 4) {
                $sn = $parts[0] -replace '^severinno-', '' -replace '-1$', ''
                $sys.containers_stats += [PSCustomObject]@{
                    name           = $sn
                    cpu            = $parts[1]
                    memory         = $parts[2]
                    memory_percent = $parts[3]
                }
            }
        }
    }

    # ── Summary ────────────────────────────────────────────────────
    $pass = 0; $fail = 0; $warn = 0
    foreach ($c in $containers) {
        if ($c.health -eq 'healthy') { $pass++ }
        elseif ($c.health -in @('unhealthy', 'exited')) { $fail++ }
        elseif ($c.health -eq 'starting') { $warn++ }
    }
    if ($pg.status -eq 'ok') { $pass++ } elseif ($pg.status -eq 'error') { $fail++ } else { $warn++ }
    if ($rd.status -eq 'ok') { $pass++ } elseif ($rd.status -eq 'error') { $fail++ } else { $warn++ }
    if ($mi.status -eq 'ok') { $pass++ } elseif ($mi.status -eq 'error') { $fail++ } else { $warn++ }
    if ($app.status -eq 'ok') { $pass++ } elseif ($app.status -eq 'error') { $fail++ } else { $warn++ }

    $summary = [PSCustomObject]@{
        pass    = $pass
        fail    = $fail
        warn    = $warn
        total   = $pass + $fail + $warn
        healthy = ($fail -eq 0)
    }

    # ── Build final object ─────────────────────────────────────────
    $result = [PSCustomObject]@{
        timestamp        = $timestamp
        theme            = $theme
        containers       = $containers
        database         = [PSCustomObject]@{ postgresql = $pg; redis = $rd; minio = $mi }
        application      = [PSCustomObject]@{ nextjs = $app }
        system_resources = [PSCustomObject]@{
            disk             = $sys.disk
            docker_disk      = $sys.docker_disk
            containers_stats = $sys.containers_stats
        }
        summary          = $summary
    }

    $result | ConvertTo-Json -Depth 10
}

# ── Main ──────────────────────────────────────────────────────────────────
if (-not $env:SEVERINNO_TEST_MODE) {
    $dir = Split-Path $PSCommandPath -Parent
    Set-Location (Resolve-Path "$dir\..")
    try {
        if ($Json) { Get-JsonStatus }
        elseif ($Once) { Dash }
        else { while ($true) { Dash; Start-Sleep $Interval } }
    } finally { Set-Location $dir }
}
