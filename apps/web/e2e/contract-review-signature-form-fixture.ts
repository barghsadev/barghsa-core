import { createHash } from 'node:crypto';
import type { Page, Route } from '@playwright/test';
import { ErrorCodes } from '@barghsa/shared/errors';
import type { ContractFinancialReview } from '@barghsa/shared/finance';
import type { ContractSignatureData } from '../src/lib/contracts.js';
import type { BusinessDocument } from '../src/lib/documents.js';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { fullNavigation } from './navigation-fixture';

const uuid = (n: number, version = 4) =>
  `86000000-0000-${version}000-8000-${String(n).padStart(12, '0')}`;
export const contractId = uuid(1),
  otherContract = uuid(2),
  profileId = uuid(3);
export const reviewVersion = uuid(4),
  acceptedVersion = uuid(5),
  amendmentVersion = uuid(6);
export const originalDocument = uuid(7),
  signedDocument = uuid(8);
export const amendmentDocument = uuid(9),
  amendmentSignedDocument = uuid(10);
const otherVersion = uuid(12);
export const staffActor = 'contract-signature-staff',
  customerActor = 'contract-signature-customer';
const instant = '2026-09-21T09:00:45.678Z';
const terms = {
  text: 'Published contract terms',
  commercialValue: { kind: 'fixed', amountIrr: '9007199254740993' },
  milestones: ['Delivery before commissioning', 'Commissioning after delivery'],
};
type Family = 'changes' | 'request' | 'record';
type PreviewMode = 'success' | 'owned' | 'mixed' | 'foreign' | 'checksum' | 'held' | 'denied';
type WriteMode = 'success' | 'held' | 'rejected';
export type ContractCommand = {
  family: Family;
  raw: string;
  body: Record<string, string | null>;
  csrf: string | null;
};
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, canonical(child)])
    );
  return value;
}
export function jsonbOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonbOrder);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, child]) => [key, jsonbOrder(child)])
    );
  return value;
}
export async function setupContractReviewSignatures(
  page: Page,
  locale: 'en' | 'fa',
  staff: boolean
) {
  await setupCatalogueForms(page, locale, locale === 'fa');
  const actor = staff ? staffActor : customerActor;
  const base = staff ? '/api/admin/contracts' : '/api/contracts';
  const state = {
    actor,
    status: staff ? 'AwaitingStaffReview' : 'AwaitingSignature',
    currentVersion: staff ? reviewVersion : acceptedVersion,
    pendingAmendment: false,
    requests: new Map<string, NonNullable<ContractSignatureData['request']>>(),
    signatures: new Map<string, NonNullable<ContractSignatureData['signature']>>(),
    reads: [] as string[],
    previews: [] as ContractCommand[],
    writes: [] as ContractCommand[],
    previewMode: 'success' as PreviewMode,
    writeMode: 'success' as WriteMode,
    heldPreview: undefined as Route | undefined,
    heldWrite: undefined as Route | undefined,
    holdRead: false,
    heldRead: undefined as Route | undefined,
    denied: false,
    needsStepUp: false,
    csrf: 'contract-signature-initial',
    verifications: [] as { password: string }[],
    effects: 0,
  };
  const documents: BusinessDocument[] = [
    [
      originalDocument,
      acceptedVersion,
      'original',
      'approved-original.pdf',
      'application/pdf',
      'b',
    ],
    [signedDocument, acceptedVersion, 'signed', 'approved-signed.png', 'image/png', 'd'],
    [
      amendmentDocument,
      amendmentVersion,
      'amendment',
      'approved-amendment.pdf',
      'application/pdf',
      'e',
    ],
    [
      amendmentSignedDocument,
      amendmentVersion,
      'signed',
      'approved-amendment-signed.png',
      'image/png',
      'f',
    ],
    [uuid(11), acceptedVersion, 'original', 'ineligible-original.png', 'image/png', 'a'],
  ].map(([id, versionId, role, name, mime, checksum]) => ({
    id: id!,
    profileId,
    businessRecordType: 'contract',
    businessRecordId: contractId,
    contractVersionId: versionId!,
    contractRole: role as BusinessDocument['contractRole'],
    category: 'contract',
    state: 'Approved',
    scanState: 'clean',
    scanSkippedReason: null,
    originalName: name!,
    detectedMime: mime!,
    sizeBytes: 32,
    checksum: checksum!.repeat(64),
    uploadedBy: customerActor,
    uploadedByType: 'customer',
    supersedesDocumentId: null,
    rejectionReason: null,
    reviewComment: null,
    revision: 1,
    createdAt: instant,
    updatedAt: instant,
    removedAt: null,
  }));
  const version = (id: string, history = false) => {
    const number = id === reviewVersion ? 1 : id === acceptedVersion ? 2 : 3;
    const shared = {
      id,
      versionNumber: number,
      content: terms,
      changeDescription: number === 1 ? 'Staff review draft' : 'Published contract terms',
      createdAt: instant,
      acceptedAt: number === 1 ? null : instant,
    };
    return {
      ...shared,
      ...(staff
        ? { contractId, createdBy: staffActor }
        : { publishedAt: instant, acceptedBy: customerActor }),
      ...(history ? { history: [], historyTruncated: false } : {}),
    };
  };
  const detail = (id = state.currentVersion, history = true) =>
    staff
      ? {
          id: contractId,
          profileId,
          orderId: null,
          serviceType: 'electricity',
          state: state.status,
          contractNumber: '9007199254740993',
          currentVersionId: state.currentVersion,
          createdAt: instant,
          updatedAt: instant,
          submittedAt: instant,
          acceptedAt: ['Accepted', 'AwaitingSignature', 'Signed', 'Active'].includes(state.status)
            ? instant
            : null,
          signedAt: ['Signed', 'Active'].includes(state.status) ? instant : null,
          activatedAt: state.status === 'Active' ? instant : null,
          completedAt: null,
          cancelledAt: null,
          linkedOrderStatus: null,
          acceptedParty: null,
          currentVersion: version(state.currentVersion),
          amendmentSupported: true,
          pendingAmendment: state.pendingAmendment
            ? {
                versionId: amendmentVersion,
                baseVersionId: acceptedVersion,
                state: 'AwaitingSignature',
                proposedBy: staffActor,
                createdAt: instant,
                publishedAt: instant,
              }
            : null,
          ...(history ? { history: [], historyTruncated: false } : {}),
        }
      : {
          id: contractId,
          contractNumber: '9007199254740993',
          profileId,
          orderId: null,
          savingOrderId: null,
          linkedOrderStatus: null,
          acceptedParty: null,
          serviceType: 'electricity',
          state: state.status,
          currentVersionId: state.currentVersion,
          canAccept: false,
          amendment: null,
          version: version(id),
          ...(history ? { history: [], historyTruncated: false } : {}),
        };
  const signingView = (id: string): ContractSignatureData => {
    const request = state.requests.get(id) ?? null,
      signature = state.signatures.get(id) ?? null;
    const isCurrent = state.currentVersion === id,
      isAmendment = state.pendingAmendment && id === amendmentVersion;
    const publicRequest = request
      ? {
          id: request.id,
          requestNumber: request.requestNumber,
          originalDocumentId: request.originalDocumentId,
          originalName: request.originalName,
          documentState: request.documentState,
          requestedAt: request.requestedAt,
        }
      : null;
    const publicSignature = signature
      ? {
          requestId: signature.requestId,
          signedDocumentId: signature.signedDocumentId,
          originalName: signature.originalName,
          documentState: signature.documentState,
          recordedByType: signature.recordedByType,
          uploadedByType: signature.uploadedByType,
          recordedAt: signature.recordedAt,
        }
      : null;
    return {
      contractId,
      versionId: id,
      state: state.status as ContractSignatureData['state'],
      isCurrent,
      isAmendment,
      canRequest:
        staff &&
        !signature &&
        ((isCurrent && ['Accepted', 'AwaitingSignature'].includes(state.status)) || isAmendment),
      canRecord:
        !signature &&
        !!request &&
        ((isCurrent && state.status === 'AwaitingSignature') || isAmendment),
      request: staff ? request : publicRequest,
      signature: staff ? signature : publicSignature,
    };
  };
  if (!staff)
    state.requests.set(acceptedVersion, {
      id: uuid(20, 7),
      requestNumber: 1,
      originalDocumentId: originalDocument,
      originalName: 'approved-original.pdf',
      documentState: 'Approved',
      requestedAt: instant,
      requestedBy: staffActor,
    });
  function financialReview(input: Record<string, string | null>): ContractFinancialReview {
    const id = input.expectedVersionId!,
      view = signingView(id),
      request = input.action === 'request';
    const document = (documentId: string) => {
      const selected = documents.find((item) => item.id === documentId)!;
      return {
        id: selected.id,
        contractId,
        versionId: id,
        originalName: selected.originalName,
        checksum: selected.checksum!,
        state: 'Approved' as const,
      };
    };
    const data: ContractFinancialReview['data'] = {
      currency: 'IRR',
      profile: { id: profileId, title: 'Contract buyer', type: 'LEGAL' },
      contract: {
        id: contractId,
        versionId: id,
        versionNumber: id === acceptedVersion ? 2 : 3,
        serviceType: 'electricity',
        state: view.isAmendment
          ? 'AwaitingSignature'
          : (view.state as 'Accepted' | 'AwaitingSignature'),
        publishedAt: instant,
        content: terms,
        ...(view.isAmendment
          ? {
              amendment: {
                baseVersionId: acceptedVersion,
                effectiveState: state.status as 'Signed' | 'Active' | 'Accepted',
              },
            }
          : {}),
      },
      activation: {
        ruleRevision: 1,
        signatureRequired: true,
        paymentRequired: true,
        serviceStartRequired: false,
        serviceStartsAt: null,
        serviceEndsAt: null,
        initialInvoiceId: null,
      },
      initialInvoice: null,
      payment: { source: 'none', amount: '0' },
      cancellationRefund: 'full_wallet',
      signature: {
        requestId: view.request?.id ?? null,
        requestNumber: view.request?.requestNumber ?? null,
        originalDocument: document(
          request ? input.originalDocumentId! : view.request!.originalDocumentId
        ),
        signedDocument: request ? null : document(input.signedDocumentId!),
      },
    };
    const review = {
      schemaVersion: 1 as const,
      scope: {
        action: request
          ? ('contract.signature-request' as const)
          : ('contract.signature-record' as const),
        profileId,
        resourceId: contractId,
      },
      data,
    };
    return {
      ...review,
      hash: createHash('sha256')
        .update(JSON.stringify(canonical(review)))
        .digest('hex'),
    };
  }
  const saved = new Map<string, Record<string, unknown>>(),
    savedBodies = new Map<string, string>();
  function persist(command: ContractCommand) {
    const key = state.actor + ':' + command.body.idempotencyKey;
    if (saved.has(key)) {
      if (savedBodies.get(key) !== command.raw)
        throw new Error('Exact replay changed captured body');
      return structuredClone(saved.get(key)!);
    }
    const input = command.body,
      id = input.expectedVersionId!;
    let result: Record<string, unknown>;
    if (command.family === 'changes') {
      state.status = 'ChangesRequested';
      // Actual ContractService.get receipt has neither top-level nor version history.
      result = detail(id, false);
    } else {
      const review = financialReview({ ...input, action: command.family });
      if (review.hash !== input.expectedReviewHash)
        throw new Error('Write review differs from captured preview');
      if (command.family === 'request') {
        const selected = documents.find((item) => item.id === input.originalDocumentId)!;
        state.requests.set(id, {
          id: uuid(30 + state.effects, 7),
          requestNumber: (state.requests.get(id)?.requestNumber ?? 0) + 1,
          originalDocumentId: selected.id,
          originalName: selected.originalName,
          documentState: 'Approved',
          requestedAt: instant,
          requestedBy: state.actor,
        });
        if (!state.pendingAmendment) state.status = 'AwaitingSignature';
      } else {
        const selected = documents.find((item) => item.id === input.signedDocumentId)!;
        state.signatures.set(id, {
          requestId: state.requests.get(id)!.id,
          signedDocumentId: selected.id,
          originalName: selected.originalName,
          documentState: 'Approved',
          recordedByType: staff ? 'staff' : 'customer',
          uploadedByType: selected.uploadedByType,
          recordedAt: instant,
          recordedBy: state.actor,
          uploadedBy: selected.uploadedBy,
        });
        state.currentVersion = id;
        state.status = state.status === 'Active' ? 'Active' : 'Signed';
        state.pendingAmendment = false;
      }
      result = { ...signingView(id), financialReview: review };
    }
    ++state.effects;
    saved.set(key, structuredClone(result));
    savedBodies.set(key, command.raw);
    return structuredClone(result);
  }
  const error = (route: Route, status: number, code: string, fields?: string[]) =>
    route.fulfill({
      status,
      json: {
        error: {
          code,
          correlationId: uuid(99),
          message: 'PRIVATE_CONTRACT_SERVER_TEXT',
          ...(fields ? { fields } : {}),
        },
        ...(code === ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code ? { requiresStepUp: true } : {}),
      },
    });
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      headers: { 'set-cookie': `barghsa_csrf=${state.csrf}; Path=/; SameSite=Lax` },
      json: {
        userId: state.actor,
        isStaff: staff,
        operatingContext: staff ? 'staff' : 'customer',
        canSwitchContext: staff,
        requiresTosAcceptance: false,
        navigation: fullNavigation(staff ? 'staff' : 'customer'),
      },
    })
  );
  await page.route('**/api/profile-invitations?*', (route) =>
    route.fulfill({ json: { invitations: [], nextAfter: null } })
  );
  await page.route(/\/api\/(?:admin\/)?contracts(?:\?[^/]*)?$/, (route) => {
    state.reads.push(route.request().url());
    const number =
      state.currentVersion === reviewVersion ? 1 : state.currentVersion === acceptedVersion ? 2 : 3;
    const common = {
      orderId: null,
      linkedOrderStatus: null,
      acceptedParty: null,
      ...(staff ? { profileId } : { savingOrderId: null }),
      serviceType: 'electricity',
      profileTitle: 'Contract buyer',
      profileType: 'LEGAL',
      commercialValue: terms.commercialValue,
      serviceStartsAt: null,
      serviceEndsAt: null,
      initialInvoiceId: null,
      initialInvoiceAmount: null,
      initialInvoiceState: null,
    };
    return route.fulfill({
      json: {
        contracts: [
          {
            ...common,
            id: contractId,
            contractNumber: '9007199254740993',
            state: state.status,
            versionId: state.currentVersion,
            versionNumber: number,
            ...(staff
              ? { changeDescription: 'Published contract terms', updatedAt: instant }
              : { publishedAt: instant }),
            acceptedAt: number === 1 ? null : instant,
            pendingAmendmentState: state.pendingAmendment ? 'AwaitingSignature' : null,
          },
          {
            ...common,
            id: otherContract,
            contractNumber: '2',
            state: staff ? 'AwaitingStaffReview' : 'Accepted',
            versionId: otherVersion,
            versionNumber: 8,
            ...(staff
              ? { changeDescription: 'Other permitted review terms', updatedAt: instant }
              : { publishedAt: instant }),
            acceptedAt: staff ? null : instant,
            pendingAmendmentState: null,
          },
        ],
        nextBefore: null,
      },
    });
  });
  await page.route(`**${base}/${contractId}`, (route) => {
    state.reads.push(route.request().url());
    if (state.holdRead) {
      state.heldRead = route;
      return;
    }
    if (state.denied) return error(route, 403, ErrorCodes.AUTHZ_FORBIDDEN.code);
    return route.fulfill({
      json: detail(
        new URL(route.request().url()).searchParams.get('versionId') ?? state.currentVersion
      ),
    });
  });
  await page.route(`**${base}/${contractId}?*`, (route) => {
    state.reads.push(route.request().url());
    return state.denied
      ? error(route, 403, ErrorCodes.AUTHZ_FORBIDDEN.code)
      : route.fulfill({
          json: detail(
            new URL(route.request().url()).searchParams.get('versionId') ?? state.currentVersion
          ),
        });
  });
  const otherRow = {
    ...version(reviewVersion),
    id: otherVersion,
    ...(staff ? { contractId: otherContract } : {}),
    versionNumber: 8,
    acceptedAt: staff ? null : instant,
    changeDescription: 'Other permitted review terms',
  };
  await page.route(`**${base}/${otherContract}`, (route) => {
    state.reads.push(route.request().url());
    return route.fulfill({
      json: {
        ...detail(),
        id: otherContract,
        contractNumber: '2',
        state: staff ? 'AwaitingStaffReview' : 'Accepted',
        currentVersionId: otherVersion,
        ...(staff
          ? {
              currentVersion: otherRow,
              acceptedAt: null,
              signedAt: null,
              activatedAt: null,
              pendingAmendment: null,
            }
          : { version: otherRow }),
      },
    });
  });
  await page.route(`**${base}/${otherContract}/versions`, (route) => {
    const row = { ...otherRow } as Record<string, unknown>;
    delete row.content;
    if (!staff) delete row.acceptedBy;
    return route.fulfill({ json: { versions: [row], nextBefore: null } });
  });
  await page.route(`**${base}/${otherContract}/signature?*`, (route) =>
    route.fulfill({
      json: {
        contractId: otherContract,
        versionId: otherVersion,
        state: staff ? 'AwaitingStaffReview' : 'Accepted',
        isCurrent: true,
        isAmendment: false,
        canRequest: false,
        canRecord: false,
        request: null,
        signature: null,
      },
    })
  );
  await page.route(`**${base}/${contractId}/versions**`, (route) => {
    state.reads.push(route.request().url());
    const id = new URL(route.request().url()).pathname.split('/versions/')[1];
    if (id) return route.fulfill({ json: staff ? version(id, true) : detail(id) });
    const ids =
      state.pendingAmendment || state.currentVersion === amendmentVersion
        ? [amendmentVersion, acceptedVersion, reviewVersion]
        : state.currentVersion === acceptedVersion
          ? [acceptedVersion, reviewVersion]
          : [reviewVersion];
    return route.fulfill({
      json: {
        versions: ids
          .filter((id) => staff || id !== reviewVersion)
          .map((id) => {
            const row = version(id) as Record<string, unknown>;
            delete row.content;
            if (!staff) delete row.acceptedBy;
            return row;
          }),
        nextBefore: null,
      },
    });
  });
  await page.route(`**${base}/${contractId}/signature?*`, (route) => {
    state.reads.push(route.request().url());
    if (state.holdRead) {
      state.heldRead = route;
      return;
    }
    return state.denied
      ? error(route, 403, ErrorCodes.AUTHZ_FORBIDDEN.code)
      : route.fulfill({
          json: signingView(new URL(route.request().url()).searchParams.get('versionId')!),
        });
  });
  await page.route(`**/api/${staff ? 'admin/' : ''}documents?*`, (route) => {
    state.reads.push(route.request().url());
    const selected = new URL(route.request().url()).searchParams.get('contractVersionId');
    return route.fulfill({
      json: {
        documents: documents.filter((item) => item.contractVersionId === selected),
        nextBefore: null,
      },
    });
  });
  await page.route(`**${base}/${contractId}/signature/review`, (route) => {
    const raw = route.request().postData()!,
      body = route.request().postDataJSON() as Record<string, string | null>;
    state.previews.push({
      family: body.action as Family,
      raw,
      body,
      csrf: route.request().headers()['x-csrf-token'] ?? null,
    });
    if (state.previewMode === 'held') {
      state.heldPreview = route;
      return;
    }
    if (state.previewMode === 'owned')
      return error(route, 400, ErrorCodes.VALIDATION_INPUT_INVALID.code, [
        body.action === 'request' ? 'originalDocumentId' : 'signedDocumentId',
      ]);
    if (state.previewMode === 'mixed')
      return error(route, 400, ErrorCodes.VALIDATION_PARSE_ZOD.code);
    if (state.previewMode === 'denied') return error(route, 403, ErrorCodes.AUTHZ_FORBIDDEN.code);
    const review = financialReview(body);
    if (state.previewMode === 'foreign') review.scope.profileId = uuid(98);
    if (state.previewMode === 'checksum')
      review.data.signature!.originalDocument.checksum = '0'.repeat(64);
    return route.fulfill({ json: review });
  });
  for (const [suffix, family] of [
    ['request-changes', 'changes'],
    ['signature-request', 'request'],
    ['signature', 'record'],
  ] as const) {
    await page.route(`**${base}/${contractId}/${suffix}`, (route) => {
      const raw = route.request().postData()!,
        body = route.request().postDataJSON() as Record<string, string | null>;
      const command = {
        family,
        raw,
        body,
        csrf: route.request().headers()['x-csrf-token'] ?? null,
      };
      state.writes.push(command);
      if (state.needsStepUp) return error(route, 403, ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code);
      if (state.writeMode === 'rejected') return error(route, 409, ErrorCodes.CONFLICT_STATE.code);
      if (state.writeMode === 'held') {
        state.heldWrite = route;
        return;
      }
      return route.fulfill({ json: jsonbOrder(persist(command)) });
    });
  }
  await page.route('**/api/auth/step-up', async (route) => {
    state.verifications.push(route.request().postDataJSON() as { password: string });
    state.needsStepUp = false;
    state.csrf = 'contract-signature-rotated';
    await page
      .context()
      .addCookies([
        { name: 'barghsa_csrf', value: state.csrf, url: new URL(route.request().url()).origin },
      ]);
    return route.fulfill({
      headers: { 'set-cookie': `barghsa_csrf=${state.csrf}; Path=/; SameSite=Lax` },
      json: { verified: true },
    });
  });
  for (const resourceId of [contractId, otherContract]) {
    await page.route(`**${base}/${resourceId}/activation?*`, (route) => {
      state.reads.push(route.request().url());
      const main = resourceId === contractId,
        currentVersionId = main ? state.currentVersion : otherVersion,
        versionId =
          new URL(route.request().url()).searchParams.get('versionId') ?? currentVersionId,
        status = main ? state.status : staff ? 'AwaitingStaffReview' : 'Accepted',
        accepted = main ? versionId !== reviewVersion : !staff,
        isCurrent = versionId === currentVersionId;
      const check = (key: string, required: boolean, met: boolean) => ({
        key,
        required,
        status: !required ? 'not_required' : met ? 'met' : 'unmet',
      });
      const checks = [
        check('staffApproval', true, accepted),
        check('customerAcceptance', true, accepted),
        check('signature', true, main && state.signatures.has(versionId)),
        check('initialPayment', true, false),
        check('serviceStart', false, false),
      ];
      return route.fulfill({
        json: {
          contractId: resourceId,
          versionId,
          state: status,
          isCurrent,
          ready:
            isCurrent &&
            ['Accepted', 'Signed'].includes(status) &&
            checks.every((item) => item.status !== 'unmet'),
          ruleRevision: 1,
          initialInvoiceId: null,
          serviceStartsAt: null,
          serviceEndsAt: null,
          evaluatedAt: instant,
          checks,
        },
      });
    });
  }
  await page.route(`**${base}/${contractId}/cancellation-status`, (route) => {
    state.reads.push(route.request().url());
    return route.fulfill({
      json: {
        contractId,
        state: state.status,
        cancelledAt: null,
        financialStatus: 'not_cancelled',
        financiallyClosed: false,
        refundAmount: '0',
        returnedAmount: '0',
        canCancel: false,
        canChooseRefund: false,
        refunds: [],
      },
    });
  });
  return {
    state,
    detail,
    signingView,
    documents,
    financialReview,
    persist,
    error,
    revisedPublishedAccepted() {
      state.currentVersion = acceptedVersion;
      state.status = 'Accepted';
    },
    pendingAmendment() {
      state.pendingAmendment = true;
      state.status = 'Signed';
    },
  };
}
