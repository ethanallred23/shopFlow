$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$caddyExe = Join-Path $projectRoot '.local/caddy/caddy.exe'
$tlsData = Join-Path $projectRoot '.local/caddy/data'
if (!(Test-Path -LiteralPath $caddyExe)) { throw 'Download official Windows amd64 Caddy to .local/caddy/caddy.exe first (see docs/LAN_HTTPS.md).' }
if (Get-NetTCPConnection -LocalPort 443 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 443 is already listening. Inspect its owner rather than starting another proxy.' }
New-Item -ItemType Directory -Force -Path $tlsData | Out-Null
# Restrict the CA private keys to this Windows user and SYSTEM; do not install CA trust.
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $tlsData /inheritance:r /grant:r "${identity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to restrict TLS data directory ACL.' }
$env:SHOPFLOW_TLS_DATA = $tlsData.Replace('\','/')
$env:XDG_CONFIG_HOME = (Join-Path $projectRoot '.local/caddy/config')
& $caddyExe validate --config (Join-Path $projectRoot 'deploy/Caddyfile') --adapter caddyfile
if ($LASTEXITCODE -ne 0) { throw 'Caddy configuration validation failed.' }
$caddyArgs = @('run','--config',('"'+(Join-Path $projectRoot 'deploy/Caddyfile')+'"'),'--adapter','caddyfile')
$process = Start-Process -FilePath $caddyExe -ArgumentList $caddyArgs -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot '.local/caddy/stdout.log') -RedirectStandardError (Join-Path $projectRoot '.local/caddy/stderr.log') -PassThru
$process.Id | Set-Content (Join-Path $projectRoot '.local/caddy/process-id')
# Caddy generates its private CA locally. Export ONLY the public trust anchor.
$rootCertificate = Join-Path $tlsData 'pki/authorities/local/root.crt'
for ($attempt=0; $attempt -lt 30; $attempt++) {
    if (Test-Path -LiteralPath $rootCertificate) { break }
    Start-Sleep -Milliseconds 500
}
if (!(Test-Path -LiteralPath $rootCertificate)) { throw 'CA certificate not yet generated. Inspect .local/caddy/stderr.log.' }
$publicDirectory = Join-Path $projectRoot 'certs'
New-Item -ItemType Directory -Force -Path $publicDirectory | Out-Null
Copy-Item -LiteralPath $rootCertificate -Destination (Join-Path $publicDirectory 'shopflow-root-ca.pem')
Write-Output 'Proxy started at https://192.168.10.36:443; verify with the exported certs/shopflow-root-ca.pem. No firewall or trust-store changes were made.'
