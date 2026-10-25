import { parentPort, workerData } from 'node:worker_threads';
process.env.NODE_ENV = 'test';
const { createDb, createApp } = await import(workerData.module);
const db = createDb(workerData.file),
  original = db.prepare.bind(db),
  gate = new Int32Array(workerData.gate);
db.prepare = (sql) => {
  const statement = original(sql);
  if (!sql.startsWith('SELECT added FROM csv_imports')) return statement;
  return new Proxy(statement, {
    get(target, name) {
      if (name === 'get')
        return (...values) => {
          const row = target.get(...values);
          if (!row && !db.isTransaction) {
            Atomics.add(gate, 0, 1);
            Atomics.notify(gate, 0);
            if (Atomics.load(gate, 0) < 2) Atomics.wait(gate, 0, 1, 2000);
          }
          return row;
        };
      const value = Reflect.get(target, name);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
};
createApp(db).listen(0, '127.0.0.1', function () {
  parentPort.postMessage(this.address().port);
});
