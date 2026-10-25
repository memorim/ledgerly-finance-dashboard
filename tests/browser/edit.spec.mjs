import { test, expect } from '../fixtures.mjs';

test('editing and removing an operation updates the balance; a conflict keeps the form draft', async ({
  page,
  request,
}) => {
  const before = (await (await request.get('/api/summary')).json()).cash.balance;
  await page.goto('/');
  await page.getByRole('button', { name: 'Добавить операцию' }).click();
  const form = page.locator('#transaction-form');
  await form.getByRole('combobox', { name: 'Вид', exact: true }).selectOption('income');
  await form.getByLabel('Сумма операции').fill('10.29');
  await form.getByLabel('Категория', { exact: true }).fill('Browser edit');
  await form.getByRole('button', { name: 'Сохранить операцию' }).click();
  await expect(
    page.getByRole('button', { name: 'Изменить операцию Browser edit', exact: true }),
  ).toBeVisible();
  expect(
    Math.round(((await (await request.get('/api/summary')).json()).cash.balance - before) * 100),
  ).toBe(1029);
  await page.getByRole('button', { name: 'Изменить операцию Browser edit', exact: true }).click();
  await form.getByLabel('Сумма операции').fill('20.31');
  await page.route('**/api/transactions/*', async (route) => {
    if (route.request().method() === 'PATCH')
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Операция уже изменена другим пользователем' }),
      });
    else await route.continue();
  });
  await form.getByRole('button', { name: 'Сохранить операцию' }).click();
  await expect(form.getByRole('alert')).toContainText('уже изменена');
  await expect(form.getByLabel('Сумма операции')).toHaveValue('20.31');
  await page.unroute('**/api/transactions/*');
  await form.getByRole('button', { name: 'Сохранить операцию' }).click();
  await expect(page.locator('#transaction-dialog')).not.toBeVisible();
  expect(
    Math.round(((await (await request.get('/api/summary')).json()).cash.balance - before) * 100),
  ).toBe(2031);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Удалить операцию Browser edit', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Удалить операцию Browser edit', exact: true }),
  ).toHaveCount(0);
  expect((await (await request.get('/api/summary')).json()).cash.balance).toBe(before);
});
