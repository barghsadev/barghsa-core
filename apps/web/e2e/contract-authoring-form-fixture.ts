import type { Page, Route } from '@playwright/test';
import { ErrorCodes } from '@barghsa/shared/errors';
import type { ContractActivationData } from '../src/lib/contracts.js';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { fullNavigation } from './navigation-fixture';

const uuid = (n: number, version = 4) =>
  `87000000-0000-${version}000-8000-${String(n).padStart(12, '0')}`;
export const draftContractId = uuid(1),
  createdContractId = uuid(2, 7),
  profileId = uuid(3),
  otherProfileId = uuid(4),
  draftVersionId = uuid(5),
  linkedOrderId = uuid(6),
  savingOrderId = uuid(7),
  invoiceId = uuid(8),
  amendmentVersionId = uuid(9, 7);
export const authoringActor = 'contract-authoring-staff';
const previousVersionId = uuid(15);
export const instant = '2026-09-21T09:00:45.678Z';
export const originalContent = {
  title: '  Imported contract title  ',
  text: '  Original opaque terms\n  ',
  commercialValue: { kind: 'fixed', amountIrr: '9007199254740993' },
  milestones: ['Delivery before commissioning', 'Commissioning after delivery'],
  imported: { sequence: [2, 1], nested: { keep: true, amount: '0007' } },
};
type Family = 'create' | 'revise' | 'context' | 'amendment';
type Body = {
  profileId?: string;
  serviceType?: string;
  orderId?: string;
  expectedVersionId?: string;
  content: Record<string, unknown>;
  changeDescription: string;
  idempotencyKey: string;
  activationContext?: {
    initialInvoiceId: string | null;
    serviceStartsAt: string | null;
    serviceEndsAt?: string | null;
  };
};
export type AuthoringCommand = { family: Family; raw: string; body: Body; csrf: string | null };
type Version = {
  id: string;
  contractId: string;
  versionNumber: number;
  content: Record<string, unknown>;
  changeDescription: string;
  createdAt: string;
  createdBy: string;
  acceptedAt: string | null;
};
export function jsonbOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonbOrder);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([k, v]) => [k, jsonbOrder(v)])
    );
  return value;
}
export async function setupContractAuthoring(
  page: Page,
  locale: 'en' | 'fa',
  contextStory: boolean
) {
  await setupCatalogueForms(page, locale, locale === 'fa');
  const state = {
    actor: authoringActor,
    csrf: 'contract-authoring-initial',
    timezone: 'Asia/Tehran',
    needsStepUp: false,
    verifications: [] as { password: string }[],
    reads: [] as string[],
    writes: [] as AuthoringCommand[],
    writeMode: 'success' as 'success' | 'held' | 'owned' | 'mixed' | 'rejected',
    ownedFields: ['changeDescription'],
    heldWrite: undefined as Route | undefined,
    holdChoices: false,
    heldChoices: undefined as Route | undefined,
    choicesMode: 'success' as 'success' | 'failed' | 'denied' | 'malformed',
    denied: false,
    effects: 0,
    selectedStatus: contextStory ? 'Draft' : 'ChangesRequested',
    currentVersionId: draftVersionId,
    hasCreated: false,
    pendingAmendment: false,
    acceptedParty: null as null | {
      profileId: string;
      profileType: 'LEGAL';
      name: string;
      identifier: string;
      registrationNumber: string;
    },
  };
  const versions = new Map<string, Version>([
    [
      draftVersionId,
      {
        id: draftVersionId,
        contractId: draftContractId,
        versionNumber: 2,
        content: structuredClone(originalContent),
        changeDescription: 'Imported contract draft',
        createdAt: instant,
        createdBy: authoringActor,
        acceptedAt: null,
      },
    ],
  ]);
  versions.set(previousVersionId, {
    ...structuredClone(versions.get(draftVersionId)!),
    id: previousVersionId,
    versionNumber: 1,
    content: { ...originalContent, text: 'Initial immutable terms' },
    changeDescription: 'Initial imported version',
  });
  const contexts = new Map<string, NonNullable<Body['activationContext']>>([
    [
      draftVersionId,
      {
        initialInvoiceId: invoiceId,
        serviceStartsAt: '2030-01-02T08:00:45.678Z',
        serviceEndsAt: '2030-01-03T08:00:45.678Z',
      },
    ],
  ]);
  contexts.set(previousVersionId, structuredClone(contexts.get(draftVersionId)!));
  let createdVersionId = '';
  const version = (id: string, history = false) => ({
    ...structuredClone(versions.get(id)!),
    ...(history ? { history: [], historyTruncated: false } : {}),
  });
  const detail = (id = draftContractId, history = false) => {
    const created = id === createdContractId;
    const current = created ? createdVersionId : state.currentVersionId;
    return {
      id,
      profileId,
      orderId: created ? linkedOrderId : null,
      serviceType: 'electricity',
      state: created ? 'Draft' : state.selectedStatus,
      contractNumber: created ? '9007199254740994' : '9007199254740993',
      currentVersionId: current,
      createdAt: instant,
      updatedAt: instant,
      submittedAt: created || state.selectedStatus === 'Draft' ? null : instant,
      acceptedAt:
        !created && ['Accepted', 'Signed', 'Active'].includes(state.selectedStatus)
          ? instant
          : null,
      signedAt: null,
      activatedAt: null,
      completedAt: null,
      cancelledAt: null,
      linkedOrderStatus: created ? 'draft' : null,
      acceptedParty: created ? null : state.acceptedParty,
      currentVersion: version(current),
      amendmentSupported: true,
      pendingAmendment:
        !created && state.pendingAmendment
          ? {
              versionId: amendmentVersionId,
              baseVersionId: current,
              state: 'Draft',
              proposedBy: authoringActor,
              createdAt: instant,
              publishedAt: null,
            }
          : null,
      ...(history ? { history: [], historyTruncated: false } : {}),
    };
  };
  const stored = new Map<string, { raw: string; result: ReturnType<typeof detail> }>();
  const persist = (command: AuthoringCommand) => {
    const saved = stored.get(command.body.idempotencyKey);
    if (saved) {
      if (saved.raw !== command.raw) throw new Error('Changed captured authoring command');
      return structuredClone(saved.result);
    }
    const { body, family } = command;
    const id = family === 'create' ? createdContractId : draftContractId;
    const previous = versions.get(state.currentVersionId)!;
    const next =
      family === 'create'
        ? uuid(10, 7)
        : family === 'amendment'
          ? amendmentVersionId
          : uuid(11 + state.effects, 7);
    versions.set(next, {
      id: next,
      contractId: id,
      versionNumber: family === 'create' ? 1 : previous.versionNumber + 1,
      content: structuredClone(body.content),
      changeDescription: body.changeDescription,
      createdBy: state.actor,
      createdAt: instant,
      acceptedAt: null,
    });
    if (family === 'create') {
      createdVersionId = next;
      state.hasCreated = true;
      contexts.set(
        next,
        body.activationContext ?? {
          initialInvoiceId: null,
          serviceStartsAt: null,
          serviceEndsAt: null,
        }
      );
    } else {
      contexts.set(
        next,
        body.activationContext ?? structuredClone(contexts.get(state.currentVersionId)!)
      );
      if (family === 'amendment') state.pendingAmendment = true;
      else {
        state.currentVersionId = next;
        if (state.selectedStatus === 'ChangesRequested')
          state.selectedStatus = 'AwaitingStaffReview';
      }
    }
    ++state.effects;
    const result = detail(id);
    stored.set(body.idempotencyKey, { raw: command.raw, result: structuredClone(result) });
    return result;
  };
  const error = (route: Route, status: number, code: string, fields?: string[]) =>
    route.fulfill({
      status,
      json: {
        error: {
          code,
          message: 'PRIVATE_AUTHORING_SERVER_TEXT',
          correlationId: uuid(99),
          ...(fields ? { fields } : {}),
        },
        ...(code === ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code ? { requiresStepUp: true } : {}),
      },
    });
  const write = (route: Route, family: Family) => {
    const command: AuthoringCommand = {
      family,
      raw: route.request().postData()!,
      body: route.request().postDataJSON() as Body,
      csrf: route.request().headers()['x-csrf-token'] ?? null,
    };
    state.writes.push(command);
    if (state.needsStepUp) return error(route, 403, ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code);
    if (state.writeMode === 'owned')
      return error(route, 400, ErrorCodes.VALIDATION_INPUT_INVALID.code, state.ownedFields);
    if (state.writeMode === 'mixed') return error(route, 400, ErrorCodes.VALIDATION_PARSE_ZOD.code);
    if (state.writeMode === 'rejected') return error(route, 409, ErrorCodes.CONFLICT_STATE.code);
    if (state.writeMode === 'held') {
      state.heldWrite = route;
      return;
    }
    return route.fulfill({
      status: family === 'create' || family === 'amendment' ? 201 : 200,
      json: jsonbOrder(persist(command)),
    });
  };
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      headers: { 'set-cookie': `barghsa_csrf=${state.csrf}; Path=/; SameSite=Lax` },
      json: {
        userId: state.actor,
        isStaff: true,
        operatingContext: 'staff',
        canSwitchContext: true,
        requiresTosAcceptance: false,
        navigation: fullNavigation('staff'),
      },
    })
  );
  await page.route('**/api/profile-invitations?*', (route) =>
    route.fulfill({ json: { invitations: [], nextAfter: null } })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: state.timezone } })
  );
  await page.route('**/api/auth/step-up', async (route) => {
    state.verifications.push(route.request().postDataJSON() as { password: string });
    state.needsStepUp = false;
    state.csrf = 'contract-authoring-rotated';
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
  await page.route(/\/api\/admin\/contracts(?:\?[^/]*)?$/, (route) => {
    if (route.request().method() === 'POST') return write(route, 'create');
    state.reads.push(route.request().url());
    return route.fulfill({
      json: {
        contracts: [...(state.hasCreated ? [createdContractId] : []), draftContractId].map((id) => {
          const row = detail(id),
            context = contexts.get(row.currentVersionId)!;
          return {
            id,
            contractNumber: row.contractNumber,
            profileId,
            orderId: row.orderId,
            serviceType: row.serviceType,
            state: row.state,
            versionId: row.currentVersionId,
            versionNumber: row.currentVersion.versionNumber,
            commercialValue: row.currentVersion.content.commercialValue ?? null,
            changeDescription: row.currentVersion.changeDescription,
            updatedAt: instant,
            acceptedAt: row.acceptedAt,
            profileTitle: 'Authoring buyer',
            profileType: 'LEGAL',
            linkedOrderStatus: row.linkedOrderStatus,
            acceptedParty: row.acceptedParty,
            serviceStartsAt: context.serviceStartsAt,
            serviceEndsAt: context.serviceEndsAt ?? null,
            initialInvoiceId: context.initialInvoiceId,
            initialInvoiceAmount: context.initialInvoiceId ? '5000' : null,
            initialInvoiceState: context.initialInvoiceId ? 'Paid' : null,
            pendingAmendmentState: row.pendingAmendment?.state ?? null,
          };
        }),
        nextBefore: null,
      },
    });
  });
  await page.route('**/api/admin/contracts/authoring-options?*', (route) => {
    state.reads.push(route.request().url());
    if (state.holdChoices) {
      state.heldChoices = route;
      return;
    }
    if (state.choicesMode === 'failed') return error(route, 503, ErrorCodes.INTERNAL_SERVER.code);
    if (state.choicesMode === 'denied') return error(route, 403, ErrorCodes.AUTHZ_FORBIDDEN.code);
    if (state.choicesMode === 'malformed')
      return route.fulfill({
        json: { profiles: [{ id: 'invalid', title: 'PRIVATE_FOREIGN_OPTION' }], nextBefore: null },
      });
    const params = new URL(route.request().url()).searchParams;
    return route.fulfill({
      json: params.has('profileId')
        ? {
            orders:
              params.get('profileId') === profileId
                ? [
                    { id: linkedOrderId, serviceType: 'electricity', createdAt: instant },
                    { id: savingOrderId, serviceType: 'savings', createdAt: instant },
                  ]
                : [],
            nextBefore: null,
          }
        : {
            profiles: [
              { id: otherProfileId, title: 'Other authorized buyer', profileType: 'INDIVIDUAL' },
              { id: profileId, title: 'Authoring buyer', profileType: 'LEGAL' },
            ].filter((row) =>
              row.title.toLowerCase().includes((params.get('search') ?? '').toLowerCase())
            ),
            nextBefore: null,
          },
    });
  });
  for (const id of [draftContractId, createdContractId]) {
    await page.route(new RegExp(`/api/admin/contracts/${id}(?:\\?[^/]*)?$`), (route) => {
      if (route.request().method() === 'PATCH')
        return write(
          route,
          route.request().postDataJSON().activationContext ? 'context' : 'revise'
        );
      state.reads.push(route.request().url());
      return state.denied
        ? error(route, 403, ErrorCodes.AUTHZ_FORBIDDEN.code)
        : route.fulfill({ json: detail(id, true) });
    });
    await page.route(`**/api/admin/contracts/${id}/versions**`, (route) => {
      state.reads.push(route.request().url());
      const selected = new URL(route.request().url()).pathname.split('/versions/')[1];
      if (selected) return route.fulfill({ json: version(selected, true) });
      return route.fulfill({
        json: {
          versions: [...versions.values()]
            .filter((v) => v.contractId === id)
            .sort((a, b) => b.versionNumber - a.versionNumber)
            .map(({ content: _content, ...row }) => row),
          nextBefore: null,
        },
      });
    });
    await page.route(`**/api/admin/contracts/${id}/activation?*`, (route) => {
      state.reads.push(route.request().url());
      const selected = new URL(route.request().url()).searchParams.get('versionId')!;
      const context = contexts.get(selected)!;
      const row = detail(id);
      const data: ContractActivationData = {
        contractId: id,
        versionId: selected,
        state: row.state,
        isCurrent: row.currentVersionId === selected,
        ready: false,
        ruleRevision: 1,
        initialInvoiceId: context.initialInvoiceId,
        serviceStartsAt: context.serviceStartsAt,
        serviceEndsAt: context.serviceEndsAt ?? null,
        evaluatedAt: instant,
        checks: [
          {
            key: 'staffApproval',
            required: true,
            status: ['Accepted', 'Signed', 'Active'].includes(row.state) ? 'met' : 'unmet',
          },
          { key: 'customerAcceptance', required: true, status: row.acceptedAt ? 'met' : 'unmet' },
          { key: 'signature', required: true, status: 'unmet' },
          {
            key: 'initialPayment',
            required: true,
            status: context.initialInvoiceId ? 'met' : 'unmet',
          },
          { key: 'serviceStart', required: true, status: 'unmet' },
        ],
      };
      return route.fulfill({ json: data });
    });
    await page.route(`**/api/admin/contracts/${id}/signature?*`, (route) => {
      state.reads.push(route.request().url());
      const selected = new URL(route.request().url()).searchParams.get('versionId');
      const row = detail(id);
      const isAmendment = !!row.pendingAmendment && row.pendingAmendment.versionId === selected;
      return route.fulfill({
        json: {
          contractId: id,
          versionId: selected,
          state: isAmendment ? row.pendingAmendment!.state : row.state,
          isCurrent: row.currentVersionId === selected,
          isAmendment,
          canRequest: false,
          canRecord: false,
          request: null,
          signature: null,
        },
      });
    });
    await page.route(`**/api/admin/contracts/${id}/cancellation-status`, (route) => {
      state.reads.push(route.request().url());
      return route.fulfill({
        json: {
          contractId: id,
          state: detail(id).state,
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
  }
  await page.route(`**/api/admin/contracts/${draftContractId}/amendments`, (route) =>
    write(route, 'amendment')
  );
  await page.route('**/api/admin/documents?*', (route) => {
    state.reads.push(route.request().url());
    return route.fulfill({ json: { documents: [], nextBefore: null } });
  });
  return {
    state,
    versions,
    contexts,
    detail,
    persist,
    error,
    acceptCurrent() {
      state.selectedStatus = 'Accepted';
      versions.get(state.currentVersionId)!.acceptedAt = instant;
      state.acceptedParty = {
        profileId,
        profileType: 'LEGAL',
        name: 'Authoring buyer',
        identifier: '12345678901',
        registrationNumber: '1234',
      };
    },
  };
}
