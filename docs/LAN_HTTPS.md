# ShopFlow LAN HTTPS on this Windows computer

## Running and verified

- Express: `127.0.0.1:3001`, HTTP, loopback only. Browser: `http://localhost:5173`.
- Caddy 2.11.7: **https://192.168.10.36:443**, bound only to this private LAN IP. Only POST `/api/v1/events` and `/api/v1/heartbeat` are proxied; other paths return 404. No public deployment or HTTP redirect listener.
- Node/OpenSSL verified the chain and IP SAN using the exported root and `rejectUnauthorized:true`. Authenticated heartbeat and timer ingestion succeeded through HTTPS. A connection without the trusted CA failed; a request with no device token returned 401.
- Tests originated on this Windows host using its LAN IP. They do **not** prove another Wi-Fi device can pass the firewall/VLAN policy. No firewall, DNS, DHCP, router, corporate ACL or system trust-store changes were made.

## Public root CA for the ESP32

Use **[certs/shopflow-root-ca.pem](../certs/shopflow-root-ca.pem)**, the actual public trust anchor of this proxy. It is safe to share with firmware authors. SHA-256 certificate fingerprint:

```text
9D:BF:B0:56:15:7F:23:71:D4:06:FE:E2:34:10:61:38:04:EF:D9:1E:92:43:7D:DB:7D:54:A3:98:FA:41:4B:85
```

Root validity: 2026-10-14 20:56:40 UTC through 2036-08-22 20:56:40 UTC. Embed the entire PEM in firmware and call `WiFiClientSecure::setCACert`. Synchronize UTC before TLS and connect to `192.168.10.36`, matching the certificate IP SAN. Caddy renews short-lived server certificates while running; trust the root, not a leaf. Never use `setInsecure()` or disable chain/hostname verification. Sampling and the timer must keep running while network/NTP access is unavailable.

Private CA/issuer/server keys are in **ignored `.local/caddy/data/`**, with inheritance removed and access restricted to the current Windows user and SYSTEM. Never share that directory or tokens. Back up CA material securely for a maintained deployment. Deleting it and generating a new CA requires updating firmware trust. Only the public root is exported to `certs/`.

## Setup and operation

From the project directory, with MySQL/Express running:

```powershell
# Fresh installation only: download official release; verify SHA-512 checksum.
powershell -ExecutionPolicy Bypass -File scripts/install-lan-proxy.ps1

# Validate config, restrict key ACLs, generate/reuse CA, start hidden,
# and export ONLY the public root certificate.
powershell -ExecutionPolicy Bypass -File scripts/start-lan-https.ps1

# Stop only the proxy:
powershell -ExecutionPolicy Bypass -File scripts/stop-lan-https.ps1
```

[deploy/Caddyfile](../deploy/Caddyfile) uses `tls internal`, `skip_install_trust`, workspace-local storage and no redirects. Caddy's administration endpoint is loopback `127.0.0.1:2019`. Logs are under `.local/caddy/`; request bodies/credentials are not logged. It is a running user process, **not an installed Windows service**. Coordinate service/account/backup ownership with IT for startup after reboot; the app and database also need startup management.

Caddy generates a private CA and IP certificate on first startup, then reuses storage. For intentional CA rotation, stop the proxy, securely retain the old private storage, configure a new storage directory, restart, and distribute the new public root before switching devices. Setup does not rotate an existing CA or install Windows/browser trust.

## Network steps requiring authorized IT involvement

1. **Reserve 192.168.10.36** for Ethernet MAC **58-11-22-CD-80-CE** on the relevant DHCP scope (gateway observed `192.168.10.1`). The IP is observed, **not confirmed reserved**. Do not set a static IP without checking DHCP/subnet allocation. If IT requires another address, update the Caddy site/bind and firmware URL; issue a matching IP certificate.
2. Permit the Arduino Wi-Fi VLAN to reach **192.168.10.36 TCP 443**. Check guest/client isolation and inter-VLAN routing. Do not forward WAN ports or expose 3001, 5173 or MySQL.
3. Windows Ethernet is **DomainAuthenticated** with firewall enabled. An authorized administrator may need this scoped rule. It has **not been executed**; substitute the actual Arduino IP or an approved subnet:

```powershell
# Only after corporate authorization, in elevated PowerShell:
$caddyProgram = (Resolve-Path '.local/caddy/caddy.exe').Path
New-NetFirewallRule -DisplayName 'ShopFlow Arduino HTTPS' `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443 `
  -LocalAddress 192.168.10.36 -RemoteAddress '<ARDUINO_IP_OR_APPROVED_SUBNET>' `
  -Program $caddyProgram -Profile Domain
```

4. From a **second device on the Arduino Wi-Fi**, run `Test-NetConnection 192.168.10.36 -Port 443`, then a CA-validated heartbeat request. A valid body without a token returns 401; a real token returns 200. Do not send a real token until certificate validation succeeds.

POSIX/OpenSSL curl, using the copied public root:

```sh
curl --cacert shopflow-root-ca.pem https://192.168.10.36/api/v1/heartbeat \
  -H 'Content-Type: application/json' \
  --data '{"deviceId":"11111111-1111-4111-8111-111111111111"}'
# Expected 401 without a token.
```

Installed Windows curl/Schannel reported unknown revocation status for this private CA, which has no public CRL/OCSP endpoint. That curl test did not pass. Verification instead used Node/OpenSSL with explicit root trust and normal chain/IP checks; verification was never disabled. Use the Node test below or an OpenSSL client rather than bypassing certificate validation. Corporate trust-store installation requires IT approval and was not done.

```powershell
npx.cmd tsx scripts/verify-timer-https.ts
```

This creates a dedicated synthetic timer in the marked demo organization, tests real HTTPS ingestion and browser display, revokes the test token, and disables the device. Evidence is `.local/timer-https-verification.json`; no token is printed/saved. Proxy-originated requests currently share the loopback IP's 600/minute API budget. Review narrowly trusted proxy handling/device limits before a large fleet; do not broadly enable trust-proxy.

Official references: [Caddy TLS](https://caddyserver.com/docs/caddyfile/directives/tls), [global options](https://caddyserver.com/docs/caddyfile/options), [Windows operation](https://caddyserver.com/docs/running).
