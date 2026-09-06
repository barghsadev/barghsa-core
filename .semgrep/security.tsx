import DOMPurify from 'dompurify';

function sqlExamples(req, db) {
  const query = `SELECT * FROM users WHERE name = '${req.query.name}'`;
  // ruleid: request-data-in-sql
  db.query(query);
  // ok: request-data-in-sql
  db.query('SELECT * FROM users WHERE name = $1', [req.query.name]);
  const row = db.query('SELECT name FROM users');
  // ok: request-data-in-sql
  db.query(row.name);
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
