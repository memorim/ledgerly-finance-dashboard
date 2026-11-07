import assert from 'node:assert/strict';
const base = new URL(process.env.SMOKE_URL || 'http://127.0.0.1:4300');
assert.ok(
  ['http:', 'https:'].includes(base.protocol) &&
    !base.username &&
    !base.password &&
    !base.search &&
    !base.hash,
  'Use a fixed HTTP(S) origin/path without credentials',
);
const url = new URL(base.href.replace(/\/$/, '') + '/api/health');
const user = process.env.SMOKE_USER,
  password = process.env.SMOKE_PASSWORD;
assert.ok((user && password) || (!user && !password), 'Set both SMOKE_USER and SMOKE_PASSWORD');
const headers = {};
if (user && password) {
  assert.ok(
    base.protocol === 'https:' || ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname),
    'Credentials require HTTPS outside loopback',
  );
  assert.ok(!user.includes(':') && !/[\r\n]/.test(user + password), 'Invalid smoke credentials');
  headers.Authorization = 'Basic ' + Buffer.from(user + ':' + password).toString('base64');
}
const response = await fetch(url, {
  headers,
  signal: AbortSignal.timeout(15000),
  redirect: 'error',
});
assert.equal(response.status, 200, 'Health must return 200');
assert.match(response.headers.get('content-type') || '', /application\/json/);
assert.equal((await response.json()).status, 'ok');
const revision = response.headers.get('x-app-revision');
assert.ok(
  revision === 'local-unversioned' || /^[a-f0-9]{40}$/i.test(revision || ''),
  'Server revision header missing',
);
if (process.env.EXPECTED_REVISION)
  assert.equal(revision, process.env.EXPECTED_REVISION, 'Deployed source revision differs');
console.log(JSON.stringify({ check: 'health_smoke', status: 'ok', revision }));
