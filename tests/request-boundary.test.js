import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
process.env.NODE_ENV = 'test';
const { createDb, createApp } = await import('../server.js');
test('operator API rejects DNS-rebinding hosts and cross-origin writes', async () => {
  const db = createDb(':memory:');
  try {
    const app = createApp(db);
    assert.equal((await request(app).get('/api/summary')).status, 200);
    assert.equal(
      (await request(app).get('/api/summary').set('Host', 'untrusted.example')).status,
      403,
    );
    assert.equal(
      (await request(app).post('/api/invalid').set('Origin', 'https://untrusted.example').send({}))
        .status,
      403,
    );
  } finally {
    db.close();
  }
});

const { operatorBoundary } = await import('../request-policy.js');
test('configured proxy host is explicit and origin validation fails closed', async () => {
  for (const origin of [
    'https://example.com/path',
    'ftp://example.com',
    'https://user:pass@example.com',
  ])
    assert.throws(() => operatorBoundary({ APP_PUBLIC_ORIGIN: origin }));
  const { default: express } = await import('express');
  const app = express();
  app.use(operatorBoundary({ APP_PUBLIC_ORIGIN: 'https://operator.example' }));
  app.post('/write', (_req, res) => res.sendStatus(204));
  assert.equal(
    (
      await request(app)
        .post('/write')
        .set('Host', 'operator.example')
        .set('Origin', 'https://operator.example')
    ).status,
    204,
  );
  assert.equal(
    (
      await request(app)
        .post('/write')
        .set('Host', 'operator.example')
        .set('Origin', 'https://other.example')
    ).status,
    403,
  );
  assert.equal((await request(app).post('/write').set('Host', '127.0.0.1')).status, 403);
});
