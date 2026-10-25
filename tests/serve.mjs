import { createServer } from 'node:http';
import { createApp, createDb } from '../server.js';
let db = createDb(':memory:'),
  app = createApp(db);
createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/__test/reset') {
    db.close();
    db = createDb(':memory:');
    app = createApp(db);
    res.writeHead(204).end();
    return;
  }
  app(req, res);
}).listen(4301, '127.0.0.1');
