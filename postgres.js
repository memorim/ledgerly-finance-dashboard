import pg from 'pg';
import Cursor from 'pg-cursor';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const pools = new Map();
export function accountSchema(user) {
  return (
    'ledgerly_' +
    createHash('sha256')
      .update(user === undefined ? 'local-operator' : 'account:' + user)
      .digest('hex')
      .slice(0, 32)
  );
}

export function postgresConfig(connectionString) {
  const url = new URL(connectionString);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    !url.pathname.slice(1)
  )
    throw new Error('Configure a PostgreSQL DATABASE_URL');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!local && url.searchParams.get('sslmode') !== 'verify-full')
    throw new Error('Remote PostgreSQL requires sslmode=verify-full');
  return {
    connectionString,
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    application_name: 'ledgerly',
    statement_timeout: 15000,
    idle_in_transaction_session_timeout: 20000,
  };
}

export function postgresSql(source, values = [], schema) {
  let index = 0;
  const text = source.replace(
    /'(?:''|[^'])*'|"(?:""|[^"])*"|\?|\b(?:invoices|transactions|settings|csv_imports)\b/g,
    (token) => {
      if (token !== '?')
        return schema && !/^["']/.test(token) ? '"' + schema + '".' + token : token;
      return '$' + ++index;
    },
  );
  if (index !== values.length) throw new Error('SQL binding count mismatch');
  return { text, values };
}

function rowsOf(result, bigints) {
  return result.rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => {
        const field = result.fields.find((field) => field.name === key);
        if (value !== null && [20, 21, 23].includes(field?.dataTypeID)) {
          if (bigints) return [key, BigInt(value)];
          const number = Number(value);
          if (!Number.isSafeInteger(number))
            throw new Error('Database integer exceeds the API range');
          return [key, number];
        }
        return [key, value];
      }),
    ),
  );
}

export async function createPostgresDb(connectionString, schema, { seed } = {}) {
  if (!/^ledgerly_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid account schema');
  const configuration = postgresConfig(connectionString);
  if (!pools.has(connectionString)) {
    const pool = new pg.Pool(configuration);
    pool.on('error', () => console.error({ event: 'database_pool', status: 'unavailable' }));
    pools.set(connectionString, { pool, references: 0 });
  }
  const shared = pools.get(connectionString),
    pool = shared.pool;
  shared.references++;
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    if (--shared.references === 0) {
      pools.delete(connectionString);
      await pool.end();
    }
  }
  const context = new AsyncLocalStorage();
  async function transaction(operation) {
    if (closed) throw new Error('Database is closed');
    if (context.getStore()) return operation();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL search_path TO "' + schema + '"');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [schema]);
      const result = await context.run(client, operation);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  const store = {
    dialect: 'postgres',
    initialized: false,
    transaction,
    close,
    prepare(source) {
      let bigints = false;
      const execute = async (values, returning = false) => {
        if (closed) throw new Error('Database is closed');
        const query = postgresSql(source, values, schema);
        if (returning && /^\s*INSERT INTO (invoices|transactions)\b/i.test(source))
          query.text += ' RETURNING id';
        return (context.getStore() || pool).query(query);
      };
      return {
        setReadBigInts(enabled) {
          bigints = enabled;
        },
        async all(...values) {
          return rowsOf(await execute(values), bigints);
        },
        async get(...values) {
          return rowsOf(await execute(values), bigints)[0];
        },
        async run(...values) {
          const result = await execute(values, true);
          return { changes: result.rowCount, lastInsertRowid: result.rows[0]?.id };
        },
        async *iterate(...values) {
          const client = await pool.connect();
          let cursor;
          try {
            if (closed) throw new Error('Database is closed');
            const query = postgresSql(source, values, schema);
            cursor = client.query(new Cursor(query.text, query.values));
            for (;;) {
              const rows = await cursor.read(100);
              if (!rows.length) break;
              yield* rows;
            }
          } finally {
            try {
              if (cursor) await cursor.close();
            } finally {
              client.release();
            }
          }
        },
      };
    },
  };
  try {
    await transaction(async () => {
      const client = context.getStore();
      await client.query('CREATE SCHEMA IF NOT EXISTS "' + schema + '"');
      await client.query(
        'CREATE TABLE IF NOT EXISTS schema_migrations(version int PRIMARY KEY, checksum text NOT NULL)',
      );
      const sql = readFileSync(new URL('./postgres-schema.sql', import.meta.url), 'utf8');
      const checksum = createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex');
      const previous = await client.query('SELECT checksum FROM schema_migrations WHERE version=1');
      if (previous.rows[0]) {
        if (previous.rows[0].checksum !== checksum)
          throw new Error('Applied PostgreSQL migration checksum mismatch');
        return;
      }
      await client.query(sql);
      if (seed) {
        const snapshot = seed();
        try {
          for (const table of ['invoices', 'transactions', 'settings', 'csv_imports']) {
            const key = table === 'settings' ? 'key' : table === 'csv_imports' ? 'hash' : 'id';
            const original = snapshot.prepare('SELECT * FROM ' + table + ' ORDER BY ' + key).all();
            for (const row of original) {
              const columns = Object.keys(row);
              await client.query(
                'INSERT INTO ' +
                  table +
                  '(' +
                  columns.map((column) => '"' + column.replaceAll('"', '""') + '"').join(',') +
                  ') VALUES(' +
                  columns.map((_, i) => '$' + (i + 1)).join(',') +
                  ')',
                Object.values(row),
              );
            }
            const restored = rowsOf(
              await client.query('SELECT * FROM ' + table + ' ORDER BY ' + key),
              false,
            );
            const canonical = (rows) =>
              JSON.stringify(
                rows.map((row) => Object.entries(row).sort(([a], [b]) => a.localeCompare(b))),
              );
            if (canonical(original) !== canonical(restored))
              throw new Error('PostgreSQL import verification failed');
          }
          for (const table of ['invoices', 'transactions'])
            await client.query(
              "SELECT setval(pg_get_serial_sequence($1,'id'),coalesce((SELECT max(id) FROM " +
                table +
                '),1),EXISTS(SELECT 1 FROM ' +
                table +
                '))',
              [table],
            );
        } finally {
          snapshot.close();
        }
      }
      await client.query('INSERT INTO schema_migrations VALUES(1,$1)', [checksum]);
      store.initialized = true;
    });
    return store;
  } catch (error) {
    await close();
    throw error;
  }
}
