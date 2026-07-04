import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const root = dirname(fileURLToPath(import.meta.url));
const invoiceSchema = z.object({ client:z.string().trim().min(2), title:z.string().trim().min(3), amount:z.number().positive(), dueDate:z.string().date(), status:z.enum(['draft','sent','paid','overdue']) });

export function createDb(filename=resolve(root,'data','ledgerly.db')){
  if(filename!==':memory:') mkdirSync(dirname(filename),{recursive:true});
  const db=new DatabaseSync(filename);
  db.exec(`CREATE TABLE IF NOT EXISTS invoices(id INTEGER PRIMARY KEY AUTOINCREMENT,client TEXT NOT NULL,title TEXT NOT NULL,amount REAL NOT NULL,due_date TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);`);
  const {count}=db.prepare('SELECT COUNT(*) count FROM invoices').get();
  if(!count) db.exec(`INSERT INTO invoices(client,title,amount,due_date,status,created_at) VALUES
  ('Morrow Studio','Разработка лендинга',145000,'2026-07-09','paid','2026-06-18'),
  ('Nova Labs','Дизайн-система продукта',218000,'2026-07-12','sent','2026-06-24'),
  ('Forma Group','Интеграция CRM',96000,'2026-07-03','overdue','2026-06-12'),
  ('Locus Travel','Поддержка платформы',72000,'2026-07-21','draft','2026-07-02'),
  ('Arka Bureau','Корпоративный сайт',187500,'2026-07-17','sent','2026-06-29');`);
  return db;
}

export function createApp(db=createDb()){
  const app=express(); app.use(express.json());
  app.get('/api/summary',(_q,res)=>{const stats=db.prepare(`SELECT ROUND(SUM(amount),0) total,ROUND(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END),0) paid,ROUND(SUM(CASE WHEN status IN ('sent','overdue') THEN amount ELSE 0 END),0) expected,COUNT(*) invoices FROM invoices`).get();const monthly=db.prepare(`SELECT substr(created_at,1,7) month,ROUND(SUM(amount),0) amount FROM invoices GROUP BY month ORDER BY month`).all();res.json({stats,monthly});});
  app.get('/api/invoices',(req,res)=>{const status=String(req.query.status||'');const rows=status&&status!=='all'?db.prepare('SELECT * FROM invoices WHERE status=? ORDER BY due_date').all(status):db.prepare('SELECT * FROM invoices ORDER BY due_date').all();res.json(rows);});
  app.post('/api/invoices',(req,res)=>{const parsed=invoiceSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({message:'Проверьте данные счёта'});const i=parsed.data;const out=db.prepare('INSERT INTO invoices(client,title,amount,due_date,status,created_at) VALUES(?,?,?,?,?,?)').run(i.client,i.title,i.amount,i.dueDate,i.status,new Date().toISOString().slice(0,10));res.status(201).json({id:Number(out.lastInsertRowid),...i});});
  app.patch('/api/invoices/:id/status',(req,res)=>{const parsed=z.object({status:z.enum(['draft','sent','paid','overdue'])}).safeParse(req.body);if(!parsed.success)return res.status(400).json({message:'Неверный статус'});const out=db.prepare('UPDATE invoices SET status=? WHERE id=?').run(parsed.data.status,Number(req.params.id));if(!out.changes)return res.status(404).json({message:'Счёт не найден'});res.json({ok:true});});
  app.delete('/api/invoices/:id',(req,res)=>{const out=db.prepare('DELETE FROM invoices WHERE id=?').run(Number(req.params.id));return out.changes?res.status(204).end():res.status(404).json({message:'Счёт не найден'});});
  app.use(express.static(resolve(root,'public'))); app.get(/^(?!\/api).*/,(_q,res)=>res.sendFile(resolve(root,'public','index.html'))); return app;
}
if(process.env.NODE_ENV!=='test') createApp().listen(process.env.PORT||4300,()=>console.log('Ledgerly: http://localhost:4300'));
