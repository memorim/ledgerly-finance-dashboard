import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
process.env.NODE_ENV = 'test';
const { createDb } = await import('../server.js');

for (const invalid of [false, true])
  test(`minor-unit migration ${invalid ? 'rolls back an unrepresentable legacy amount' : 'retains the legacy value and copies exact cents once'}`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'ledger-money-migration-'));
    let db;
    try {
      const file = join(directory, 'legacy.sqlite');
      db = new DatabaseSync(file);
      db.exec(
        'CREATE TABLE invoices(id INTEGER PRIMARY KEY,client TEXT NOT NULL,title TEXT NOT NULL,amount REAL NOT NULL,due_date TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);',
      );
      const amount = invalid ? 1.001 : 0.1 + 0.2;
      db.prepare(
        "INSERT INTO invoices VALUES(1,'Existing client','Keep record',?,'2030-01-10','paid','2026-01-10')",
      ).run(amount);
      const before = db.prepare('SELECT * FROM invoices').get();
      db.close();
      db = null;
      if (invalid) {
        assert.throws(() => createDb(file), /cannot be migrated/);
        db = new DatabaseSync(file);
        assert.deepEqual(db.prepare('SELECT * FROM invoices').get(), before);
        assert.equal(
          db
            .prepare('PRAGMA table_info(invoices)')
            .all()
            .some((column) => column.name === 'amount_cents'),
          false,
        );
      } else {
        db = createDb(file);
        assert.equal(db.prepare('SELECT amount_cents FROM invoices').get().amount_cents, 30);
        assert.equal(db.prepare('SELECT amount FROM invoices').get().amount, amount);
        db.close();
        db = createDb(file);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n, 1);
        assert.equal(db.prepare('SELECT amount_cents FROM invoices').get().amount_cents, 30);
      }
    } finally {
      db?.close();
      assert.ok(realpathSync(directory).startsWith(realpathSync(tmpdir()) + sep));
      rmSync(directory, { recursive: true, force: true });
    }
  });
