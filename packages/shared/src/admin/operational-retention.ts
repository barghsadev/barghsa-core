export const operationalRetentionFields = [
  { key: 'searchableLogsDays', min: 30, max: 365 },
  { key: 'metricsArchiveDays', min: 400, max: 730 },
  { key: 'ordinaryTracesDays', min: 7, max: 90 },
  { key: 'priorityTracesDays', min: 30, max: 365 },
] as const;

export type OperationalRetention = Record<
  (typeof operationalRetentionFields)[number]['key'],
  number
>;

export const defaultOperationalRetention: OperationalRetention = {
  searchableLogsDays: 30,
  metricsArchiveDays: 400,
  ordinaryTracesDays: 7,
  priorityTracesDays: 30,
};

export interface OperationalRetentionView {
  version: number;
  policy: OperationalRetention;
  canEdit: boolean;
}

export function isOperationalRetention(value: unknown): value is OperationalRetention {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const policy = value as Record<string, unknown>;
  return (
    Object.keys(policy).length === operationalRetentionFields.length &&
    operationalRetentionFields.every(({ key, min, max }) => {
      const days = policy[key];
      return typeof days === 'number' && Number.isInteger(days) && days >= min && days <= max;
    }) &&
    (policy.ordinaryTracesDays as number) <= (policy.priorityTracesDays as number)
  );
}
