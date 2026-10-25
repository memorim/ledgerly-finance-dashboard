import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const root = dirname(fileURLToPath(import.meta.url));

export function createDb(filename = resolve(root, 'data', 'ledgerly.db')) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  try {
    db.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000;PRAGMA journal_mode=WAL;');
    db.exec('BEGIN IMMEDIATE');
    const fresh = !db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='invoices'")
      .get();
    db.exec(
      `CREATE TABLE IF NOT EXISTS invoices(id INTEGER PRIMARY KEY AUTOINCREMENT,client TEXT NOT NULL,title TEXT NOT NULL,amount REAL NOT NULL,due_date TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);`,
    );
    if (fresh)
      db.exec(`INSERT INTO invoices(client,title,amount,due_date,status,created_at) VALUES
  ('Morrow Studio','Разработка лендинга',145000,'2026-07-09','paid','2026-06-18'),
  ('Nova Labs','Дизайн-система продукта',218000,'2026-07-12','sent','2026-06-24'),
  ('Forma Group','Интеграция CRM',96000,'2026-07-03','overdue','2026-06-12'),
  ('Locus Travel','Поддержка платформы',72000,'2026-07-21','draft','2026-07-02'),
  ('Arka Bureau','Корпоративный сайт',187500,'2026-07-17','sent','2026-06-29');`);
    if (
      !db
        .prepare('PRAGMA table_info(invoices)')
        .all()
        .some((c) => c.name === 'paid_at')
    )
      db.exec('ALTER TABLE invoices ADD COLUMN paid_at TEXT;');
    db.exec(
      `CREATE TABLE IF NOT EXISTS transactions(id INTEGER PRIMARY KEY AUTOINCREMENT,external_id TEXT NOT NULL UNIQUE,kind TEXT NOT NULL CHECK(kind IN ('income','expense')),amount_cents INTEGER NOT NULL CHECK(amount_cents>0),occurred_on TEXT NOT NULL,category TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);CREATE INDEX IF NOT EXISTS transactions_date ON transactions(occurred_on,id);CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value INTEGER NOT NULL);INSERT OR IGNORE INTO settings VALUES('opening_balance_cents',0),('goal_cents',100000000);CREATE TABLE IF NOT EXISTS csv_imports(hash TEXT PRIMARY KEY,added INTEGER NOT NULL,created_at TEXT NOT NULL);PRAGMA user_version=1;`,
    );
    if (fresh) {
      db.prepare("UPDATE invoices SET paid_at='2026-06-20' WHERE status='paid'").run();
      const add = db.prepare(
        'INSERT INTO transactions(external_id,kind,amount_cents,occurred_on,category,description,created_at) VALUES(?,?,?,?,?,?,?)',
      );
      for (let i = 5; i >= 0; i--) {
        const date = new Date(
          Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - i, 5),
        )
          .toISOString()
          .slice(0, 10);
        add.run(
          randomUUID(),
          'income',
          (40000 + i * 5000) * 100,
          date,
          'Проекты',
          'Поступление по проекту',
          new Date().toISOString(),
        );
        add.run(
          randomUUID(),
          'expense',
          (12000 + i * 1000) * 100,
          date,
          'Инструменты',
          'Расходы на инструменты',
          new Date().toISOString(),
        );
      }
    }
    migrateMoneySchema(db);
    db.exec('COMMIT');
    return db;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    db.close();
    throw error;
  }
}

function migrateMoneySchema(db) {
  const invoiceColumns = new Set(
    db
      .prepare('PRAGMA table_info(invoices)')
      .all()
      .map((column) => column.name),
  );
  if (!invoiceColumns.has('amount_cents'))
    db.exec('ALTER TABLE invoices ADD COLUMN amount_cents INTEGER');
  const update = db.prepare('UPDATE invoices SET amount_cents=? WHERE id=?');
  for (const row of db.prepare('SELECT id,amount FROM invoices WHERE amount_cents IS NULL').all()) {
    // Legacy input accepted tiny binary rounding residues; preserve the old column and round once into minor units.
    const amount = Math.round(row.amount * 100);
    if (
      !Number.isFinite(row.amount) ||
      row.amount <= 0 ||
      row.amount > 1e9 ||
      !Number.isSafeInteger(amount) ||
      Math.abs(row.amount * 100 - amount) >= 1e-6
    )
      throw new Error(
        'An invoice cannot be migrated to exact minor units; the original database is unchanged',
      );
    update.run(amount, row.id);
  }
  const transactionColumns = new Set(
    db
      .prepare('PRAGMA table_info(transactions)')
      .all()
      .map((column) => column.name),
  );
  if (!transactionColumns.has('version'))
    db.exec('ALTER TABLE transactions ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
  if (!transactionColumns.has('deleted_at'))
    db.exec('ALTER TABLE transactions ADD COLUMN deleted_at TEXT');
  db.exec(readFileSync(new URL('./money-constraints.sql', import.meta.url), 'utf8'));
  db.exec('PRAGMA user_version=2');
}
