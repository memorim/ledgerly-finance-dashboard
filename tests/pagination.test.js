import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
process.env.NODE_ENV = 'test';
const { createApp, createDb } = await import('../server.js');
test('transactions beyond 100 remain reachable and export includes more than 1000 rows', async () => {
  const db = createDb(':memory:');
  try {
    const insert = db.prepare(
      'INSERT INTO transactions(external_id,kind,amount_cents,occurred_on,category,description,created_at) VALUES(?,?,?,?,?,?,?)',
    );
    for (let i = 0; i < 1005; i++)
      insert.run(
        randomUUID(),
        'income',
        100,
        '2026-01-01',
        'Test',
        `row ${i}`,
        new Date().toISOString(),
      );
    const app = createApp(db);
    const first = await request(app).get('/api/transactions');
    const second = await request(app).get('/api/transactions?offset=100&limit=100');
    assert.equal(first.body.length, 100);
    assert.equal(second.body.length, 100);
    assert.notEqual(first.body[0].id, second.body[0].id);
    const csv = await request(app).get('/api/transactions/export.csv');
    assert.equal(csv.status, 200);
    assert.ok(csv.text.includes('row 1004'));
    assert.equal(csv.text.trim().split('\r\n').length, Number(first.headers['x-total-count']) + 1);
    assert.equal((await request(app).get('/api/transactions?offset=-1')).status, 400);
  } finally {
    db.close();
  }
});
