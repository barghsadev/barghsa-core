import { expect, it } from 'vitest';
import {
  contractDraftContent,
  contractContextBody,
  contractAuthoringOptions,
  contractActivationData,
  matchedContractAuthoringReceipt,
  type ContractAuthoringEvidence,
} from './contract-authoring-form.js';
import {
  contractDraftSchema,
  contractContextSchema,
} from './contract-review-signature-form-schemas.js';
import {
  contract,
  version,
  context,
  values,
  PROFILE,
  ORDER,
  actor,
  authoringReceipt,
} from './contract-authoring-form.fixtures.js';
const captured: ContractAuthoringEvidence = {
  kind: 'revise',
  actor,
  existing: { contract, version },
  body: { content: { ...version.content, text: 'Changed' }, changeDescription: 'Revision' },
};
it('preserves imported opaque content and exact unchanged whitespace while switching hidden commercial drafts', () => {
  const original = { title: { fa: 'Imported' }, text: ' Keep ', unknown: ['raw', { a: false }] };
  expect(
    contractDraftContent(original, {
      ...values,
      text: ' Keep ',
      commercialValueKind: 'fixed',
      commercialValueAmountIrr: '9007199254740993',
    })
  ).toEqual({ ...original, commercialValue: { kind: 'fixed', amountIrr: '9007199254740993' } });
  expect(
    contractDraftContent(original, {
      ...values,
      text: ' Keep ',
      commercialValueKind: 'variable',
      commercialValueDescription: ' Variable ',
    })
  ).toEqual({ ...original, commercialValue: { kind: 'variable', description: 'Variable' } });
});
it('preserves exact original seconds and validates native timezone/DST/end ordering without rounding', () => {
  const raw = {
    initialInvoiceId: '',
    serviceStartsAt: '2026-09-22T03:30',
    serviceEndsAt: '2026-11-22T03:30',
    changeDescription: 'Extend',
  };
  expect(contractContextBody(context, raw, 'Asia/Tehran')).toEqual({
    initialInvoiceId: null,
    serviceStartsAt: context.serviceStartsAt,
    serviceEndsAt: '2026-11-22T00:00:00.000Z',
  });
  expect(
    contractContextSchema(
      (values) =>
        contractContextBody(
          { ...context, serviceStartsAt: null, serviceEndsAt: null },
          values,
          'America/New_York'
        ),
      (k) => k
    ).safeParse({ ...raw, serviceStartsAt: '2027-03-14T02:30' }).success
  ).toBe(false);
  expect(
    contractContextSchema(
      (values) => contractContextBody(context, values, 'Asia/Tehran'),
      (k) => k
    ).safeParse({
      ...raw,
      serviceEndsAt: '2026-09-21T03:30',
    }).success
  ).toBe(false);
});
it('enforces original int8/commercial/UTF8 rules while accepting structured imported title and zero', () => {
  const schema = contractDraftSchema(
    {},
    false,
    [PROFILE],
    [],
    (k) => k,
    (values) => contractDraftContent({}, values)
  );
  expect(
    schema.safeParse({ ...values, commercialValueKind: 'fixed', commercialValueAmountIrr: '0' })
      .success
  ).toBe(true);
  expect(
    schema.safeParse({
      ...values,
      commercialValueKind: 'fixed',
      commercialValueAmountIrr: '9223372036854775807',
    }).success
  ).toBe(true);
  expect(
    schema.safeParse({
      ...values,
      commercialValueKind: 'fixed',
      commercialValueAmountIrr: '9223372036854775808',
    }).success
  ).toBe(false);
  expect(schema.safeParse({ ...values, text: 'ب'.repeat(33000) }).success).toBe(false);
  expect(
    contractDraftSchema(
      { title: { en: 'Imported' } },
      true,
      [],
      [],
      (k) => k,
      (values) => contractDraftContent({ title: { en: 'Imported' } }, values)
    ).safeParse({
      ...values,
      title: '',
    }).success
  ).toBe(true);
});
it('accepts complete real staff receipts without absent publishedAt/savingOrderId, including JSONB key ordering', () => {
  const receipt = authoringReceipt(captured);
  expect(receipt).not.toHaveProperty('savingOrderId');
  expect(receipt.currentVersion).not.toHaveProperty('publishedAt');
  const row = receipt.currentVersion as Record<string, unknown>;
  row.content = { text: 'Changed', opaque: { policy: [false, 'keep'] }, title: ' Original ' };
  expect(matchedContractAuthoringReceipt(receipt, captured)).toBe(true);
  const create: ContractAuthoringEvidence = {
    kind: 'create',
    actor: captured.actor,
    body: {
      profileId: PROFILE,
      serviceType: 'solar',
      content: { title: 'New', text: 'Terms' },
      changeDescription: 'Initial',
    },
  };
  expect(matchedContractAuthoringReceipt(authoringReceipt(create), create)).toBe(true);
});
it.each([
  'profile',
  'contract',
  'version-contract',
  'number',
  'content',
  'reason',
  'actor',
  'state',
  'partial',
] as const)('rejects a %s receipt without proving an unrelated write', (kind) => {
  const receipt = authoringReceipt(captured),
    row = receipt.currentVersion as Record<string, unknown>;
  if (kind === 'profile') receipt.profileId = ORDER;
  if (kind === 'contract') receipt.id = ORDER;
  if (kind === 'version-contract') row.contractId = ORDER;
  if (kind === 'number') row.versionNumber = 99;
  if (kind === 'content') row.content = { title: 'Forged' };
  if (kind === 'reason') row.changeDescription = 'Other';
  if (kind === 'actor') row.createdBy = 'other';
  if (kind === 'state') receipt.state = 'Active';
  if (kind === 'partial') delete receipt.updatedAt;
  expect(matchedContractAuthoringReceipt(receipt, captured)).toBe(false);
});
it('binds amendment to the unchanged effective base and actual pending metadata rather than invented new content', () => {
  const amendment = {
    ...captured,
    kind: 'amendment' as const,
    existing: { contract: { ...contract, state: 'Accepted' as const }, version },
  };
  const receipt = authoringReceipt(amendment);
  expect(matchedContractAuthoringReceipt(receipt, amendment)).toBe(true);
  (receipt.pendingAmendment as Record<string, unknown>).baseVersionId = ORDER;
  expect(matchedContractAuthoringReceipt(receipt, amendment)).toBe(false);
});
it('accepts the service original unchanged Draft result for a semantic JSONB no-op', () => {
  const unchanged = {
    ...captured,
    body: { content: version.content, changeDescription: 'New reason' },
  };
  const receipt = {
    ...authoringReceipt(unchanged),
    currentVersionId: version.id,
    currentVersion: version,
  };
  expect(matchedContractAuthoringReceipt(receipt, unchanged)).toBe(true);
  expect(
    matchedContractAuthoringReceipt(receipt, {
      ...unchanged,
      existing: { contract: { ...contract, state: 'ChangesRequested' }, version },
    })
  ).toBe(false);
});
it('accepts real names-only choices/complete context and rejects duplicate or coerced enums/cursors', () => {
  expect(
    contractAuthoringOptions(
      { profiles: [{ id: PROFILE, title: 'Acme', profileType: 'LEGAL' }], nextBefore: null },
      false
    )?.rows
  ).toHaveLength(1);
  expect(
    contractAuthoringOptions(
      {
        orders: [{ id: ORDER, serviceType: ['electricity'], createdAt: version.createdAt }],
        nextBefore: null,
      },
      true
    )
  ).toBeNull();
  expect(
    contractAuthoringOptions(
      { profiles: [{ id: PROFILE, title: 'Acme', profileType: ['LEGAL'] }], nextBefore: null },
      false
    )
  ).toBeNull();
  expect(
    contractAuthoringOptions(
      {
        profiles: [
          { id: PROFILE, title: 'Acme', profileType: 'LEGAL' },
          { id: PROFILE, title: 'Acme', profileType: 'LEGAL' },
        ],
        nextBefore: null,
      },
      false
    )
  ).toBeNull();
  expect(
    contractAuthoringOptions(
      { profiles: [{ id: PROFILE, title: 'Acme', profileType: 'LEGAL' }], nextBefore: PROFILE },
      false
    )
  ).toBeNull();
  expect(contractActivationData(context, contract.id, version.id)).toEqual(context);
  expect(
    contractActivationData(
      {
        ...context,
        checks: context.checks.map((item, index) =>
          index ? item : { ...item, key: ['staffApproval'] }
        ),
      },
      contract.id,
      version.id
    )
  ).toBeNull();
});

it('rejects Date.parse shorthand in a saved receipt, activation source and option row', () => {
  const receipt = authoringReceipt(captured);
  receipt.createdAt = '1';
  expect(matchedContractAuthoringReceipt(receipt, captured)).toBe(false);
  expect(
    contractActivationData({ ...context, serviceStartsAt: '1' }, contract.id, version.id)
  ).toBeNull();
  expect(
    contractAuthoringOptions(
      { orders: [{ id: ORDER, serviceType: 'solar', createdAt: '1' }], nextBefore: null },
      true
    )
  ).toBeNull();
});

it('requires nonempty emitted content when clearing an imported commercial-only contract', () => {
  const original = { commercialValue: { kind: 'fixed', amountIrr: '0' } };
  const raw = { ...values, title: '', text: '', commercialValueKind: 'unstated' as const };
  expect(contractDraftContent(original, raw)).toEqual({});
  expect(
    contractDraftSchema(
      original,
      true,
      [],
      [],
      (k) => k,
      (values) => contractDraftContent(original, values)
    ).safeParse(raw).success
  ).toBe(false);
  expect(
    contractDraftSchema(
      original,
      true,
      [],
      [],
      (k) => k,
      (values) => contractDraftContent(original, values)
    ).safeParse({
      ...raw,
      text: 'Replacement terms',
    }).success
  ).toBe(true);
});
