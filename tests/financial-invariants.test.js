import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
process.env.NODE_ENV = 'test';
const { createDb, createApp } = await import('../server.js');
const { calculateCash } = await import('../finance.js');

test('cash conservation and partition/order invariance hold for generated integer-kopek records', () => {
  let seed = 0x71ab;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  const now = new Date('2030-07-15T00:00:00Z');
  for (let sample = 0; sample < 200; sample++) {
    const rows = Array.from({ length: 1 + (next() % 40) }, () => ({
      kind: next() % 3 ? 'income' : 'expense',
      amount_cents: BigInt(2 + (next() % 1000000)),
      date: '2030-07-10',
    }));
    const result = calculateCash(rows, { opening: -123n, goal: 10000000n }, now);
    assert.deepEqual(
      calculateCash([...rows].reverse(), { opening: -123n, goal: 10000000n }, now),
      result,
    );
    const [first, ...rest] = rows,
      half = first.amount_cents / 2n;
    assert.deepEqual(
      calculateCash(
        [
          { ...first, amount_cents: half },
          { ...first, amount_cents: first.amount_cents - half },
          ...rest,
        ],
        { opening: -123n, goal: 10000000n },
        now,
      ),
      result,
    );
    const amount = BigInt(1 + (next() % 100000));
    const balanced = calculateCash(
      [
        ...rows,
        { kind: 'income', amount_cents: amount, date: '2030-07-10' },
        { kind: 'expense', amount_cents: amount, date: '2030-07-10' },
      ],
      { opening: -123n, goal: 10000000n },
      now,
    );
    assert.equal(balanced.balance, result.balance);
    const future = calculateCash(
      [...rows, { kind: 'income', amount_cents: amount, date: '2030-07-16' }],
      { opening: -123n, goal: 10000000n },
      now,
    );
    assert.deepEqual(future, result);
  }
});

test('transaction edits and deletion adjust cash once; stale versions and import conflicts preserve records', async () => {
  const db = createDb(':memory:');
  try {
    db.exec('DELETE FROM invoices;DELETE FROM transactions');
    const app = createApp(db),
      body = {
        kind: 'income',
        amount: 10.29,
        date: '2020-01-10',
        category: 'Work',
        description: 'Original',
      };
    const created = await request(app).post('/api/transactions').send(body);
    assert.equal(created.status, 201);
    assert.equal((await request(app).get('/api/summary')).body.cash.balance, 10.29);
    const url = '/api/transactions/' + created.body.id;
    const changed = await request(app)
      .patch(url)
      .send({ ...body, amount: 15.31, version: 1 });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.version, 2);
    assert.equal((await request(app).get('/api/summary')).body.cash.balance, 15.31);
    assert.equal(
      (
        await request(app)
          .patch(url)
          .send({ ...body, amount: 99, version: 1 })
      ).status,
      409,
    );
    const stored = db
      .prepare('SELECT * FROM transactions WHERE external_id=?')
      .get(created.body.id);
    assert.equal(stored.amount_cents, 1531);
    assert.equal((await request(app).delete(url).send({ version: 1 })).status, 409);
    assert.equal((await request(app).delete(url).send({ version: 2 })).status, 204);
    assert.equal((await request(app).delete(url).send({ version: 2 })).status, 204);
    assert.equal((await request(app).get('/api/transactions')).body.length, 0);
    assert.equal((await request(app).get('/api/summary')).body.cash.balance, 0);
    assert.equal(
      db.prepare('SELECT COUNT(*) n FROM transactions WHERE deleted_at IS NOT NULL').get().n,
      1,
      'deleted data remains stored',
    );
    const csv =
      'id,kind,amount,date,category,description\n' +
      created.body.id +
      ',income,15.31,2020-01-10,Work,Original\n';
    assert.equal(
      (await request(app).post('/api/transactions/import').send({ csv })).status,
      409,
      'a new import cannot resurrect a removed UUID',
    );
  } finally {
    db.close();
  }
});

test('aggregate limit failures roll back invoices, CSV and settings atomically', async () => {
  const db = createDb(':memory:');
  try {
    db.exec(
      "DELETE FROM invoices;DELETE FROM transactions;WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value+1 FROM n WHERE value<1000) INSERT INTO transactions(external_id,kind,amount_cents,occurred_on,category,description,created_at) SELECT printf('00000000-0000-4000-8000-%012d',value),'income',100000000000,'2020-01-10','Scale','','2020-01-10' FROM n;",
    );
    const app = createApp(db);
    assert.equal((await request(app).get('/api/summary')).body.cash.balance, 1e12);
    assert.equal(
      (
        await request(app).post('/api/invoices').send({
          client: 'Audit',
          title: 'Beyond the bound',
          amount: 0.01,
          dueDate: '2030-01-10',
          status: 'paid',
        })
      ).status,
      409,
    );
    assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n, 0);
    const csv =
      'id,kind,amount,date,category,description\n,income,0.01,2020-01-10,Extra,No partial write\n';
    assert.equal((await request(app).post('/api/transactions/import').send({ csv })).status, 409);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM transactions').get().n, 1000);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM csv_imports').get().n, 0);
    assert.equal(
      (await request(app).patch('/api/settings').send({ goalAmount: 1, openingBalance: 0.01 }))
        .status,
      409,
    );
    assert.equal(
      db.prepare("SELECT value FROM settings WHERE key='opening_balance_cents'").get().value,
      0,
    );
  } finally {
    db.close();
  }
});
