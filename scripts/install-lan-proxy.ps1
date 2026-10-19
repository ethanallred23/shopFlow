$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$directory = Join-Path $projectRoot '.local/caddy'
New-Item -ItemType Directory -Force -Path $directory | Out-Null
$release = 'https://github.com/caddyserver/caddy/releases/download/v2.11.7'
$archive = Join-Path $directory 'caddy.zip'
$checksums = Join-Path $directory 'checksums.txt'
Invoke-WebRequest -Uri "$release/caddy_2.11.7_windows_amd64.zip" -OutFile $archive -UseBasicParsing
Invoke-WebRequest -Uri "$release/caddy_2.11.7_checksums.txt" -OutFile $checksums -UseBasicParsing
$expected = Get-Content -LiteralPath $checksums | Where-Object { $_ -match 'caddy_2.11.7_windows_amd64.zip$' }
$actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA512).Hash.ToLower()
if (!$expected -or !$expected.StartsWith($actual)) { throw 'Official Caddy SHA-512 checksum mismatch; refusing to install.' }
Expand-Archive -LiteralPath $archive -DestinationPath $directory -Force
& (Join-Path $directory 'caddy.exe') version
