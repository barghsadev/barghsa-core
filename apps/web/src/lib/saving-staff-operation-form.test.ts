import { expect, it } from 'vitest';
import { savingOperationSchema } from './saving-staff-operation-form-schemas.js';
import {
  matchedSavingOperationReceipt,
  matchedSavingOperationReview,
  savingOperationFields,
  savingOperationPreviewBody,
  type SavingOperationIntent,
} from './saving-staff-operation-form.js';
import {
  savingDecisionReview,
  savingOperationOrder,
  savingStageReview,
  savingOperationReceipt,
} from '../test/saving-staff-operation-fixtures.js';

const messages = { note: 'note invalid', handover: 'handover invalid' };
it('validates consumed intent fields without changing raw or unused drafts', () => {
  const raw = { note: ' ' + 'x'.repeat(1000) + ' ', handover: ' ' };
  const reject: SavingOperationIntent = { kind: 'decision', action: 'reject' };
  expect(savingOperationSchema(reject, messages).safeParse(raw).success).toBe(true);
  expect(
    savingOperationSchema(reject, messages).safeParse({ ...raw, note: 'x'.repeat(1001) }).success
  ).toBe(false);
  expect(
    savingOperationSchema({ kind: 'decision', action: 'approve' }, messages).safeParse({
      note: 'x'.repeat(1001),
      handover: 'x'.repeat(1001),
    }).success
  ).toBe(true);
  expect(savingOperationPreviewBody(reject, raw)).toEqual({
    action: 'reject',
    reason: 'x'.repeat(1000),
  });
  expect(raw.note).toBe(' ' + 'x'.repeat(1000) + ' ');
});
it('requires handover only for completion and binds any supplied descriptor on skip', () => {
  const skip: SavingOperationIntent = {
    kind: 'stage',
    stage: 'equipment_handover',
    action: 'skip',
  };
  expect(
    savingOperationSchema(skip, messages).safeParse({ note: ' explain ', handover: '' }).success
  ).toBe(true);
  expect(
    savingOperationSchema({ ...skip, action: 'complete' }, messages).safeParse({
      note: ' explain ',
      handover: '',
    }).success
  ).toBe(false);
  expect(
    savingOperationSchema(skip, messages).safeParse({
      note: ' explain ',
      handover: 'x'.repeat(1001),
    }).success
  ).toBe(false);
  expect(
    savingOperationPreviewBody(skip, { note: ' explain ', handover: ' optional details ' })
  ).toEqual({
    expectedStatus: 'in_progress',
    explanation: 'explain',
    handoverDescription: 'optional details',
  });
});
it.each(['decision', 'stage'] as const)(
  'binds complete %s financial source independently of JSONB key ordering',
  (kind) => {
    const source = savingOperationOrder(kind);
    const intent: SavingOperationIntent =
      kind === 'decision'
        ? { kind, action: 'reject' }
        : { kind, stage: 'equipment_handover', action: 'skip' };
    const draft = { note: ' reason ', handover: '' };
    const value =
      kind === 'decision'
        ? savingDecisionReview(source, 'reject', draft.note)
        : savingStageReview(source, 'equipment_handover', 'skip', draft.note);
    expect(matchedSavingOperationReview(value, source, intent, draft)).not.toBeNull();
    const reordered = structuredClone(value);
    const reorderedLines = source.pricingSnapshot.lines.map((line) =>
      Object.fromEntries(Object.entries(line).reverse())
    );
    reordered.data.pricingSnapshot = {
      lines: reorderedLines,
      plan: source.pricingSnapshot.plan,
    };
    expect(matchedSavingOperationReview(reordered, source, intent, draft)).not.toBeNull();
    reorderedLines.reverse();
    expect(matchedSavingOperationReview(reordered, source, intent, draft)).toBeNull();
    for (const [name, wrong] of Object.entries({
      customerName: 'Other buyer',
      billIdentifier: 'other',
      agreementSnapshot: 'Other agreement',
      contractId: source.profileId,
      contractState: 'Completed',
      invoiceId: source.profileId,
      invoiceState: 'Cancelled',
      versionId: source.profileId,
    })) {
      expect(
        matchedSavingOperationReview(
          { ...value, data: { ...value.data, [name]: wrong } },
          source,
          intent,
          draft
        ),
        name
      ).toBeNull();
    }
    expect(
      matchedSavingOperationReview(
        { ...value, data: { ...value.data, pricingSnapshot: {} } },
        source,
        intent,
        draft
      )
    ).toBeNull();
    expect(
      matchedSavingOperationReview(
        {
          ...value,
          data: {
            ...value.data,
            [kind === 'decision' ? 'pendingRefundAmount' : 'pendingRefundAmountIrR']: '1',
          },
        },
        source,
        intent,
        draft
      )
    ).toBeNull();
  }
);
it('accepts actual lexical stage review order and rejects changed or duplicate stage identities', () => {
  const source = savingOperationOrder('stage');
  const intent: SavingOperationIntent = {
    kind: 'stage',
    stage: 'equipment_handover',
    action: 'skip',
  };
  const value = savingStageReview(source, intent.stage, intent.action, 'reason');
  expect(value.data.stages.map((row) => row.stage)).not.toEqual(
    source.stages.map((row) => row.stage)
  );
  expect(
    matchedSavingOperationReview(value, source, intent, { note: 'reason', handover: '' })
  ).not.toBeNull();
  expect(
    matchedSavingOperationReview(
      { ...value, data: { ...value.data, nextStage: 'product_delivery' } },
      source,
      intent,
      { note: 'reason', handover: '' }
    )
  ).toBeNull();
  const changed = structuredClone(value);
  changed.data.stages[0]!.status = 'completed';
  expect(
    matchedSavingOperationReview(changed, source, intent, { note: 'reason', handover: '' })
  ).toBeNull();
  changed.data.stages = [
    value.data.stages[0]!,
    value.data.stages[0]!,
    ...value.data.stages.slice(2),
  ];
  expect(
    matchedSavingOperationReview(changed, source, intent, { note: 'reason', handover: '' })
  ).toBeNull();
});
it('requires the exact decision outcome receipt, including the actual refund branch', () => {
  for (const [action, paid] of [
    ['approve', '0'],
    ['reject', '0'],
    ['reject', '300000'],
  ] as const) {
    const source = savingOperationOrder('decision', 'equipment_handover', paid);
    const intent: SavingOperationIntent = { kind: 'decision', action };
    const review = matchedSavingOperationReview(
      savingDecisionReview(source, action, 'reason'),
      source,
      intent,
      { note: 'reason', handover: '' }
    )!;
    const receipt = savingOperationReceipt(source, intent);
    expect(matchedSavingOperationReceipt(receipt, review)).toBe(true);
    if (action === 'reject' && paid === '0') {
      const wrong = savingDecisionReview(source, action, 'reason');
      expect(
        matchedSavingOperationReview(
          { ...wrong, data: { ...wrong.data, outcome: 'publish_contract' } },
          source,
          intent,
          { note: 'reason', handover: '' }
        )
      ).toBeNull();
    }
    for (const wrong of [
      { ...receipt, savingOrderId: source.profileId },
      { ...receipt, refundId: paid === '0' ? source.profileId : null },
      { ...receipt, status: 'completed' },
      { ...receipt, versionId: source.versionId },
    ])
      expect(matchedSavingOperationReceipt(wrong, review)).toBe(false);
  }
});
it('requires every stage receipt field, including terminal completion and optional skip', () => {
  for (const [stage, action] of [
    ['product_delivery', 'complete'],
    ['equipment_handover', 'skip'],
    ['process_completion', 'complete'],
  ] as const) {
    const source = savingOperationOrder('stage', stage);
    const intent: SavingOperationIntent = { kind: 'stage', stage, action };
    const review = matchedSavingOperationReview(
      savingStageReview(source, stage, action, 'reason'),
      source,
      intent,
      { note: 'reason', handover: '' }
    )!;
    const receipt = savingOperationReceipt(source, intent);
    expect(matchedSavingOperationReceipt(receipt, review)).toBe(true);
    for (const field of ['savingOrderId', 'status', 'stage', 'stageStatus', 'nextStage'])
      expect(matchedSavingOperationReceipt({ ...receipt, [field]: 'wrong' }, review)).toBe(false);
    expect(
      matchedSavingOperationReceipt({ ...receipt, expectedReviewHash: review.value.hash }, review)
    ).toBe(false);
  }
});
it('projects only editable identifiers for the captured intent', () => {
  const reject: SavingOperationIntent = { kind: 'decision', action: 'reject' };
  const stage: SavingOperationIntent = {
    kind: 'stage',
    stage: 'product_delivery',
    action: 'complete',
  };
  expect(savingOperationFields(['reason'], reject)).toEqual(['note']);
  expect(savingOperationFields(['explanation', 'handoverDescription'], stage)).toEqual([
    'note',
    'handover',
  ]);
  for (const fields of [
    [],
    ['expectedReviewHash'],
    ['reason', 'expectedVersionId'],
    ['constructor'],
    [['reason']],
  ])
    expect(savingOperationFields(fields, reject)).toBeNull();
  expect(savingOperationFields(['reason'], { kind: 'decision', action: 'approve' })).toBeNull();
});
