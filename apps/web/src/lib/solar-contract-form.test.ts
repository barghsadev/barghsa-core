import { expect, it } from 'vitest';
import { solarContractSchema } from './solar-contract-form-schemas.js';
import {
  matchedSolarContractReview,
  solarContractBody,
  solarContractFields,
  solarContractOptions,
  solarContractReceipt,
  solarContractRejection,
} from './solar-contract-form.js';
import {
  contractDraft,
  contractOptions,
  contractReview,
  createdContract,
  solarOwnedError,
  solarRequestId,
  solarProfileId,
  solarCommandKey,
  solarDocumentId,
  solarCreatedId,
} from '../test/solar-contract-fixtures.js';
const messages = Object.fromEntries(
  [
    'source',
    'title',
    'text',
    'changeDescription',
    'valueKind',
    'fixedAmount',
    'variableDescription',
    'invoiceLines',
    'description',
    'quantity',
    'unitPrice',
    'vatRate',
    'isTaxable',
  ].map((key) => [key, key])
);
const schema = solarContractSchema(messages, contractOptions);
it('preserves fixed int8 commercial value independent of invoice, zero prices/leading zeros, variable inactive draft and half-up/non-taxable VAT', () => {
  const draft = contractDraft();
  draft.fixedAmount = '9223372036854775807';
  draft.invoiceLines = [
    { description: 'Taxed', quantity: '3', unitPrice: '00005', vatRate: '1000', isTaxable: true },
    { description: 'Untaxed', quantity: '2', unitPrice: '60', vatRate: '5000', isTaxable: false },
    { description: 'Free', quantity: '1', unitPrice: '0', vatRate: '10000', isTaxable: true },
  ];
  expect(schema.safeParse(draft).success).toBe(true);
  const body = solarContractBody(draft, solarProfileId, solarCommandKey);
  const review = contractReview(body);
  expect(review.data.invoiceLines.map((line) => line.vatAmount)).toEqual(['2', '0', '0']);
  expect(review.data.totals.total).toBe('137');
  expect(matchedSolarContractReview(review, solarRequestId, body, contractOptions)).toEqual(review);
  draft.valueKind = 'variable';
  draft.source = 'document:' + solarDocumentId;
  draft.fixedAmount = 'broken hidden draft';
  expect(schema.safeParse(draft).success).toBe(true);
});
it.each([
  [
    'blank title',
    (d: ReturnType<typeof contractDraft>) => {
      d.title = ' ';
    },
    'title',
  ],
  [
    'fixed leading zero',
    (d: ReturnType<typeof contractDraft>) => {
      d.fixedAmount = '01';
    },
    'fixedAmount',
  ],
  [
    'fixed overflow',
    (d: ReturnType<typeof contractDraft>) => {
      d.fixedAmount = '9223372036854775808';
    },
    'fixedAmount',
  ],
  [
    'malformed row price without throwing',
    (d: ReturnType<typeof contractDraft>) => {
      d.invoiceLines[0]!.unitPrice = 'x';
    },
    'invoiceLines.0.unitPrice',
  ],
  [
    'row overflow',
    (d: ReturnType<typeof contractDraft>) => {
      d.invoiceLines[0]!.unitPrice = '9223372036854775808';
    },
    'invoiceLines.0.unitPrice',
  ],
  [
    'quantity overflow',
    (d: ReturnType<typeof contractDraft>) => {
      d.invoiceLines[0]!.quantity = '2147483648';
    },
    'invoiceLines.0.quantity',
  ],
  [
    'VAT fractional',
    (d: ReturnType<typeof contractDraft>) => {
      d.invoiceLines[0]!.vatRate = '1.5';
    },
    'invoiceLines.0.vatRate',
  ],
  [
    'zero invoice total',
    (d: ReturnType<typeof contractDraft>) => {
      d.invoiceLines[0]!.unitPrice = '0';
    },
    'invoiceLines.0.unitPrice',
  ],
  [
    'aggregate overflow',
    (d: ReturnType<typeof contractDraft>) => {
      d.invoiceLines[0]!.unitPrice = '9223372036854775807';
      d.invoiceLines[0]!.quantity = '2';
    },
    'invoiceLines.0.unitPrice',
  ],
  [
    'UTF8 contract limit',
    (d: ReturnType<typeof contractDraft>) => {
      d.text = 'ش'.repeat(33000);
    },
    'text',
  ],
  [
    'unavailable source',
    (d: ReturnType<typeof contractDraft>) => {
      d.source = 'template:' + solarCreatedId;
    },
    'source',
  ],
] as const)('rejects %s at the linked owned field', (_, change, field) => {
  const draft = contractDraft();
  change(draft);
  const result = schema.safeParse(draft);
  expect(result.success).toBe(false);
  if (!result.success)
    expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain(field);
});
it('bounds rows and complete conditional text while retaining raw drafts', () => {
  const draft = contractDraft();
  draft.valueKind = 'variable';
  draft.variableDescription = 'x'.repeat(501);
  expect(schema.safeParse(draft).success).toBe(false);
  draft.variableDescription = '  valid rule  ';
  draft.title = 'x'.repeat(201);
  expect(schema.safeParse(draft).success).toBe(false);
  draft.title = 'valid';
  draft.invoiceLines = [];
  expect(schema.safeParse(draft).success).toBe(false);
  draft.invoiceLines = Array.from({ length: 101 }, () => contractDraft().invoiceLines[0]!);
  expect(schema.safeParse(draft).success).toBe(false);
  expect(draft.variableDescription).toBe('  valid rule  ');
});
it.each([
  'scope',
  'request',
  'terms',
  'commercial',
  'source',
  'order',
  'line',
  'totals',
  'due',
  'outcome',
] as const)('rejects complete but mismatched preview %s', (kind) => {
  const body = solarContractBody(contractDraft(), solarProfileId, solarCommandKey),
    review = contractReview(body);
  if (kind === 'scope') review.scope.resourceId = solarCreatedId;
  if (kind === 'request') review.data.requestId = solarCreatedId;
  if (kind === 'terms') review.data.text += ' altered';
  if (kind === 'commercial') review.data.commercialValue = { kind: 'fixed', amountIrr: '1' };
  if (kind === 'source') review.data.source.label = 'Foreign label';
  if (kind === 'order') {
    body.invoiceLines.push({ ...body.invoiceLines[0]!, description: 'Second' });
    review.data.invoiceLines.push({ ...review.data.invoiceLines[0]!, description: 'Wrong order' });
  }
  if (kind === 'line') review.data.invoiceLines[0]!.vatAmount = '1';
  if (kind === 'totals') review.data.totals.total = '1';
  if (kind === 'due') review.data.dueRule.configDays = 8;
  if (kind === 'outcome') review.data.outcome = 'published';
  expect(matchedSolarContractReview(review, solarRequestId, body, contractOptions)).toBeNull();
});
it('accepts semantic JSONB key order but rejects missing rows/due rule and stale option labels', () => {
  const body = solarContractBody(contractDraft(), solarProfileId, solarCommandKey),
    review = contractReview(body);
  review.data.invoiceLines[0] = Object.fromEntries(
    Object.entries(review.data.invoiceLines[0]!).reverse()
  ) as (typeof review.data.invoiceLines)[number];
  expect(matchedSolarContractReview(review, solarRequestId, body, contractOptions)).toEqual(review);
  expect(
    matchedSolarContractReview(review, solarRequestId, body, { ...contractOptions, templates: [] })
  ).toBeNull();
  expect(
    matchedSolarContractReview(
      { ...review, data: { ...review.data, dueRule: { configDays: 7 } } },
      solarRequestId,
      body,
      contractOptions
    )
  ).toBeNull();
});
it('validates exact actual receipt keys, one distinct invoice identity and literal status', () => {
  expect(solarContractReceipt(createdContract)).toEqual({ contractId: createdContract.contractId });
  for (const value of [
    { ...createdContract, status: 'approved' },
    { ...createdContract, contractId: 'truthy' },
    { ...createdContract, invoiceIds: [] },
    { ...createdContract, invoiceIds: [solarCreatedId] },
    {
      ...createdContract,
      invoiceIds: [...createdContract.invoiceIds, ...createdContract.invoiceIds],
    },
    { ...createdContract, financialReview: contractReview() },
  ])
    expect(solarContractReceipt(value)).toBeNull();
});
it('maps only complete owned active branch/row fields and rejects protected/mixed metadata', () => {
  const draft = contractDraft();
  expect(
    solarContractFields(['title', 'invoiceLine0UnitPrice', 'sourceTemplateVersionId'], draft)
  ).toEqual(['title', 'invoiceLines.0.unitPrice', 'source']);
  for (const fields of [
    ['title', 'profileId'],
    ['expectedReviewHash'],
    ['invoiceLine99UnitPrice'],
    ['commercialValueDescription'],
    [],
    ['sourceDocumentId'],
  ])
    expect(solarContractFields(fields, draft)).toBeNull();
  expect(solarContractRejection(solarOwnedError(['title']))).not.toBeNull();
  expect(
    solarContractRejection({ error: { ...solarOwnedError([]).error, code: 'UNKNOWN' } })
  ).toBeNull();
  expect(
    solarContractRejection({ error: { ...solarOwnedError([]).error, correlationId: 'not-uuid' } })
  ).toBeNull();
});
it('rejects malformed/duplicate private option identities', () => {
  expect(solarContractOptions(contractOptions)).toEqual(contractOptions);
  expect(
    solarContractOptions({
      ...contractOptions,
      templates: [...contractOptions.templates, ...contractOptions.templates],
    })
  ).toBeNull();
  expect(
    solarContractOptions({
      ...contractOptions,
      documents: [{ id: 'bad', original_name: 'Private.pdf' }],
    })
  ).toBeNull();
});
