import { createHostedApp } from './hosted.js';
import { operatorBoundary } from './request-policy.js';
import express from 'express';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import {
  moneyValue,
  dateValue,
  transactionSchema,
  cents,
  cashSummary,
  invoiceSummary,
  writeCashChange,
  exportCsv,
  importedRows,
  databaseTransaction,
} from './finance.js';
import { MoneyRangeError, hasMinorUnitPrecision } from './money.js';

import { createDb } from './database.js';
import { dataDirectory } from './storage.js';
import { accountSchema, createPostgresDb } from './postgres.js';
export { createDb } from './database.js';
const root = dirname(fileURLToPath(import.meta.url));
const invoiceSchema = z
  .object({
    client: z.string().trim().min(2).max(120),
    title: z.string().trim().min(3).max(200),
    amount: moneyValue,
    dueDate: dateValue,
    status: z.enum(['draft', 'sent', 'paid', 'overdue']),
  })
  .strict();

export function createApp(db = createDb(), { authenticatedOrigin } = {}) {
  const app = express();
  const configuredRevision =
    process.env.RENDER === 'true' ? process.env.RENDER_GIT_COMMIT : process.env.APP_REVISION;
  const revision = /^[a-f0-9]{40}$/i.test(configuredRevision || '')
    ? configuredRevision
    : 'local-unversioned';
  app.use('/api/health', (_req, res, next) => {
    res.set('X-App-Revision', revision);
    next();
  });

  app.use(
    operatorBoundary(
      authenticatedOrigin
        ? { ...process.env, APP_PUBLIC_ORIGIN: authenticatedOrigin }
        : process.env,
    ),
  );
  app.use(express.json({ limit: '256kb' }));
  app.get('/api/health', async (_req, res) => {
    await db.prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  });
  app.get('/api/summary', async (_q, res) => {
    res.json(
      await databaseTransaction(db, async () => ({
        ...(await invoiceSummary(db)),
        cash: await cashSummary(db),
      })),
    );
  });
  app.get('/api/invoices', async (req, res) => {
    const status = String(req.query.status || '');
    const rows =
      status && status !== 'all'
        ? await db.prepare('SELECT * FROM invoices WHERE status=? ORDER BY due_date').all(status)
        : await db.prepare('SELECT * FROM invoices ORDER BY due_date').all();
    res.json(rows);
  });
  app.post('/api/invoices', async (req, res) => {
    const parsed = invoiceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: 'Проверьте данные счёта' });
    const i = parsed.data,
      today = new Date().toISOString().slice(0, 10);
    const out = await writeCashChange(
      db,
      async () =>
        await db
          .prepare(
            'INSERT INTO invoices(client,title,amount,due_date,status,created_at,paid_at,amount_cents) VALUES(?,?,?,?,?,?,?,?)',
          )
          .run(
            i.client,
            i.title,
            i.amount,
            i.dueDate,
            i.status,
            today,
            i.status === 'paid' ? today : null,
            cents(i.amount),
          ),
    );
    res.status(201).json({ id: Number(out.lastInsertRowid), ...i });
  });
  app.patch('/api/invoices/:id/status', async (req, res) => {
    const parsed = z
      .object({ status: z.enum(['draft', 'sent', 'paid', 'overdue']) })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: 'Неверный статус' });
    const out = await writeCashChange(
      db,
      async () =>
        await db
          .prepare(
            "UPDATE invoices SET status=?,paid_at=CASE WHEN ?='paid' THEN COALESCE(paid_at,?) ELSE NULL END WHERE id=?",
          )
          .run(
            parsed.data.status,
            parsed.data.status,
            new Date().toISOString().slice(0, 10),
            Number(req.params.id),
          ),
    );
    if (!out.changes) return res.status(404).json({ message: 'Счёт не найден' });
    res.json({ ok: true });
  });
  app.delete('/api/invoices/:id', async (req, res) => {
    const out = await writeCashChange(
      db,
      async () => await db.prepare('DELETE FROM invoices WHERE id=?').run(Number(req.params.id)),
    );
    return out.changes
      ? res.status(204).end()
      : res.status(404).json({ message: 'Счёт не найден' });
  });
  app.get('/api/transactions', async (req, res) => {
    const parsed = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(100),
        offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
      })
      .strict()
      .safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: 'Проверьте параметры страницы' });
    const { limit, offset } = parsed.data;
    const total = (
      await db.prepare('SELECT count(*) n FROM transactions WHERE deleted_at IS NULL').get()
    ).n;
    res.set('X-Total-Count', String(total));
    res.json(
      await db
        .prepare(
          'SELECT * FROM transactions WHERE deleted_at IS NULL ORDER BY occurred_on DESC,id DESC LIMIT ? OFFSET ?',
        )
        .all(limit, offset),
    );
  });
  app.post('/api/transactions', async (req, res) => {
    const p = transactionSchema.safeParse(req.body);
    if (!p.success)
      return res.status(400).json({ message: 'Проверьте сумму, дату и категорию операции' });
    const t = p.data,
      id = randomUUID();
    await writeCashChange(
      db,
      async () =>
        await db
          .prepare(
            'INSERT INTO transactions(external_id,kind,amount_cents,occurred_on,category,description,created_at) VALUES(?,?,?,?,?,?,?)',
          )
          .run(
            id,
            t.kind,
            cents(t.amount),
            t.date,
            t.category,
            t.description,
            new Date().toISOString(),
          ),
    );
    res.status(201).json({ id, ...t, version: 1 });
  });
  app.patch('/api/transactions/:id', async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const parsed = transactionSchema
      .extend({ version: z.number().int().positive() })
      .safeParse(req.body);
    if (!id.success || !parsed.success)
      return res.status(400).json({ message: 'Проверьте операцию и её версию' });
    const old = await db
      .prepare('SELECT version,deleted_at FROM transactions WHERE external_id=?')
      .get(id.data);
    if (!old || old.deleted_at) return res.status(404).json({ message: 'Операция не найдена' });
    const { version, ...transaction } = parsed.data;
    const result = await writeCashChange(
      db,
      async () =>
        await db
          .prepare(
            'UPDATE transactions SET kind=?,amount_cents=?,occurred_on=?,category=?,description=?,version=version+1 WHERE external_id=? AND version=? AND deleted_at IS NULL',
          )
          .run(
            transaction.kind,
            cents(transaction.amount),
            transaction.date,
            transaction.category,
            transaction.description,
            id.data,
            version,
          ),
    );
    if (!result.changes)
      return res.status(409).json({
        code: 'version_conflict',
        message:
          'Операция уже изменена. Обновите список; введённые данные можно сохранить в форме.',
      });
    res.json({ id: id.data, ...transaction, version: version + 1 });
  });
  app.delete('/api/transactions/:id', async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id),
      parsed = z.object({ version: z.number().int().positive() }).strict().safeParse(req.body);
    if (!id.success || !parsed.success)
      return res.status(400).json({ message: 'Укажите корректный id и версию операции' });
    const old = await db
      .prepare('SELECT version,deleted_at FROM transactions WHERE external_id=?')
      .get(id.data);
    if (!old) return res.status(404).json({ message: 'Операция не найдена' });
    if (old.deleted_at) return res.status(204).end();
    const result = await writeCashChange(
      db,
      async () =>
        await db
          .prepare(
            'UPDATE transactions SET deleted_at=?,version=version+1 WHERE external_id=? AND version=? AND deleted_at IS NULL',
          )
          .run(new Date().toISOString(), id.data, parsed.data.version),
    );
    if (
      !result.changes &&
      !(await db.prepare('SELECT deleted_at FROM transactions WHERE external_id=?').get(id.data))
        ?.deleted_at
    )
      return res
        .status(409)
        .json({ code: 'version_conflict', message: 'Операция уже изменена. Обновите список.' });
    res.status(204).end();
  });
  app.get('/api/transactions/export.csv', async (req, res, next) => {
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="ledgerly-transactions.csv"',
    });
    try {
      res.write(exportCsv([]));
      // Iterate one row at a time and respect backpressure; never truncate the export.
      for await (const row of db
        .prepare('SELECT * FROM transactions WHERE deleted_at IS NULL ORDER BY occurred_on,id')
        .iterate()) {
        if (res.destroyed) break;
        const line = exportCsv([row]).split('\r\n').slice(1).join('\r\n');
        if (!res.write(line)) {
          await new Promise((resolve) => {
            const done = () => {
              res.off('drain', done);
              res.off('close', done);
              resolve();
            };
            res.once('drain', done);
            res.once('close', done);
          });
        }
      }
      res.end();
    } catch (error) {
      if (res.headersSent) res.destroy();
      else next(error);
    }
  });
  app.post('/api/transactions/import', async (req, res) => {
    const p = z
      .object({ csv: z.string().min(1).max(200000) })
      .strict()
      .safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: 'Передайте CSV до 200 000 символов' });
    let rows;
    try {
      rows = importedRows(p.data.csv);
    } catch {
      return res.status(400).json({
        message:
          'Проверьте CSV: id,kind,amount,date,category,description; максимум 1000 операций; корректные даты и суммы.',
      });
    }
    const hash = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    let added = 0;
    try {
      const result = await databaseTransaction(db, async () => {
        const previous = await db.prepare('SELECT added FROM csv_imports WHERE hash=?').get(hash);
        if (previous) {
          return { added: previous.added, replayed: true };
        }
        const insert = db.prepare(
          'INSERT INTO transactions(external_id,kind,amount_cents,occurred_on,category,description,created_at) VALUES(?,?,?,?,?,?,?)',
        );
        for (const row of rows) {
          const id = row.id || randomUUID(),
            old = await db.prepare('SELECT * FROM transactions WHERE external_id=?').get(id);
          if (old) {
            if (
              old.kind !== row.kind ||
              old.amount_cents !== cents(row.amount) ||
              old.occurred_on !== row.date ||
              old.category !== row.category ||
              old.description !== row.description ||
              old.deleted_at !== null
            )
              throw new Error('conflict');
            continue;
          }
          await insert.run(
            id,
            row.kind,
            cents(row.amount),
            row.date,
            row.category,
            row.description,
            new Date().toISOString(),
          );
          added++;
        }
        await db
          .prepare('INSERT INTO csv_imports VALUES(?,?,?)')
          .run(hash, added, new Date().toISOString());
        await invoiceSummary(db);
        await cashSummary(db);
        return { added, replayed: false };
      });
      res.json(result);
    } catch (error) {
      return res
        .status(error.message === 'conflict' || error instanceof MoneyRangeError ? 409 : 503)
        .json({
          message:
            error instanceof MoneyRangeError
              ? error.message
              : error.message === 'conflict'
                ? 'Операция с этим id уже содержит другие данные. CSV не импортирован.'
                : 'Импорт не выполнен; исходные операции сохранены.',
        });
    }
  });
  app.patch('/api/settings', async (req, res) => {
    const p = z
      .object({
        goalAmount: moneyValue,
        openingBalance: z.number().finite().min(-1e9).max(1e9).refine(hasMinorUnitPrecision),
      })
      .strict()
      .safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: 'Проверьте цель и начальный остаток' });
    await databaseTransaction(db, async () => {
      await db
        .prepare("UPDATE settings SET value=? WHERE key='goal_cents'")
        .run(cents(p.data.goalAmount));
      await db
        .prepare("UPDATE settings SET value=? WHERE key='opening_balance_cents'")
        .run(cents(p.data.openingBalance));
      await invoiceSummary(db);
      await cashSummary(db);
    });
    res.json({ ok: true });
  });
  app.use(express.static(resolve(root, 'public')));
  app.get(/^(?!\/api).*/, async (_q, res) => res.sendFile(resolve(root, 'public', 'index.html')));
  app.use((error, _req, res, _next) => {
    const status =
      error instanceof MoneyRangeError
        ? 409
        : error?.type === 'entity.too.large'
          ? 413
          : error instanceof SyntaxError
            ? 400
            : 503;
    if (status === 503)
      console.error({
        event: 'request_error',
        error: db.dialect === 'postgres' ? 'database_error' : String(error),
      });
    res.status(status).json({
      message: error instanceof MoneyRangeError ? error.message : 'Не удалось обработать запрос',
    });
  });
  app.closeStorage = () => db.close();
  return app;
}
if (process.env.NODE_ENV !== 'test') {
  if (process.env.APP_PUBLIC_ORIGIN && !process.env.APP_ACCOUNTS)
    throw new Error('Public access requires APP_ACCOUNTS');
  const app = process.env.APP_ACCOUNTS
    ? createHostedApp({
        createDb: process.env.DATABASE_URL
          ? (_file, user) =>
              createPostgresDb(process.env.DATABASE_URL, accountSchema(user), {
                seed: () => createDb(':memory:'),
              })
          : createDb,
        createApp,
        origin: process.env.APP_PUBLIC_ORIGIN,
        accounts: JSON.parse(process.env.APP_ACCOUNTS),
        directory: resolve(dataDirectory(), 'accounts'),
      })
    : createApp(
        process.env.DATABASE_URL
          ? await createPostgresDb(process.env.DATABASE_URL, accountSchema(), {
              seed: () => createDb(':memory:'),
            })
          : createDb(),
      );
  if (process.env.DATABASE_URL && app.readyAccounts) await app.readyAccounts();
  const server = app.listen(process.env.PORT || 4300, process.env.HOST || '127.0.0.1');
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, async () => {
      if (closing) return;
      closing = true;
      await new Promise((resolve) => server.close(resolve));
      if (app.closeAccounts) await app.closeAccounts();
      else await app.closeStorage();
    });
}
