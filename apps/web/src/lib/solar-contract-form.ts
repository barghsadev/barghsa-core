import { ErrorCodes } from '@barghsa/shared/errors';
import { receiptUuid } from './solar-postal-form.js';

export interface SolarContractOptions {
  templates: Array<{ version_id: string; name: string; version_number: number }>;
  documents: Array<{ id: string; original_name: string }>;
}
export interface SolarInvoiceDraft {
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate: string;
  isTaxable: boolean;
}
export interface SolarContractDraft {
  source: string;
  title: string;
  text: string;
  changeDescription: string;
  valueKind: string;
  fixedAmount: string;
  variableDescription: string;
  invoiceLines: SolarInvoiceDraft[];
}
export const emptySolarInvoice = (): SolarInvoiceDraft => ({
  description: '',
  quantity: '1',
  unitPrice: '',
  vatRate: '0',
  isTaxable: false,
});
export const emptySolarContract = (): SolarContractDraft => ({
  source: '',
  title: '',
  text: '',
  changeDescription: '',
  valueKind: '',
  fixedAmount: '',
  variableDescription: '',
  invoiceLines: [emptySolarInvoice()],
});
export interface SolarContractBody {
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
}
export interface SolarContractReview {
  schemaVersion: 1;
  hash: string;
  scope: { action: 'solar.contract.create'; profileId: string; resourceId: string };
  data: {
    requestId: string;
    requestStatus: 'approved';
    title: string;
    text: string;
    changeDescription: string;
    commercialValue: SolarContractBody['commercialValue'];
    source: SolarContractBody['source'] & {
      label: string;
      versionNumber: number | null;
      checksum?: string;
      sizeBytes?: number;
      fileName?: string;
      contentType?: string;
    };
    template?: { name: string; text: string };
    activationRequirements?: {
      signature_required: boolean;
      payment_required: boolean;
      service_start_required: boolean;
      revision: number;
    };
    invoiceLines: Array<
      SolarContractBody['invoiceLines'][number] & { lineTotal: string; vatAmount: string }
    >;
    totals: { currency: 'IRR'; subtotal: string; vat: string; total: string };
    dueRule: {
      source: 'config' | 'fallback';
      configDays: number;
      periodId: string | null;
      serviceType: 'manual';
    };
    outcome: 'draft_contract_and_unpaid_invoice';
  };
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && receiptUuid(value);
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
export const solarInt8 = 9_223_372_036_854_775_807n;
export const solarRowPrice = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9]{1,19}$/.test(value) && BigInt(value) <= solarInt8;
export function solarContractOptions(value: unknown): SolarContractOptions | null {
  if (
    !record(value) ||
    !Array.isArray(value.templates) ||
    !Array.isArray(value.documents) ||
    !value.templates.every(
      (item) =>
        record(item) &&
        uuid(item.version_id) &&
        typeof item.name === 'string' &&
        !!item.name.trim() &&
        integer(item.version_number, 1, 2_147_483_647)
    ) ||
    !value.documents.every(
      (item) =>
        record(item) &&
        uuid(item.id) &&
        typeof item.original_name === 'string' &&
        !!item.original_name.trim()
    ) ||
    new Set(value.templates.map((item) => item.version_id)).size !== value.templates.length ||
    new Set(value.documents.map((item) => item.id)).size !== value.documents.length
  )
    return null;
  return value as unknown as SolarContractOptions;
}
export function selectedSolarSource(raw: string, options: SolarContractOptions) {
  const [kind, id, extra] = raw.split(':');
  if (!id || extra !== undefined) return null;
  if (kind === 'template') {
    const item = options.templates.find((item) => item.version_id === id);
    return item
      ? ({
          kind,
          templateVersionId: id,
          label: item.name,
          versionNumber: item.version_number,
        } as const)
      : null;
  }
  const item = kind === 'document' ? options.documents.find((item) => item.id === id) : null;
  return item
    ? ({
        kind: 'document',
        documentId: id,
        label: item.original_name,
        versionNumber: null,
      } as const)
    : null;
}
export function solarContractBody(
  draft: SolarContractDraft,
  profileId: string,
  key: string
): SolarContractBody {
  const [kind, id] = draft.source.split(':');
  if (!id || !['template', 'document'].includes(kind ?? '')) throw new Error('source');
  return {
    profileId,
    idempotencyKey: key,
    title: draft.title.trim(),
    text: draft.text.trim(),
    changeDescription: draft.changeDescription.trim(),
    commercialValue:
      draft.valueKind === 'fixed'
        ? { kind: 'fixed', amountIrr: draft.fixedAmount }
        : { kind: 'variable', description: draft.variableDescription.trim() },
    source:
      kind === 'template'
        ? { kind: 'template', templateVersionId: id }
        : { kind: 'document', documentId: id },
    invoiceLines: draft.invoiceLines.map((line) => ({
      description: line.description.trim(),
      quantity: Number(line.quantity),
      unitPrice: line.unitPrice,
      vatRate: Number(line.vatRate),
      isTaxable: line.isTaxable,
    })),
  };
}
export function solarContractAmounts(lines: SolarContractBody['invoiceLines']) {
  let subtotal = 0n,
    vat = 0n;
  const calculated = lines.map((line) => {
    const lineTotal = BigInt(line.quantity) * BigInt(line.unitPrice);
    const vatAmount = line.isTaxable
      ? (lineTotal * BigInt(line.vatRate) * 2n + 10_000n) / 20_000n
      : 0n;
    subtotal += lineTotal;
    vat += vatAmount;
    return {
      ...line,
      unitPrice: BigInt(line.unitPrice).toString(),
      lineTotal: lineTotal.toString(),
      vatAmount: vatAmount.toString(),
    };
  });
  return {
    lines: calculated,
    subtotal: subtotal.toString(),
    vat: vat.toString(),
    total: (subtotal + vat).toString(),
  };
}
export function matchedSolarContractReview(
  value: unknown,
  requestId: string,
  body: SolarContractBody,
  options: SolarContractOptions
): SolarContractReview | null {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    typeof value.hash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.hash) ||
    !record(value.scope) ||
    value.scope.action !== 'solar.contract.create' ||
    value.scope.profileId !== body.profileId ||
    value.scope.resourceId !== body.idempotencyKey ||
    !record(value.data)
  )
    return null;
  const data = value.data,
    source = selectedSolarSource(
      body.source.kind === 'template'
        ? 'template:' + body.source.templateVersionId
        : 'document:' + body.source.documentId,
      options
    );
  if (
    !source ||
    data.requestId !== requestId ||
    data.requestStatus !== 'approved' ||
    data.outcome !== 'draft_contract_and_unpaid_invoice' ||
    data.title !== body.title ||
    data.text !== body.text ||
    data.changeDescription !== body.changeDescription ||
    !record(data.commercialValue) ||
    !record(data.source) ||
    !record(data.totals) ||
    !record(data.dueRule) ||
    !Array.isArray(data.invoiceLines)
  )
    return null;
  if (
    data.commercialValue.kind !== body.commercialValue.kind ||
    (body.commercialValue.kind === 'fixed'
      ? data.commercialValue.amountIrr !== body.commercialValue.amountIrr
      : data.commercialValue.description !== body.commercialValue.description) ||
    Object.keys(data.commercialValue).length !== 2 ||
    ![4, 8].includes(Object.keys(data.source).length) ||
    Object.entries(source).some(
      ([key, expected]) => data.source && (data.source as Record<string, unknown>)[key] !== expected
    )
  )
    return null;
  if (
    Object.keys(data.source).length === 8 &&
    (typeof data.source.checksum !== 'string' ||
      !/^[a-f0-9]{64}$/.test(data.source.checksum) ||
      !integer(
        data.source.sizeBytes,
        1,
        (body.source.kind === 'template' ? 10 : 50) * 1024 * 1024
      ) ||
      typeof data.source.fileName !== 'string' ||
      !data.source.fileName.trim() ||
      data.source.fileName.length > 255 ||
      typeof data.source.contentType !== 'string' ||
      !data.source.contentType.trim() ||
      data.source.contentType.length > 255)
  )
    return null;
  if (
    data.template !== undefined &&
    (body.source.kind !== 'template' ||
      !record(data.template) ||
      Object.keys(data.template).length !== 2 ||
      data.template.name !== data.source.label ||
      typeof data.template.text !== 'string' ||
      !data.template.text.trim() ||
      new TextEncoder().encode(data.template.text).length > 65_536)
  )
    return null;
  if (
    data.activationRequirements !== undefined &&
    (!record(data.activationRequirements) ||
      Object.keys(data.activationRequirements).length !== 4 ||
      typeof data.activationRequirements.signature_required !== 'boolean' ||
      typeof data.activationRequirements.payment_required !== 'boolean' ||
      typeof data.activationRequirements.service_start_required !== 'boolean' ||
      !integer(data.activationRequirements.revision, 1, 2_147_483_647))
  )
    return null;
  const amounts = solarContractAmounts(body.invoiceLines);
  if (
    data.invoiceLines.length !== amounts.lines.length ||
    data.invoiceLines.some((line, index) => {
      const expected = amounts.lines[index];
      return (
        !record(line) ||
        !expected ||
        Object.keys(line).length !== 7 ||
        Object.entries(expected).some(([key, expectedValue]) => line[key] !== expectedValue)
      );
    }) ||
    data.totals.currency !== 'IRR' ||
    data.totals.subtotal !== amounts.subtotal ||
    data.totals.vat !== amounts.vat ||
    data.totals.total !== amounts.total ||
    BigInt(amounts.total) <= 0n ||
    BigInt(amounts.total) > solarInt8
  )
    return null;
  const due = data.dueRule;
  if (
    Object.keys(due).length !== 4 ||
    due.serviceType !== 'manual' ||
    !integer(due.configDays, 1, 365) ||
    !(
      (due.source === 'config' && uuid(due.periodId)) ||
      (due.source === 'fallback' && due.periodId === null && due.configDays === 7)
    )
  )
    return null;
  return value as unknown as SolarContractReview;
}
export function solarContractReceipt(value: unknown): { contractId: string } | null {
  return record(value) &&
    Object.keys(value).length === 3 &&
    value.status === 'contract_created' &&
    uuid(value.contractId) &&
    Array.isArray(value.invoiceIds) &&
    value.invoiceIds.length === 1 &&
    uuid(value.invoiceIds[0]) &&
    value.invoiceIds[0] !== value.contractId
    ? { contractId: value.contractId }
    : null;
}
export function solarContractRejection(value: unknown) {
  if (!record(value) || !record(value.error)) return null;
  const error = value.error;
  return typeof error.message === 'string' &&
    uuid(error.correlationId) &&
    [
      ErrorCodes.VALIDATION_INPUT_INVALID.code,
      'VALIDATION:INPUT_INVALID',
      ErrorCodes.CONFLICT_STATE.code,
      ErrorCodes.CONFLICT_VERSION.code,
      ErrorCodes.NOT_FOUND_RESOURCE.code,
    ].some((code) => error.code === code)
    ? error
    : null;
}
export function solarContractFields(fields: unknown[], draft: SolarContractDraft): string[] | null {
  const owned: Record<string, string> = {
    title: 'title',
    text: 'text',
    changeDescription: 'changeDescription',
    commercialValueKind: 'valueKind',
    sourceKind: 'source',
    invoiceLines: 'invoiceLines',
  };
  owned[draft.valueKind === 'fixed' ? 'commercialValueAmountIrr' : 'commercialValueDescription'] =
    draft.valueKind === 'fixed' ? 'fixedAmount' : 'variableDescription';
  owned[draft.source.startsWith('template:') ? 'sourceTemplateVersionId' : 'sourceDocumentId'] =
    'source';
  for (let index = 0; index < draft.invoiceLines.length; index++)
    for (const [name, leaf] of [
      ['Description', 'description'],
      ['Quantity', 'quantity'],
      ['UnitPrice', 'unitPrice'],
      ['VatRate', 'vatRate'],
      ['IsTaxable', 'isTaxable'],
    ])
      owned['invoiceLine' + index + name] = 'invoiceLines.' + index + '.' + leaf;
  return fields.length &&
    fields.every((field) => typeof field === 'string' && Object.hasOwn(owned, field))
    ? fields.map((field) => owned[field as string]!)
    : null;
}
