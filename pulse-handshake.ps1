# ============================================================
# DevPulse — handshake de instância (v0.13.1)
#
# Decide o que fazer com a porta 4173 ANTES de iniciar ou abrir
# qualquer coisa. Nunca mata processos e nunca assume que uma
# porta respondendo "service":"DevPulse" é necessariamente ESTA
# instalação — duas cópias diferentes do DevPulse (por exemplo,
# uma instalação antiga em outra pasta) podem responder com o
# mesmo "service" e até a mesma "version".
#
# Para distinguir isso, cada instalação tem um instanceId
# opaco e local (data/instance-id, ver src/server/instance.js).
# Este script lê/cria o instanceId DESTA pasta e compara com o
# instanceId devolvido por /api/health.
#
# Exit codes (lidos pelo DevPulse.bat via errorlevel):
#   0 - a porta já responde como ESTA MESMA instalação
#       -> reaproveitar (single-instance normal)
#   1 - a porta está livre
#       -> esta instalação pode iniciar o servidor
#   2 - a porta responde, mas não parece ser o DevPulse
#       -> não mexer, avisar o usuário
#   3 - a porta responde como DevPulse, mas de OUTRA instalação
#       (instanceId diferente)
#       -> não mexer, não abrir o Pulse, avisar o usuário
#
# -Port existe SOMENTE para a suíte de testes conseguir apontar
# este mesmo script de handshake para uma porta de teste isolada
# (cenário de duas instalações em paralelo). DevPulse.bat nunca
# passa esse parâmetro - a porta de produção continua sendo
# sempre 4173.
# ============================================================

param(
    [int]$Port = 4173
)

$ErrorActionPreference = "SilentlyContinue"

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir = Join-Path $ProjectDir "data"
$InstanceIdFile = Join-Path $DataDir "instance-id"

function Get-LocalInstanceId {
    if (-not (Test-Path $DataDir)) {
        New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
    }

    if (Test-Path $InstanceIdFile) {
        $existing = (Get-Content -Path $InstanceIdFile -Raw -ErrorAction SilentlyContinue)

        if ($existing -and $existing.Trim()) {
            return $existing.Trim()
        }
    }

    $newId = [guid]::NewGuid().ToString()

    # Criação exclusiva: se duas execuções concorrentes
    # chegarem aqui na primeira vez, só uma consegue criar o
    # arquivo - a outra cai no catch e relê o valor já gravado,
    # em vez de sobrescrever com um id diferente.
    try {
        $stream = [System.IO.File]::Open(
            $InstanceIdFile,
            [System.IO.FileMode]::CreateNew
        )
        $stream.Close()

        Set-Content -Path $InstanceIdFile -Value $newId -NoNewline

        return $newId
    } catch {
        $existing = (Get-Content -Path $InstanceIdFile -Raw -ErrorAction SilentlyContinue)

        if ($existing -and $existing.Trim()) {
            return $existing.Trim()
        }

        return $newId
    }
}

$thisInstanceId = Get-LocalInstanceId

try {
    $response = Invoke-WebRequest `
        -Uri "http://127.0.0.1:$Port/api/health" `
        -UseBasicParsing `
        -TimeoutSec 1

    if ($response.StatusCode -eq 200) {
        $body = $response.Content | ConvertFrom-Json

        if ($body.service -eq "DevPulse") {
            if ($body.instanceId -and ($body.instanceId -eq $thisInstanceId)) {
                exit 0
            } else {
                exit 3
            }
        } else {
            exit 2
        }
    }
} catch {
    # Porta não respondeu dentro do timeout - trata como livre.
}

exit 1
