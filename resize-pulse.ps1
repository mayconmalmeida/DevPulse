param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("expanded", "dock", "detail")]
    [string]$Mode
)

# ============================================================
# DevPulse Pulse v0.9.1
#
# Wrapper fino sobre pulse-window.ps1 — a fonte única de
# verdade para dimensões, descoberta de janela (robusta,
# via EnumWindows) e cálculo idempotente de geometria vive
# lá. Este script só chama a API pública e traduz o
# resultado para stdout/exit code, como o backend espera.
# ============================================================

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

. (Join-Path $ScriptDir "pulse-window.ps1")

try {
    Set-PulseWindowMode -Mode $Mode | Out-Null
} catch {
    Write-Error $_.Exception.Message
    exit 1
}

Write-Output $Mode
exit 0
