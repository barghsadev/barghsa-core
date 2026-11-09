import {
  contractStates,
  type ContractDetailData,
  type ContractHistoryEvent,
  type ContractVersion,
} from './contracts.js';

export type ContractVersionPage = { versions: ContractVersion[]; nextBefore: number | null };
type ContractVersionRecord = ContractVersion & { contractId?: string };

const optionalText = (value: unknown) => value == null || typeof value === 'string';
const isDate = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const isVersionNumber = (value: number) => Number.isSafeInteger(value) && value > 0;

function validHistory(value: { history?: ContractHistoryEvent[]; historyTruncated?: boolean }) {
  return (
    (value.historyTruncated === undefined || typeof value.historyTruncated === 'boolean') &&
    (value.history === undefined ||
      (Array.isArray(value.history) &&
        value.history.every(
          (event) =>
            event &&
            typeof event.id === 'string' &&
            typeof event.event === 'string' &&
            ['staff', 'customer', 'system'].includes(event.actorType) &&
            isDate(event.at) &&
            optionalText(event.actorName) &&
            optionalText(event.reason)
        )))
  );
}

function validVersion(version: ContractVersionRecord, contractId: string) {
  return (
    !!version &&
    typeof version.id === 'string' &&
    !!version.id &&
    (version.contractId === undefined || version.contractId === contractId) &&
    isVersionNumber(version.versionNumber) &&
    typeof version.changeDescription === 'string' &&
    isDate(version.createdAt) &&
    [version.acceptedAt, version.publishedAt].every((date) => date == null || isDate(date)) &&
    optionalText(version.createdBy)
  );
}

export function validContractSnapshot(
  version: ContractVersion | undefined,
  contractId: string,
  expectedVersion?: string
): version is ContractVersion {
  return (
    !!version &&
    validVersion(version, contractId) &&
    (expectedVersion === undefined || version.id === expectedVersion) &&
    !!version.content &&
    typeof version.content === 'object' &&
    !Array.isArray(version.content) &&
    validHistory(version)
  );
}

export function validContractDetail(contract: ContractDetailData, id: string) {
  const party = contract?.acceptedParty;
  return (
    !!contract &&
    contract.id === id &&
    typeof contract.profileId === 'string' &&
    !!contract.profileId &&
    contractStates.includes(contract.state) &&
    ['electricity', 'savings', 'solar'].includes(contract.serviceType) &&
    (contract.currentVersionId === undefined ||
      (typeof contract.currentVersionId === 'string' && !!contract.currentVersionId)) &&
    [contract.contractNumber, contract.orderId, contract.savingOrderId].every(optionalText) &&
    (party == null ||
      (party.profileId === contract.profileId &&
        ['INDIVIDUAL', 'LEGAL'].includes(party.profileType) &&
        [party.name, party.identifier, party.registrationNumber].every(optionalText))) &&
    validHistory(contract)
  );
}

export function validContractVersionPage(
  page: ContractVersionPage,
  contractId: string,
  before?: number
) {
  return (
    !!page &&
    (page.nextBefore === null ||
      (isVersionNumber(page.nextBefore) && (before === undefined || page.nextBefore < before))) &&
    Array.isArray(page.versions) &&
    page.versions.every(
      (version) =>
        validVersion(version, contractId) &&
        (before === undefined || version.versionNumber < before)
    ) &&
    new Set(page.versions.map((version) => version.id)).size === page.versions.length
  );
}
