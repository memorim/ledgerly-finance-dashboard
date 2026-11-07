# Persistent data and authenticated deployment checks

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
