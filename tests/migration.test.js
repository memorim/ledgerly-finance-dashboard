import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
process.env.NODE_ENV = 'test';
const { createDb } = await import('../server.js');
test('failed migration rolls back schema changes and preserves existing records', () => {
  const directory = mkdtempSync(join(tmpdir(), 'schema-rollback-')),
    file = join(directory, 'db.sqlite');
  let db;
  try {
    db = new DatabaseSync(file);
    db.exec(
      "CREATE TABLE invoices(id INTEGER PRIMARY KEY,client TEXT,title TEXT,amount REAL,due_date TEXT,status TEXT,created_at TEXT);INSERT INTO invoices VALUES(1,'Keep','Keep',1,'2026-10-24','paid','2026-10-20');CREATE TABLE transactions(id INTEGER PRIMARY KEY);",
    );
    db.close();
    db = null;
    assert.throws(() => createDb(file));
    db = new DatabaseSync(file);
    assert.equal(
      db
        .prepare('PRAGMA table_info(invoices)')
        .all()
        .some((c) => c.name === 'paid_at'),
      false,
    );
    assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n, 1);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally {
    db?.close();
    assert.ok(realpathSync(directory).startsWith(realpathSync(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  }
});
