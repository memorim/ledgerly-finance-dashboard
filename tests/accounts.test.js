import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostedApp } from '../hosted.js';
process.env.NODE_ENV = 'test';
const { createApp, createDb } = await import('../server.js');
test('hosted accounts require credentials and isolate stored records', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'accounts-'));
  const tokenA = 'a'.repeat(40),
    tokenB = 'b'.repeat(40),
    hash = (v) => createHash('sha256').update(v).digest('hex');
  const app = createHostedApp({
    createDb,
    createApp,
    origin: 'https://private.example',
    accounts: { alice: hash(tokenA), bob: hash(tokenB) },
    directory,
  });
  const call = (method, path, user, secret) =>
    request(app)[method](path).set('Host', 'private.example').auth(user, secret);
  try {
    assert.equal((await call('get', '/api/invoices', 'alice', 'wrong')).status, 401);
    const made = await call('post', '/api/invoices', 'alice', tokenA).send({
      client: 'Private client',
      title: 'Private invoice',
      amount: 50,
      dueDate: '2026-12-01',
      status: 'draft',
    });
    assert.equal(made.status, 201);
    const own = await call('get', '/api/invoices', 'alice', tokenA),
      other = await call('get', '/api/invoices', 'bob', tokenB);
    assert.ok(JSON.stringify(own.body).includes('Private'));
    assert.ok(!JSON.stringify(other.body).includes('Private'));
    assert.equal(
      (
        await call('post', '/api/invoices', 'alice', tokenA)
          .set('Origin', 'https://evil.example')
          .send({
            client: 'Private client',
            title: 'Private invoice',
            amount: 50,
            dueDate: '2026-12-01',
            status: 'draft',
          })
      ).status,
      403,
    );
  } finally {
    app.closeAccounts();
    rmSync(directory, { recursive: true, force: true });
  }
});
