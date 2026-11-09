CREATE TABLE invoices (
  id BIGSERIAL PRIMARY KEY,
  client TEXT NOT NULL, title TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  due_date TEXT NOT NULL CHECK (due_date ~ '^\d{4}-\d{2}-\d{2}$' AND due_date::date::text = due_date),
  status TEXT NOT NULL CHECK (status IN ('draft','sent','paid','overdue')),
  created_at TEXT NOT NULL, paid_at TEXT,
  amount_cents BIGINT NOT NULL CHECK (amount_cents BETWEEN 1 AND 100000000000),
  CHECK (round((amount*100)::numeric) = amount_cents)
);
CREATE TABLE transactions (
  id BIGSERIAL PRIMARY KEY,
  external_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('income','expense')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents BETWEEN 1 AND 100000000000),
  occurred_on TEXT NOT NULL CHECK (occurred_on ~ '^\d{4}-\d{2}-\d{2}$' AND occurred_on::date::text = occurred_on),
  category TEXT NOT NULL CHECK (length(trim(category)) BETWEEN 1 AND 80),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  created_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0), deleted_at TEXT
);
CREATE INDEX transactions_date ON transactions(occurred_on,id);
CREATE TABLE settings(key TEXT PRIMARY KEY,value BIGINT NOT NULL);
CREATE TABLE csv_imports(hash TEXT PRIMARY KEY,added INTEGER NOT NULL,created_at TEXT NOT NULL);
