export interface SavingFulfillmentEvent {
  id: string;
  stage: string;
  from_status: string;
  to_status: string;
  explanation: string;
  handover_description?: string | null;
  created_at: string;
  actorName?: string | null;
  actor_context?: string | null;
  noteKind?: 'started' | 'confirmed' | 'recorded';
}

export interface SavingFulfillmentStage {
  stage: string;
  status: string;
  started_at?: string | null;
  completed_at: string | null;
  explanation: string | null;
  handover_description: string | null;
}
