import { createHash } from 'node:crypto';
import type { Page, Route } from '@playwright/test';
import { ErrorCodes } from '@barghsa/shared/errors';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { fullNavigation } from './navigation-fixture';
import { firstSolar, olderSolar, solarProfile } from '../src/test/solar-staff-fixtures';

export { firstSolar, olderSolar, solarProfile };
export const templateVersion = '85000000-0000-4000-8000-000000000001';
export const contractDocument = '85000000-0000-4000-8000-000000000002';
const generated = (n: number) => `85000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
export type SolarCommand = {
  profileId: string;
  idempotencyKey: string;
  title: string;
  text: string;
  changeDescription: string;
  commercialValue: { kind: 'fixed'; amountIrr: string } | { kind: 'variable'; description: string };
  source:
    { kind: 'template'; templateVersionId: string } | { kind: 'document'; documentId: string };
  invoiceLines: Array<{
    description: string;
    quantity: number;
    unitPrice: string;
    vatRate: number;
    isTaxable: boolean;
  }>;
  expectedReviewHash?: string;
};
export type SolarCall = { id: string; body: SolarCommand; raw: string; csrf: string | null };
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
export function solarContractReview(id: string, body: SolarCommand) {
  const invoiceLines = body.invoiceLines.map((line) => {
    const unitPrice = BigInt(line.unitPrice),
      lineTotal = BigInt(line.quantity) * unitPrice;
    const vatAmount = line.isTaxable
      ? (2n * lineTotal * BigInt(line.vatRate) + 10000n) / 20000n
      : 0n;
    return {
      ...line,
      unitPrice: unitPrice.toString(),
      lineTotal: lineTotal.toString(),
      vatAmount: vatAmount.toString(),
    };
  });
  const subtotal = invoiceLines.reduce((sum, line) => sum + BigInt(line.lineTotal), 0n);
  const vat = invoiceLines.reduce((sum, line) => sum + BigInt(line.vatAmount), 0n);
  const snapshot = {
    schemaVersion: 1,
    scope: {
      action: 'solar.contract.create',
      profileId: body.profileId,
      resourceId: body.idempotencyKey,
    },
    data: {
      requestId: id,
      requestStatus: 'approved',
      title: body.title,
      text: body.text,
      changeDescription: body.changeDescription,
      commercialValue: body.commercialValue,
      source: {
        ...body.source,
        label:
          body.source.kind === 'template'
            ? 'Solar construction template'
            : 'signed-solar-terms.pdf',
        versionNumber: body.source.kind === 'template' ? 3 : null,
      },
      invoiceLines,
      totals: {
        currency: 'IRR',
        subtotal: subtotal.toString(),
        vat: vat.toString(),
        total: (subtotal + vat).toString(),
      },
      dueRule: {
        source: 'config',
        configDays: 7,
        periodId: '85000000-0000-4000-8000-000000000003',
        serviceType: 'manual',
      },
      outcome: 'draft_contract_and_unpaid_invoice',
    },
  };
  return {
    ...snapshot,
    hash: createHash('sha256')
      .update(JSON.stringify(canonical(snapshot)))
      .digest('hex'),
  };
}
export async function setupSolarContractIssue(page: Page, locale: 'en' | 'fa') {
  await setupCatalogueForms(page, locale, locale === 'fa');
  const state = {
    actor: 'solar-contract-staff',
    csrf: 'solar-contract-initial',
    needsStepUp: false,
    verifications: [] as Array<{ password: string }>,
    previews: [] as SolarCall[],
    writes: [] as SolarCall[],
    reads: [] as string[],
    optionsReads: [] as string[],
    guidanceWrites: [] as unknown[],
    siblingWrites: [] as string[],
    effects: 0,
    previewMode: 'success' as
      'success' | 'owned' | 'mixed' | 'foreign' | 'arithmetic' | 'held' | 'denied',
    writeMode: 'held' as 'held' | 'success' | 'owned' | 'rejected' | 'denied',
    optionsMode: 'success' as 'success' | 'held' | 'denied' | 'missing' | 'malformed',
    heldPreview: undefined as Route | undefined,
    heldWrite: undefined as Route | undefined,
    heldOptions: undefined as Route | undefined,
    rows: new Map([
      [firstSolar, 'approved'],
      [olderSolar, 'approved'],
    ]),
    guidance: {
      fa: 'راهنمای اصل مدارک',
      en: 'Original solar postal guidance',
      destinationAddress: 'Solar Street',
      contactDetails: 'Staff contact',
      originals: [] as Array<{ fa: string; en: string }>,
    },
  };
  const saved = new Map<
    string,
    { raw: string; result: { status: string; contractId: string; invoiceIds: string[] } }
  >();
  const options = {
    templates: [
      { version_id: templateVersion, name: 'Solar construction template', version_number: 3 },
    ],
    documents: [{ id: contractDocument, original_name: 'signed-solar-terms.pdf' }],
  };
  const error = (route: Route, status: number, code: string, fields?: string[]) =>
    route.fulfill({
      status,
      json: {
        error: {
          code,
          correlationId: '85000000-0000-4000-8000-000000000090',
          message: 'PRIVATE_SOLAR_CONTRACT_SERVER_TEXT',
          ...(fields ? { fields } : {}),
        },
      },
    });
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
  await page.route('**/api/auth/step-up', async (route) => {
    state.verifications.push(route.request().postDataJSON());
    state.needsStepUp = false;
    state.csrf = 'solar-contract-rotated';
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
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [{ id: solarProfile, profileType: 'INDIVIDUAL', title: 'Solar buyer' }],
        activeProfileId: solarProfile,
        hasDefault: true,
      },
    })
  );
  await page.route('**/api/admin/solar/postal-guidance', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: state.guidance });
    state.guidanceWrites.push(route.request().postDataJSON());
    return error(route, 409, ErrorCodes.CONFLICT_STATE.code);
  });
  const queueRow = (id: string) => ({
    id,
    profile_id: solarProfile,
    request_status: state.rows.get(id),
    postal_status: 'received',
    profile_name: id === firstSolar ? 'First solar buyer' : 'Older solar buyer',
    courier: 'Post',
    tracking_number: id === firstSolar ? 'TRACK-1' : 'TRACK-2',
    send_date: '2026-09-23T00:00:00.000Z',
    receipt_image_id: null,
    staff_notes: null,
    created_at: id === firstSolar ? '2026-09-23T10:00:00.000Z' : '2026-09-22T10:00:00.000Z',
    estimated_arrival_date: '2026-09-26',
    tracking_url: 'https://courier.example.org/track/TRACK-1',
    tracking_note: 'Delivered originals',
    tracking_revision: 0,
    tracking_recorded_at: '2026-09-23T10:00:00.000Z',
  });
  await page.route(/\/api\/admin\/solar\/postal-queue(?:\?[^/]*)?$/, (route) => {
    state.reads.push(route.request().url());
    const lane = new URL(route.request().url()).searchParams.get('lane') ?? 'all';
    return route.fulfill({
      json: {
        requests:
          lane === 'waiting_customer'
            ? []
            : [firstSolar, olderSolar]
                .filter((id) => state.rows.get(id) === 'approved')
                .map(queueRow),
        nextBefore: null,
      },
    });
  });
  for (const id of [firstSolar, olderSolar]) {
    await page.route(`**/api/admin/solar/requests/${id}/postal/tracking`, (route) =>
      route.fulfill({
        json: {
          requestId: id,
          profileId: solarProfile,
          receiptImageId: null,
          requestStatus: state.rows.get(id),
          postalStatus: 'received',
          courier: 'Post',
          trackingNumber: id === firstSolar ? 'TRACK-1' : 'TRACK-2',
          sendDate: '2026-09-23',
          estimatedArrivalDate: '2026-09-26',
          trackingUrl: 'https://courier.example.org/track/TRACK-1',
          note: 'Delivered originals',
          revision: 0,
          recordedAt: '2026-09-23T10:00:00.000Z',
          canEdit: false,
        },
      })
    );
    await page.route(`**/api/admin/solar/requests/${id}/contract-options`, (route) => {
      state.optionsReads.push(id);
      if (state.optionsMode === 'held') {
        state.heldOptions = route;
        return;
      }
      if (state.optionsMode === 'denied') return error(route, 403, ErrorCodes.AUTHZ_FORBIDDEN.code);
      if (state.optionsMode === 'missing')
        return error(route, 404, ErrorCodes.NOT_FOUND_RESOURCE.code);
      return route.fulfill({
        json:
          state.optionsMode === 'malformed'
            ? { ...options, templates: [...options.templates, options.templates[0]] }
            : options,
      });
    });
    await page.route(`**/api/admin/solar/requests/${id}/create-contract/review`, (route) => {
      const call = {
        id,
        body: route.request().postDataJSON(),
        raw: route.request().postData()!,
        csrf: route.request().headers()['x-csrf-token'] ?? null,
      } as SolarCall;
      state.previews.push(call);
      if (state.previewMode === 'held') {
        state.heldPreview = route;
        return;
      }
      if (state.previewMode === 'owned')
        return error(route, 400, ErrorCodes.VALIDATION_INPUT_INVALID.code, [
          'invoiceLine0UnitPrice',
        ]);
      if (state.previewMode === 'mixed')
        return error(route, 400, ErrorCodes.VALIDATION_INPUT_INVALID.code);
      if (state.previewMode === 'denied') return error(route, 403, ErrorCodes.AUTHZ_FORBIDDEN.code);
      const snapshot = solarContractReview(id, call.body);
      return route.fulfill({
        json: jsonbOrder(
          state.previewMode === 'foreign'
            ? { ...snapshot, scope: { ...snapshot.scope, profileId: olderSolar } }
            : state.previewMode === 'arithmetic'
              ? {
                  ...snapshot,
                  data: { ...snapshot.data, totals: { ...snapshot.data.totals, total: '1' } },
                }
              : snapshot
        ),
      });
    });
    await page.route(`**/api/admin/solar/requests/${id}/create-contract`, (route) => {
      const call = {
        id,
        body: route.request().postDataJSON(),
        raw: route.request().postData()!,
        csrf: route.request().headers()['x-csrf-token'] ?? null,
      } as SolarCall;
      state.writes.push(call);
      if (state.needsStepUp)
        return route.fulfill({
          status: 403,
          json: {
            requiresStepUp: true,
            error: {
              code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code,
              correlationId: '85000000-0000-4000-8000-000000000091',
              message: 'Step-up required',
            },
          },
        });
      if (state.writeMode === 'held') {
        state.heldWrite = route;
        return;
      }
      if (state.writeMode === 'owned')
        return error(route, 400, ErrorCodes.VALIDATION_INPUT_INVALID.code, ['title']);
      if (state.writeMode === 'rejected') return error(route, 409, ErrorCodes.CONFLICT_STATE.code);
      if (state.writeMode === 'denied') return error(route, 403, ErrorCodes.AUTHZ_FORBIDDEN.code);
      return route.fulfill({ json: jsonbOrder(persist(call)) });
    });
    await page.route(`**/api/admin/solar/requests/${id}/close-no-contract`, (route) => {
      state.siblingWrites.push(route.request().url());
      return error(route, 409, ErrorCodes.CONFLICT_STATE.code);
    });
  }
  function persist(call: SolarCall) {
    const key = `${state.actor}:${call.body.idempotencyKey}`;
    const existing = saved.get(key);
    if (existing) {
      if (existing.raw !== call.raw) throw new Error('Captured retry command changed');
      return existing.result;
    }
    state.effects++;
    const result = {
      status: 'contract_created',
      contractId: generated(state.effects * 2 + 10),
      invoiceIds: [generated(state.effects * 2 + 11)],
    };
    saved.set(key, { raw: call.raw, result });
    state.rows.set(call.id, 'contract_created');
    return result;
  }
  return { state, options, queueRow, review: solarContractReview, persist, error };
}
