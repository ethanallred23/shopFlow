# Validation evidence

## Detection-time / LAN HTTPS update (2026-10-14)

- Third MySQL migration applied to demo and disposable test databases; Prisma client regenerated.
- **27 tests passed**, including timer snapshots, concurrent distinct events/retries, gaps, invalid changes, reset/reuse, replay, shifts, assignment changes and clock corrections.
- Final TypeScript check and Vite production build passed. Vite retains a non-blocking large chart-chunk warning.
- Real HTTPS ingress at `https://192.168.10.36:443` validated the custom root and IP SAN from this Windows host. Untrusted TLS failed; missing bearer token returned 401; timer-only part events returned 422.
- Browser showed 13,500 ms recovered, 1,500 ms current counter, 10,000 ms confirmed shift time, 3,500 ms unallocated, Absent state with online heartbeat, and no production metrics. Temporary credentials were revoked/device disabled.
- Backend remains bound to loopback. Proxy binds only the private LAN IP. CA private-key ACLs were verified as current user and SYSTEM only. No system trust-store or corporate network controls changed.
- Second-device/Arduino connectivity and an IT-approved DHCP reservation remain unverified. Windows curl/Schannel failed private-CA revocation checking; Node/OpenSSL HTTPS validation and authenticated requests passed with verification enabled. See [LAN_HTTPS.md](LAN_HTTPS.md).

The earlier baseline evidence follows.

Validated on Windows with Node.js 22.14.0 and an official portable MySQL 8.0.45 instance bound to loopback, stored under ignored `.local/`.

- Two committed Prisma migrations applied successfully to both demo and disposable test databases.
- Demo seed completed through the same transactional ingestion function used by the HTTP API.
- TypeScript checks, Prisma client generation and Vite production build passed.
- 17 automated tests passed with `RUN_DB_TESTS=1`: 13 domain/validation/schedule tests and four MySQL integration tests. Coverage includes concurrent duplicate requests, initial HIGH, repeated HIGH, reboot/retired boot, out-of-order state, minimum interval, measured cycles, strict schema validation, overnight shifts, breaks, DST, daily target proration, role hierarchy, tenant isolation, exports, unauthenticated SSE, CSRF, assignment snapshots, case-sensitive event IDs, unknown buffered times, disabled/revoked credentials, and resumable replay.
- Headless Microsoft Edge browser smoke passed login → register → one-time credential → assign → authenticated ingestion/retries → dashboard data, reports/CSV, settings, floor display, and mobile viewport overflow checks. Desktop and mobile screenshots were inspected. Scripts use actual persisted demo data.
- `npm audit` reported **zero vulnerabilities** after dependency updates.

The first concurrency run exposed Prisma's default two-second transaction-admission limit under eight simultaneous requests. A bounded ten-second admission limit fixed the failure; the full integration suite then passed. Windows holds Prisma's engine DLL open while the server runs, so stop `npm run dev` before regenerating the client/building.

Not validated here: physical Nano ESP32 electrical behavior, sketch compilation against an installed Arduino core, actual Wi-Fi/power-loss tests, deployment HTTPS/reverse-proxy configuration, production load capacity, or restore drills. The hardware guide states buffering and timing limitations. See architecture documentation for historical schedule/target and report sample limits.

## This workspace's optional portable database

Docker was unavailable, so verification used a workspace-local MySQL package. `.env` already contains randomly generated local database and demo-login credentials; they are not committed. To reuse it:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-local-mysql.ps1
npm.cmd run dev
```

Open http://localhost:5173 and use `SEED_EMAIL` / `SEED_PASSWORD` from `.env`. To shut down the portable database after stopping the app:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/stop-local-mysql.ps1
```

These helpers only apply to this initialized workspace. Fresh clones should use the README's Docker/MySQL startup commands. The portable package, database files, screenshots, cache and secrets live in ignored `.local/`; none are required in the repository.
# Production setup verification — 2026-10-14

- Created a separate empty local MySQL 8.0.45 database for deployment verification; did not migrate or modify the existing `shopflow` database.
- Ran the production setup workflow twice. First pass applied all four committed migrations, generated Prisma, type-checked, built and seeded only the bootstrap marker. Second pass reported no pending migrations and did not duplicate the marker.
- Verified 19 database tables (including Prisma migration history), 29 foreign keys, and restrictive deletion/orphan rejection.
- All 29 tests passed with database integration enabled, including concurrent first-admin creation, bcrypt verification, reruns preserving the original password, and no demo shops/events.
- Reseeded essential configuration after admin creation: one completed bootstrap marker and one administrator remained.
- Current local development configuration fails production validation with clear field names. A deliberately unreachable database produced a nonzero exit and skipped build/seeding. Final TypeScript check passed.
- Build reported a non-blocking chart chunk size warning. No production server was deployed and no production credentials were supplied. The existing local `.env` database credentials remain blank.

