import { test, expect } from '../fixtures.mjs';
test('a saved cash operation changes the balance and survives CSV round-trip', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(page.locator('.load-feedback')).toHaveText('');
  const before = (await (await request.get('/api/summary')).json()).cash.balance;
  await expect(page.getByLabel('Цель на квартал', { exact: true })).toBeVisible();
  await page.getByLabel('Цель на квартал', { exact: true }).fill('200000');
  await page.getByRole('button', { name: 'Сохранить настройки', exact: true }).click();
  await expect(page.locator('#settings-result')).toContainText('Настройки сохранены');
  expect((await (await request.get('/api/summary')).json()).cash.goal).toBe(200000);
  await page.getByRole('button', { name: 'Добавить операцию', exact: false }).click();
  const form = page.locator('#transaction-form');
  await form.getByLabel('Сумма операции', { exact: true }).fill('123.45');
  await form.getByLabel('Категория', { exact: true }).fill('Browser cash test');
  await form.getByLabel('Описание операции', { exact: true }).fill('Saved through UI');
  await form.getByRole('button', { name: 'Сохранить операцию', exact: true }).click();
  await expect(page.locator('#transaction-dialog')).not.toBeVisible();
  await expect(page.locator('#transaction-list')).toContainText('Browser cash test');
  const cash = (await (await request.get('/api/summary')).json()).cash;
  expect(cash.balance).toBeCloseTo(before - 123.45, 2);
  expect(await page.locator('#cash-balance').innerText()).toContain(
    new Intl.NumberFormat('ru-RU').format(cash.balance),
  );
  const csv = await (await request.get('/api/transactions/export.csv')).text(),
    count = (await (await request.get('/api/transactions')).json()).length;
  await page
    .locator('#csv-file')
    .setInputFiles({ name: 'round-trip.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.locator('#csv-result')).toContainText('Добавлено операций: 0');
  expect((await (await request.get('/api/transactions')).json()).length).toBe(count);
  await page.reload();
  await expect(page.locator('#transaction-list')).toContainText('Browser cash test');
});
