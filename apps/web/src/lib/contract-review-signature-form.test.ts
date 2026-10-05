import { expect, it } from 'vitest';
import { ErrorCodes } from '@barghsa/shared/errors';
import {
  contractSignatureView,
  signatureDocumentPage,
  signingDocuments,
  matchedSignatureReview,
  matchedSignatureReceipt,
  matchedChangesReceipt,
  sameContractEvidence,
  contractFormRejection,
} from './contract-review-signature-form.js';
import {
  contractChangesSchema,
  signatureRequestSchema,
  signatureRecordSchema,
} from './contract-review-signature-form-schemas.js';
import {
  actor,
  documentId,
  signingView,
  signingDocument,
  signingReview,
  signingSource,
  signingReceipt,
  changesReceipt,
  profileId,
  contractId,
  versionId,
} from '../test/contract-review-signature-fixtures.js';
it('retains raw drafts while wire validation trims only the owned reason', () => {
  const schema = contractChangesSchema('reason');
  expect(schema.safeParse({ reason: '  durable change  ' }).success).toBe(true);
  expect(schema.safeParse({ reason: ' ' }).success).toBe(false);
  expect(schema.safeParse({ reason: 'x'.repeat(1001) }).success).toBe(false);
  expect(
    signatureRequestSchema('doc', [documentId(1)]).safeParse({ originalDocumentId: documentId(2) })
      .success
  ).toBe(false);
  expect(
    signatureRecordSchema('doc', 'ack', [documentId(2)]).safeParse({
      signedDocumentId: documentId(2),
      acknowledged: false,
    }).success
  ).toBe(false);
});
it('accepts complete opaque staff actors and rejects staff attribution on customer views', () => {
  expect(contractSignatureView(signingView(true), true)).not.toBeNull();
  expect(contractSignatureView(signingView(true), false)).toBeNull();
  expect(
    contractSignatureView(
      { ...signingView(), request: { ...signingView().request, requestedBy: actor } },
      false
    )
  ).toBeNull();
  expect(contractSignatureView({ ...signingView(), signature: {} }, false)).toBeNull();
});
it('preserves non-PDF signed copies while originals require PDF and matching approved source', () => {
  const docs = [
    signingDocument(1, 'original'),
    signingDocument(2, 'signed', { detectedMime: 'image/png' }),
    signingDocument(3, 'original', { detectedMime: 'image/png' }),
    signingDocument(4, 'signed', { state: 'Available' }),
  ];
  expect(signingDocuments(docs, signingView(true), profileId, true).map((x) => x.id)).toEqual([
    documentId(1),
  ]);
  expect(signingDocuments(docs, signingView(), profileId, false).map((x) => x.id)).toEqual([
    documentId(2),
  ]);
  expect(
    signatureDocumentPage(
      { documents: docs, nextBefore: 'opaque-cursor' },
      profileId,
      contractId,
      versionId
    )?.nextBefore
  ).toBe('opaque-cursor');
  expect(
    signatureDocumentPage(
      { documents: [...docs, docs[0]], nextBefore: null },
      profileId,
      contractId,
      versionId
    )
  ).toBeNull();
});
it.each(['checksum', 'version', 'content', 'request', 'profile'] as const)(
  'rejects preview with changed %s evidence',
  async (kind) => {
    const view = signingView(),
      doc = signingDocument(),
      review = signingReview(view, doc);
    if (kind === 'checksum') review.data.signature!.signedDocument!.checksum = 'c'.repeat(64);
    if (kind === 'version') review.data.contract.versionId = documentId(9);
    if (kind === 'content') review.data.contract.content = { title: 'Other' };
    if (kind === 'request') review.data.signature!.requestId = documentId(9);
    if (kind === 'profile') review.scope.profileId = documentId(9);
    expect(
      await matchedSignatureReview(review, view, profileId, doc, false, signingSource())
    ).toBeNull();
  }
);
it.each([false, true])(
  'matches full %s record receipt and JSONB reordered objects',
  async (staff) => {
    const view = signingView(staff),
      doc = signingDocument(),
      review = signingReview(view, doc),
      receipt = signingReceipt(view, doc, review, staff);
    const reordered = JSON.parse(JSON.stringify(receipt), (_key, value: unknown) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse())
        : value
    );
    expect(
      await matchedSignatureReceipt(reordered, review, view, doc, staff, actor)
    ).not.toBeNull();
  }
);
it.each(['review', 'foreign', 'actor', 'document', 'flags', 'status', 'request'] as const)(
  'retains uncertainty on a malformed record %s',
  async (kind) => {
    const view = signingView(true),
      doc = signingDocument(),
      review = signingReview(view, doc),
      receipt = signingReceipt(view, doc, structuredClone(review), true);
    if (kind === 'review')
      receipt.financialReview.data.contract.content = { title: 'Changed but same hash' };
    if (kind === 'foreign') receipt.contractId = documentId(9);
    if (kind === 'actor') receipt.signature!.recordedBy = 'other';
    if (kind === 'document') receipt.signature!.signedDocumentId = documentId(9);
    if (kind === 'flags') receipt.canRecord = true;
    if (kind === 'status') receipt.state = 'Active';
    if (kind === 'request') receipt.request = { ...receipt.request!, requestNumber: 4 };
    expect(await matchedSignatureReceipt(receipt, review, view, doc, true, actor)).toBeNull();
  }
);
it.each(['Accepted', 'Signed', 'Active'] as const)(
  'matches amendment request and applied record from %s',
  async (state) => {
    const view = signingView(true, { state, isCurrent: false, isAmendment: true }),
      original = signingDocument(3, 'amendment'),
      signed = signingDocument();
    const requested = signingReview(view, original, true),
      recorded = signingReview(view, signed);
    expect(await matchedSignatureReview(requested, view, profileId, original, true)).not.toBeNull();
    expect(
      await matchedSignatureReceipt(
        signingReceipt(view, original, requested, true),
        requested,
        view,
        original,
        true,
        actor
      )
    ).not.toBeNull();
    expect(
      await matchedSignatureReceipt(
        signingReceipt(view, signed, recorded, true),
        recorded,
        view,
        signed,
        true,
        actor
      )
    ).not.toBeNull();
  }
);
it('checks exact request numbering and original evidence without requiring canRequest false', async () => {
  const view = signingView(true, { state: 'Accepted', request: null, canRecord: false }),
    doc = signingDocument(1, 'original'),
    review = signingReview(view, doc, true),
    receipt = signingReceipt(view, doc, review, true);
  expect(await matchedSignatureReceipt(receipt, review, view, doc, true, actor)).not.toBeNull();
  expect(
    await matchedSignatureReceipt(
      { ...receipt, request: { ...receipt.request!, requestNumber: 2 } },
      review,
      view,
      doc,
      true,
      actor
    )
  ).toBeNull();
});
it('checks actual request-changes result without inventing reason, history or review hash', () => {
  const source = signingSource({ state: 'AwaitingStaffReview' }),
    receipt = changesReceipt(source);
  expect(Object.hasOwn(receipt, 'history')).toBe(false);
  expect(matchedChangesReceipt(receipt, source)).toBe(true);
  expect(
    matchedChangesReceipt(
      { ...receipt, currentVersion: { ...receipt.currentVersion, content: { title: 'Other' } } },
      source
    )
  ).toBe(false);
  expect(matchedChangesReceipt({ ...receipt, profileId: documentId(9) }, source)).toBe(false);
});
it('requires complete recognized nested rejection and compares arrays in order', () => {
  const error = {
    code: ErrorCodes.VALIDATION_INPUT_INVALID.code,
    message: 'Invalid',
    correlationId: documentId(9),
    fields: ['reason'],
  };
  expect(contractFormRejection({ error })).toEqual(error);
  expect(contractFormRejection({ error: { ...error, code: 'unknown' } })).toBeNull();
  expect(contractFormRejection({ error: { ...error, correlationId: 'request' } })).toBeNull();
  expect(sameContractEvidence({ terms: ['one', 'two'] }, { terms: ['two', 'one'] })).toBe(false);
});

it('binds loaded original checksum and role without inventing evidence for an unpaginated original', async () => {
  const view = signingView(),
    signed = signingDocument(),
    original = signingDocument(1, 'original'),
    review = signingReview(view, signed);
  expect(
    await matchedSignatureReview(review, view, profileId, signed, false, undefined, [])
  ).not.toBeNull();
  expect(
    await matchedSignatureReview(review, view, profileId, signed, false, undefined, [original])
  ).not.toBeNull();
  const changed = structuredClone(review);
  changed.data.signature!.originalDocument.checksum = 'f'.repeat(64);
  expect(
    await matchedSignatureReview(changed, view, profileId, signed, false, undefined, [original])
  ).toBeNull();
  expect(
    await matchedSignatureReview(review, view, profileId, signed, false, undefined, [
      { ...original, contractRole: 'signed' },
    ])
  ).toBeNull();
});
it.each(['contractNumber', 'orderId', 'versionContract'] as const)(
  'rejects changed immutable changes receipt %s',
  (kind) => {
    const source = signingSource({
        state: 'AwaitingStaffReview',
        contractNumber: '1001',
        orderId: documentId(6),
      }),
      receipt = changesReceipt(source);
    const altered =
      kind === 'contractNumber'
        ? { ...receipt, contractNumber: '1002' }
        : kind === 'orderId'
          ? { ...receipt, orderId: documentId(7) }
          : {
              ...receipt,
              currentVersion: { ...receipt.currentVersion, contractId: documentId(7) },
            };
    expect(matchedChangesReceipt(altered, source)).toBe(false);
  }
);
