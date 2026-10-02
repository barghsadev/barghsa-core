import type { SolarProgress } from '../lib/solar-progress.js';
export const constructionRequest = '85000000-0000-4000-8000-000000000001';
export const constructionOlder = '85000000-0000-4000-8000-000000000002';
export const constructionContract = '85000000-0000-4000-8000-000000000003';
export const constructionProfile = '85000000-0000-4000-8000-000000000004';
export const constructionStages = ['in_progress', 'delivered', 'installed'] as const;
const dates = ['2026-09-26T23:00:00.000Z', '2026-09-27T23:00:00.000Z', '2026-09-28T23:00:00.000Z'];
export function constructionProgress(revision = 0, id = constructionRequest): SolarProgress {
  const ids = [
    'document_review',
    'postal_submission',
    'contract_signing',
    ...constructionStages,
  ] as const;
  return {
    requestId: id,
    profileId: constructionProfile,
    contractId: constructionContract,
    contractState: 'Active',
    revision,
    nextMilestone: constructionStages[revision] ?? null,
    eligible: revision < 3,
    canRecord: revision < 3,
    stopped: false,
    steps: ids.map((stage, index) => ({
      id: stage,
      state: index < revision + 3 ? 'complete' : index === revision + 3 ? 'current' : 'pending',
      completed: index < revision + 3,
      recordedAt:
        index < 3 ? '2026-09-25T23:00:00.000Z' : index < revision + 3 ? dates[index - 3]! : null,
      note: null,
    })),
    events: constructionStages.slice(0, revision).map((stage, index) => ({
      stage,
      revision: index + 1,
      recordedAt: dates[index]!,
      actorName: 'کارشناس <img src=x>',
      note: 'Verified <script> work',
    })),
  };
}
export function constructionRow(id = constructionRequest) {
  return {
    requestId: id,
    contractId: constructionContract,
    contractNumber: id === constructionRequest ? '701' : '702',
    submittedAt: '2026-09-20T23:00:00.000Z',
    contractState: 'Active',
    stage: null,
    revision: 0,
  };
}
