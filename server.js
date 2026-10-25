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
} from './finance.js';
import { MoneyRangeError, hasMinorUnitPrecision } from './money.js';

import { createDb } from './database.js';
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

export function createApp(db = createDb()) {
  const app = express();
  const revision = /^[a-f0-9]{40}$/i.test(process.env.APP_REVISION || '')
    ? process.env.APP_REVISION
    : 'local-unversioned';
  app.use('/api/health', (_req, res, next) => {
    res.set('X-App-Revision', revision);
    next();
  });

  app.use(operatorBoundary());
  app.use(express.json({ limit: '256kb' }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/summary', (_q, res) => {
    res.json({ ...invoiceSummary(db), cash: cashSummary(db) });
  });
  app.get('/api/invoices', (req, res) => {
    const status = String(req.query.status || '');
    const rows =
      status && status !== 'all'
        ? db.prepare('SELECT * FROM invoices WHERE status=? ORDER BY due_date').all(status)
        : db.prepare('SELECT * FROM invoices ORDER BY due_date').all();
    res.json(rows);
  });
  app.post('/api/invoices', (req, res) => {
    const parsed = invoiceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: 'Проверьте данные счёта' });
    const i = parsed.data,
      today = new Date().toISOString().slice(0, 10);
    const out = writeCashChange(db, () =>
      db
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
  app.patch('/api/invoices/:id/status', (req, res) => {
    const parsed = z
      .object({ status: z.enum(['draft', 'sent', 'paid', 'overdue']) })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: 'Неверный статус' });
    const out = writeCashChange(db, () =>
      db
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
  app.delete('/api/invoices/:id', (req, res) => {
    const out = writeCashChange(db, () =>
      db.prepare('DELETE FROM invoices WHERE id=?').run(Number(req.params.id)),
    );
    return out.changes
      ? res.status(204).end()
      : res.status(404).json({ message: 'Счёт не найден' });
  });
  app.get('/api/transactions', (_req, res) =>
    res.json(
      db
        .prepare(
          'SELECT * FROM transactions WHERE deleted_at IS NULL ORDER BY occurred_on DESC,id DESC LIMIT 100',
        )
        .all(),
    ),
  );
  app.post('/api/transactions', (req, res) => {
    const p = transactionSchema.safeParse(req.body);
    if (!p.success)
      return res.status(400).json({ message: 'Проверьте сумму, дату и категорию операции' });
    const t = p.data,
      id = randomUUID();
    writeCashChange(db, () =>
      db
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
  app.patch('/api/transactions/:id', (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const parsed = transactionSchema
      .extend({ version: z.number().int().positive() })
      .safeParse(req.body);
    if (!id.success || !parsed.success)
      return res.status(400).json({ message: 'Проверьте операцию и её версию' });
    const old = db
      .prepare('SELECT version,deleted_at FROM transactions WHERE external_id=?')
      .get(id.data);
    if (!old || old.deleted_at) return res.status(404).json({ message: 'Операция не найдена' });
    const { version, ...transaction } = parsed.data;
    const result = writeCashChange(db, () =>
      db
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
  app.delete('/api/transactions/:id', (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id),
      parsed = z.object({ version: z.number().int().positive() }).strict().safeParse(req.body);
    if (!id.success || !parsed.success)
      return res.status(400).json({ message: 'Укажите корректный id и версию операции' });
    const old = db
      .prepare('SELECT version,deleted_at FROM transactions WHERE external_id=?')
      .get(id.data);
    if (!old) return res.status(404).json({ message: 'Операция не найдена' });
    if (old.deleted_at) return res.status(204).end();
    const result = writeCashChange(db, () =>
      db
        .prepare(
          'UPDATE transactions SET deleted_at=?,version=version+1 WHERE external_id=? AND version=? AND deleted_at IS NULL',
        )
        .run(new Date().toISOString(), id.data, parsed.data.version),
    );
    if (
      !result.changes &&
      !db.prepare('SELECT deleted_at FROM transactions WHERE external_id=?').get(id.data)
        ?.deleted_at
    )
      return res
        .status(409)
        .json({ code: 'version_conflict', message: 'Операция уже изменена. Обновите список.' });
    res.status(204).end();
  });
  app.get('/api/transactions/export.csv', (_req, res) => {
    const rows = db
      .prepare(
        'SELECT * FROM transactions WHERE deleted_at IS NULL ORDER BY occurred_on,id LIMIT 1001',
      )
      .all();
    if (rows.length > 1000)
      return res.status(413).json({ message: 'Один CSV содержит до 1000 операций' });
    res
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="ledgerly-transactions.csv"',
      })
      .send(exportCsv(rows));
  });
  app.post('/api/transactions/import', (req, res) => {
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
    db.exec('BEGIN IMMEDIATE');
    try {
      const previous = db.prepare('SELECT added FROM csv_imports WHERE hash=?').get(hash);
      if (previous) {
        db.exec('ROLLBACK');
        return res.json({ added: previous.added, replayed: true });
      }
      const insert = db.prepare(
        'INSERT INTO transactions(external_id,kind,amount_cents,occurred_on,category,description,created_at) VALUES(?,?,?,?,?,?,?)',
      );
      for (const row of rows) {
        const id = row.id || randomUUID(),
          old = db.prepare('SELECT * FROM transactions WHERE external_id=?').get(id);
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
        insert.run(
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
      db.prepare('INSERT INTO csv_imports VALUES(?,?,?)').run(
        hash,
        added,
        new Date().toISOString(),
      );
      invoiceSummary(db);
      cashSummary(db);
      db.exec('COMMIT');
      res.json({ added, replayed: false });
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
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
  app.patch('/api/settings', (req, res) => {
    const p = z
      .object({
        goalAmount: moneyValue,
        openingBalance: z.number().finite().min(-1e9).max(1e9).refine(hasMinorUnitPrecision),
      })
      .strict()
      .safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: 'Проверьте цель и начальный остаток' });
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("UPDATE settings SET value=? WHERE key='goal_cents'").run(
        cents(p.data.goalAmount),
      );
      db.prepare("UPDATE settings SET value=? WHERE key='opening_balance_cents'").run(
        cents(p.data.openingBalance),
      );
      invoiceSummary(db);
      cashSummary(db);
      db.exec('COMMIT');
      res.json({ ok: true });
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  });
  app.use(express.static(resolve(root, 'public')));
  app.get(/^(?!\/api).*/, (_q, res) => res.sendFile(resolve(root, 'public', 'index.html')));
  app.use((error, _req, res, _next) => {
    const status =
      error instanceof MoneyRangeError
        ? 409
        : error?.type === 'entity.too.large'
          ? 413
          : error instanceof SyntaxError
            ? 400
            : 503;
    if (status === 503) console.error({ event: 'request_error', error: String(error) });
    res.status(status).json({
      message: error instanceof MoneyRangeError ? error.message : 'Не удалось обработать запрос',
    });
  });
  return app;
}
if (process.env.NODE_ENV !== 'test')
  createApp().listen(process.env.PORT || 4300, process.env.HOST || '127.0.0.1', () =>
    console.log('Ledgerly: http://localhost:4300'),
  );
