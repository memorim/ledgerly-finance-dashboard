// Browser-only adapter, loaded exclusively by scripts/build_demo.py.
// ponytail: state lasts for one page session; use the documented server for shared, durable data.
(() => {
  const state = structuredClone(globalThis.DEMO_SEED);
  const fail = (message, status = 400) => {
    throw Object.assign(new Error(message), { status });
  };
  const text = (value, min = 1, max = 200) => {
    if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max)
      fail('Проверьте введённые данные');
    return value.trim();
  };
  const json = (value, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input, globalThis.location.href);
    if (url.origin !== globalThis.location.origin || !url.pathname.startsWith('/api/'))
      return originalFetch(input, options);
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      return await handle(
        url,
        options.method || 'GET',
        options.body ? JSON.parse(options.body) : {},
        new Headers(options.headers),
      );
    } catch (error) {
      return json({ message: error.message, detail: error.message }, error.status || 400);
    }
  };
  globalThis.PORTFOLIO_DEMO = true;

  const settings = {
    goal: state['/api/summary'].cash.goal,
    opening: state['/api/summary'].cash.openingBalance,
  };
  const minor = (v) => {
    if (!Number.isFinite(v) || Math.abs(v) > 1e9 || !/^-?\d+(?:\.\d{1,2})?$/.test(String(v)))
      fail('Сумма: не более двух знаков после запятой и миллиарда рублей');
    return Math.round(v * 100);
  };
  function summary() {
    const rows = [
      ...state['/api/transactions'].map((t) => ({ ...t, date: t.occurred_on })),
      ...state['/api/invoices']
        .filter((i) => i.status === 'paid')
        .map((i) => ({ kind: 'income', amount_cents: i.amount_cents, date: i.paid_at })),
    ];
    const today = new Date().toISOString().slice(0, 10),
      quarter =
        today.slice(0, 5) +
        String(Math.floor(new Date().getUTCMonth() / 3) * 3 + 1).padStart(2, '0') +
        '-01';
    const months = Array.from({ length: 6 }, (_, i) =>
      new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 5 + i, 1))
        .toISOString()
        .slice(0, 7),
    );
    let income = 0,
      expenses = 0,
      quarterIncome = 0;
    const monthly = months.map((month) => ({ month, income: 0, expenses: 0 }));
    for (const row of rows) {
      if (row.date > today) continue;
      const bucket = monthly.find((x) => x.month === row.date?.slice(0, 7));
      if (row.kind === 'income') {
        income += row.amount_cents;
        if (row.date >= quarter) quarterIncome += row.amount_cents;
        if (bucket) bucket.income += row.amount_cents;
      } else {
        expenses += row.amount_cents;
        if (bucket) bucket.expenses += row.amount_cents;
      }
    }
    const previous = monthly.at(-2).income,
      current = monthly.at(-1).income;
    return {
      stats: {
        expected:
          state['/api/invoices']
            .filter((i) => ['sent', 'overdue'].includes(i.status))
            .reduce((n, i) => n + i.amount_cents, 0) / 100,
      },
      cash: {
        income: income / 100,
        expenses: expenses / 100,
        balance: (minor(settings.opening) + income - expenses) / 100,
        openingBalance: settings.opening,
        goal: settings.goal,
        quarterIncome: quarterIncome / 100,
        goalPercent: Math.min(100, Math.round((quarterIncome / minor(settings.goal)) * 100)),
        goalRemaining: Math.max(0, minor(settings.goal) - quarterIncome) / 100,
        growth: previous ? Math.round(((current - previous) / previous) * 1000) / 10 : null,
        monthly: monthly.map((x) => ({ ...x, income: x.income / 100, expenses: x.expenses / 100 })),
        undatedIncome: 0,
      },
    };
  }
  function transaction(body) {
    const amount_cents = minor(body.amount);
    if (amount_cents <= 0 || !['income', 'expense'].includes(body.kind))
      fail('Проверьте сумму и тип операции');
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(body.date) ||
      !Number.isFinite(Date.parse(body.date)) ||
      new Date(body.date).toISOString().slice(0, 10) !== body.date
    )
      fail('Проверьте дату');
    return {
      kind: body.kind,
      amount_cents,
      occurred_on: body.date,
      category: text(body.category, 1, 80),
      description: typeof body.description === 'string' ? body.description.slice(0, 500) : '',
    };
  }
  async function handle(url, method, body) {
    const path = url.pathname;
    if (path === '/api/summary') return json(summary());
    if (path === '/api/invoices' && method === 'GET') {
      const status = url.searchParams.get('status');
      return json(state[path].filter((x) => !status || status === 'all' || x.status === status));
    }
    if (path === '/api/transactions' && method === 'GET') return json(state[path]);
    if (path === '/api/transactions' && method === 'POST') {
      const row = { ...transaction(body), external_id: crypto.randomUUID(), version: 1 };
      if (state[path].length >= 1000) fail('До 1000 операций на сессию');
      state[path].unshift(row);
      return json(row, 201);
    }
    const match = path.match(/^\/api\/transactions\/([^/]+)$/);
    if (match && ['PATCH', 'DELETE'].includes(method)) {
      const rows = state['/api/transactions'],
        index = rows.findIndex((x) => x.external_id === match[1]);
      if (index < 0) fail('Операция не найдена', 404);
      if (rows[index].version !== body.version)
        fail('Операция уже изменена. Обновите страницу.', 409);
      if (method === 'DELETE') rows.splice(index, 1);
      else rows[index] = { ...rows[index], ...transaction(body), version: rows[index].version + 1 };
      return json({ ok: true });
    }
    if (path === '/api/settings' && method === 'PATCH') {
      minor(body.openingBalance);
      if (minor(body.goalAmount) <= 0) fail('Цель должна быть положительной');
      settings.goal = body.goalAmount;
      settings.opening = body.openingBalance;
      return json({ ok: true });
    }
    if (path === '/api/invoices' && method === 'POST') {
      const amount_cents = minor(body.amount);
      if (amount_cents <= 0) fail('Сумма должна быть положительной');
      const row = {
        id: crypto.randomUUID(),
        client: text(body.client, 2, 120),
        title: text(body.title, 3, 200),
        amount: body.amount,
        amount_cents,
        due_date: body.dueDate,
        status: 'sent',
        created_at: new Date().toISOString().slice(0, 10),
        paid_at: null,
      };
      state[path].push(row);
      return json(row, 201);
    }
    if (path === '/api/transactions/import')
      fail(
        'CSV-импорт доступен при локальном запуске серверной версии. Здесь можно добавить операцию вручную.',
        409,
      );
    fail('Маршрут доступен в серверной версии', 404);
  }
})();
