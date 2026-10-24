import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
process.env.NODE_ENV='test';
const {createDb,createApp}=await import('../server.js');
const {exportCsv,importedRows,parseCsv}=await import('../finance.js');
test('cash totals, monthly chart, balance and goal are derived from stored cents',async()=>{
 const db=createDb(':memory:');try{
  db.exec('DELETE FROM invoices;DELETE FROM transactions;');const app=createApp(db),today=new Date().toISOString().slice(0,10);
  await request(app).post('/api/invoices').send({client:'Client',title:'Paid invoice',amount:0.29,dueDate:today,status:'paid'});
  await request(app).post('/api/transactions').send({kind:'income',amount:100,date:today,category:'Other',description:''});
  await request(app).post('/api/transactions').send({kind:'expense',amount:30.12,date:today,category:'Tools',description:''});
  await request(app).patch('/api/settings').send({goalAmount:200,openingBalance:10});
  const {cash}= (await request(app).get('/api/summary')).body;assert.equal(cash.income,100.29);assert.equal(cash.expenses,30.12);assert.equal(cash.balance,80.17);assert.equal(cash.monthly.at(-1).income,100.29);assert.equal(cash.monthly.at(-1).expenses,30.12);assert.equal(cash.goalRemaining,99.71);assert.equal(cash.goalPercent,50);
  for(const amount of [0,-1,0.001,1e12])assert.equal((await request(app).post('/api/transactions').send({kind:'income',amount,date:today,category:'Invalid'})).status,400);
  assert.equal((await request(app).post('/api/transactions').send({kind:'income',amount:1,date:'2026-02-30',category:'Invalid'})).status,400);
  assert.equal((await request(app).patch('/api/settings').send({goalAmount:200,openingBalance:0.001})).status,400);
 }finally{db.close();}
});
test('CSV supports UTF-8, embedded quotes/newlines and neutralizes spreadsheet formulas',()=>{
 const rows=[{external_id:'cc7e7ca8-cffb-4c38-a54f-d1e0eef4157a',kind:'expense',amount_cents:12345,occurred_on:'2026-10-10',category:'=FORMULA',description:'Текст, "кавычки"\nи строка'}];
 const csv=exportCsv(rows);assert.ok(csv.includes("'=FORMULA"));const imported=importedRows(csv);assert.equal(imported[0].category,'=FORMULA');assert.equal(imported[0].description,rows[0].description);assert.equal(imported[0].amount,123.45);
 for(const category of ['\n=SUM(1)',' =SUM(1)','\t+1',"'literal"]){const csv=exportCsv([{...rows[0],category}]);assert.equal(importedRows(csv)[0].category,category.trim());assert.ok(csv.includes("\"'"));}
 for(const broken of ['a,"unclosed','a,"closed"bad','a,b,c,d,e,f,g'])assert.throws(()=>parseCsv(broken));
});
test('CSV retry and own-export import create no duplicates; a conflict rolls back the entire file',async()=>{
 const db=createDb(':memory:');try{
  db.exec('DELETE FROM transactions;');const app=createApp(db);const header='id,kind,amount,date,category,description\n',row='cc7e7ca8-cffb-4c38-a54f-d1e0eef4157a,income,10.25,2026-10-10,Work,Value\n';
  assert.equal((await request(app).post('/api/transactions/import').send({csv:header+row})).body.added,1);
  assert.equal((await request(app).post('/api/transactions/import').send({csv:header+row})).body.replayed,true);
  const exported=await request(app).get('/api/transactions/export.csv');assert.equal((await request(app).post('/api/transactions/import').send({csv:exported.text})).body.replayed,true);assert.equal(db.prepare('SELECT COUNT(*) n FROM transactions').get().n,1);
  const conflict=header+'30e3a982-e32e-4213-b747-b4ebc5d6055a,income,5,2026-10-10,Work,First\n'+row.replace('10.25','11.25');
  assert.equal((await request(app).post('/api/transactions/import').send({csv:conflict})).status,409);assert.equal(db.prepare('SELECT COUNT(*) n FROM transactions').get().n,1);
 }finally{db.close();}
});
