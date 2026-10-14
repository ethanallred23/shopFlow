# Nano ESP32 → ShopFlow: implemented integration handoff

Verified 2026-10-14. Hardware reported working: D5 HIGH means detected, LOW absent; D4 follows detection; TM1637 CLK D2/DIO D3 at 3.3 V. The hardware timer accumulates only while detected, pauses when absent, and resumes without clearing. The repository sketch does **not** implement the TM1637 or this accumulated-time measurement; retain the working firmware's sampling/display logic.

## Connectivity — not ready for physical connection yet

Backend is running locally at **http://127.0.0.1:3001**, frontend at **http://localhost:5173**. No deployment or HTTPS endpoint is configured in this project. All observed application/database listeners bind to loopback.

The computer's active Ethernet IPv4 is **192.168.10.36**, gateway **192.168.10.1**. A Wi-Fi device must reach that Ethernet host through the LAN; localhost on the ESP32 is the ESP32 itself. **http://192.168.10.36:3001 currently refuses connections**, as does **https://192.168.10.36:443**. There is no usable Arduino base URL yet. Port 5173 is the Vite frontend, not the firmware's API destination.

Recommended LAN setup: a same-computer HTTPS reverse proxy listening on LAN port 443 and forwarding to `http://127.0.0.1:3001`. With a private/company CA certificate containing IP SAN `192.168.10.36`, the exact future Arduino base URL can be **https://192.168.10.36:443**. This URL is a configuration target, **not a running endpoint**. Alternatively provision a LAN-resolvable hostname and matching certificate, and use that hostname. Reserve the computer's DHCP address. Install the issuing root CA in firmware.

Keep Express on loopback behind that proxy. A routine fix added configurable `HOST` (default `127.0.0.1`) and accurate startup logging; `HOST=0.0.0.0` would allow direct LAN binding after restart but would still only provide HTTP. Do not use it as a substitute for TLS or send the device bearer token over LAN HTTP.

Windows Firewall is enabled; the Ethernet connection is DomainAuthenticated. No enabled inbound rules named for Node/ShopFlow/Caddy/nginx were found; that limited check does not establish effective port access. An authorized, appropriately scoped inbound TCP 443 rule may be needed. Corporate Wi-Fi/client isolation, VLAN ACLs, DNS, and routing require verification from a second device. No firewall rules, public deployment, port forwarding, or TLS verification settings were changed.

## Current API

Both endpoints require `Content-Type: application/json` and `Authorization: Bearer <device-token>`. No browser cookie, CSRF token, organization ID or workstation ID belongs in device requests.

**POST /api/v1/heartbeat**

```json
{"deviceId":"11111111-1111-4111-8111-111111111111","firmware":"nano-esp32-1.0"}
```

Replace the illustrative UUID with the registered device UUID. `firmware` is optional, maximum 100 characters. No other fields are accepted. Success: HTTP 200, `{"ok":true}`. Send about every 30 seconds. Online means a heartbeat within 90 seconds; production events alone do not mark a device online. Heartbeats do not consume event sequence numbers.

**POST /api/v1/events** — initial baseline:

```json
{
  "schemaVersion": 1,
  "eventId": "boot-a-0",
  "deviceId": "11111111-1111-4111-8111-111111111111",
  "bootId": "boot-a",
  "sequence": 0,
  "uptimeMs": 1000,
  "occurredAt": "2026-10-14T20:00:00.000Z",
  "delivery": "live",
  "type": "sensor.state_changed",
  "data": {"detected": false}
}
```

Then a detection edge:

```json
{
  "schemaVersion": 1,
  "eventId": "boot-a-1",
  "deviceId": "11111111-1111-4111-8111-111111111111",
  "bootId": "boot-a",
  "sequence": 1,
  "uptimeMs": 2500,
  "occurredAt": "2026-10-14T20:00:01.500Z",
  "delivery": "live",
  "type": "sensor.state_changed",
  "data": {"detected": true}
}
```

Use actual sample timestamps, not these illustrative historical times. They control report placement. First success: HTTP 200 `{"ok":true,"duplicate":false}`. Retry of the same device/event ID: HTTP 200 `{"ok":true,"duplicate":true}`. Acknowledgement follows database commit; an acknowledged event may still be excluded from counting because it is baseline/late/gapped.

| Field | Implemented validation and firmware requirements |
|---|---|
| schemaVersion | Exactly integer 1. |
| deviceId | Registered UUID; must match token. |
| eventId | Case-sensitive, 1–100 characters; unique per device across boots. Preserve ID and payload on retry. First committed payload wins. |
| bootId | Case-sensitive, 1–100 characters. Generate a fresh random ID each actual restart; do not change it just because Wi-Fi reconnects. |
| sequence | Integer 0–2,147,483,647; monotonically increase across all event types within a boot. Start at 0; don't reset on reconnect. |
| uptimeMs | Integer 0–9,007,199,254,740,991; monotonic milliseconds since boot. Avoid 32-bit millis rollover. |
| occurredAt | Required: UTC ISO string with Z, or null. More than five minutes in the future gives 422. No maximum past age is enforced. |
| delivery | Optional: live, buffered, unknown; defaults to unknown. Preserve original timestamps when buffering. |
| type/data | Only the two types below; unknown fields/types rejected. |

Types are `sensor.state_changed` / `{"detected":boolean}` and `cycle.completed` / `{"durationMs":integer}` (1–86,400,000). For a **real completed machine cycle**, use the same envelope with a new ID/sequence and the latter type/data. **Do not send accumulated detection time as cycle.completed.**

With `occurredAt:null`, explicit `delivery:live` creates a receipt-time estimate. Buffered/unknown delivery remains time-unplaced and is excluded from shift totals. Use `null` plus `buffered` if the original sample had no synchronized clock; never replace its original time with the reconnect time.

Errors generally return `{"error":"..."}`: 400 invalid JSON/schema/unsupported duration; 401 missing, invalid, revoked, disabled or archived credential; 403 device ID mismatch; 413 body too large; 422 unsupported device capability or timestamp too far ahead; 500 internal/database failure. Validation can run before authentication, so a malformed unauthenticated body may return 400 first. The rate limiter returns 429 with its default text body and Retry-After, not the JSON error format.

One event per request, no batch endpoint; JSON arrays are rejected. Maximum body 16 KB. All `/api` traffic shares an in-memory **600 requests/minute/IP** limit, including events, heartbeat and browser traffic. Login has an additional 20/15-minute/IP limit. Respect Retry-After; use capped exponential backoff with jitter for connection loss, timeout, 429 and 5xx. Retry unchanged events in order with one request in flight. Stop and correct 400/401/403/413/422 instead of retrying rapidly. Count-relevant sequence gaps and older delivery can lose derived counts even though raw rows are stored.

## Provisioning

Sign in as admin → Settings creates the shop/area/workstation → Devices → Register device → copy the one-time UUID/token → assign workstation. Current UI registration grants count and cycle capabilities. Configure minimum count interval in workstation detail (default 500 ms). Credentials contain 256 random bits; only SHA-256 hashes are stored. Never send the admin password from firmware.

Device disable/archive blocks ingestion with 401. Re-enabling a merely disabled device restores its still-unrevoked token. Token → Rotate revokes all previous credentials immediately and displays a new token once; update firmware. Token → Revoke leaves no usable credential. There is no overlap/grace period. Events capture the workstation assigned **at ingestion**, including buffered events; drain a queue before moving a device when historical attribution matters.

## Your timer's meaning and remaining measurement work

The site **cannot currently store/display cumulative detection duration as its own metric**. There is no duration accumulator or timer field. State edges produce metrics labeled parts; device durations produce cycle median/p90. Adding `totalDetectedMs` to state data, or sending a custom timer event, currently returns 400. Raw state timestamps alone cannot reconstruct reliable detected time across missing edges and outages.

Recommended next contract, **not implemented or accepted yet**: a versioned detection-time snapshot event with `detected`, monotonic `totalDetectedMs`, and an explicit `counterId` reset epoch. Send snapshots periodically (e.g. every 5–10 seconds) and on transitions, alongside 30-second heartbeats. Keep measurement in the sampling task; networking must not pause the timer or TM1637 display. State changes can remain useful history, but a timer-only device/workstation mode must stop interpreting those edges as completed parts.

Required server changes: validate a new event/capability; persist a separate detection-duration measurement/checkpoint; compute cumulative-counter differences transactionally/idempotently; detect resets and regressions; label UI/export as **Detected time**, separate from cycle duration/parts. Never sum cumulative snapshots. Use a persisted counter epoch if the timer survives reboot; otherwise start a new epoch and mark loss/reset. Later snapshots can recover total time across missed intermediate packets, but cannot allocate that time accurately across shifts, assignments or resets without additional timestamped intervals. Report those attribution gaps rather than spreading time evenly or substituting receipt time. Individual HIGH-interval durations are optional supporting detail, not a second independent quantity to add to snapshot totals.

Current counting behavior: first reading/restart is baseline; only confirmed LOW→HIGH counts, repeated HIGH doesn't. Debounce consumes rejected edges. A gap re-baselines; older sequence/decreasing uptime/previously superseded boot is excluded. Raw rows remain immutable. Reconnect itself changes no state; in-order retries of the same IDs don't double-count. This protects part counts, **not your timer totals**, which remain solely on the device today.

## TLS and verification

Use WiFiClientSecure with `setCACert` for the current issuing root CA, validate the hostname/IP SAN and complete server chain, and synchronize UTC (e.g. SNTP) before the TLS handshake so certificate validity dates can be checked. Keep sampling/accumulation running while waiting for Wi-Fi/NTP/TLS. Do not call `setInsecure`. An installed Arduino core was not found/compiled here; check API compatibility in the firmware environment. Official reference: [Espressif secure-client example](https://github.com/espressif/arduino-esp32/blob/2.0.17/libraries/WiFiClientSecure/examples/WiFiClientSecure/WiFiClientSecure.ino). Its historical example CA is not a certificate to reuse for this server.

Curl for **computer-local API verification only** (replace placeholders; save an event above as event.json):

```sh
curl --fail-with-body http://127.0.0.1:3001/api/v1/events \
  -H "Authorization: Bearer <DEVICE_TOKEN>" \
  -H "Content-Type: application/json" --data-binary @event.json
```

Once LAN TLS is actually provisioned with the IP SAN described above:

```sh
curl --fail-with-body --cacert shopflow-root-ca.pem \
  https://192.168.10.36:443/api/v1/heartbeat \
  -H "Authorization: Bearer <DEVICE_TOKEN>" \
  -H "Content-Type: application/json" \
  --data '{"deviceId":"<REGISTERED_DEVICE_UUID>","firmware":"nano-esp32-1.0"}'
```

Commands use POSIX shell line continuation; use curl.exe on Windows and put the command on one line or use PowerShell backticks. No real token is included here.

Actual HTTP test: `scripts/verify-device-api.ts` created a dedicated test device and workstation in the marked demo organization. Workstation **231f6383-6fd1-4029-8b73-8af7b9790423**, named **CI Arduino API verification 2026-10-14T20:40:06.090Z**, received LOW,HIGH,HIGH,LOW,HIGH. Five immutable rows produced exactly **2 counts**, no cycle median. Three concurrent duplicate retries added no rows/counts. Authenticated dashboard returned the correct workstation and online status; Edge displayed the two-count metric. Heartbeat, missing token, ID mismatch, disable, rotate, revoke and unsupported duration rejection were verified. Test credentials were revoked and the device disabled; synthetic history remains visible. Evidence: ignored `.local/arduino-api-verification.json` and `.png`.

**Can connect now? Not from the physical Arduino with validated HTTPS.** Local API/auth/counting work. Remaining blockers: LAN HTTPS endpoint/certificate + ESP32 trust/time setup; scoped firewall/routing/Wi-Fi reachability; new accurate detection-duration storage/display contract; provisioning a separate physical-device credential. Physical Wi-Fi, TLS, TM1637, accumulation, buffering/overflow and power-loss behavior have not been tested here.
