import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
function browser() {
  let offset = 0;
  class Clock extends Date {
    static now() {
      return Date.now() + offset;
    }
  }
  let network = 0;
  const scope = {
    DEMO_SEED: JSON.parse(readFileSync(new URL('./seed.json', import.meta.url), 'utf8')),
    structuredClone,
    Response,
    Headers,
    URL,
    DOMException,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Date: Clock,
    crypto: webcrypto,
    location: new URL('https://example.test/project/'),
    fetch: async () => {
      network++;
      throw Error('Unexpected network request');
    },
  };
  runInNewContext(readFileSync(new URL('./browser.js', import.meta.url), 'utf8'), scope);
  return {
    call: async (path, method = 'GET', body, headers) => {
      const response = await scope.fetch(path, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
        headers,
      });
      return { status: response.status, body: await response.json() };
    },
    advance: (ms) => {
      offset += ms;
    },
    network: () => network,
  };
}
test('minor units, settings, edits and stale version preserve the cash invariant', async () => {
  const b = browser();
  const initial = (await b.call('/api/summary')).body.cash.balance;
  const payload = {
    kind: 'income',
    amount: 0.1,
    date: new Date().toISOString().slice(0, 10),
    category: 'Test income',
    description: '',
  };
  const first = await b.call('/api/transactions', 'POST', payload);
  assert.equal(first.status, 201);
  await b.call('/api/transactions', 'POST', { ...payload, amount: 0.2 });
  assert.equal(Math.round(((await b.call('/api/summary')).body.cash.balance - initial) * 100), 30);
  const path = '/api/transactions/' + first.body.external_id;
  assert.equal((await b.call(path, 'PATCH', { ...payload, amount: 1, version: 0 })).status, 409);
  assert.equal((await b.call(path, 'DELETE', { version: 1 })).status, 200);
  assert.equal(Math.round(((await b.call('/api/summary')).body.cash.balance - initial) * 100), 20);
  assert.equal(
    (await b.call('/api/transactions', 'POST', { ...payload, amount: 0.001 })).status,
    400,
  );
  assert.equal(b.network(), 0);
});
