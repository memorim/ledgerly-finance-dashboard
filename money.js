import { z } from 'zod';

export const MAX_ENTRY_CENTS = 100_000_000_000n;
// The numeric JSON API must round-trip a kopeck, not just fit an integer before division by 100.
export const MAX_TOTAL_CENTS = 100_000_000_000_000n;
export class MoneyRangeError extends RangeError {
  constructor() {
    super('Превышен предел точного расчёта денежной суммы');
  }
}
export const hasMinorUnitPrecision = (value) => /^-?\d+(?:\.\d{1,2})?$/.test(String(value));
export const moneyValue = z
  .number()
  .finite()
  .positive()
  .max(1e9)
  .refine(hasMinorUnitPrecision, 'Не более двух знаков после запятой');
export const dateValue = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value,
    'Некорректная дата',
  );
export const transactionSchema = z
  .object({
    kind: z.enum(['income', 'expense']),
    amount: moneyValue,
    date: dateValue,
    category: z.string().trim().min(1).max(80),
    description: z.string().max(500).default(''),
  })
  .strict();

export function cents(value) {
  if (!Number.isFinite(value) || !hasMinorUnitPrecision(value)) throw new MoneyRangeError();
  const negative = value < 0;
  const [whole, fraction = ''] = String(Math.abs(value)).split('.');
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (result > MAX_ENTRY_CENTS) throw new MoneyRangeError();
  return Number(negative ? -result : result);
}
export function moneyNumber(value) {
  const integer = BigInt(value);
  if (integer > MAX_TOTAL_CENTS || integer < -MAX_TOTAL_CENTS) throw new MoneyRangeError();
  return Number(integer) / 100;
}
export function formatCents(value) {
  const integer = BigInt(value),
    absolute = integer < 0n ? -integer : integer;
  return `${integer < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
