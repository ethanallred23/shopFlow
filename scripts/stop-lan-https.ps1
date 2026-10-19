$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
& (Join-Path $projectRoot '.local/caddy/caddy.exe') stop --address 127.0.0.1:2019
if ($LASTEXITCODE -ne 0) { throw 'Caddy shutdown failed.' }
