import {z} from 'zod';
export const moneyValue=z.number().finite().positive().max(1e9).refine(value=>Math.abs(value*100-Math.round(value*100))<1e-6,'Не более двух знаков после запятой');
export const dateValue=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'Некорректная дата');
export const transactionSchema=z.object({kind:z.enum(['income','expense']),amount:moneyValue,date:dateValue,category:z.string().trim().min(1).max(80),description:z.string().max(500).default('')}).strict();
export const cents=value=>Math.round(value*100);
export function cashSummary(db,now=new Date()){
 const today=now.toISOString().slice(0,10),quarter=today.slice(0,5)+String(Math.floor(now.getUTCMonth()/3)*3+1).padStart(2,'0')+'-01';
 const monthKeys=Array.from({length:6},(_,i)=>new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-5+i,1)).toISOString().slice(0,7));
 const payments=db.prepare("SELECT paid_at date,CAST(ROUND(amount*100) AS INTEGER) amount_cents,'income' kind FROM invoices WHERE status='paid'").all();
 const transactions=db.prepare('SELECT occurred_on date,amount_cents,kind FROM transactions').all(),rows=[...payments,...transactions].filter(r=>!r.date||r.date<=today);
 const income=rows.filter(r=>r.kind==='income').reduce((a,r)=>a+r.amount_cents,0),expenses=rows.filter(r=>r.kind==='expense').reduce((a,r)=>a+r.amount_cents,0);
 const opening=Number(db.prepare("SELECT value FROM settings WHERE key='opening_balance_cents'").get().value),goal=Number(db.prepare("SELECT value FROM settings WHERE key='goal_cents'").get().value);
 const quarterIncome=rows.filter(r=>r.kind==='income'&&r.date>=quarter&&r.date<=today).reduce((a,r)=>a+r.amount_cents,0);
 const monthly=monthKeys.map(month=>({month,income:rows.filter(r=>r.kind==='income'&&r.date?.startsWith(month)).reduce((a,r)=>a+r.amount_cents,0)/100,expenses:rows.filter(r=>r.kind==='expense'&&r.date?.startsWith(month)).reduce((a,r)=>a+r.amount_cents,0)/100}));
 const current=monthly.at(-1).income,previous=monthly.at(-2).income,growth=previous?Math.round((current-previous)/previous*1000)/10:null;
 return {income:income/100,expenses:expenses/100,balance:(opening+income-expenses)/100,openingBalance:opening/100,goal:goal/100,quarterIncome:quarterIncome/100,goalPercent:Math.min(100,Math.round(quarterIncome/goal*100)),goalRemaining:Math.max(0,goal-quarterIncome)/100,growth,monthly,undatedIncome:payments.filter(r=>!r.date).reduce((a,r)=>a+r.amount_cents,0)/100};
}
export function parseCsv(text){
 if(text.length>200000)throw new Error('CSV превышает 200 000 символов');
 text=text.replace(/^\uFEFF/,'');const rows=[];let row=[],cell='',quoted=false,closed=false;
 const pushCell=()=>{row.push(cell);cell='';closed=false;if(row.length>6)throw new Error('Слишком много колонок');};
 const pushRow=()=>{pushCell();if(row.some(v=>v!==''))rows.push(row);row=[];if(rows.length>1001)throw new Error('Максимум 1000 операций');};
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
  if(closed&&c!==','&&c!=='\r'&&c!=='\n')throw new Error('Символ после закрывающей кавычки');
  if(c==='"'){if(cell)throw new Error('Некорректные кавычки');quoted=true;}
  else if(c===',')pushCell();else if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;pushRow();}else cell+=c;
 }
 if(quoted)throw new Error('Незакрытая кавычка');if(cell||row.length||closed)pushRow();return rows;
}
const safeCell=value=>{let s=String(value??'');if(/^[=+\-@'\s]/u.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
export function exportCsv(rows){return ['id,kind,amount,date,category,description',...rows.map(r=>[r.external_id,r.kind,(r.amount_cents/100).toFixed(2),r.occurred_on,r.category,r.description].map(safeCell).join(','))].join('\r\n')+'\r\n';}
export function importedRows(csv){
 const [header,...rows]=parseCsv(csv);const columns=['id','kind','amount','date','category','description'];
 if(!header||header.join(',')!==columns.join(','))throw new Error('Ожидаются колонки id,kind,amount,date,category,description');
 return rows.map(values=>{
  if(values.length!==columns.length)throw new Error('Неверное число колонок');const [id,kind,amount,date,category,description]=values;
  if(id&&!z.string().uuid().safeParse(id).success)throw new Error('Некорректный id операции');
  if(!/^\d+(?:\.\d{1,2})?$/.test(amount))throw new Error('Сумма должна быть положительной, с точкой и не более двух десятичных знаков');
  const literal=v=>v.startsWith("'")?v.slice(1):v;
  return {id,...transactionSchema.parse({kind,amount:Number(amount),date,category:literal(category),description:literal(description)})};
 });
}
