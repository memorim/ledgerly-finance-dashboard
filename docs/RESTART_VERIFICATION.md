# Live persistence after redeploy — 2026-11-09

The owner confirmed that the current installation contains demo data only and
explicitly authorized a manual redeploy of the existing Render Free service.
The deployed source remained `d2be00785d61716f5342f0bbe9df5a5eee0b4862`.
Deployment `dep-dborfhs9v7es7385vhj0` reached `live` at
2026-11-09 12:09:23 UTC.

Before and after the redeploy, a read-only query inside the external Neon
PostgreSQL computed the same fingerprint across all fields in invoices,
transactions and settings: `502a890fb0afba24db157dd90a3196b9`.
The verified database contains five demo invoices, twelve transactions,
two settings and migration version 1. PostgreSQL account initialization must
finish before the application starts accepting traffic.

This verifies persistence across a real application redeploy, in addition to
the reconnect/concurrency tests in CI. The authenticated live CRUD scenario
still requires the operator's access secret; this step does not claim that it
was performed. It also does not verify recovery after loss of PostgreSQL or
replace an independent backup. No paid disk, database plan or worker was added.
