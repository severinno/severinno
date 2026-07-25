@echo off
setlocal enabledelayedexpansion
title Severinno Marketplace — Launcher
cd /d "%~dp0"

:: Se nao tiver flag de configurado, vai direto pro modo completo
:: (cria o arquivo .tmp/configured.flag depois do primeiro setup)
if not exist ".tmp\configured.flag" (
    if "%1"=="" goto ALL
)

:MENU
cls
echo ============================================
echo    Severinno Marketplace — Launcher
echo ============================================
echo.
echo  1. Setup completo (Docker + DB + app)
echo  2. Health Check + corrigir problemas
echo  3. Dashboard (tempo real)
echo  4. FAZER TUDO (setup rapido + check + dashboard)  ^<-- PADRAO
echo  5. Sair
echo.
echo  Iniciando opcao 4 em 5 segundos...
echo  Pressione 1-5 para escolher outra opcao.
echo.

:: Auto-select option 4 after timeout
set "opt="
for /l %%i in (1,1,5) do (
    choice /c:12345 /n /t:1 /d:5 >nul 2>&1
    if not errorlevel 5 (
        set "opt=!errorlevel!"
        goto RUN_OPTION
    )
)
set opt=4

:RUN_OPTION
if "%opt%"=="1" goto SETUP
if "%opt%"=="2" goto CHECK
if "%opt%"=="3" goto DASHBOARD
if "%opt%"=="4" goto ALL
if "%opt%"=="5" goto EOF
goto MENU

:SETUP
cls
echo ============================================
echo    Executando setup completo...
echo ============================================
echo.
where bash >nul 2>&1
if %errorlevel%==0 (
    bash scripts\setup.sh
) else (
    powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
)
echo.
echo  Setup concluido.
pause
goto MENU

:CHECK
cls
echo ============================================
echo    Executando health check...
echo ============================================
echo.
where bash >nul 2>&1
if %errorlevel%==0 (
    bash scripts\check-health.sh --fix
) else (
    powershell -ExecutionPolicy Bypass -File scripts\check-health.ps1 -Fix
)
echo.
pause
goto MENU

:DASHBOARD
cls
echo ============================================
echo    Abrindo dashboard em tempo real...
echo ============================================
echo  Pressione Ctrl+C no dashboard para voltar.
echo.
timeout /t 3 /nobreak >nul
where bash >nul 2>&1
if %errorlevel%==0 (
    bash scripts\dashboard.sh
) else (
    powershell -ExecutionPolicy Bypass -File scripts\dashboard.ps1
)
goto MENU

:ALL
cls
echo ============================================
echo    MODO COMPLETO
echo    Setup rapido + Health Check + Dashboard
echo ============================================
echo.

:: Step 1: Setup rapido
echo [1/3] Setup rapido (infra + DB)...
echo.
where bash >nul 2>&1
if %errorlevel%==0 (
    bash scripts\setup.sh --quick
) else (
    powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -Quick
)
if errorlevel 1 (
    echo  [AVISO] Setup pode nao ter completado — continuando...
)
echo.

:: Step 2: Health Check
echo [2/3] Health Check...
echo.
where bash >nul 2>&1
if %errorlevel%==0 (
    bash scripts\check-health.sh --fix
) else (
    powershell -ExecutionPolicy Bypass -File scripts\check-health.ps1 -Fix
)
echo.

:: Show credentials before dashboard
echo ============================================
echo    Credenciais de Teste
echo ============================================
echo    Admin:    admin@severinno.com / admin123
echo    Cliente:  cliente@severinno.com / cliente123
echo    Prestador: carlos@severinno.com / provider123
echo.
echo  Pressione Ctrl+C no dashboard para sair.
echo  Iniciando dashboard em 5 segundos...
echo.
timeout /t 5 /nobreak >nul

:: Marcar como configurado (proxima execucao mostra menu)
if not exist ".tmp" mkdir .tmp >nul 2>&1
echo 1 > ".tmp\configured.flag" 2>nul

:: Step 3: Dashboard
echo [3/3] Dashboard...
where bash >nul 2>&1
if %errorlevel%==0 (
    bash scripts\dashboard.sh
) else (
    powershell -ExecutionPolicy Bypass -File scripts\dashboard.ps1
)
goto MENU

:EOF
cls
echo ============================================
echo    Obrigado por usar o Severinno Marketplace!
echo ============================================
echo.
echo  Credenciais de teste:
echo    Admin:    admin@severinno.com / admin123
echo    Cliente:  cliente@severinno.com / cliente123
echo    Prestador: carlos@severinno.com / provider123
echo.
echo  Servicos:
echo    App:      http://localhost:3000
echo    MinIO:    http://localhost:9001
echo.
timeout /t 5 /nobreak >nul
