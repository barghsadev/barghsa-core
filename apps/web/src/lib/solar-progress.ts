export type SolarMilestone = 'in_progress' | 'delivered' | 'installed';

export const solarMilestonePaths = {
  in_progress: 'start-work',
  delivered: 'equipment-delivery',
  installed: 'installation',
} as const satisfies Record<SolarMilestone, string>;

export function solarMilestoneFromPath(operation: string | undefined) {
  return (Object.keys(solarMilestonePaths) as SolarMilestone[]).find(
    (stage) => solarMilestonePaths[stage] === operation
  );
}

export interface SolarProgress {
  requestId: string;
  profileId: string;
  contractId: string | null;
  contractState: string | null;
  revision: number;
  nextMilestone: SolarMilestone | null;
  eligible: boolean;
  stopped: boolean;
  canRecord?: boolean;
  steps: Array<{
    id: 'document_review' | 'postal_submission' | 'contract_signing' | SolarMilestone;
    state: 'complete' | 'current' | 'pending';
    completed: boolean;
    recordedAt: string | null;
    note: string | null;
  }>;
  events: Array<{
    stage: SolarMilestone;
    revision: number;
    recordedAt: string;
    actorName: string | null;
    actorContext?: string | null;
    note: string;
  }>;
}
