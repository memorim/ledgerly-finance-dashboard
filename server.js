import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {createHash,randomUUID} from 'node:crypto';
import {moneyValue,dateValue,transactionSchema,cents,cashSummary,exportCsv,importedRows} from './finance.js';

const root = dirname(fileURLToPath(import.meta.url));
const invoiceSchema = z.object({ client:z.string().trim().min(2), title:z.string().trim().min(3), amount:moneyValue, dueDate:dateValue, status:z.enum(['draft','sent','paid','overdue']) });

export function createDb(filename=resolve(root,'data','ledgerly.db')){
  if(filename!==':memory:') mkdirSync(dirname(filename),{recursive:true});
  const db=new DatabaseSync(filename);db.exec('BEGIN IMMEDIATE');try{
  db.exec(`CREATE TABLE IF NOT EXISTS invoices(id INTEGER PRIMARY KEY AUTOINCREMENT,client TEXT NOT NULL,title TEXT NOT NULL,amount REAL NOT NULL,due_date TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);`);
  const {count}=db.prepare('SELECT COUNT(*) count FROM invoices').get();
  if(!count) db.exec(`INSERT INTO invoices(client,title,amount,due_date,status,created_at) VALUES
  ('Morrow Studio','Разработка лендинга',145000,'2026-07-09','paid','2026-06-18'),
  ('Nova Labs','Дизайн-система продукта',218000,'2026-07-12','sent','2026-06-24'),
  ('Forma Group','Интеграция CRM',96000,'2026-07-03','overdue','2026-06-12'),
  ('Locus Travel','Поддержка платформы',72000,'2026-07-21','draft','2026-07-02'),
  ('Arka Bureau','Корпоративный сайт',187500,'2026-07-17','sent','2026-06-29');`);
  if(!db.prepare('PRAGMA table_info(invoices)').all().some(c=>c.name==='paid_at'))db.exec('ALTER TABLE invoices ADD COLUMN paid_at TEXT;');
  db.exec(`CREATE TABLE IF NOT EXISTS transactions(id INTEGER PRIMARY KEY AUTOINCREMENT,external_id TEXT NOT NULL UNIQUE,kind TEXT NOT NULL CHECK(kind IN ('income','expense')),amount_cents INTEGER NOT NULL CHECK(amount_cents>0),occurred_on TEXT NOT NULL,category TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);CREATE INDEX IF NOT EXISTS transactions_date ON transactions(occurred_on,id);CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value INTEGER NOT NULL);INSERT OR IGNORE INTO settings VALUES('opening_balance_cents',0),('goal_cents',100000000);CREATE TABLE IF NOT EXISTS csv_imports(hash TEXT PRIMARY KEY,added INTEGER NOT NULL,created_at TEXT NOT NULL);PRAGMA user_version=1;`);
  if(!count){
   db.prepare("UPDATE invoices SET paid_at='2026-06-20' WHERE status='paid'").run();
   const add=db.prepare('INSERT INTO transactions(external_id,kind,amount_cents,occurred_on,category,description,created_at) VALUES(?,?,?,?,?,?,?)');
   for(let i=5;i>=0;i--){const date=new Date(Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth()-i,5)).toISOString().slice(0,10);add.run(randomUUID(),'income',(40000+i*5000)*100,date,'Проекты','Поступление по проекту',new Date().toISOString());add.run(randomUUID(),'expense',(12000+i*1000)*100,date,'Инструменты','Расходы на инструменты',new Date().toISOString());}
  }
  db.exec('COMMIT');return db;
  }catch(error){if(db.isTransaction)db.exec('ROLLBACK');db.close();throw error;}
}

export function createApp(db=createDb()){
  const app=express(); app.use(express.json({limit:'256kb'}));
  app.get('/api/health',(_req,res)=>res.json({status:'ok'}));
  app.get('/api/summary',(_q,res)=>{const stats=db.prepare(`SELECT ROUND(SUM(amount),0) total,ROUND(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END),0) paid,ROUND(SUM(CASE WHEN status IN ('sent','overdue') THEN amount ELSE 0 END),0) expected,COUNT(*) invoices FROM invoices`).get();const monthly=db.prepare(`SELECT substr(created_at,1,7) month,ROUND(SUM(amount),0) amount FROM invoices GROUP BY month ORDER BY month`).all();res.json({stats,monthly,cash:cashSummary(db)});});
  app.get('/api/invoices',(req,res)=>{const status=String(req.query.status||'');const rows=status&&status!=='all'?db.prepare('SELECT * FROM invoices WHERE status=? ORDER BY due_date').all(status):db.prepare('SELECT * FROM invoices ORDER BY due_date').all();res.json(rows);});
  app.post('/api/invoices',(req,res)=>{const parsed=invoiceSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:'Проверьте данные счёта'});const i=parsed.data,today=new Date().toISOString().slice(0,10);const out=db.prepare('INSERT INTO invoices(client,title,amount,due_date,status,created_at,paid_at) VALUES(?,?,?,?,?,?,?)').run(i.client,i.title,i.amount,i.dueDate,i.status,today,i.status==='paid'?today:null);res.status(201).json({id:Number(out.lastInsertRowid),...i});});
  app.patch('/api/invoices/:id/status',(req,res)=>{const parsed=z.object({status:z.enum(['draft','sent','paid','overdue'])}).safeParse(req.body);if(!parsed.success)return res.status(400).json({message:'Неверный статус'});const out=db.prepare('UPDATE invoices SET status=?,paid_at=CASE WHEN ?=\'paid\' THEN COALESCE(paid_at,?) ELSE NULL END WHERE id=?').run(parsed.data.status,parsed.data.status,new Date().toISOString().slice(0,10),Number(req.params.id));if(!out.changes)return res.status(404).json({message:'Счёт не найден'});res.json({ok:true});});
  app.delete('/api/invoices/:id',(req,res)=>{const out=db.prepare('DELETE FROM invoices WHERE id=?').run(Number(req.params.id));return out.changes?res.status(204).end():res.status(404).json({message:'Счёт не найден'});});
  app.get('/api/transactions',(_req,res)=>res.json(db.prepare('SELECT * FROM transactions ORDER BY occurred_on DESC,id DESC LIMIT 100').all()));
  app.post('/api/transactions',(req,res)=>{const p=transactionSchema.safeParse(req.body);if(!p.success)return res.status(400).json({message:'Проверьте сумму, дату и категорию операции'});const t=p.data,id=randomUUID();db.prepare('INSERT INTO transactions(external_id,kind,amount_cents,occurred_on,category,description,created_at) VALUES(?,?,?,?,?,?,?)').run(id,t.kind,cents(t.amount),t.date,t.category,t.description,new Date().toISOString());res.status(201).json({id,...t});});
  app.get('/api/transactions/export.csv',(_req,res)=>{const rows=db.prepare('SELECT * FROM transactions ORDER BY occurred_on,id LIMIT 1001').all();if(rows.length>1000)return res.status(413).json({message:'Один CSV содержит до 1000 операций'});res.set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="ledgerly-transactions.csv"'}).send(exportCsv(rows));});
  app.post('/api/transactions/import',(req,res)=>{
   const p=z.object({csv:z.string().min(1).max(200000)}).strict().safeParse(req.body);if(!p.success)return res.status(400).json({message:'Передайте CSV до 200 000 символов'});
   let rows;try{rows=importedRows(p.data.csv);}catch{return res.status(400).json({message:'Проверьте CSV: id,kind,amount,date,category,description; максимум 1000 операций; корректные даты и суммы.'});}
   const hash=createHash('sha256').update(JSON.stringify(rows)).digest('hex'),previous=db.prepare('SELECT added FROM csv_imports WHERE hash=?').get(hash);if(previous)return res.json({added:previous.added,replayed:true});
   let added=0;db.exec('BEGIN IMMEDIATE');
   try{
    const insert=db.prepare('INSERT INTO transactions(external_id,kind,amount_cents,occurred_on,category,description,created_at) VALUES(?,?,?,?,?,?,?)');
    for(const row of rows){const id=row.id||randomUUID(),old=db.prepare('SELECT * FROM transactions WHERE external_id=?').get(id);if(old){if(old.kind!==row.kind||old.amount_cents!==cents(row.amount)||old.occurred_on!==row.date||old.category!==row.category||old.description!==row.description)throw new Error('conflict');continue;}insert.run(id,row.kind,cents(row.amount),row.date,row.category,row.description,new Date().toISOString());added++;}
    db.prepare('INSERT INTO csv_imports VALUES(?,?,?)').run(hash,added,new Date().toISOString());db.exec('COMMIT');res.json({added,replayed:false});
   }catch(error){if(db.isTransaction)db.exec('ROLLBACK');return res.status(error.message==='conflict'?409:503).json({message:error.message==='conflict'?'Операция с этим id уже содержит другие данные. CSV не импортирован.':'Импорт не выполнен; исходные операции сохранены.'});}
  });
  app.patch('/api/settings',(req,res)=>{const p=z.object({goalAmount:moneyValue,openingBalance:z.number().finite().min(-1e9).max(1e9).refine(value=>Math.abs(value*100-Math.round(value*100))<1e-6)}).strict().safeParse(req.body);if(!p.success)return res.status(400).json({message:'Проверьте цель и начальный остаток'});db.exec('BEGIN IMMEDIATE');try{db.prepare("UPDATE settings SET value=? WHERE key='goal_cents'").run(cents(p.data.goalAmount));db.prepare("UPDATE settings SET value=? WHERE key='opening_balance_cents'").run(cents(p.data.openingBalance));db.exec('COMMIT');res.json({ok:true});}catch(error){db.exec('ROLLBACK');throw error;}});
  app.use(express.static(resolve(root,'public'))); app.get(/^(?!\/api).*/,(_q,res)=>res.sendFile(resolve(root,'public','index.html'))); app.use((error,_req,res,_next)=>res.status(error?.type==='entity.too.large'?413:error instanceof SyntaxError?400:503).json({message:'Не удалось обработать запрос'})); return app;
}
if(process.env.NODE_ENV!=='test') createApp().listen(process.env.PORT||4300,()=>console.log('Ledgerly: http://localhost:4300'));
