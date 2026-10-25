import { test, expect } from '../fixtures.mjs';
test('mobile layout and recovery after a failed API request', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.load-feedback')).toHaveText('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(
    true,
  );
  await page.route('**/api/summary*', (r) =>
    r.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"message":"Test unavailable"}',
    }),
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'Повторить загрузку', exact: true })).toBeVisible();
  await page.unroute('**/api/summary*');
  await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
  await expect(page.locator('.load-feedback')).toHaveText('');
});

test('failed form submission retains entered data', async ({ page }) => {
  await page.goto('/');
  await page.locator('.new').first().click();
  const form = page.locator('#invoice-form');
  await expect(form).toBeVisible();
  const values = { client: 'Browser Demo', title: 'Preserved demo invoice', amount: '1000' };
  for (const [name, value] of Object.entries(values))
    await form.locator('[name="' + name + '"]').fill(value);
  await page.route('**/api/**', (route) =>
    route.request().method() === 'POST' ? route.abort('failed') : route.continue(),
  );
  await form.locator('button').last().click();
  await expect(form.getByRole('alert')).toContainText('Не удалось выполнить запрос');
  await expect(form.locator('[name="client"]')).toHaveValue(values['client']);
});
