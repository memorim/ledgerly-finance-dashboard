# Пример API

Ответ получен при локальном запуске проверяемой версии. Данные демонстрационные.

```http
GET /api/summary HTTP/1.1
Host: localhost:4300
```

HTTP 200

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
  ]
}
```
