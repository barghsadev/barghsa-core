import DOMPurify from 'dompurify';
import { Param } from '@nestjs/common';
import { sql } from 'drizzle-orm';

function sqlExamples(req, db) {
  const query = `SELECT * FROM users WHERE name = '${req.query.name}'`;
  // ruleid: request-data-in-sql
  db.query(query);
  // ok: request-data-in-sql
  db.query('SELECT * FROM users WHERE name = $1', [req.query.name]);
  const row = db.query('SELECT name FROM users');
  // ok: request-data-in-sql
  db.query(row.name);
  // ruleid: request-data-in-sql
  db.execute(sql.raw(query));
  // ok: request-data-in-sql
  db.execute(sql`SELECT * FROM users WHERE name = ${req.query.name}`);
  // ok: request-data-in-sql
  db.execute(sql.raw('SELECT 1'));
}

class NestSqlExamples {
  select(@Param('name') name: string) {
    const statement = `SELECT * FROM users WHERE name = '${name}'`;
    // ruleid: request-data-in-sql
    return sql.raw(statement);
  }

  selectBound(@Param('name') name: string) {
    // ok: request-data-in-sql
    return sql`SELECT * FROM users WHERE name = ${name}`;
  }
}

function outboundExamples(req, https) {
  const destination = req.body.url;
  // ruleid: request-data-in-outbound-url
  fetch(destination);
  // ruleid: request-data-in-outbound-url
  https.request(destination);
  // ok: request-data-in-outbound-url
  fetch('https://provider.example.test/status', { body: req.body.payload });
  const cache = new Map();
  // ok: request-data-in-outbound-url
  cache.get(req.query.key);
}

function redirectExamples(req, res) {
  // ruleid: request-data-in-redirect
  res.redirect(req.query.next);
  // ruleid: request-data-in-redirect
  res.redirect(302, req.body.next);
  // ok: request-data-in-redirect
  res.redirect('/dashboard');
}

function htmlExamples(req, node) {
  const html = req.body.html;
  // ruleid: untrusted-html-output
  node.innerHTML = html;
  // ruleid: untrusted-html-output
  const unsafe = <div dangerouslySetInnerHTML={{ __html: html }} />;
  // ok: untrusted-html-output
  const escaped = <div>{html}</div>;
  // ok: untrusted-html-output
  const safe = <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />;
  return [unsafe, escaped, safe];
}

function credentials() {
  // ruleid: literal-credential-assignment
  const apiKey = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  // ruleid: literal-credential-assignment
  const config = { apiToken: 'aaaaaaaaaaaaaaaaaaaaaaaa' };
  // ok: literal-credential-assignment
  const apiToken = process.env.API_TOKEN;
  // ok: literal-credential-assignment
  const password = '';
}

async function externalTransactionExamples(db, gateway, https) {
  // ruleid: external-call-in-db-transaction
  await db.transaction(async (tx) => {
    await tx.insert('intent');
    return gateway.verifyPayment({ merchantOrderId: 'fixture' });
  });

  // ruleid: external-call-in-db-transaction
  await db.transaction(async function (tx) {
    await tx.insert('intent');
    return https.request('https://provider.example.test/status');
  });

  // ruleid: external-call-in-db-transaction
  await db.transaction(() => globalThis.fetch('https://provider.example.test/status'));

  // ok: external-call-in-db-transaction
  const intent = await db.transaction(async (tx) => tx.insert('intent'));
  // ok: external-call-in-db-transaction
  const result = await gateway.verifyPayment({ merchantOrderId: intent.id });
  // ok: external-call-in-db-transaction
  await db.transaction(async (tx) => tx.update(intent.id, result));

  // ok: external-call-in-db-transaction
  await db.transaction(await fetch('https://provider.example.test/status'), async (tx) => {
    return tx.insert('already fetched');
  });
}
