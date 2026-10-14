$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$mysqlAdmin = Join-Path $projectRoot '.local/mysql/mysql-8.0.45-winx64/bin/mysqladmin.exe'
$secretPath = Join-Path $projectRoot '.local/root-password'
if (!(Get-NetTCPConnection -LocalPort 3307 -State Listen -ErrorAction SilentlyContinue)) {
    Write-Output 'Portable MySQL is already stopped.'
    exit 0
}
if (!(Test-Path -LiteralPath $secretPath)) { throw 'No workspace-local MySQL administration credential found.' }
$previousPassword = $env:MYSQL_PWD
try {
    $env:MYSQL_PWD = [System.IO.File]::ReadAllText($secretPath)
    & $mysqlAdmin --host=127.0.0.1 --port=3307 --user=root shutdown
    if ($LASTEXITCODE -ne 0) { throw 'MySQL shutdown failed.' }
} finally { $env:MYSQL_PWD = $previousPassword }
