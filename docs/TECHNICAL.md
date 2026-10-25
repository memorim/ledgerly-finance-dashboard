> Historical note: current monetary storage, edit/delete and concurrency behaviour is documented in [MONEY_MODEL.md](MONEY_MODEL.md) and the root README.

# Ledgerly — финансовый кабинет и счета

Финансовый кабинет для небольших команд и самостоятельных специалистов. Показывает выручку, ожидаемые платежи, динамику и состояние выставленных счетов.

## Возможности

- агрегированная финансовая сводка;
- фильтрация счетов по статусу;
- создание новых счетов с серверной валидацией;
- смена статусов и удаление через REST API;
- локальная SQLite-база с demo-данными;
- адаптивный интерфейс и интеграционные тесты.

## Стек

Node.js, Express, SQLite, Zod, HTML, CSS, JavaScript, Node Test Runner, Supertest.

## Запуск

```bash
pnpm install
pnpm start
```

Откройте `http://localhost:4300`. На Windows можно запустить `start-local.cmd`.

```bash
pnpm test
```

## Текущий режим работы
Суммы операций считаются в целых копейках. Денежный поток включает сохранённые операции и оплаченные счета; будущие операции не увеличивают текущий баланс. Старые оплаченные счета без даты учитываются в итоге, но не привязываются к месяцу. CSV — ручной обмен, без банка или платёжной системы. Локальный API рассчитан на доверенный доступ.

## Денежный поток и CSV
`GET/POST /api/transactions`, `PATCH /api/settings`, `GET /api/transactions/export.csv`, `POST /api/transactions/import` с JSON `{ "csv": "..." }`. Колонки: `id,kind,amount,date,category,description`. Сумма положительная с точкой и двумя десятичными знаками; `kind` — `income` или `expense`, дата — `YYYY-MM-DD`. До 1000 операций и 200 000 символов. UUID сохраняется при экспорте; повтор импорта не создаёт дублей. Конфликт существующего UUID откатывает весь файл.
