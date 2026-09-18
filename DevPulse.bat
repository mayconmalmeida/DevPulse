@echo off
setlocal

title DevPulse Launcher

cd /d "%~dp0"

set "DEVPULSE_URL=http://127.0.0.1:4173/pulse.html"

rem Descoberta do Edge e feita pelo mesmo modulo compartilhado
rem que o launcher usa (pulse-window.ps1, funcao Find-EdgePath)
rem nunca um caminho unico fixo assumido aqui (v0.13.0).
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='SilentlyContinue'; . '%~dp0pulse-window.ps1'; $p = Find-EdgePath; if ($p) { exit 0 } else { exit 1 }"

if errorlevel 1 (
    echo [DevPulse] Microsoft Edge nao encontrado neste computador.
    echo [DevPulse] O DevPulse Pulse requer o Microsoft Edge instalado.
    echo.
    pause
    exit /b 1
)

where node >nul 2>nul

if errorlevel 1 (
    echo [DevPulse] Node.js nao encontrado no PATH.
    echo [DevPulse] Instale o Node.js ^(https://nodejs.org^) e tente novamente.
    echo.
    pause
    exit /b 1
)

rem Instala dependencias somente se o projeto realmente
rem declarar alguma e node_modules ainda nao existir - hoje
rem o DevPulse nao tem dependencias externas, entao este
rem bloco nao faz nada; existe para nao quebrar se isso mudar
rem no futuro. Nunca instala o proprio Node.js.
if not exist "%~dp0node_modules" (
    powershell -NoProfile -Command ^
      "$pkg = Get-Content '%~dp0package.json' -Raw | ConvertFrom-Json; $hasDeps = ($pkg.dependencies -and $pkg.dependencies.PSObject.Properties.Count -gt 0) -or ($pkg.devDependencies -and $pkg.devDependencies.PSObject.Properties.Count -gt 0); if ($hasDeps) { exit 0 } else { exit 1 }"

    if not errorlevel 1 (
        echo [DevPulse] Instalando dependencias ^(primeira execucao^)...
        call npm install --no-fund --no-audit
        if errorlevel 1 (
            echo.
            echo [DevPulse] Falha ao instalar dependencias via npm install.
            echo.
            pause
            exit /b 1
        )
    )
)

rem "Ja esta rodando" so conta se a porta 4173 responder como
rem ESTA MESMA instalacao - nunca so pelo campo "service" do
rem corpo de /api/health, porque duas instalacoes diferentes do
rem DevPulse podem responder com o mesmo "service" (e ate a
rem mesma "version"). A distincao real e feita comparando o
rem instanceId local (data\instance-id) com o instanceId devolvido
rem pela porta 4173 (pulse-handshake.ps1, v0.13.1).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pulse-handshake.ps1"

if errorlevel 3 (
    echo.
    echo [DevPulse] A porta 4173 ja esta em uso por OUTRA instalacao
    echo [DevPulse] do DevPulse ^(pasta diferente desta^). Para evitar
    echo [DevPulse] abrir o Pulse errado, esta copia nao vai continuar.
    echo [DevPulse] Feche a outra instalacao do DevPulse e tente de novo.
    echo.
    pause
    exit /b 1
)

if errorlevel 2 (
    echo.
    echo [DevPulse] A porta 4173 ja esta em uso por outro processo,
    echo [DevPulse] que nao parece ser o DevPulse. Encerre esse processo
    echo [DevPulse] ou libere a porta 4173 e tente novamente.
    echo.
    pause
    exit /b 1
)

if errorlevel 1 (

    start "DevPulse Server" /min cmd /c "cd /d ""%~dp0"" && npm run dev"

    powershell -NoProfile -Command ^
      "$ok=$false; for($i=0;$i -lt 20;$i++){ try { $r=Invoke-WebRequest 'http://127.0.0.1:4173/api/health' -UseBasicParsing -TimeoutSec 1; if($r.StatusCode -eq 200){$body=$r.Content|ConvertFrom-Json; if($body.service -eq 'DevPulse'){$ok=$true;break} } } catch {}; Start-Sleep -Milliseconds 500 }; if(-not $ok){exit 1}"

    if errorlevel 1 (
        echo.
        echo [DevPulse] O servico nao respondeu a tempo.
        echo.
        pause
        exit /b 1
    )

)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pulse-launch.ps1" >nul

if errorlevel 1 (
    echo.
    echo [DevPulse] Nao foi possivel abrir/posicionar o Pulse.
    echo.
    pause
    exit /b 1
)

exit /b 0
