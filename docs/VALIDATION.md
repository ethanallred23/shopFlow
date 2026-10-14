# Validation evidence

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
