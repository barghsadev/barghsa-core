/* global __ENV, open */
import { check } from 'k6';
import { scenario } from 'k6/execution';
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';

const fixture = JSON.parse(open(__ENV.BARGHSA_PERFORMANCE_INPUT));
const loopback = /^http:\/\/127\.0\.0\.1:\d+$/;
if (!loopback.test(fixture.api) || !loopback.test(fixture.operations)) {
  throw new Error('Load scenarios require the isolated loopback fixtures');
}

const budgets = {
  electricity_preview: 300,
  order_submission: 500,
  wallet_payment: 500,
  invoice_list: 300,
  crm_search: 300,
  upload_authorization: 500,
  notification_fanout: 500,
};
const measurements = {};
const thresholds = { checks: ['rate==1'] };
for (const [name, budget] of Object.entries(budgets)) {
  const duration = new Trend(`${name}_duration`, true);
  const completed = new Counter(`${name}_completed`);
  measurements[name] = { duration, completed };
  thresholds[`${name}_duration`] = [`p(95)<${budget * 1.2}`];
  thresholds[`${name}_completed`] = [`count>=${fixture.samples}`];
}

export const options = {
  scenarios: {
    weekly: {
      executor: 'shared-iterations',
      vus: fixture.concurrency,
      iterations: fixture.samples,
      maxDuration: '10m',
    },
  },
  maxRedirects: 0,
  summaryTrendStats: ['med', 'p(95)', 'p(99)'],
  thresholds,
};

function request(base, path, name, headers, status, validate, body) {
  const params = { headers, tags: { name }, timeout: '5s' };
  const response =
    body === undefined
      ? http.get(`${base}${path}`, params)
      : http.post(`${base}${path}`, JSON.stringify(body), params);
  let data;
  if (response.status === status) {
    try {
      data = response.json();
    } catch {
      // Treat invalid JSON like a failed status and keep response data private.
    }
  }
  if (!check(data, { [name]: (value) => value !== undefined && validate(value) })) {
    console.error(`${name} returned an unexpected response (HTTP ${response.status})`);
    return undefined;
  }
  const measurement = measurements[name];
  if (measurement) {
    measurement.duration.add(response.timings.duration);
    measurement.completed.add(1);
  }
  return data;
}

export default function () {
  const actor = fixture.actors[scenario.iterationInTest];
  const headers = {
    Cookie: `barghsa_session=${actor.sessionId}`,
    'X-CSRF-Token': actor.csrf,
    'Content-Type': 'application/json',
    'Accept-Language': actor.locale,
  };
  const quoteInput = { profileId: actor.profileId, period: 'next_week', totalKwh: '10' };
  const quote = request(
    fixture.api,
    '/api/electricity/preview/simple',
    'electricity_preview',
    headers,
    200,
    (value) => typeof value?.reviewDigest === 'string',
    quoteInput
  );
  if (quote) {
    request(
      fixture.api,
      '/api/electricity/orders/simple',
      'order_submission',
      headers,
      201,
      (value) => Boolean(value?.orderId && value?.contractId && value?.invoiceId),
      {
        ...quoteInput,
        expectedQuoteDigest: quote.reviewDigest,
        idempotencyKey: actor.orderKey,
        address: { ...fixture.address, fullAddress: actor.street },
      }
    );
  }

  const walletPath = `/api/invoices/${actor.invoiceId}/wallet-payment`;
  const review = request(
    fixture.api,
    walletPath,
    'wallet_payment_review',
    headers,
    200,
    (value) => typeof value?.review?.hash === 'string'
  );
  if (review) {
    request(
      fixture.api,
      walletPath,
      'wallet_payment',
      headers,
      200,
      (value) => Boolean(value?.walletTransactionId && value?.reviewHash === review.review.hash),
      {
        idempotencyKey: actor.paymentKey,
        expectedRemainingAmount: '100000',
        expectedReviewHash: review.review.hash,
      }
    );
  }

  request(fixture.api, '/api/invoices?limit=20', 'invoice_list', headers, 200, (value) =>
    Array.isArray(value?.items ?? value?.invoices)
  );
  request(
    fixture.api,
    `/api/crm/users?limit=20&search=${encodeURIComponent(actor.search)}`,
    'crm_search',
    { Cookie: `barghsa_session=${fixture.staffSession}`, 'Accept-Language': actor.locale },
    200,
    (value) => Array.isArray(value?.users) && value.users.length > 0
  );
  request(
    fixture.api,
    '/api/upload/presigned-url',
    'upload_authorization',
    headers,
    200,
    (value) =>
      typeof value?.key === 'string' &&
      typeof value?.presignedUrl === 'string' &&
      value?.headers?.['If-None-Match'] === '*',
    {
      category: 'document',
      fileName: actor.fileName,
      contentType: 'application/pdf',
      fileSize: 128,
    }
  );
  request(
    fixture.operations,
    '/operations/alerts',
    'notification_fanout',
    { Authorization: `Bearer ${fixture.alertSecret}`, 'Content-Type': 'application/json' },
    200,
    (value) => value?.receipts?.length === 1 && value.receipts[0].inserted === true,
    {
      alerts: [
        {
          status: 'firing',
          fingerprint: actor.orderKey.replace(/-/g, ''),
          startsAt: fixture.startsAt,
          labels: {
            alertname: 'SmsProviderLowCredit',
            environment: 'isolated-load',
            database: 'fixture',
            severity: 'warning',
            priority: 'P2',
          },
        },
      ],
    }
  );
}

export function handleSummary(data) {
  const operations = Object.entries(budgets).map(([operation, budgetP95Ms]) => {
    const duration = data.metrics[`${operation}_duration`];
    const completed = data.metrics[`${operation}_completed`]?.values.count ?? 0;
    const p95Ms = duration?.values['p(95)'] ?? null;
    return {
      operation,
      completed,
      budgetP95Ms,
      regressionThresholdMs: budgetP95Ms * 1.2,
      p50Ms: duration?.values.med ?? null,
      p95Ms,
      p99Ms: completed >= 1000 ? (duration?.values['p(99)'] ?? null) : null,
      withinBudget: p95Ms !== null && p95Ms < budgetP95Ms,
      regression: p95Ms === null || p95Ms >= budgetP95Ms * 1.2 || completed < fixture.samples,
    };
  });
  const report = JSON.stringify(
    {
      source: fixture.source,
      environment: 'isolated-load',
      concurrency: fixture.concurrency,
      requestedSamples: fixture.samples,
      warmupIterations: 0,
      dataset: {
        customerAccounts: fixture.samples,
        backgroundProfiles: fixture.background,
        seededInvoices: 13 * fixture.samples,
        operationsRecipients: 3,
      },
      failedChecks: data.metrics.checks?.values.fails ?? null,
      operations,
    },
    null,
    2
  );
  return { stdout: `${report}\n`, [__ENV.BARGHSA_PERFORMANCE_REPORT]: `${report}\n` };
}
