import { z } from 'zod';
import { transactionSchema, formatCents } from './money.js';

export function parseCsv(text) {
  if (text.length > 200000) throw new Error('CSV превышает 200 000 символов');
  text = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [],
    cell = '',
    quoted = false,
    closed = false;
  const pushCell = () => {
    row.push(cell);
    cell = '';
    closed = false;
    if (row.length > 6) throw new Error('Слишком много колонок');
  };
  const pushRow = () => {
    pushCell();
    if (row.some((v) => v !== '')) rows.push(row);
    row = [];
    if (rows.length > 1001) throw new Error('Максимум 1000 операций');
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
      continue;
    }
    if (closed && c !== ',' && c !== '\r' && c !== '\n')
      throw new Error('Символ после закрывающей кавычки');
    if (c === '"') {
      if (cell) throw new Error('Некорректные кавычки');
      quoted = true;
    } else if (c === ',') pushCell();
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      pushRow();
    } else cell += c;
  }
  if (quoted) throw new Error('Незакрытая кавычка');
  if (cell || row.length || closed) pushRow();
  return rows;
}
const safeCell = (value) => {
  let s = String(value ?? '');
  if (/^[=+\-@'\s]/u.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
};
export function exportCsv(rows) {
  return (
    [
      'id,kind,amount,date,category,description',
      ...rows.map((r) =>
        [
          r.external_id,
          r.kind,
          formatCents(r.amount_cents),
          r.occurred_on,
          r.category,
          r.description,
        ]
          .map(safeCell)
          .join(','),
      ),
    ].join('\r\n') + '\r\n'
  );
}
export function importedRows(csv) {
  const [header, ...rows] = parseCsv(csv);
  const columns = ['id', 'kind', 'amount', 'date', 'category', 'description'];
  if (!header || header.join(',') !== columns.join(','))
    throw new Error('Ожидаются колонки id,kind,amount,date,category,description');
  return rows.map((values) => {
    if (values.length !== columns.length) throw new Error('Неверное число колонок');
    const [id, kind, amount, date, category, description] = values;
    if (id && !z.string().uuid().safeParse(id).success) throw new Error('Некорректный id операции');
    if (!/^\d+(?:\.\d{1,2})?$/.test(amount))
      throw new Error(
        'Сумма должна быть положительной, с точкой и не более двух десятичных знаков',
      );
    const literal = (v) => (v.startsWith("'") ? v.slice(1) : v);
    return {
      id,
      ...transactionSchema.parse({
        kind,
        amount: Number(amount),
        date,
        category: literal(category),
        description: literal(description),
      }),
    };
  });
}
