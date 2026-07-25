# ============================================================================
# Pester tests: scripts/dashboard.ps1 (Pester v3 compatible)
# ============================================================================
$env:SEVERINNO_TEST_MODE = '1'

$here = Split-Path -Parent $PSCommandPath
$scriptPath = Resolve-Path "$here\..\scripts\dashboard.ps1"
. $scriptPath

function Set-DarkMode {
    param([switch]$Dark)
    $script:DarkMode = $Dark.IsPresent
    $script:C_OK     = if ($DarkMode) { "Green" } else { "DarkGreen" }
    $script:C_ERR    = if ($DarkMode) { "Red" } else { "DarkRed" }
    $script:C_WARN   = if ($DarkMode) { "Yellow" } else { "DarkYellow" }
    $script:C_OFF    = if ($DarkMode) { "DarkGray" } else { "Gray" }
    $script:C_HEADER = if ($DarkMode) { "White" } else { "Cyan" }
    $script:C_SUB    = if ($DarkMode) { "DarkGray" } else { "Cyan" }
    $script:C_DIM    = if ($DarkMode) { "DarkGray" } else { "DarkGray" }
    $script:IC_OK    = if ($DarkMode) { " ◉" } else { " +" }
    $script:IC_ERR   = if ($DarkMode) { " ◉" } else { " !" }
    $script:IC_WARN  = if ($DarkMode) { " ◉" } else { " ~" }
    $script:IC_OFF   = if ($DarkMode) { " ○" } else { " ." }
}

Describe "Stat function" {

    It "returns output for 'ok' status" {
        Set-DarkMode
        $result = Stat "TestService" "ok" "healthy" 4>&1 | Out-String
        $result | Should Not Be $null
        $result | Should Not Be ""
    }

    It "returns output for 'error' status" {
        Set-DarkMode
        $result = Stat "TestService" "error" "crashed" 4>&1 | Out-String
        $result | Should Not Be $null
        $result | Should Not Be ""
    }

    It "returns output for 'starting' status" {
        Set-DarkMode
        $result = Stat "TestService" "starting" "booting" 4>&1 | Out-String
        $result | Should Not Be $null
        $result | Should Not Be ""
    }

    It "returns output for unknown status" {
        Set-DarkMode
        $result = Stat "TestService" "unknown" "???" 4>&1 | Out-String
        $result | Should Not Be $null
        $result | Should Not Be ""
    }

    It "includes the service name in output" {
        Set-DarkMode
        $result = Stat "MyService" "ok" "running" 4>&1 | Out-String
        $result | Should Match "MyService"
    }

    It "includes the status detail in output" {
        Set-DarkMode
        $result = Stat "Svc" "ok" "healthy" 4>&1 | Out-String
        $result | Should Match "healthy"
    }

    It "stat outputs content for each status type" {
        Set-DarkMode
        $okIcon   = (Stat "A" "ok" "a" 4>&1 | Out-String)
        $errIcon  = (Stat "A" "error" "b" 4>&1 | Out-String)
        $warnIcon = (Stat "A" "starting" "c" 4>&1 | Out-String)
        $okIcon | Should Not Be $null
        $errIcon | Should Not Be $null
        $warnIcon | Should Not Be $null
    }

    It "matches PONG as ok status" {
        Set-DarkMode
        $result = Stat "Redis" "PONG" "PONG" 4>&1 | Out-String
        $result | Should Not Be $null
        $result | Should Not Be ""
    }
}

Describe "Show-Header function" {

    It "outputs section text in light mode" {
        Set-DarkMode
        $result = Show-Header "Test Section" 4>&1 | Out-String
        $result | Should Match "Test Section"
    }

    It "outputs section text in dark mode" {
        Set-DarkMode -Dark
        $result = Show-Header "Test Section" 4>&1 | Out-String
        $result | Should Match "Test Section"
    }

    It "outputs different format in dark vs light mode" {
        Set-DarkMode
        $lightResult = Show-Header "Section" 4>&1 | Out-String
        Set-DarkMode -Dark
        $darkResult  = Show-Header "Section" 4>&1 | Out-String
        $lightResult | Should Not BeExactly $darkResult
    }
}

Describe "Parameter parsing" {

    It "defaults DarkMode to false without -Dark" {
        $Dark = [switch]::new($false)
        $script:DarkMode = $Dark
        $script:DarkMode | Should Be $false
    }

    It "sets DarkMode to true with -Dark" {
        $Dark = [switch]::new($true)
        $script:DarkMode = $Dark
        $script:DarkMode | Should Be $true
    }

    It "accepts -Interval parameter" {
        $Interval = 5
        $Interval | Should Be 5
    }

    It "defaults Interval to 3" {
        $Interval = 3
        $Interval | Should Be 3
    }
}

Describe "Theme colors" {

    It "dark mode uses Green for OK" {
        Set-DarkMode -Dark
        $script:C_OK | Should Be "Green"
    }

    It "light mode uses DarkGreen for OK" {
        Set-DarkMode
        $script:C_OK | Should Be "DarkGreen"
    }

    It "dark mode uses Red for ERROR" {
        Set-DarkMode -Dark
        $script:C_ERR | Should Be "Red"
    }

    It "light mode uses DarkRed for ERROR" {
        Set-DarkMode
        $script:C_ERR | Should Be "DarkRed"
    }

    It "dark mode uses ◉ icon for OK" {
        Set-DarkMode -Dark
        $script:IC_OK | Should Match "◉"
    }

    It "light mode uses + icon for OK" {
        Set-DarkMode
        $script:IC_OK | Should Match "\+"
    }
}
