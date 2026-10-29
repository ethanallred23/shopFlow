# Explicit production deployment

ShopFlow uses Node.js 22+ and MySQL 8.0. The database server and the named database must exist before application setup. `setup:production` creates the **tables inside that database** using the committed migrations. It is an explicit command, never a Git hook or an application-start side effect.

## Prepare MySQL

**Managed hosting:** create a MySQL database and database user through the hosting panel first. Assign that user access to this database. Use the provider's exact hostname, port and database name; shared hosts may prefix names. Follow the provider's database TLS requirements. Do not use the hosting administrator account as the runtime user.

**VPS, optional administrator step:** connect locally with an appropriately privileged MySQL administrator (`mysql -u root -p`, or the distribution's socket-authenticated administrator). Execute the following after replacing the password placeholders with your own strong, unique values. These are SQL templates, not commands run by ShopFlow. Avoid saving secrets in SQL history or transcripts (on Linux, disable MySQL client history with `MYSQL_HISTFILE=/dev/null`).

```sql
CREATE DATABASE shopflow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'shopflow_deploy'@'localhost' IDENTIFIED BY '<your deployment password>';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON shopflow.* TO 'shopflow_deploy'@'localhost';
CREATE USER 'shopflow_runtime'@'localhost' IDENTIFIED BY '<your runtime password>';
GRANT SELECT, INSERT, UPDATE, DELETE
  ON shopflow.* TO 'shopflow_runtime'@'localhost';
```

Use the actual connecting host instead of `localhost` when the application is on another server; restrict access to that host. Keep same-machine MySQL bound to `127.0.0.1` and do not expose its port publicly. Neither account needs global administration privileges, `GRANT OPTION`, or permission to create other databases. The deployment grants above cover the currently committed migrations; review privileges when future migrations change. Reuse existing accounts/databases rather than recreating them. User creation and password rotation are administrator tasks, not application setup tasks.

## First deployment

1. Clone a reviewed release into a new release directory. Install dependencies with `npm ci --include=dev` (plain `npm ci` also works when npm is not omitting development dependencies). Prisma, TypeScript, Vite and the current `tsx` runtime are required. Never overwrite an existing `.env` when copying the example.
2. Supply a private `.env` or deployment environment with these values. Keep the file readable only by the service/deployment account and administrators; it is Git-ignored. Environment variables override `.env`.

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
APP_ORIGIN=https://shopflow.your-domain.example
DATABASE_URL=mysql://:@127.0.0.1:3306/shopflow
RUN_DB_TESTS=0
```

Replace `APP_ORIGIN` with your real HTTPS origin, without a trailing slash. Insert the URL-encoded MySQL username between `//` and `:` and password between `:` and `@`. Use the actual database port (the existing Windows portable installation uses **3307**, not 3306). Empty credentials fail validation. Use the database-scoped deployment account for setup, then the DML-only runtime account for the service. Your deployment secret manager can inject `DATABASE_URL` for the command without changing the service's `.env`; do not put password URLs in shell history. `SEED_EMAIL` and `SEED_PASSWORD` are not used by production setup. Optional `ORG_NAME` and `ORG_TIMEZONE` override first-admin defaults; blank or omitted values use `CI Team` and `America/Denver`.

3. Take a database backup before migrations, even when reusing a database believed to be empty. Store backups outside the checkout with restricted access. Managed hosting: take a provider snapshot/export and verify its restore procedure. On a VPS, an example with a password prompt is:

```sh
mysqldump --host=127.0.0.1 --port=3306 --user=YOUR_BACKUP_USER -p --single-transaction --quick --no-tablespaces --set-gtid-purged=OFF --result-file=/secure/backups/shopflow-before-deploy.sql shopflow
```

Choose a unique backup filename and check the exit status and backup size. Test restoring into a separate database before relying on the backup. Keep schema changes paused during the dump. Backup permissions are separate from application permissions; see [MySQL's mysqldump requirements](https://dev.mysql.com/doc/refman/8.0/en/mysqldump.html). Provider-managed backup tools may be more appropriate for replicated databases.

4. Run explicitly, and stop if the command returns nonzero:

```sh
npm run setup:production
npm run admin:create
```

`setup:production` validates configuration, generates Prisma Client, runs `prisma migrate deploy`, type-checks and builds the app, then idempotently inserts one bootstrap marker. No demo organization, shop, events, shift schedule, user or default password is seeded. `prisma/seed.ts` refuses production execution. See [Prisma's deployment workflow](https://docs.prisma.io/docs/orm/prisma-client/deployment/deploy-database-changes-with-prisma-migrate).

`admin:create` requires an interactive terminal and prompts only for administrator name, email and a confirmed password. Organization and timezone default to `CI Team` and `America/Denver`; optional `ORG_NAME` and `ORG_TIMEZONE` in `.env` override them. Surrounding whitespace is trimmed from timezone values. Mismatched passwords can be retried without re-entering account details. The password is hidden, must be at least 12 characters and at most 72 UTF-8 bytes, and is stored as a bcrypt hash. No password arguments, piped credentials or environment-password defaults are accepted. Concurrent invocations serialize on the bootstrap row. Once an administrator exists, rerunning does not change accounts or passwords. An existing organization with no administrator requires explicit recovery; the command will not silently create another organization. `db:setup` now aliases this secure command.

5. Switch to runtime credentials and run `npm run db:check`. Only after setup, administrator creation and the connection check succeed, start the app with `npm start` under your service supervisor. Configure a same-host reverse proxy with a valid HTTPS certificate for the browser site; `APP_ORIGIN` must match it. The existing Arduino-only LAN proxy does not publish the browser UI. Verify HTTPS sign-in, then configure shops, workstations and shifts in Settings. No shift times are assumed during production bootstrap.

Express trusts forwarded client addresses only from loopback proxies. Configure the same-host proxy to append the actual client address to `X-Forwarded-For` or overwrite the header with it, and keep the application bound to loopback. If another proxy sits in front of it, configure that proxy chain deliberately; trusting loopback alone may identify the upstream proxy instead of individual clients.

## Subsequent updates and failures

Use one deployment operator/job at a time. Stage the new release separately, install its dependencies, take and verify a fresh backup, and schedule maintenance for changes that may lock tables. Run `npm run setup:production` with the database-scoped deployment account. Only after migration/build succeeds, switch the service to the new release and restart with runtime credentials. Check logs, HTTPS sign-in and dashboard access. Do not rerun `admin:create` for updates.

The user-to-workstation assignment feature requires migration `20261029000000_user_workstation` before starting the new application. Administrators can create accounts and assign each person to a station in Settings. Assignments identify the current team at a station; they do not retroactively attribute individual cabinet records to a person.

The department roster also requires `20261029010000_user_department`. It copies the department from each existing user's assigned workstation; users without a station remain without a department until an administrator assigns one. Administrators manage departments under Settings; supervisors and administrators can assign department members from the workstation page. Changing a user's department clears the current workstation assignment.

The command fails immediately at the first unsuccessful step and does not restart the server. Successfully applied migrations remain applied if a later build fails; MySQL DDL is not an all-or-nothing transaction. Fix the failure, then rerun setup. Never use `migrate reset`, `db push --force-reset`, or `migrate dev` on production. Review failed migration state before using Prisma's manual recovery tools; do not mark a partially applied migration complete blindly.

The new integrity migration adds 29 restrictive foreign keys. On an older database, orphan rows cause the migration to fail rather than being deleted. Review and repair those records using your backup and an explicit data-repair plan before resuming the failed migration. Existing unique indexes (including event retry identities), primary keys, nullability and foreign keys are installed from the migration history on an empty database. Relations restrict deletion of referenced historical data; tenant authorization remains enforced by the application.

Ordinary reruns do not delete data, create duplicate configuration, reseed demo data, or reset passwords. Schema deployment and database restoration are separate operations; rollback of application files alone does not undo a migration.
