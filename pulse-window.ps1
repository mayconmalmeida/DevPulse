# ============================================================
# DevPulse Pulse — módulo compartilhado de janela nativa
# ============================================================
#
# Fonte única de verdade para:
#   - dimensões dos modos nativos (dock/detail/expanded)
#   - descoberta robusta do HWND do Pulse (via EnumWindows,
#     não via Process.MainWindowHandle — que só reflete UMA
#     janela por processo e pode apontar para a janela
#     errada quando o Edge reaproveita processo/thread entre
#     múltiplas janelas)
#   - cálculo idempotente de geometria (sempre a partir da
#     working area, nunca a partir da posição/tamanho atual
#     da janela)
#
# Este arquivo é "dot-sourced" por resize-pulse.ps1 e
# pulse-launch.ps1 — nunca executado diretamente.

# ------------------------------------------------------------
# Dimensões nativas (única fonte de verdade)
# ------------------------------------------------------------

$Script:PulseDimensions = @{
    dock     = @{ Width = 170; Height = 590 }
    # Dock + painel de detalhes, aberto à esquerda do dock.
    detail   = @{ Width = 480; Height = 700 }
    expanded = @{ Width = 590; Height = 590 }
}

$Script:PulseMargins = @{
    Right  = 16
    Top    = 60
    Bottom = 20
}

# ------------------------------------------------------------
# Descoberta do Microsoft Edge (v0.13.0)
#
# Nenhum caminho é assumido como único — instalações válidas
# de Edge existem em pelo menos 4 lugares diferentes conforme
# a máquina (64-bit "Program Files", 32-bit "Program Files
# (x86)", instalação por usuário em LOCALAPPDATA, ou apenas
# registrada no registro do Windows via "App Paths", que é o
# mecanismo oficial que o Windows usa para resolver
# executáveis registrados). Retorna $null se nada for
# encontrado — quem chama decide como reagir (nunca segue em
# frente silenciosamente com um caminho inexistente).
# ------------------------------------------------------------

function Find-EdgePath {
    $candidates = @()

    if ($env:ProgramFiles) {
        $candidates += Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"
    }

    if (${env:ProgramFiles(x86)}) {
        $candidates += Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"
    }

    if ($env:LOCALAPPDATA) {
        $candidates += Join-Path $env:LOCALAPPDATA "Microsoft\Edge\Application\msedge.exe"
    }

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    # Último recurso: "App Paths" no registro — mecanismo
    # oficial e documentado do Windows para localizar
    # executáveis instalados, independente de onde vivem.
    $appPathsKeys = @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe",
        "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"
    )

    foreach ($key in $appPathsKeys) {
        try {
            $registered = (Get-ItemProperty -Path $key -ErrorAction Stop).'(default)'

            if ($registered -and (Test-Path $registered)) {
                return $registered
            }
        } catch {
            # Chave não existe nesta máquina — segue tentando as outras.
        }
    }

    return $null
}

# ------------------------------------------------------------
# Win32 API
# ------------------------------------------------------------

if (-not ("PulseWin32" -as [type])) {

    Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class PulseWin32
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
}
"@

}

Add-Type -AssemblyName System.Windows.Forms

# ------------------------------------------------------------
# Descoberta robusta da janela do Pulse
#
# Enumera TODAS as janelas de topo do sistema (não apenas a
# "MainWindow" heurística de um processo) e identifica a do
# Pulse pelo título + confirma que o processo dono é o
# msedge. Faz retry curto e determinístico — o Edge app-mode
# pode ainda não ter criado a janela real nos primeiros
# instantes após o processo iniciar.
# ------------------------------------------------------------

function Find-PulseWindowHandle {
    param(
        [int]$MaxAttempts = 20,
        [int]$DelayMs = 150
    )

    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {

        $script:PulseFoundHandle = [IntPtr]::Zero

        $callback = {
            param([IntPtr]$hWnd, [IntPtr]$lParam)

            if (-not [PulseWin32]::IsWindowVisible($hWnd)) {
                return $true
            }

            $length = [PulseWin32]::GetWindowTextLength($hWnd)

            if ($length -eq 0) {
                return $true
            }

            $sb = New-Object System.Text.StringBuilder ($length + 1)
            [PulseWin32]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
            $title = $sb.ToString()

            if ($title -notlike "*DevPulse*Pulse*") {
                return $true
            }

            [uint32]$procId = 0
            [PulseWin32]::GetWindowThreadProcessId($hWnd, [ref]$procId) | Out-Null

            try {
                $proc = Get-Process -Id $procId -ErrorAction Stop
            } catch {
                return $true
            }

            if ($proc.ProcessName -ne "msedge") {
                return $true
            }

            $script:PulseFoundHandle = $hWnd

            # Para a enumeração assim que encontrarmos uma
            # janela válida.
            return $false
        }

        [PulseWin32]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null

        if (
            $script:PulseFoundHandle -ne [IntPtr]::Zero -and
            [PulseWin32]::IsWindow($script:PulseFoundHandle)
        ) {
            return $script:PulseFoundHandle
        }

        Start-Sleep -Milliseconds $DelayMs
    }

    return [IntPtr]::Zero
}

# ------------------------------------------------------------
# Geometria idempotente
#
# x/y/width/height são sempre recalculados a partir da
# working area do monitor + das dimensões-alvo do modo —
# nunca a partir da posição/tamanho atual da janela. Chamar
# o mesmo modo várias vezes seguidas produz sempre a mesma
# geometria, e a borda direita visual nunca se move entre
# dock/detail/expanded.
# ------------------------------------------------------------

function Get-PulseTargetGeometry {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet("dock", "detail", "expanded")]
        [string]$Mode,

        [Parameter(Mandatory = $true)]
        $WorkingArea
    )

    $target = $Script:PulseDimensions[$Mode]

    $width = $target.Width
    $height = $target.Height

    $maxHeight =
        $WorkingArea.Height -
        $Script:PulseMargins.Top -
        $Script:PulseMargins.Bottom

    if ($height -gt $maxHeight) {
        $height = $maxHeight
    }

    $rightEdge =
        $WorkingArea.Right -
        $Script:PulseMargins.Right

    $x = $rightEdge - $width

    $y = $WorkingArea.Top + $Script:PulseMargins.Top

    return [PSCustomObject]@{
        Mode   = $Mode
        X      = $x
        Y      = $y
        Width  = $width
        Height = $height
    }
}

# ------------------------------------------------------------
# Aplica a geometria numa janela já localizada.
# ------------------------------------------------------------

function Set-PulseWindowGeometry {
    param(
        [Parameter(Mandatory = $true)]
        [IntPtr]$Handle,

        [Parameter(Mandatory = $true)]
        $Geometry
    )

    if (-not [PulseWin32]::IsWindow($Handle)) {
        throw "PULSE_WINDOW_HANDLE_INVALID"
    }

    # SW_RESTORE = 9 — garante que a janela não está
    # minimizada antes de mover/redimensionar.
    [PulseWin32]::ShowWindow($Handle, 9) | Out-Null

    Start-Sleep -Milliseconds 35

    $result =
        [PulseWin32]::MoveWindow(
            $Handle,
            $Geometry.X,
            $Geometry.Y,
            $Geometry.Width,
            $Geometry.Height,
            $true
        )

    if (-not $result) {
        throw "PULSE_MOVEWINDOW_FAILED"
    }
}

# ------------------------------------------------------------
# Atalho: localizar + posicionar num só passo.
# ------------------------------------------------------------

function Set-PulseWindowMode {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet("dock", "detail", "expanded")]
        [string]$Mode,

        [int]$MaxAttempts = 20,
        [int]$DelayMs = 150
    )

    $handle = Find-PulseWindowHandle -MaxAttempts $MaxAttempts -DelayMs $DelayMs

    if ($handle -eq [IntPtr]::Zero) {
        throw "PULSE_WINDOW_NOT_FOUND"
    }

    $screen = [System.Windows.Forms.Screen]::FromHandle($handle)
    $workingArea = $screen.WorkingArea

    $geometry = Get-PulseTargetGeometry -Mode $Mode -WorkingArea $workingArea

    Set-PulseWindowGeometry -Handle $handle -Geometry $geometry

    return [PSCustomObject]@{
        Handle   = $handle
        Geometry = $geometry
    }
}
