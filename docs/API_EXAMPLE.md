# Пример API

Ответ локальной базы. Значения зависят от сохранённых операций и текущего месяца.

```http
GET /api/summary
```

```json
{
  "stats": {
    "total": 718500,
    "paid": 145000,
    "expected": 501500,
    "invoices": 5
  },
  "monthly": [
    {
      "month": "2026-06",
      "amount": 646500
    },
    {
      "month": "2026-07",
      "amount": 72000
    }
  ],
  "cash": {
    "income": 460000,
    "expenses": 87000,
    "balance": 373000,
    "openingBalance": 0,
    "goal": 1000000,
    "quarterIncome": 40000,
    "goalPercent": 4,
    "goalRemaining": 960000,
    "growth": -11.1,
    "monthly": [
      {
        "month": "2026-05",
        "income": 65000,
        "expenses": 17000
      },
      {
        "month": "2026-06",
        "income": 205000,
        "expenses": 16000
      },
      {
        "month": "2026-07",
        "income": 55000,
        "expenses": 15000
      },
      {
        "month": "2026-08",
        "income": 50000,
        "expenses": 14000
      },
      {
        "month": "2026-09",
        "income": 45000,
        "expenses": 13000
      },
      {
        "month": "2026-10",
        "income": 40000,
        "expenses": 12000
      }
    ],
    "undatedIncome": 0
  }
}
```
