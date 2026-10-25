import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
process.env.NODE_ENV = 'test';
const { createApp, createDb } = await import('../server.js');
const app = createApp(createDb(':memory:'));
describe('Ledgerly API', () => {
  it('returns financial summary', async () => {
    const r = await request(app).get('/api/summary');
    assert.equal(r.status, 200);
    assert.equal(r.body.stats.invoices, 5);
  });
  it('filters invoices', async () => {
    const r = await request(app).get('/api/invoices?status=paid');
    assert.equal(r.body.length, 1);
  });
  it('creates invoice', async () => {
    const r = await request(app).post('/api/invoices').send({
      client: 'Test Client',
      title: 'API integration',
      amount: 50000,
      dueDate: '2026-08-01',
      status: 'sent',
    });
    assert.equal(r.status, 201);
    assert.ok(r.body.id);
  });
});

describe('Input validation and missing records', () => {
  it('rejects invalid input', async () => {
    assert.equal((await request(app).post('/api/invoices').send({})).status, 400);
  });
  it('returns 404 for a missing record', async () => {
    assert.equal(
      (await request(app).patch('/api/invoices/999/status').send({ status: 'paid' })).status,
      404,
    );
  });
});
