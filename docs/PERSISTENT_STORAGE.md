# Persistent data and authenticated deployment checks

## Free external PostgreSQL

`DATABASE_URL` enables PostgreSQL instead of a local disk. Neon Free is one
option: current limits include 1 GB per project, 100 CU-hours/month per project
and automatic suspension after inactivity. Render does not need a paid disk.
Use a pooled Neon connection with `sslmode=verify-full`. Remote connections
without certificate/hostname verification are rejected. The application shares
a pool of five connections and lets idle connections close.

Each provisioned account uses a server-derived schema; callers cannot select
another account's schema. Schema migrations run under a transaction and an
account advisory lock, record a checksum, and roll back on failure. Concurrent
CSV imports and monetary mutations use that same account lock. Exact kopecks,
version conflicts, CSV streaming and the local SQLite mode are retained.

Before switching an existing installation, stop writes and make a consistent
SQLite backup for **every** account. Keep the original outside Render. With
`DATABASE_URL` in the protected shell environment, run:

```sh
node scripts/migrate-postgres.mjs /private/backup/alice.db alice
```

Omit the username for the standalone operator database. The command opens the
source read-only, checks integrity/schema version, copies all four tables and
compares every row before committing. It refuses to overwrite an initialized
destination. An old SQLite schema must first be upgraded using a disposable
copy and the existing upgrade checks. Never delete the old data to fix import.

Only after all imports pass, set `DATABASE_URL` on the service. An account whose
destination has never been initialized starts with the existing demo seed, so
do not use first login as a migration procedure. No live database or Render
configuration is changed by adding this code. Do not redeploy an ephemeral
SQLite installation before obtaining its consistent backup.

Verify health with the exact source revision, authenticate, create a synthetic
record, restart the service and read the same ID and amount. Repeat after a
database reconnect. The PostgreSQL CI job covers independent connections,
account isolation, concurrent imports/edits, overflow rollback and reconnects;
it does not prove the operator's live deployment or backup retention.

Neon instant restore has its own retention limit. Keep independent, protected
backups and rehearse restore separately; database persistence is not a backup.

Provider details: https://neon.com/pricing and https://render.com/docs/free.

## Existing local disk mode

Set `LEDGERLY_DATA_DIRECTORY` to the mount point of a persistent disk. The local
database is `ledgerly.db`; hosted account databases live under `accounts/` on
the same disk. Omitting the variable preserves the existing `data/` default.
The application rejects paths inside `public/`.

Before changing the path, stop writes and back up the entire old data directory,
including account databases and any SQLite WAL files. Copy it consistently with
the app stopped, keep the original, and check the copies before switching. Do
not mount an empty disk over the only existing copy. A path setting does not
create a hosting-provider disk or make an ephemeral directory durable.

After starting behind HTTPS, set `SMOKE_URL`, `SMOKE_USER` and `SMOKE_PASSWORD`
in the operator's protected environment and run `pnpm smoke`. Credentials are
sent in the Authorization header, never in URLs or printed output. Redirects
are rejected; credentials over plain HTTP are allowed only on loopback for
local tests. `EXPECTED_REVISION` checks the exact deployed source revision.

`tests/storage.test.js` checks persistence across independent processes and
rejects public paths. `tests/smoke.test.js` verifies real HTTP account login,
wrong/missing credentials and revision mismatch. Actual HTTPS, disk mounting,
restarts and restore rehearsal must still be checked on the target service.
