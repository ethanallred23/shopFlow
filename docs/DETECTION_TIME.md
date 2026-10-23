# Implemented Arduino detection-time contract

The Biltoki target uses D8 for the sensor, D2 for its detection LED, and TM1637 CLK/DIO on D4/D5. Biltoki qualifies both arrival and departure after 5 seconds of stable sensing; its accumulated timer and snapshots use that qualified state. The old repository `ShopFlowSensor.ino` is a **part-counting example**, not this timer firmware.

## Connection and provisioning

**Base URL: `https://192.168.10.36:443`**. CA-validated requests through the actual proxy succeeded from this Windows computer. Arduino/second-device Wi-Fi access remains untested. IT must reserve this IP and confirm scoped firewall/routing access; no network controls were changed.

Use **[shopflow-root-ca.pem](../certs/shopflow-root-ca.pem)** with `WiFiClientSecure.setCACert`. Synchronize UTC first; validate the IP SAN and certificate chain. Never disable TLS verification. See [LAN_HTTPS.md](LAN_HTTPS.md) for fingerprint, setup and network steps.

Admin → Settings: create workstation → Devices → Register device → **Detection time only (Arduino timer)** → save the displayed UUID/token once → assign workstation. This grants exactly `capabilities:["detection_time"]`, which cannot be combined with count/cycle capabilities. Timer-only devices receive 422 for state-change or cycle-completed events. Do not reuse the disabled verification device. Disable/archive blocks ingestion; rotation immediately revokes prior tokens. No secret belongs in this handoff.

## Accepted event

POST `/api/v1/events`:

```http
Authorization: Bearer <DEVICE_TOKEN>
Content-Type: application/json
```

```json
{
  "schemaVersion": 1,
  "eventId": "boot-7f63-counter-a-snapshot-12",
  "deviceId": "11111111-1111-4111-8111-111111111111",
  "bootId": "boot-7f63",
  "sequence": 12,
  "uptimeMs": 180000,
  "occurredAt": "2026-10-14T21:00:00.000Z",
  "delivery": "live",
  "type": "sensor.detection_time_snapshot",
  "data": {
    "detected": true,
    "totalDetectedMs": 125000,
    "counterId": "counter-a-7f63"
  }
}
```

Replace illustrative values with the registered UUID and original sample values. Use random boot/counter IDs in firmware. `totalDetectedMs` is integer milliseconds, nonnegative, at most 9,007,199,254,740,991, and no greater than `uptimeMs` (this device resets on boot). `detected` is boolean. `counterId`, `bootId` and `eventId` are case-sensitive strings, 1–100 characters. Event IDs are unique per device across boots and stable across retries. Sequence increases within each boot, integer 0–2,147,483,647; uptime is a monotonic safe integer (avoid 32-bit rollover).

A reconnect changes none of these identifiers. A restart uses new bootId and counterId, with sequence allowed to restart at zero. A manual reset within the same boot also requires a new counterId, while sequence/uptime continue. Send a final snapshot before an intentional reset when possible.

`occurredAt` is required: UTC ISO ending Z or null. Preserve the timestamp through retries; use null for samples captured before clock sync. `delivery` is live/buffered/unknown (optional, default unknown). Queued events use buffered. Never replace an old sample timestamp with reconnect time. More than five minutes in the future is rejected. Receipt-time estimates do not qualify detection intervals for shifts.

Send snapshots every **5–10 seconds and on transitions**, plus separate 30-second heartbeats. Keep accumulation/display independent of blocking network operations. Use a bounded queue and report overflow. Later cumulative snapshots recover missed intermediate totals, but not their detailed timing. Time accumulated after the last recoverable snapshot is lost if power loss resets the device and destroys its buffer.

## Accounting actually implemented

- First accepted snapshot of each counter contributes its **full total** to recovered device time. Its start is unknown, so the contribution is unallocated to shifts.
- Later snapshots contribute `new total - last accepted total`; equal totals contribute zero. Never sum cumulative snapshots.
- Sequence gaps still recover the cumulative difference. Duplicate event retries add nothing.
- Decreasing totals, impossible increases (more than elapsed uptime), older sequences, decreasing uptime, retired counter/boot and counter reuse across boots are durably recorded and flagged, without changing accepted totals/state.
- A new counter starts a separate total; all-counter recovered time never resets. Do not reuse retired counter IDs. A previously unseen boot with an older known timestamp is excluded. When timestamps are absent, order between unseen boots cannot be proven: drain old-boot queues before publishing a new boot and send requests in order, one in flight. Known retired boots are excluded.
- Clock corrections do not discard monotonic totals within a counter, but can make intervals unallocatable. Timestamp elapsed time must agree with monotonic uptime within 2 seconds to qualify for placement. This is not proof of device clock accuracy.
- A delta enters a selected shift/day only when consecutive accepted snapshots have valid device times, consistent clocks, the same assignment, and the entire interval lies inside that window. Boundary-spanning deltas are shown as uncertain and excluded; no uniform distribution is invented. First snapshots, unknown clocks and changed assignments are unallocated. All-time device totals explicitly include previous assignments/counters.
- Detected/absent is from the latest accepted snapshot. Both sample time and receipt must be within 30 seconds to show Current. Old buffered or unknown-time snapshots are labeled stale/last reported. Connectivity independently uses the 90-second heartbeat threshold. The UI does not extrapolate elapsed time between snapshots.

## Biltoki cabinet progress

For a timer-only workstation, the site derives cabinet progress from qualified detection snapshots. A detected interval represents one cabinet being built; a transition to absent completes that cabinet when the qualified interval is at least 5 seconds. The dashboard reports completed cabinets, remaining target, cabinets expected by now, required time per remaining cabinet, time spent building, time available while no cabinet was being built, and a green/red on-track status. The workstation target is the cabinet target for the selected shift. This keeps the shared site model intact while allowing Biltoki-specific cabinet behavior.

## Acknowledgements and heartbeat

After database commit, HTTP 200, for example:

```json
{"ok":true,"duplicate":false,"measurementAccepted":true,"notice":null}
```

First/gap snapshots can include a notice. Duplicate retry returns `duplicate:true` and the original outcome. A late/decreasing snapshot is stored but returns HTTP 200 with `measurementAccepted:false` and its notice. Do not retry that same invalid sample forever; fix the firmware/counter lifecycle and send a new event.

Malformed/extra fields → 400; unauthorized/disabled/revoked → 401; wrong device UUID → 403; body over 16 KB → 413; unsupported capability or future timestamp → 422; rate limit → 429; service failure → 500. One event per request; no batches. Current budget: 600 API requests/minute/IP. Retry unchanged payload/ID with backoff/jitter on network failures, 429 (honor Retry-After) and 5xx. Preserve sequence order.

POST `/api/v1/heartbeat`, same bearer and JSON headers:

```json
{"deviceId":"11111111-1111-4111-8111-111111111111","firmware":"nano-timer-1.0"}
```

Returns HTTP 200 `{"ok":true}`. Heartbeat does not advance sequence, accumulated time or sensor state.

## Verification

Real HTTPS test: **13,500 ms recovered**, **1,500 ms current counter after reboot**, **10,000 ms confirmed in shift**, **3,500 ms unallocated**, **Absent** sensor with **online** heartbeat. No part/cycle measurements. Three retries added no time; late/decreasing snapshots were flagged; missing auth failed and untrusted TLS failed. Browser display was verified. Test credentials were revoked and the synthetic device disabled.

MySQL tests cover first snapshots, retries, gaps, older delivery, invalid changes, reset/reuse, concurrent ingestion, replay, shift boundaries, assignment changes and clock corrections. Physical Arduino compilation, Wi-Fi/TLS/NTP access, TM1637, overflow and power-loss remain hardware checks.
