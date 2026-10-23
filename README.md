# ShopFlow

**Arduino devices:** the firmware source-of-truth collection is [`arduino/`](arduino/README.md). Biltoki's canonical sketch is [arduino/Biltoki/Biltoki.ino](arduino/Biltoki/Biltoki.ino), with [Biltoki setup and maintenance](arduino/Biltoki/README.md). Update affected firmware alongside site changes, then upload it to the physical device.

Arduino timers now have a **Detection time only** device mode and separate accumulated-time/state metrics. See the [current timer firmware contract](docs/DETECTION_TIME.md), [Windows LAN HTTPS setup](docs/LAN_HTTPS.md), and [public ESP32 root CA](certs/shopflow-root-ca.pem). Private keys remain under ignored `.local/`.

A production-flow application for Quality Craft Wood Works, operated by its CI Team. It uses Express + TypeScript, MySQL 8 + Prisma, React + Vite, Tailwind CSS, Recharts and server-sent events. Includes authenticated dashboards, workstation detail, device provisioning, CSV reports, floor display, internal organization settings, a simulator and a Nano ESP32 example.

## Local startup (PowerShell)

Prerequisites: Node.js 22+, npm, and MySQL 8. This Windows workspace already has an initialized portable MySQL 8.0.45 database. Keep its existing `.local/mysql-data` directory; do not initialize it again. Start it with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-local-mysql.ps1
```

It listens only on `127.0.0.1:3307`; the database is `shopflow`. Starting this existing server does not require changing its passwords. In your existing `.env`, fill in **both** blank credential fields in:

```dotenv
DATABASE_URL=mysql://:@127.0.0.1:3307/shopflow
```

The completed format is `mysql://<URL-encoded username>:<URL-encoded password>@127.0.0.1:3307/shopflow`. Use credentials for an existing MySQL account with access to `shopflow`; percent-encode reserved characters in each credential (for example, `@` becomes `%40`). Prisma reads `DATABASE_URL` directly. Editing this URL does not create a MySQL account or change its password. Blank fields deliberately prevent connecting until you enter credentials; MySQL still requires its existing password.

```powershell
npm.cmd run db:migrate
npm.cmd run db:check
npm.cmd run dev
```

Restart the backend after changing `.env`. Do not reseed an existing database. `.env` and `.local/` are excluded from Git; preserve all your other `.env` settings.

### Alternative: a new installation with Docker Compose

Use this only for a separate installation, not to replace this workspace's existing portable database. Compose uses a separate named volume and cannot run alongside portable MySQL on the same port. Install Docker Desktop with Compose first. Existing Docker volumes retain their existing credentials; changing environment variables does not reset accounts.

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
# Edit .env: fill MYSQL_USER, MYSQL_PASSWORD and MYSQL_ROOT_PASSWORD.
# Use a non-root app username and nonempty, strong passwords.
# Also fill DATABASE_URL with the URL-encoded app credentials.
# Set a unique SEED_PASSWORD of at least 12 characters for a new installation.
npm.cmd ci
docker compose up -d --wait
npm.cmd run db:migrate
npm.cmd run db:check
npm.cmd run db:seed
npm.cmd run dev
```

Open **http://localhost:5173**, using exactly that host because login validates `APP_ORIGIN`. Sign in with `SEED_EMAIL` and `SEED_PASSWORD` from `.env`. On macOS/Linux use `npm` instead of `npm.cmd` and `cp` instead of `Copy-Item`. With an existing MySQL server, set `DATABASE_URL` and skip Compose. Database and server/session times use UTC; display uses the organization timezone.

The seeded organization is explicitly marked **DEMO DATA**, with three workstations and historical events produced through the production ingestion function. Seed is a one-time bootstrap, not a destructive reset. Demo events are in the hours before seeding; choose the matching date/shift if your view is empty. Demo sensors go offline after 90 seconds unless a simulator is connected. No counters are hard-coded into the frontend.

For production, follow [production setup and updates](docs/PRODUCTION_SETUP.md). Run `setup:production`, then `admin:create` for interactive first-admin creation; production does not use seed passwords or demo data. Keep MySQL's server/session timezone at UTC (`default-time-zone=+00:00`); the Compose image uses UTC.

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

To preview the Biltoki cabinet workflow locally, run `npm.cmd run demo:biltoki` once after seeding. It adds a clearly labeled example timer workstation with two completed cabinet intervals and one active interval; rerunning the command is safe and does not duplicate it.

Database tests are intentionally opt-in. Use a disposable MySQL database, run migrations against it, then:

```powershell
$env:DATABASE_URL='mysql://<URL-encoded test username>:<URL-encoded test password>@127.0.0.1:3307/shopflow_test'
npm.cmd run db:migrate
$env:RUN_DB_TESTS='1'
npm.cmd test
```

Create `shopflow_test` and grant your test user access first. Tests create isolated organizations and remove their own rows. Tests cover counting, baseline/restarts, debounce, duplicates, concurrent retries, late delivery, role/tenant boundaries, CSRF, credential disable/revoke, schedules/DST, and resumable replay. See [validation evidence](docs/VALIDATION.md) for checks actually executed here.

## Single-instance deployment

```powershell
# First configure production .env, provision MySQL, and take a backup.
npm.cmd ci --include=dev
npm.cmd run setup:production
npm.cmd run admin:create
# Start only after the commands above succeed, using runtime DB credentials.
npm.cmd start
```

Run Express under a process supervisor and terminate HTTPS with a same-host reverse proxy to `127.0.0.1:3001`. Set secrets in deployment environment variables. The build serves from `dist`; `tsx` remains a runtime requirement, so do not omit devDependencies with this startup command. Use separate credentials for production.

Read [architecture, API contracts, metric definitions and limitations](docs/ARCHITECTURE.md), and the [first physical sensor walkthrough](docs/ARDUINO.md). This repository is a local/deployable Node application; it has not been published to a hosted service.
# shopFlow
