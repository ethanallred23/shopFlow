# ShopFlow

A production-flow application built with Express + TypeScript, MySQL 8 + Prisma, React + Vite, Tailwind CSS, Recharts and server-sent events. Includes authenticated dashboards, workstation detail, device provisioning, CSV reports, floor display, organization settings, a simulator and a Nano ESP32 example.

## Local startup (PowerShell)

Prerequisites: Node.js 22+, npm, Docker Desktop with Compose (or an existing MySQL 8 server).

```powershell
Copy-Item .env.example .env
# Edit .env: set a unique SEED_PASSWORD of at least 12 characters.
npm.cmd ci
docker compose up -d --wait
npm.cmd run db:migrate
npm.cmd run db:seed
npm.cmd run dev
```

Open **http://localhost:5173**, using exactly that host because login validates `APP_ORIGIN`. Sign in with `SEED_EMAIL` and `SEED_PASSWORD` from `.env`. On macOS/Linux use `npm` instead of `npm.cmd` and `cp` instead of `Copy-Item`. With an existing MySQL server, set `DATABASE_URL` and skip Compose. Database and server/session times use UTC; display uses the organization timezone.

The seeded organization is explicitly marked **DEMO DATA**, with three workstations and historical events produced through the production ingestion function. Seed is a one-time bootstrap, not a destructive reset. Demo events are in the hours before seeding; choose the matching date/shift if your view is empty. Demo sensors go offline after 90 seconds unless a simulator is connected. No counters are hard-coded into the frontend.

For a clean production organization, use a separate administrator email, set `ORG_NAME` and optionally `ORG_TIMEZONE`, then run `npm.cmd run db:setup` instead of seeding. This creates no demo events; configure your floor in Settings. Keep MySQL's server/session timezone at UTC (`default-time-zone=+00:00`); the Compose image uses UTC.

## Connect a simulator

Register a device on Devices, save its one-time token, and assign it to a workstation. In a second PowerShell terminal:

```powershell
$env:API_URL='http://localhost:3001'
$env:DEVICE_ID='<device UUID from registration>'
$env:DEVICE_TOKEN='<one-time device token>'
npm.cmd run simulate -- normal
```

Modes: `normal`, `slow`, `repeated`, `duplicate`, `restart`, `buffered`, `out-of-order`, `disconnect`. Stop with Ctrl+C. The simulator uses the real HTTP API, stable event IDs for retries, bounded request timeouts, periodic heartbeats and measured cycle events. The buffered scenario preserves original event timestamps.

## Build and tests

```powershell
npm.cmd run build
npm.cmd test
```

With the development server running, `npm.cmd run test:browser` exercises the vertical slice in installed Microsoft Edge using the configured seed login. It creates a clearly named smoke-test sensor in the demo organization, sends events, archives that sensor, and writes screenshots under ignored `.local/`.

Database tests are intentionally opt-in. Use a disposable MySQL database, run migrations against it, then:

```powershell
$env:DATABASE_URL='mysql://shopflow:local-only-password@localhost:3306/shopflow_test'
npm.cmd run db:migrate
$env:RUN_DB_TESTS='1'
npm.cmd test
```

Create `shopflow_test` and grant your test user access first. Tests create isolated organizations and remove their own rows. Tests cover counting, baseline/restarts, debounce, duplicates, concurrent retries, late delivery, role/tenant boundaries, CSRF, credential disable/revoke, schedules/DST, and resumable replay. See [validation evidence](docs/VALIDATION.md) for checks actually executed here.

## Single-instance deployment

```powershell
npm.cmd ci
npm.cmd run db:migrate
npm.cmd run build
$env:NODE_ENV='production'
$env:APP_ORIGIN='https://shopflow.example.com'
npm.cmd start
```

Run Express under a process supervisor and terminate HTTPS with a same-host reverse proxy to `127.0.0.1:3001`. Set secrets in deployment environment variables. The build serves from `dist`; `tsx` remains a runtime requirement, so do not omit devDependencies with this startup command. Do not use the Compose example's local passwords in production.

Read [architecture, API contracts, metric definitions and limitations](docs/ARCHITECTURE.md), and the [first physical sensor walkthrough](docs/ARDUINO.md). This repository is a local/deployable Node application; it has not been published to a hosted service.
# shopFlow
