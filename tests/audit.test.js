import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import request from 'supertest';
process.env.NODE_ENV = 'test';
const { createDb, createApp } = await import('../server.js');

test('summary preserves kopecks and invoice status/delete changes cash exactly once', async () => {
  const db = createDb(':memory:');
  try {
    db.exec('DELETE FROM invoices;DELETE FROM transactions;');
    const app = createApp(db);
    const payload = {
      client: 'Audit client',
      title: 'Precision check',
      amount: 0.29,
      dueDate: '2030-01-10',
      status: 'paid',
    };
    const invoice = await request(app).post('/api/invoices').send(payload);
    assert.equal(invoice.status, 201);
    let summary = (await request(app).get('/api/summary')).body;
    assert.equal(summary.stats.total, 0.29);
    assert.equal(summary.stats.paid, 0.29);
    assert.equal(summary.cash.balance, 0.29);
    await request(app).patch(`/api/invoices/${invoice.body.id}/status`).send({ status: 'paid' });
    assert.equal((await request(app).get('/api/summary')).body.cash.balance, 0.29);
    await request(app).patch(`/api/invoices/${invoice.body.id}/status`).send({ status: 'sent' });
    summary = (await request(app).get('/api/summary')).body;
    assert.equal(summary.cash.balance, 0);
    assert.equal(summary.stats.expected, 0.29);
    assert.equal((await request(app).delete(`/api/invoices/${invoice.body.id}`)).status, 204);
    assert.equal((await request(app).get('/api/summary')).body.cash.balance, 0);
    assert.deepEqual((await request(app).get('/api/summary')).body.stats, {
      total: 0,
      paid: 0,
      expected: 0,
      invoices: 0,
    });
  } finally {
    db.close();
  }
});

test('reopening an intentionally empty invoice table does not seed more cash operations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-audit-'));
  let db;
  try {
    const file = join(dir, 'db.sqlite');
    db = createDb(file);
    db.exec('DELETE FROM invoices');
    const count = db.prepare('SELECT COUNT(*) n FROM transactions').get().n;
    db.close();
    db = null;
    db = createDb(file);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM transactions').get().n, count);
  } finally {
    db?.close();
    assert.ok(realpathSync(dir).startsWith(realpathSync(tmpdir()) + sep));
    rmSync(dir, { recursive: true, force: true });
  }
});
