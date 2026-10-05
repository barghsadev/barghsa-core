import {
  contractStates,
  type ContractActivationData,
  type ContractDetailData,
  type ContractVersion,
} from './contracts.js';
import { sameContractEvidence } from './contract-review-signature-form.js';
import { datetimeLocalToIso, isoToDatetimeLocal } from './due-at-override.js';
export const authoringUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const instant = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^(?:[0-9]{4}|[+-][0-9]{6})-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(
    value
  ) &&
  Number.isFinite(Date.parse(value));
export type ExistingContractDraft = { contract: ContractDetailData; version: ContractVersion };
export type ContractDraftValues = {
  profileId: string;
  orderId: string;
  serviceType: string;
  title: string;
  text: string;
  commercialValueKind: 'unsupported' | 'unstated' | 'fixed' | 'variable';
  commercialValueAmountIrr: string;
  commercialValueDescription: string;
  changeDescription: string;
};
export type ContractContextValues = {
  initialInvoiceId: string;
  serviceStartsAt: string;
  serviceEndsAt: string;
  changeDescription: string;
};
export function contractDraftContent(
  original: Record<string, unknown>,
  values: ContractDraftValues
) {
  const content = { ...original };
  for (const name of ['title', 'text'] as const)
    if (
      (original[name] === undefined || typeof original[name] === 'string') &&
      (original[name] !== undefined || values[name].trim())
    )
      content[name] = values[name] === original[name] ? values[name] : values[name].trim();
  if (values.commercialValueKind === 'fixed')
    content.commercialValue = { kind: 'fixed', amountIrr: values.commercialValueAmountIrr.trim() };
  else if (values.commercialValueKind === 'variable')
    content.commercialValue = {
      kind: 'variable',
      description: values.commercialValueDescription.trim(),
    };
  else if (values.commercialValueKind === 'unstated') delete content.commercialValue;
  return content;
}
export function contractContextBody(
  context: ContractActivationData,
  values: ContractContextValues,
  timezone: string
) {
  return {
    initialInvoiceId: values.initialInvoiceId.trim().toLowerCase() || null,
    serviceStartsAt:
      values.serviceStartsAt === isoToDatetimeLocal(context.serviceStartsAt, timezone)
        ? context.serviceStartsAt
        : values.serviceStartsAt
          ? datetimeLocalToIso(values.serviceStartsAt, timezone)
          : null,
    serviceEndsAt:
      values.serviceEndsAt === isoToDatetimeLocal(context.serviceEndsAt, timezone)
        ? context.serviceEndsAt
        : values.serviceEndsAt
          ? datetimeLocalToIso(values.serviceEndsAt, timezone)
          : null,
  };
}
export type ContractAuthoringEvidence = {
  kind: 'create' | 'revise' | 'amendment' | 'context';
  actor: string;
  body: Record<string, unknown>;
  existing?: ExistingContractDraft;
};
export function matchedContractAuthoringReceipt(
  value: unknown,
  captured: ContractAuthoringEvidence
): value is Record<string, unknown> & { id: string } {
  if (
    !record(value) ||
    !authoringUuid(value.id) ||
    !authoringUuid(value.profileId) ||
    !authoringUuid(value.currentVersionId) ||
    !record(value.currentVersion) ||
    value.currentVersion.id !== value.currentVersionId ||
    value.currentVersion.contractId !== value.id ||
    !Number.isSafeInteger(value.currentVersion.versionNumber) ||
    typeof value.currentVersion.changeDescription !== 'string' ||
    !record(value.currentVersion.content) ||
    !instant(value.currentVersion.createdAt) ||
    typeof value.currentVersion.createdBy !== 'string' ||
    !value.currentVersion.createdBy ||
    !(value.currentVersion.acceptedAt === null || instant(value.currentVersion.acceptedAt)) ||
    typeof value.contractNumber !== 'string' ||
    !/^[1-9][0-9]*$/.test(value.contractNumber) ||
    !instant(value.createdAt) ||
    !instant(value.updatedAt) ||
    !['submittedAt', 'acceptedAt', 'signedAt', 'activatedAt', 'completedAt', 'cancelledAt'].every(
      (name) => value[name] === null || instant(value[name])
    ) ||
    typeof value.amendmentSupported !== 'boolean' ||
    !(value.linkedOrderStatus === null || typeof value.linkedOrderStatus === 'string') ||
    !(value.orderId === null || authoringUuid(value.orderId))
  )
    return false;
  const version = value.currentVersion,
    base = captured.existing;
  if (!base)
    return (
      captured.kind === 'create' &&
      value.profileId === captured.body.profileId &&
      value.serviceType === captured.body.serviceType &&
      value.orderId === (captured.body.orderId ?? null) &&
      value.state === 'Draft' &&
      version.versionNumber === 1 &&
      version.createdBy === captured.actor &&
      version.changeDescription === captured.body.changeDescription &&
      sameContractEvidence(version.content, captured.body.content) &&
      version.acceptedAt === null &&
      value.acceptedParty === null &&
      value.pendingAmendment === null
    );
  if (
    value.id !== base.contract.id ||
    value.profileId !== base.contract.profileId ||
    value.serviceType !== base.contract.serviceType ||
    (base.contract.contractNumber !== undefined &&
      value.contractNumber !== base.contract.contractNumber) ||
    (base.contract.orderId !== undefined && value.orderId !== base.contract.orderId)
  )
    return false;
  if (captured.kind === 'amendment') {
    const pending = value.pendingAmendment;
    return (
      value.state === base.contract.state &&
      value.currentVersionId === base.version.id &&
      [
        'id',
        'versionNumber',
        'content',
        'changeDescription',
        'createdAt',
        'createdBy',
        'acceptedAt',
      ].every(
        (name) =>
          !Object.hasOwn(base.version, name) ||
          sameContractEvidence(version[name], base.version[name as keyof ContractVersion])
      ) &&
      sameContractEvidence(value.acceptedParty, base.contract.acceptedParty ?? null) &&
      record(pending) &&
      authoringUuid(pending.versionId) &&
      pending.versionId !== base.version.id &&
      pending.baseVersionId === base.version.id &&
      pending.state === 'Draft' &&
      pending.proposedBy === captured.actor &&
      instant(pending.createdAt) &&
      pending.publishedAt === null
    );
  }
  if (
    value.pendingAmendment !== null ||
    value.acceptedParty !== null ||
    value.state !==
      (base.contract.state === 'ChangesRequested' ? 'AwaitingStaffReview' : 'Draft') ||
    !sameContractEvidence(version.content, captured.body.content)
  )
    return false;
  // A Draft context edit may normalize to an existing context; the service then returns the unchanged version.
  if (value.currentVersionId === base.version.id)
    return (
      base.contract.state === 'Draft' &&
      [
        'id',
        'versionNumber',
        'content',
        'changeDescription',
        'createdAt',
        'createdBy',
        'acceptedAt',
      ].every(
        (name) =>
          !Object.hasOwn(base.version, name) ||
          sameContractEvidence(version[name], base.version[name as keyof ContractVersion])
      )
    );
  return (
    version.versionNumber === base.version.versionNumber + 1 &&
    version.createdBy === captured.actor &&
    version.changeDescription === captured.body.changeDescription &&
    version.acceptedAt === null
  );
}
export type ContractAuthoringChoice = {
  id: string;
  title?: string;
  profileType?: 'INDIVIDUAL' | 'LEGAL';
  serviceType?: 'electricity' | 'savings' | 'solar';
  createdAt?: string;
};
export function contractAuthoringOptions(
  value: unknown,
  order: boolean
): { rows: ContractAuthoringChoice[]; nextBefore: string | null } | null {
  if (!record(value)) return null;
  const rows = value[order ? 'orders' : 'profiles'];
  if (
    !Array.isArray(rows) ||
    rows.length > 50 ||
    !rows.every(
      (row) =>
        record(row) &&
        authoringUuid(row.id) &&
        (order
          ? typeof row.serviceType === 'string' &&
            ['electricity', 'savings', 'solar'].includes(row.serviceType) &&
            instant(row.createdAt)
          : typeof row.title === 'string' &&
            typeof row.profileType === 'string' &&
            ['INDIVIDUAL', 'LEGAL'].includes(row.profileType))
    ) ||
    new Set(rows.map((row) => row.id)).size !== rows.length ||
    !(
      value.nextBefore === null ||
      (authoringUuid(value.nextBefore) &&
        rows.length === 50 &&
        rows.at(-1)?.id === value.nextBefore)
    )
  )
    return null;
  return { rows, nextBefore: value.nextBefore };
}
export function contractActivationData(
  value: unknown,
  id: string,
  versionId: string
): ContractActivationData | null {
  if (
    !record(value) ||
    value.contractId !== id ||
    value.versionId !== versionId ||
    !contractStates.some((state) => state === value.state) ||
    typeof value.isCurrent !== 'boolean' ||
    typeof value.ready !== 'boolean' ||
    !Number.isSafeInteger(value.ruleRevision) ||
    Number(value.ruleRevision) < 1 ||
    !(value.initialInvoiceId === null || authoringUuid(value.initialInvoiceId)) ||
    ![value.serviceStartsAt, value.serviceEndsAt].every((v) => v === null || instant(v)) ||
    !instant(value.evaluatedAt) ||
    !Array.isArray(value.checks) ||
    value.checks.length !== 5 ||
    !value.checks.every(
      (item) =>
        record(item) &&
        typeof item.key === 'string' &&
        [
          'staffApproval',
          'customerAcceptance',
          'signature',
          'initialPayment',
          'serviceStart',
        ].includes(item.key) &&
        typeof item.required === 'boolean' &&
        typeof item.status === 'string' &&
        ['met', 'unmet', 'not_required'].includes(item.status)
    ) ||
    new Set(value.checks.map((item) => item.key)).size !== 5
  )
    return null;
  return value as unknown as ContractActivationData;
}

export function contractContextScope(context: ContractActivationData) {
  const {
    contractId,
    versionId,
    state,
    isCurrent,
    ruleRevision,
    initialInvoiceId,
    serviceStartsAt,
    serviceEndsAt,
  } = context;
  return {
    contractId,
    versionId,
    state,
    isCurrent,
    ruleRevision,
    initialInvoiceId,
    serviceStartsAt,
    serviceEndsAt,
  };
}

export function contractAuthoringSource(existing?: ExistingContractDraft) {
  if (!existing) return null;
  const { contract, version } = existing;
  return {
    contract: {
      id: contract.id,
      profileId: contract.profileId,
      contractNumber: contract.contractNumber,
      orderId: contract.orderId,
      serviceType: contract.serviceType,
      state: contract.state,
      currentVersionId: contract.currentVersionId,
      acceptedParty: contract.acceptedParty,
      pendingAmendment: contract.pendingAmendment,
      amendmentSupported: contract.amendmentSupported,
    },
    version: {
      id: version.id,
      versionNumber: version.versionNumber,
      content: version.content,
      changeDescription: version.changeDescription,
      createdBy: version.createdBy,
      createdAt: version.createdAt,
      acceptedAt: version.acceptedAt,
    },
  };
}
