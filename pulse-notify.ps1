param(
    [Parameter(Mandatory = $true)]
    [string]$Title,

    [Parameter(Mandatory = $true)]
    [string]$Message,

    [ValidateSet("Info", "Warning", "Error")]
    [string]$Icon = "Info"
)

# ============================================================
# DevPulse Pulse v0.12.0 — notificação nativa do Windows
#
# Mecanismo: System.Windows.Forms.NotifyIcon (balloon tip).
# Escolhido por ser parte do .NET Framework já presente no
# Windows — nenhuma instalação, nenhum módulo externo
# (ex.: BurntToast), nenhum privilégio de admin, nenhum
# bypass de política corporativa. O próprio Windows 10/11
# roteia esses balloon tips para a Central de Ações.
#
# Chamado pelo backend (src/alerts/notifier.js) como
# processo solto (spawn, sem esperar o processo terminar) —
# uma notificação lenta/travada nunca deve atrasar uma
# resposta HTTP do DevPulse.
# ============================================================

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$toolTipIcon = switch ($Icon) {
    "Warning" { [System.Windows.Forms.ToolTipIcon]::Warning }
    "Error"   { [System.Windows.Forms.ToolTipIcon]::Error }
    default   { [System.Windows.Forms.ToolTipIcon]::Info }
}

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Information
$notify.Visible = $true
$notify.BalloonTipTitle = $Title
$notify.BalloonTipText = $Message
$notify.BalloonTipIcon = $toolTipIcon

$notify.ShowBalloonTip(8000)

Start-Sleep -Seconds 8

$notify.Dispose()

exit 0
