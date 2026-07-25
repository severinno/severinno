# ============================================================================
# Pester tests: scripts/check-health.ps1 (Pester v3 compatible)
# ============================================================================
$env:SEVERINNO_TEST_MODE = '1'

$here = Split-Path -Parent $PSCommandPath
$scriptPath = Resolve-Path "$here\..\scripts\check-health.ps1"
. $scriptPath

function Reset-Counters {
    $script:PassCount = 0
    $script:FailCount = 0
    $script:WarnCount = 0
    $script:Errors = @()
    $script:CriticalFail = $false
}

Describe "Write-Pass / Write-Fail / Write-Warn" {

    BeforeEach { Reset-Counters }

    It "Write-Pass increments PassCount" {
        Write-Pass "test ok" 2>$null
        $script:PassCount | Should Be 1
    }

    It "Write-Fail increments FailCount and Errors" {
        Write-Fail "something broke" 2>$null
        $script:FailCount | Should Be 1
    }

    It "Write-Warn increments WarnCount" {
        Write-Warn "minor issue" 2>$null
        $script:WarnCount | Should Be 1
    }

    It "counters work together" {
        Write-Pass "p1" 2>$null
        Write-Pass "p2" 2>$null
        Write-Fail "f1" 2>$null
        Write-Warn "w1" 2>$null
        $script:PassCount | Should Be 2
        $script:FailCount | Should Be 1
        $script:WarnCount | Should Be 1
    }

    It "counters are independent" {
        Write-Pass "a" 2>$null
        Write-Pass "b" 2>$null
        Write-Pass "c" 2>$null
        $script:PassCount | Should Be 3
        $script:FailCount | Should Be 0
        $script:WarnCount | Should Be 0
    }

    It "Write-Fail appends multiple errors" {
        Write-Fail "error 1" 2>$null
        Write-Fail "error 2" 2>$null
        Write-Fail "error 3" 2>$null
        $script:Errors.Count | Should Be 3
    }
}

Describe "Find-Python function" {
    It "returns a value without error" {
        $result = Find-Python
        $result | Should Not Be $null
        $result | Should Not Be ""
    }
}

Describe "Test-PortInUse function" {
    It "returns false for port 0" {
        $result = Test-PortInUse -Port 0
        $result | Should Be $false
    }

    It "returns false for port 65535" {
        $result = Test-PortInUse -Port 65535
        $result | Should Be $false
    }
}

Describe "Write-Step function" {
    It "outputs without crashing" {
        $result = Write-Step "Test Step" 4>&1 | Out-String
        $result | Should Match "Test Step"
    }
}

Describe "Run-HealthCheck function" {
    It "runs without crashing" {
        Reset-Counters
        $result = Run-HealthCheck 4>&1 | Out-String
        $result | Should Not Be $null
        $result | Should Not Be ""
    }
}
