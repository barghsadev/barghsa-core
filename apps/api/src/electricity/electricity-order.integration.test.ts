import { afterEach, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let headers: Record<string, string>;
let input: Record<string, unknown>;

beforeEach(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES('buyer','buyer@electricity.test','test-only')"
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES($1,'buyer',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
    [session, csrf, randomUUID()]
  );
  headers = {
    Cookie: `barghsa_session=${session}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
  const profileId = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES('buyer','LEGAL','ACTIVE') RETURNING id"
    )
  ).rows[0].id;
  await http.pool.query(
    `INSERT INTO products(type,system_key,title,status,price)
     VALUES ('electricity','thermal','{"en":"Thermal"}','active',100000)
     ON CONFLICT (system_key) DO UPDATE SET status='active',price=100000`
  );
  await http.pool.query(
    `INSERT INTO products(type,system_key,title,status,price)
     VALUES ('electricity','green','{"en":"Green"}','active',200000)
     ON CONFLICT (system_key) DO UPDATE SET status='active',price=200000`
  );
  const provinceId = (
    await http.pool.query(
      "INSERT INTO provinces(name_fa,name_en) VALUES('استان','Province') RETURNING id"
    )
  ).rows[0].id;
  const cityId = (
    await http.pool.query(
      "INSERT INTO cities(province_id,name_fa,name_en) VALUES($1,'شهر','City') RETURNING id",
      [provinceId]
    )
  ).rows[0].id;
  input = {
    profileId,
    period: 'next_week',
    totalKwh: '10',
    idempotencyKey: randomUUID(),
    address: { provinceId, cityId, fullAddress: 'Electricity Street', postalCode: '1234567890' },
  };
  await refreshQuote();
}, 40000);
afterEach(async () => {
  await http?.close();
}, 15000);

const post = (path: string, body: unknown) =>
  fetch(`${http.base}/api/electricity/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

async function refreshQuote() {
  const response = await post('preview/simple', {
    profileId: input.profileId,
    period: input.period,
    totalKwh: input.totalKwh,
    ...('giftCode' in input ? { giftCode: input.giftCode } : {}),
  });
  expect(response.status, http.logs()).toBe(200);
  input.expectedQuoteDigest = ((await response.json()) as { reviewDigest: string }).reviewDigest;
}

it('previews and atomically submits an order, contract, lines and payable invoice once', async () => {
  const preview = await post('preview/simple', {
    profileId: input.profileId,
    period: input.period,
    totalKwh: input.totalKwh,
  });
  expect(preview.status, http.logs()).toBe(200);
  const quote = (await preview.json()) as Record<string, unknown>;
  expect(quote).toMatchObject({ totalKwh: '10', subtotalIrR: '1000000', totalIrR: '1000000' });
  const first = await post('orders/simple', input);
  expect(first.status, http.logs()).toBe(201);
  const result = (await first.json()) as {
    orderId: string;
    contractId: string;
    invoiceId: string;
    totalIrR: string;
  };
  expect(result.totalIrR).toBe('1000000');
  const repeat = await post('orders/simple', input);
  expect(repeat.status, http.logs()).toBe(201);
  expect(await repeat.json()).toEqual(result);
  const altered = await post('orders/simple', { ...input, totalKwh: '11' });
  expect(altered.status).toBe(409);
  const saved = (
    await http.pool.query(
      `SELECT o.status AS order_status,e.status AS electricity_status,e.total_kwh,
            c.state AS contract_state,i.state AS invoice_state,i.total_amount,
            (SELECT COUNT(*)::int FROM electricity_order_lines WHERE order_id=o.id) AS line_count
       FROM orders o JOIN electricity_orders e ON e.id=o.id
       JOIN contracts c ON c.id=$2 JOIN invoices i ON i.id=$3 WHERE o.id=$1`,
      [result.orderId, result.contractId, result.invoiceId]
    )
  ).rows[0];
  expect(saved).toMatchObject({
    order_status: 'PENDING',
    electricity_status: 'awaiting_staff_review',
    total_kwh: '10',
    contract_state: 'AwaitingStaffReview',
    invoice_state: 'Unpaid',
    total_amount: '1000000',
    line_count: 1,
  });
  const count = (
    await http.pool.query(
      'SELECT COUNT(*)::int AS count FROM electricity_order_submissions WHERE user_id=$1',
      ['buyer']
    )
  ).rows[0].count;
  expect(count).toBe(1);
});

it('allows manual quantity when bill provider is unconfigured', async () => {
  const response = await fetch(
    `${http.base}/api/electricity/bill-data/${input.profileId}?period=next_week`,
    { headers }
  );
  expect(response.status, http.logs()).toBe(200);
  expect(await response.json()).toMatchObject({ available: false, manualEntryAllowed: true });
});

it('freezes the mandatory green and gift composition into one invoice', async () => {
  await http.pool.query(
    `INSERT INTO app_config(key,value,version) VALUES('electricity.green_mandatory_rules',$1::jsonb,1)`,
    [
      JSON.stringify({
        simple_order: {
          mandatory_green_enabled: true,
          average_power_threshold_kw: 0,
          mandatory_green_share_percent: 20,
        },
        advanced_order: {
          mandatory_green_enabled: false,
          average_power_threshold_kw: 1000,
          mandatory_green_share_percent: 4,
        },
      }),
    ]
  );
  await http.pool.query(
    `INSERT INTO gift_codes(code,discount_type,discount_value,valid_from,created_by)
     VALUES('POWER','fixed_irr',100000,'2026-01-01','buyer')`
  );
  input.giftCode = 'power';
  await refreshQuote();
  const response = await post('orders/simple', input);
  expect(response.status, http.logs()).toBe(201);
  const order = (await response.json()) as {
    orderId: string;
    invoiceId: string;
    lines: Array<{ systemKey: string; quantityKwh: string }>;
    totalIrR: string;
    discountIrR: string;
  };
  expect(order.lines.map((line) => [line.systemKey, line.quantityKwh])).toEqual([
    ['thermal', '8'],
    ['green', '2'],
  ]);
  expect(order.discountIrR).toBe('100000');
  expect(order.totalIrR).toBe('1100000');
  const invoice = (
    await http.pool.query(
      `SELECT i.total_amount, i.invoice_calculation_snapshot, o.gift_discount_amount,
            (SELECT COUNT(*)::int FROM invoice_lines WHERE invoice_id=i.id) AS line_count
       FROM invoices i JOIN orders o ON o.id=i.order_id WHERE i.id=$1`,
      [order.invoiceId]
    )
  ).rows[0];
  expect(invoice).toMatchObject({
    total_amount: '1100000',
    gift_discount_amount: '100000',
    line_count: 2,
  });
  expect(invoice.invoice_calculation_snapshot.lines).toHaveLength(2);
});

it('serializes concurrent retries and rolls back rejected product submissions', async () => {
  const [first, second] = await Promise.all([
    post('orders/simple', input),
    post('orders/simple', input),
  ]);
  expect(first.status, http.logs()).toBe(201);
  expect(second.status, http.logs()).toBe(201);
  expect(await first.json()).toEqual(await second.json());
  await http.pool.query("UPDATE products SET status='inactive' WHERE system_key='thermal'");
  const failed = await post('orders/simple', { ...input, idempotencyKey: randomUUID() });
  expect(failed.status).toBe(400);
  const count = (
    await http.pool.query('SELECT COUNT(*)::int AS n FROM orders WHERE user_id=$1', ['buyer'])
  ).rows[0].n;
  expect(count).toBe(1);
});

it('rejects a reviewed quote after its authoritative price changes', async () => {
  await http.pool.query("UPDATE products SET price=150000 WHERE system_key='thermal'");
  const response = await post('orders/simple', input);
  expect(response.status, http.logs()).toBe(409);
  const count = (
    await http.pool.query('SELECT COUNT(*)::int AS n FROM orders WHERE user_id=$1', ['buyer'])
  ).rows[0].n;
  expect(count).toBe(0);
});
