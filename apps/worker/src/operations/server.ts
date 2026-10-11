import { createServer } from 'node:http';
import { createDirectDbPool } from '@barghsa/db';
import { receiveOperationsAlerts } from './alerts.js';

const pool = createDirectDbPool({}, { shared: false });
const server = createServer(async (req, res) => {
  const path = (req.url ?? '').split('?')[0];
  if (path === '/operations/alerts') return receiveOperationsAlerts(req, res, pool);
  if (path === '/health') {
    try {
      if (
        (process.env['OPS_ALERT_WEBHOOK_SECRET'] ?? '').length < 32 ||
        !process.env['OPS_ALERT_ENVIRONMENT'] ||
        !process.env['OPS_ALERT_DATABASE']
      )
        throw new Error('Operations receiver configuration unavailable');
      const ready = (
        await pool.query("SELECT to_regclass('operations_alert_receipts') IS NOT NULL AS ready")
      ).rows[0]?.ready;
      if (!ready) throw new Error('Operations migration unavailable');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'operations' }));
    } catch {
      res.writeHead(503);
      res.end();
    }
    return;
  }
  res.writeHead(404);
  res.end();
});
server.requestTimeout = 15000;
server.headersTimeout = 15000;
server.listen(Number(process.env['OPS_ALERT_PORT'] ?? '9094'));
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    const deadline = setTimeout(() => process.exit(1), 15000);
    server.close(() => {
      void pool.end().then(() => {
        clearTimeout(deadline);
        process.exit(0);
      });
    });
  });
