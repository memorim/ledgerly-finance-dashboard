import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
process.env.NODE_ENV = 'test';
const { createDb, createApp } = await import('../server.js');
const { cashSummary, calculateCash } = await import('../finance.js');

test('money validation rejects hidden extra decimal places instead of silently rounding', async () => {
  const db = createDb(':memory:');
  try {
    const app = createApp(db);
    const result = await request(app)
      .post('/api/transactions')
      .send({ kind: 'income', amount: 1.000000001, date: '2030-01-10', category: 'Precision' });
    assert.equal(result.status, 400);
  } finally {
    db.close();
  }
});

test('large aggregates fail explicitly instead of returning an unsafe numeric balance', () => {
  const db = createDb(':memory:');
  try {
    db.exec(
      "DELETE FROM invoices;DELETE FROM transactions;WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value+1 FROM n WHERE value<90072) INSERT INTO transactions(external_id,kind,amount_cents,occurred_on,category,description,created_at) SELECT printf('00000000-0000-4000-8000-%012d',value),'income',100000000000,'2030-01-10','Scale','','2030-01-10' FROM n;",
    );
    assert.throws(() => cashSummary(db, new Date('2030-01-11T00:00:00Z')), RangeError);
  } finally {
    db.close();
  }
});

test('future entries cannot defer an aggregate overflow until their date arrives', () => {
  const rows = Array.from({ length: 1001 }, () => ({
    kind: 'income',
    amount_cents: 100000000000n,
    date: '9999-12-31',
  }));
  assert.throws(() => calculateCash(rows), RangeError);
});
