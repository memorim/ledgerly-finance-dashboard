import { MAX_ENTRY_CENTS, MoneyRangeError, moneyNumber } from './money.js';
export { moneyValue, dateValue, transactionSchema, cents } from './money.js';
export { parseCsv, exportCsv, importedRows } from './csv.js';

export function calculateCash(rows, { opening = 0n, goal = 100000000n } = {}, now = new Date()) {
  opening = BigInt(opening);
  goal = BigInt(goal);
  if (
    goal <= 0n ||
    goal > MAX_ENTRY_CENTS ||
    opening > MAX_ENTRY_CENTS ||
    opening < -MAX_ENTRY_CENTS
  )
    throw new MoneyRangeError();
  const today = now.toISOString().slice(0, 10);
  const quarter =
    today.slice(0, 5) + String(Math.floor(now.getUTCMonth() / 3) * 3 + 1).padStart(2, '0') + '-01';
  const buckets = new Map(
    Array.from({ length: 6 }, (_, index) => [
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + index, 1))
        .toISOString()
        .slice(0, 7),
      { income: 0n, expenses: 0n },
    ]),
  );
  let income = 0n,
    expenses = 0n,
    quarterIncome = 0n,
    undatedIncome = 0n;
  let allIncome = 0n,
    allExpenses = 0n;
  for (const row of rows) {
    const amount = BigInt(row.amount_cents);
    if (amount <= 0n || amount > MAX_ENTRY_CENTS || !['income', 'expense'].includes(row.kind))
      throw new MoneyRangeError();
    if (row.kind === 'income') allIncome += amount;
    else allExpenses += amount;
    if (row.date && row.date > today) continue;
    const isIncome = row.kind === 'income';
    if (isIncome) {
      income += amount;
      if (!row.date) undatedIncome += amount;
      else if (row.date >= quarter) quarterIncome += amount;
    } else expenses += amount;
    const bucket = buckets.get(row.date?.slice(0, 7));
    if (bucket) {
      if (isIncome) bucket.income += amount;
      else bucket.expenses += amount;
    }
  }
  // Include future entries in range validation so a date change cannot overflow the cash API.
  moneyNumber(allIncome);
  moneyNumber(allExpenses);
  moneyNumber(opening + allIncome);
  moneyNumber(opening - allExpenses);
  const monthly = Array.from(buckets, ([month, totals]) => ({
    month,
    income: moneyNumber(totals.income),
    expenses: moneyNumber(totals.expenses),
  }));
  const current = monthly.at(-1).income,
    previous = monthly.at(-2).income;
  return {
    income: moneyNumber(income),
    expenses: moneyNumber(expenses),
    balance: moneyNumber(opening + income - expenses),
    openingBalance: moneyNumber(opening),
    goal: moneyNumber(goal),
    quarterIncome: moneyNumber(quarterIncome),
    goalPercent: Number(quarterIncome >= goal ? 100n : (quarterIncome * 100n + goal / 2n) / goal),
    goalRemaining: moneyNumber(quarterIncome >= goal ? 0n : goal - quarterIncome),
    growth: previous ? Math.round(((current - previous) / previous) * 1000) / 10 : null,
    monthly,
    undatedIncome: moneyNumber(undatedIncome),
  };
}

export function cashSummary(db, now = new Date()) {
  const paymentQuery = db.prepare(
    "SELECT paid_at date,amount_cents,'income' kind FROM invoices WHERE status='paid'",
  );
  paymentQuery.setReadBigInts(true);
  const transactionQuery = db.prepare(
    'SELECT occurred_on date,amount_cents,kind FROM transactions WHERE deleted_at IS NULL',
  );
  transactionQuery.setReadBigInts(true);
  const settingQuery = db.prepare('SELECT key,value FROM settings');
  settingQuery.setReadBigInts(true);
  const settings = Object.fromEntries(settingQuery.all().map((row) => [row.key, row.value]));
  return calculateCash(
    [...paymentQuery.all(), ...transactionQuery.all()],
    { opening: settings.opening_balance_cents, goal: settings.goal_cents },
    now,
  );
}

export function invoiceSummary(db) {
  const query = db.prepare('SELECT amount_cents,status,substr(created_at,1,7) month FROM invoices');
  query.setReadBigInts(true);
  const invoices = query.all(),
    months = new Map();
  let total = 0n,
    paid = 0n,
    expected = 0n;
  for (const invoice of invoices) {
    const amount = BigInt(invoice.amount_cents);
    if (amount <= 0n || amount > MAX_ENTRY_CENTS) throw new MoneyRangeError();
    total += amount;
    if (invoice.status === 'paid') paid += amount;
    if (['sent', 'overdue'].includes(invoice.status)) expected += amount;
    months.set(invoice.month, (months.get(invoice.month) || 0n) + amount);
  }
  return {
    stats: {
      total: moneyNumber(total),
      paid: moneyNumber(paid),
      expected: moneyNumber(expected),
      invoices: invoices.length,
    },
    monthly: Array.from(months, ([month, amount]) => ({ month, amount: moneyNumber(amount) })).sort(
      (a, b) => a.month.localeCompare(b.month),
    ),
  };
}

export function writeCashChange(db, change) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = change();
    // Keep the API's monetary range invariant in the same write transaction as every balance-changing mutation.
    invoiceSummary(db);
    cashSummary(db);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
