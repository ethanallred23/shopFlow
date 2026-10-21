# Remote timer investigation (2026-10-21)

## Confirmed checkout findings

The reported firmware is not present. A recursive repository inventory found only
`arduino/ShopFlowSensor/ShopFlowSensor.ino`, the legacy counting example documented
in ARDUINO.md and FIRMWARE_HANDOFF.md. It has no `pollingEnabled`, `batch`, `active`,
`decodeCommand()`, `requestHttp()`, timer accumulator or TM1637 implementation.
Its `networkTask()` sends heartbeats and sensor edges but never polls or ACKs
commands. Thus step 3 is absent in this firmware. This does not establish which
step fails on the user's currently flashed firmware.

The original TimerDevice buttons were disabled because StationDetail supplied no
onCommand callback. The global disabled-button CSS used a wait cursor. There was
no execution-status subscription or loading state in this component. Therefore
an actual infinite spinner in a deployed version is also not reproduced by this
checkout. No live device logs, HTTP captures or production command records were
available to confirm the deployed failure.

Server defect: expired commands were filtered out of device polling while their
stored status remained pending forever. ACKs for unknown IDs incorrectly returned
HTTP 200 with duplicate:true. ACKs did not trigger dashboard refresh.

## Implemented lifecycle

1. Authorized admin/supervisor queues a command with CSRF protection. HTTP 201
   returns `{id,type,status:"pending",expiresAt}`. Invalid payloads return 400;
   a device without detection_time capability returns 422.
2. Device GET /api/v1/commands authenticates and expires overdue pending rows.
   HTTP 200 returns `{commands:[{id,type,payload,createdAt,expiresAt}]}`. Payload
   is `{}` or `{totalDetectedMs:60000}`; dates are ISO UTC strings, not integers.
3. Physical receipt, validation and execution remain unverified: actual timer
   firmware must be supplied. Deadline is 24 hours. Device must reject an expired
   command immediately before execution and preserve execution results for retry.
4. Device POST /api/v1/commands/:id/ack accepts applied/rejected, optional result
   object and optional error string. HTTP 200 returns `{ok:true,duplicate,status}`.
   Duplicate terminal ACKs preserve the first result; conflicting status returns
   409; unknown/wrong-device ID returns 404. Device authentication serializes ACKs
   under the existing device-row transaction lock.
5. Expiry is materialized on device polling and browser command reads even when
   the device is offline. Late ACKs may change expired to applied/rejected because
   execution could precede expiry with a lost acknowledgement. Expired means no
   confirmation, not proof that the device did nothing.
6. Browser queues once, then reads the specific command every 3 seconds. Queue
   submission is distinct from confirmed execution. Pending disables further
   controls but shows an explicit queued message, not a loading spinner. Applied,
   rejected and expired are shown accurately; status refresh survives temporary
   network errors. Page remount reads the latest command. Individual HTTP requests
   have a 10-second transport deadline, which reports uncertainty and never marks
   a command applied or changes its database status. POSTs are not auto-retried.

## Hardware requirements still outstanding

Retain D5 sensor (HIGH = detected), D4 LED, D2 TM1637 CLK, D3 TM1637 DIO.
The legacy example already uses D5/D4 and has no display pins to correct. Do not
flash this counting sketch onto the timer as a fix. Supply the actual timer sketch
for inspection of three-second polling, HTTP/chunked response decoding, integer
and ISO timestamp validation, retry state, and pin definitions.

Device-side exactly-once execution is NOT established by idempotent server ACKs.
The firmware must hold each result across failed ACKs without reapplying it, avoid
batch/active deadlock, and keep networking outside the sampling/display loop.
Test reset/set-total with dropped ACK responses and Wi-Fi reconnection. Power-loss
exactly-once behavior additionally requires durable execution state.

The snapshot schema still rejects totalDetectedMs > uptimeMs and impossible
counter increases. Set Total must honor these safety checks or return a useful
rejection. No timer safety checks, TLS checks or historical totals were weakened.

## Validation

- TypeScript check: passed.
- Unit suite: 23 passed; 20 database-gated tests skipped in normal run.
- Explicit RUN_DB_TESTS=1 run: blocked by invalid configured MySQL credentials.
  New HTTP integration tests cover all four command envelopes, repeated polling
  (simulated disconnect/reconnect), applied/rejected ACKs, duplicates/conflicts,
  expiry, late ACK, invalid payload, missing authentication and unknown IDs.
  These tests do not execute firmware.
- Full npm build: blocked by locked Prisma query_engine-windows.dll.node during
  generation. Existing application processes were not terminated.
- Physical Arduino/Wi-Fi/TLS/display and real browser-to-device end-to-end tests:
  outstanding; actual timer firmware is required.
- Independent Vite production build: passed (existing large-chunk warning).
