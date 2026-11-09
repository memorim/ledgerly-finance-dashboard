import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { accountSchema, createPostgresDb, postgresConfig, postgresSql } from '../postgres.js';
import { createHostedApp } from '../hosted.js';
process.env.NODE_ENV = 'test';
const { createDb, createApp } = await import('../server.js');

test('remote PostgreSQL checks certificates and preserves bound values', () => {
  assert.throws(() => postgresConfig('postgresql://u:p@db.example/ledgerly?sslmode=disable'));
  assert.throws(() => postgresConfig('postgresql://u:p@db.example/ledgerly'));
  assert.ok(postgresConfig('postgresql://u:p@db.example/ledgerly?sslmode=verify-full'));
  const query = postgresSql(
    "SELECT '?' literal FROM invoices WHERE client=?",
    ["private' OR 1=1"],
    accountSchema('alice'),
  );
  assert.ok(query.text.includes("SELECT '?' literal"));
  assert.ok(query.text.includes('WHERE client=$1'));
  assert.deepEqual(query.values, ["private' OR 1=1"]);
  assert.throws(() => postgresSql('SELECT ?', []));
  assert.notEqual(accountSchema('alice'), accountSchema('bob'));
});

test(
  'PostgreSQL preserves cents, isolation, concurrent imports and data after reconnect',
  { skip: !process.env.TEST_POSTGRES_URL },
  async () => {
    const url = process.env.TEST_POSTGRES_URL;
    const prefix = randomUUID();
    const users = { alice: prefix + '-alice', bob: prefix + '-bob' };
    const schemas = Object.values(users).map(accountSchema);
    const stores = [];
    const open = async (user) => {
      const store = await createPostgresDb(url, accountSchema(user), {
        seed: () => createDb(':memory:'),
      });
      stores.push(store);
      return store;
    };
    const admin = new pg.Pool({ connectionString: url });
    try {
      const first = await open(users.alice),
        second = await open(users.alice),
        other = await open(users.bob);
      assert.equal(first.initialized, true);
      assert.equal(second.initialized, false);
      const a = createApp(first),
        b = createApp(second),
        c = createApp(other);
      const get = (app, path) => request(app).get(path).set('Host', 'localhost');
      const post = (app, path, body) => request(app).post(path).set('Host', 'localhost').send(body);
      const invoice = {
        client: 'Private client',
        title: 'Persistent invoice',
        amount: 12.34,
        dueDate: '2026-12-01',
        status: 'paid',
      };
      const made = await post(a, '/api/invoices', invoice);
      assert.equal(made.status, 201);
      assert.ok(
        (await get(b, '/api/invoices')).body.some(
          (row) => row.id === made.body.id && row.amount_cents === 1234,
        ),
      );
      assert.ok(!(await get(c, '/api/invoices')).body.some((row) => row.title === invoice.title));
      const identifier = randomUUID();
      const payload = {
        csv: `id,kind,amount,date,category,description\r\n${identifier},income,10.01,2026-11-01,Project,Concurrent\r\n`,
      };
      const imports = await Promise.all([
        post(a, '/api/transactions/import', payload),
        post(b, '/api/transactions/import', payload),
      ]);
      assert.ok(imports.every((result) => result.status === 200));
      assert.equal(imports.filter((result) => !result.body.replayed).length, 1);
      assert.equal(
        (
          await first
            .prepare('SELECT count(*) n FROM transactions WHERE external_id=?')
            .get(identifier)
        ).n,
        1,
      );
      const invalid = await post(a, '/api/transactions/import', {
        csv: payload.csv.replace('10.01', '10.02'),
      });
      assert.equal(invalid.status, 409);
      const summary = (await get(a, '/api/summary')).body;
      assert.equal((await get(b, '/api/summary')).status, 200);
      assert.ok((await get(a, '/api/transactions/export.csv')).text.includes(identifier));
      const tx = (await get(a, '/api/transactions')).body.find(
        (row) => row.external_id === identifier,
      );
      const edit = (app) =>
        request(app)
          .patch('/api/transactions/' + identifier)
          .set('Host', 'localhost')
          .send({
            kind: 'income',
            amount: 10.01,
            date: '2026-11-01',
            category: 'Project',
            description: 'Concurrent',
            version: tx.version,
          });
      const edits = await Promise.all([edit(a), edit(b)]);
      assert.deepEqual(edits.map((result) => result.status).sort(), [200, 409]);
      await first.close();
      await second.close();
      const reopened = await open(users.alice);
      assert.deepEqual((await get(createApp(reopened), '/api/summary')).body, summary);
      assert.ok(
        (await get(createApp(reopened), '/api/invoices')).body.some(
          (row) => row.id === made.body.id,
        ),
      );
      await reopened.transaction(async () => {
        await reopened.prepare('DELETE FROM invoices').run();
        await reopened.prepare('DELETE FROM transactions').run();
        await reopened
          .prepare(
            "INSERT INTO transactions(external_id,kind,amount_cents,occurred_on,category,description,created_at) SELECT (? || n::text),'income',100000000000,'2020-01-10','Scale','','2020-01-10' FROM generate_series(1,1000) n",
          )
          .run(prefix);
      });
      const maximum = (await get(createApp(reopened), '/api/summary')).body;
      assert.equal(maximum.cash.balance, 1e12);
      const tooLarge = await request(createApp(reopened))
        .patch('/api/settings')
        .set('Host', 'localhost')
        .send({ goalAmount: 1, openingBalance: 0.01 });
      assert.equal(tooLarge.status, 409);
      assert.deepEqual((await get(createApp(reopened), '/api/summary')).body, maximum);
      const token = 't'.repeat(40);
      const hosted = createHostedApp({
        createDb: (_file, user) => open(users[user]),
        createApp,
        origin: 'https://private.example',
        accounts: { alice: createHash('sha256').update(token).digest('hex') },
        directory: '/tmp/fixture-ledgerly',
      });
      assert.equal(
        (await request(hosted).get('/api/invoices').set('Host', 'private.example')).status,
        401,
      );
      assert.equal(
        (
          await request(hosted)
            .get('/api/invoices')
            .set('Host', 'private.example')
            .auth('alice', token)
        ).status,
        200,
      );
      await hosted.closeAccounts();
    } finally {
      await Promise.all(stores.map((store) => store.close()));
      for (const schema of schemas)
        await admin.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
      await admin.end();
    }
  },
);
