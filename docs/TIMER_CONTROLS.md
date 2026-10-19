# Timer controls

Timer controls are queued commands. The browser never edits a detected-time total directly. An administrator or supervisor queues a command on the timer workstation page; the Arduino polls, applies it in its hardware loop, and acknowledges it. Until the device polls, the command remains pending.

The controls are:

- `pause`: stop adding elapsed milliseconds even if D5 is HIGH. Keep reporting the current state and total.
- `resume`: allow D5 HIGH to add elapsed milliseconds again.
- `reset`: set the local total to zero and generate a new `bootId`/`counterId` epoch. Historical totals remain in ShopFlow.
- `set_total_detected_ms`: set a calibrated total in milliseconds and generate a new `counterId`. This is an explicit correction and does not rewrite prior measurements.

The controls appear in the Detected time panel after the detection-time device is assigned to a workstation. `set_total_detected_ms` accepts a nonnegative integer. The UI displays the current counter, recovered all-time time, selected shift time and unallocated time so a reset is not mistaken for deletion.

## Device command API

Both routes use the device bearer token and HTTPS:

```http
GET /api/v1/commands
Authorization: Bearer <device-token>
```

Response:

```json
{
  "commands": [
    {
      "id": "command-uuid",
      "type": "pause",
      "payload": {},
      "createdAt": "2026-10-19T16:00:00.000Z",
      "expiresAt": "2026-10-20T16:00:00.000Z"
    }
  ]
}
```

For `set_total_detected_ms`, the payload is `{"totalDetectedMs":60000}`. The device must remember applied command IDs until it has acknowledged them, so repeated polls do not apply a command twice.

```http
POST /api/v1/commands/<command-id>/ack
Authorization: Bearer <device-token>
Content-Type: application/json
```

```json
{"status":"applied","result":{"counterId":"new-counter-id","totalDetectedMs":0}}
```

Use `status:"rejected"` with an optional `error` when the command cannot be applied. A successful response is HTTP 200. Commands expire after 24 hours. Acknowledgement is separate from the detection snapshot: after applying reset or set-total, send a snapshot using the new counter ID and the normal event sequence/uptime/timestamp rules.

The firmware must keep sampling D5 and updating D4/TM1637 independently of HTTP. Poll commands about every 2–5 seconds when connected, process them in order, and acknowledge only after the local state is changed. Never reuse a counter ID after reset or calibration. Keep the existing retry queue and TLS/NTP validation.
