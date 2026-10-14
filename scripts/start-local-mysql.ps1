# Optional helper for the portable MySQL installed during local validation.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$mysqlBase = Join-Path $projectRoot '.local/mysql/mysql-8.0.45-winx64'
$mysqlData = Join-Path $projectRoot '.local/mysql-data'
$mysqlExe = Join-Path $mysqlBase 'bin/mysqld.exe'
if (!(Test-Path -LiteralPath $mysqlExe) -or !(Test-Path -LiteralPath $mysqlData)) {
    throw 'Portable MySQL is not initialized here. Use docker compose up -d --wait and the README setup instead.'
}
if (Get-NetTCPConnection -LocalPort 3307 -State Listen -ErrorAction SilentlyContinue) {
    Write-Output 'Port 3307 is already listening; no new database process started.'
    exit 0
}
$mysqlArgs = @('--no-defaults', ('--basedir="' + $mysqlBase + '"'), ('--datadir="' + $mysqlData + '"'), '--port=3307', '--bind-address=127.0.0.1', '--mysqlx=0', '--default-time-zone=+00:00', '--console')
Start-Process -FilePath $mysqlExe -ArgumentList $mysqlArgs -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot '.local/mysql-stdout.log') -RedirectStandardError (Join-Path $projectRoot '.local/mysql-stderr.log') | Out-Null
Write-Output 'Portable MySQL starting on 127.0.0.1:3307. Credentials remain in .env.'
