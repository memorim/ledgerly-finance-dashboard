import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

test('configured disk preserves default database across independent processes', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'ledgerly-disk-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = { ...process.env, NODE_ENV: 'test', LEDGERLY_DATA_DIRECTORY: directory };
  const run = (source) =>
    execFileSync(process.execPath, ['--input-type=module', '-e', source], {
      env,
      encoding: 'utf8',
    });
  run(
    "import {createDb} from './database.js'; const db=createDb(); db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('disk_probe',713); db.close();",
  );
  assert.equal(existsSync(join(directory, 'ledgerly.db')), true);
  assert.equal(
    run(
      "import {createDb} from './database.js'; const db=createDb(); console.log(db.prepare('SELECT value FROM settings WHERE key=?').get('disk_probe').value); db.close();",
    ).trim(),
    '713',
  );
});

test('the persistent data directory cannot expose private records as static files', () => {
  for (const directory of [resolve('public'), resolve('public/private')]) {
    assert.throws(() =>
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          "import {dataDirectory} from './storage.js'; dataDirectory();",
        ],
        { env: { ...process.env, LEDGERLY_DATA_DIRECTORY: directory }, stdio: 'pipe' },
      ),
    );
  }
});
