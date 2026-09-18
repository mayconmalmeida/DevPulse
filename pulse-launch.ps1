param(
    # Vazio por padrão de propósito: o caminho real é
    # descoberto por Find-EdgePath (pulse-window.ps1) depois
    # do dot-source abaixo — nunca um único caminho fixo
    # assumido de antemão (v0.13.0, Public Release Readiness).
    # Passar -EdgePath força um caminho específico, útil só
    # para depuração manual.
    [string]$EdgePath = "",
    [string]$Url = "http://127.0.0.1:4173/pulse.html"
)

# ============================================================
# DevPulse Pulse v0.9.1 — launcher de janela
#
# Única implementação responsável por: verificar instância
# existente, abrir a janela Edge app-mode quando necessário,
# e aplicar a geometria nativa inicial. Substitui
# position-pulse.ps1 (removido — tinha dimensões próprias,
# 390x500, que conflitavam com resize-pulse.ps1 e causavam
# o "flash" de geometria errada no startup).
# ============================================================

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

. (Join-Path $ScriptDir "pulse-window.ps1")

if (-not $EdgePath) {
    $EdgePath = Find-EdgePath
}

# ------------------------------------------------------------
# 1) Já existe uma janela Pulse válida? Verificação curta —
#    se não existir de verdade, não vale a pena esperar
#    muito aqui (o caso "abrir do zero" é tratado abaixo,
#    com um retry bem mais generoso).
# ------------------------------------------------------------

$existingHandle = Find-PulseWindowHandle -MaxAttempts 2 -DelayMs 80

if ($existingHandle -ne [IntPtr]::Zero) {

    [PulseWin32]::ShowWindow($existingHandle, 9) | Out-Null
    [PulseWin32]::SetForegroundWindow($existingHandle) | Out-Null

    Write-Output "EXISTING"
    exit 0
}

# ------------------------------------------------------------
# 2) Não existe — abre uma nova janela Edge app-mode.
# ------------------------------------------------------------

if (-not $EdgePath -or -not (Test-Path $EdgePath)) {
    Write-Error "EDGE_NOT_FOUND"
    exit 1
}

Start-Process -FilePath $EdgePath -ArgumentList @(
    "--app=$Url",
    "--new-window"
) | Out-Null

# ------------------------------------------------------------
# 3) Espera a janela real existir e aplica o modo seguro
#    (dock) imediatamente — sem geometria intermediária
#    arbitrária. O próprio pulse.js corrige para "expanded"
#    logo em seguida caso essa seja a preferência persistida
#    do usuário; é uma única correção rápida, não um "flash"
#    para um tamanho sem relação com nenhum modo real.
# ------------------------------------------------------------

try {
    Set-PulseWindowMode -Mode dock -MaxAttempts 40 -DelayMs 200 | Out-Null
    Write-Output "LAUNCHED"
    exit 0
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
