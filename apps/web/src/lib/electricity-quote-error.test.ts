import { expect, it } from 'vitest';
import { electricityQuoteError } from './electricity-quote-error.js';

const response = (body: unknown, status = 400) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

it('explains the configured green limit without changing the required quantity', async () => {
  const body = {
    error: 'ELECTRICITY_QUOTE_INVALID',
    details: [{ code: 'PRODUCT_MAX_KWH', systemKey: 'green', requiredKwh: '5', limitKwh: '4' }],
  };
  expect(await electricityQuoteError(response(body), 'en')).toContain(
    'requires 5 kWh of Green electricity, but the product maximum is 4 kWh'
  );
  const persian = await electricityQuoteError(response(body), 'fa');
  expect(persian).toContain('برق سبز');
  expect(persian).toContain('۵');
  expect(persian).toContain('۴');
});

it('explains a minimum and falls back for unexpected errors', async () => {
  const minimum = {
    error: 'ELECTRICITY_QUOTE_INVALID',
    details: [{ code: 'PRODUCT_MIN_KWH', systemKey: 'thermal', requiredKwh: '10' }],
  };
  expect(await electricityQuoteError(response(minimum), 'en')).toContain(
    'minimum for Thermal electricity is 10 kWh'
  );
  expect(
    await electricityQuoteError(response({ message: 'internal details' }), 'en')
  ).not.toContain('internal details');
  expect(await electricityQuoteError(response(minimum, 500), 'en')).toContain(
    'Price calculation failed'
  );
});

it('identifies unavailable required products and mandatory green supply', async () => {
  for (const detail of [
    { code: 'PRODUCT_UNAVAILABLE', systemKey: 'thermal' },
    { code: 'GREEN_RULE_UNAVAILABLE' },
  ]) {
    const body = { error: 'ELECTRICITY_QUOTE_INVALID', details: [detail] };
    expect(await electricityQuoteError(response(body), 'en')).toBe(
      'Ordering this product is temporarily unavailable.'
    );
    expect(await electricityQuoteError(response(body), 'fa')).toContain('موقتاً');
  }
});
