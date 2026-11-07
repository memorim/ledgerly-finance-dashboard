import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostedApp } from '../hosted.js';
process.env.NODE_ENV = 'test';
const { createApp, createDb } = await import('../server.js');

test('smoke checks real HTTP health and fails on a mismatched revision', async () => {
  const previous = process.env.APP_REVISION;
  process.env.APP_REVISION = 'a'.repeat(40);
  const db = createDb(':memory:');
  const server = createApp(db).listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const env = {
      ...process.env,
      SMOKE_URL: `http://127.0.0.1:${address.port}`,
      EXPECTED_REVISION: 'a'.repeat(40),
    };
    const result = await promisify(execFile)(process.execPath, ['scripts/smoke.mjs'], { env });
    assert.match(result.stdout, /health_smoke/);
    await assert.rejects(() =>
      promisify(execFile)(process.execPath, ['scripts/smoke.mjs'], {
        env: { ...env, EXPECTED_REVISION: 'b'.repeat(40) },
      }),
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    if (previous === undefined) delete process.env.APP_REVISION;
    else process.env.APP_REVISION = previous;
  }
});

test('smoke authenticates a hosted account without exposing its secret', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ledgerly-smoke-'));
  const password = 'synthetic-smoke-secret-'.repeat(3);
  let app;
  const server = createServer((req, res) => app(req, res)).listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const base = `127.0.0.1:${server.address().port}`;
    app = createHostedApp({
      createDb,
      createApp,
      origin: `https://${base}`,
      directory,
      accounts: { owner: createHash('sha256').update(password).digest('hex') },
    });
    const env = {
      ...process.env,
      SMOKE_URL: `http://${base}`,
      SMOKE_USER: 'owner',
      SMOKE_PASSWORD: password,
    };
    const run = (extra) =>
      promisify(execFile)(process.execPath, ['scripts/smoke.mjs'], { env: { ...env, ...extra } });
    const result = await run({});
    assert.match(result.stdout, /health_smoke/);
    assert.ok(!result.stdout.includes(password));
    await assert.rejects(() => run({ SMOKE_PASSWORD: 'wrong' }));
    await assert.rejects(() => run({ SMOKE_PASSWORD: '' }));
    await assert.rejects(() => run({ SMOKE_URL: 'http://remote.example' }));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    app?.closeAccounts();
    rmSync(directory, { recursive: true, force: true });
  }
});
