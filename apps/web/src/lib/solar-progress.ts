export type SolarMilestone = 'in_progress' | 'delivered' | 'installed';
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
    note: string;
  }>;
}
