import express from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';

// Each provisioned account owns a separate database. No caller-supplied tenant IDs.
export function createHostedApp({ createDb, createApp, origin, accounts, directory }) {
  const parsed = new URL(origin);
  if (
    parsed.protocol !== 'https:' ||
    parsed.origin !== origin ||
    parsed.username ||
    parsed.password
  )
    throw new Error('APP_PUBLIC_ORIGIN must be an HTTPS origin without a trailing slash');
  const entries = Object.entries(accounts);
  if (
    !entries.length ||
    entries.length > 100 ||
    entries.some(
      ([user, hash]) => !/^[a-zA-Z0-9_-]{1,64}$/.test(user) || !/^[a-f0-9]{64}$/.test(hash),
    )
  )
    throw new Error('Provision 1–100 accounts with SHA-256 hashes of random access secrets');
  const hashes = new Map(entries.map(([u, h]) => [u, Buffer.from(h, 'hex')]));
  const applications = new Map(),
    databases = [];
  const app = express();
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.get('host') !== parsed.host)
      return res.status(403).json({ message: 'Host not allowed' });
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      (req.get('sec-fetch-site') === 'cross-site' ||
        (req.get('origin') && req.get('origin') !== origin))
    )
      return res.status(403).json({ message: 'Origin not allowed' });
    const header = req.get('authorization') || '';
    let user = '',
      password = '';
    if (header.startsWith('Basic ') && header.length <= 1024) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'),
        colon = decoded.indexOf(':');
      if (colon > 0) {
        user = decoded.slice(0, colon);
        password = decoded.slice(colon + 1);
      }
    }
    const expected = hashes.get(user) || Buffer.alloc(32);
    const valid = timingSafeEqual(createHash('sha256').update(password).digest(), expected);
    if (!hashes.has(user) || password.length < 32 || !valid)
      return res
        .set('WWW-Authenticate', 'Basic realm="Private account", charset="UTF-8"')
        .status(401)
        .json({ message: 'Authentication required' });
    if (!applications.has(user)) {
      const file = resolve(directory, createHash('sha256').update(user).digest('hex') + '.db');
      const db = createDb(file);
      databases.push(db);
      applications.set(user, createApp(db, { authenticatedOrigin: origin }));
    }
    applications.get(user)(req, res, next);
  });
  app.closeAccounts = () => {
    databases.forEach((db) => db.close());
    applications.clear();
    databases.length = 0;
  };
  return app;
}
