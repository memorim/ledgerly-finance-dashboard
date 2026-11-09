import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMigrationSource } from '../migration-source.js';
import { createDb } from '../database.js';

test('migration reads a consistent SQLite snapshot without modifying the source', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ledgerly-import-'));
  const filename = join(directory, 'source.db');
  try {
    const original = createDb(filename);
    original.close();
    const before = readFileSync(filename);
    const source = openMigrationSource(filename);
    assert.ok(source.prepare('SELECT count(*) n FROM invoices').get().n > 0);
    assert.throws(() => source.prepare('DELETE FROM invoices').run());
    source.close();
    assert.deepEqual(readFileSync(filename), before);
    const legacy = createDb(filename);
    legacy.exec('PRAGMA user_version=1');
    legacy.close();
    const old = readFileSync(filename);
    assert.throws(() => openMigrationSource(filename), /schema version 2/);
    assert.deepEqual(readFileSync(filename), old);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
