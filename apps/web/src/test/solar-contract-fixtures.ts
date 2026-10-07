import {
  solarContractAmounts,
  solarContractBody,
  type SolarContractBody,
  type SolarContractDraft,
} from '../lib/solar-contract-form.js';
export const solarRequestId = '11111111-1111-4111-8111-111111111111';
export const solarProfileId = '22222222-2222-4222-8222-222222222222';
export const solarTemplateId = '33333333-3333-4333-8333-333333333333';
export const solarDocumentId = '44444444-4444-4444-8444-444444444444';
export const solarCommandKey = '55555555-5555-4555-8555-555555555555';
export const solarCreatedId = '66666666-6666-4666-8666-666666666666';
export const solarInvoiceId = '77777777-7777-4777-8777-777777777777';
export const contractOptions = {
  templates: [{ version_id: solarTemplateId, name: 'Solar agreement', version_number: 2 }],
  documents: [{ id: solarDocumentId, original_name: 'Signed source.pdf' }],
};
export function contractDraft(): SolarContractDraft {
  return {
    source: 'template:' + solarTemplateId,
    title: 'Solar agreement',
    text: 'Build the station.',
    changeDescription: 'Initial draft',
    valueKind: 'fixed',
    fixedAmount: '900000',
    variableDescription: 'Retained variable draft',
    invoiceLines: [
      {
        description: 'Deposit',
        quantity: '1',
        unitPrice: '100000',
        vatRate: '0',
        isTaxable: false,
      },
    ],
  };
}
export function contractReview(
  body: SolarContractBody = solarContractBody(contractDraft(), solarProfileId, solarCommandKey)
) {
  const amounts = solarContractAmounts(body.invoiceLines);
  const source =
    body.source.kind === 'template'
      ? { ...body.source, label: 'Solar agreement', versionNumber: 2 }
      : { ...body.source, label: 'Signed source.pdf', versionNumber: null };
  return {
    schemaVersion: 1,
    hash: 'a'.repeat(64),
    scope: {
      action: 'solar.contract.create',
      profileId: body.profileId,
      resourceId: body.idempotencyKey,
    },
    data: {
      requestId: solarRequestId,
      requestStatus: 'approved',
      title: body.title,
      text: body.text,
      changeDescription: body.changeDescription,
      commercialValue: body.commercialValue,
      source: {
        ...source,
        checksum: 'b'.repeat(64),
        sizeBytes: 100,
        fileName: body.source.kind === 'template' ? 'solar.txt' : 'Signed source.pdf',
        contentType: body.source.kind === 'template' ? 'text/plain' : 'application/pdf',
      },
      ...(body.source.kind === 'template'
        ? {
            template: {
              name: source.label,
              text: 'Rendered template source terms.\n\n' + body.text,
            },
          }
        : {}),
      activationRequirements: {
        signature_required: true,
        payment_required: false,
        service_start_required: false,
        revision: 1,
      },
      invoiceLines: amounts.lines,
      totals: {
        currency: 'IRR',
        subtotal: amounts.subtotal,
        vat: amounts.vat,
        total: amounts.total,
      },
      dueRule: { source: 'fallback', configDays: 7, periodId: null, serviceType: 'manual' },
      outcome: 'draft_contract_and_unpaid_invoice',
    },
  };
}
export const createdContract = {
  status: 'contract_created',
  contractId: solarCreatedId,
  invoiceIds: [solarInvoiceId],
};
export const solarOwnedError = (fields: unknown[]) => ({
  error: {
    code: 'VALIDATION:INPUT:INVALID',
    message: 'Invalid input',
    correlationId: solarCommandKey,
    fields,
  },
});
