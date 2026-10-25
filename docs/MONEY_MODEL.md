# Exact money and write model

`money.js` → `finance.js` (pure `calculateCash`) → SQLite adapter → `server.js` → local UI.

## Storage and migration

Version 2 adds invoice `amount_cents`, transaction `version` and nullable `deleted_at` in one startup transaction. Original invoice REAL values and all previous columns remain intact. Tiny binary residues accepted by the previous schema (such as 0.1 + 0.2) are rounded once to kopeks; genuinely extra decimal digits cause rollback. No production database was migrated as part of development checks.

New money input must be a finite positive decimal with at most two digits after the decimal point and at most 1,000,000,000 roubles. Opening balance may be negative within that bound. BigInt intermediate calculations avoid accumulation drift. Every total is converted to numeric JSON only after range validation. The conservative 1,000,000,000,000-rouble limit also bounds future entries and possible opening-balance offsets.

`writeCashChange` takes `BEGIN IMMEDIATE`, performs a mutation, recalculates invoice/cash invariants, and commits. A trigger, range or write failure rolls the transaction back. CSV uses the same lock/range validation around the hash check and all rows. Reads calculate current-date summaries in UTC; undated legacy paid invoices count toward all-time income, not invented monthly history.

## Editing

GET `/api/transactions` includes `external_id` and `version`. PATCH `/api/transactions/:uuid` accepts all entry fields plus that version; DELETE accepts `{ "version": 1 }`. Each mutation increments the version and compares it atomically. Stale mutation: 409. Unknown entry: 404. A repeated delete is 204. Deleted entries remain in SQLite, but do not affect reports or export. This is retention, not a complete accounting audit trail or undo UI.

## Import replay

A file hash is an immutable import operation key. Exact replay returns its original addition count and never replaces subsequent edits. Different files may share UUIDs only when all stored entry fields agree; a UUID belonging to a deleted record cannot resurrect it. Separate-process HTTP regression checks use one temporary WAL database and synchronised requests.

## Verification

Run `pnpm test`, `pnpm test:contract`, `pnpm test:upgrade` and `pnpm test:e2e`. Regression evidence is in money-safety, money-migration, financial-invariants, import-concurrency and browser/edit tests. Fixtures use memory or temporary databases, never the operator database.
