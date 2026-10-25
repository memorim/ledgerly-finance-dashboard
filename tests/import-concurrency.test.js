import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
process.env.NODE_ENV = 'test';
const { createDb } = await import('../server.js');
test('independent HTTP servers replay one concurrent CSV import without duplicate records', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'ledger-import-')),
    file = join(directory, 'ledger.sqlite'),
    workers = [];
  t.after(async () => {
    await Promise.all(workers.map((worker) => worker.terminate()));
    assert.ok(realpathSync(directory).startsWith(realpathSync(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  });
  const initial = createDb(file);
  initial.exec('DELETE FROM transactions');
  initial.close();
  const gate = new SharedArrayBuffer(4);
  const ports = await Promise.all(
    [0, 1].map(
      () =>
        new Promise((resolve, reject) => {
          const worker = new Worker(new URL('./import-worker.mjs', import.meta.url), {
            workerData: { file, gate, module: new URL('../server.js', import.meta.url).href },
          });
          workers.push(worker);
          worker.once('message', resolve);
          worker.once('error', reject);
        }),
    ),
  );
  const csv =
    'id,kind,amount,date,category,description\ncc7e7ca8-cffb-4c38-a54f-d1e0eef4157a,income,10.25,2020-01-10,Work,Concurrent import\n';
  const results = await Promise.all(
    ports.map(async (port) => {
      const response = await fetch('http://127.0.0.1:' + port + '/api/transactions/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv }),
      });
      return { status: response.status, body: await response.json() };
    }),
  );
  assert.deepEqual(
    results.map((result) => result.status),
    [200, 200],
  );
  assert.deepEqual(results.map((result) => result.body.replayed).sort(), [false, true]);
  const db = createDb(file);
  try {
    assert.equal(db.prepare('SELECT COUNT(*) n FROM transactions').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM csv_imports').get().n, 1);
  } finally {
    db.close();
  }
});
