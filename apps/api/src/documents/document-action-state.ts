import type { Document } from '@barghsa/db';

const targets = {
  submit: 'SubmittedForReview',
  approve: 'Approved',
  reject: 'Rejected',
  'request-changes': 'Available',
  quarantine: 'Quarantined',
  remove: 'Removed',
} as const satisfies Record<string, Document['state']>;

export type DocumentAction = keyof typeof targets;
type State = Document['state'];
type Scope = 'standard' | 'saving-customer' | 'solar-customer' | 'solar-staff';

const standardRemoval: readonly State[] = ['Uploading', 'PendingScan', 'Superseded', 'Quarantined'];
const removalSources: Record<Scope, readonly State[]> = {
  standard: standardRemoval,
  'solar-staff': standardRemoval,
  'saving-customer': ['Uploading', 'PendingScan', 'Available'],
  'solar-customer': [
    'Uploading',
    'PendingScan',
    'Available',
    'SubmittedForReview',
    'Approved',
    'Rejected',
  ],
};
const quarantineSources: readonly State[] = [
  'Uploading',
  'PendingScan',
  'Available',
  'SubmittedForReview',
  'Approved',
  'Rejected',
  'Superseded',
];

/** Resolve the lifecycle pair after the caller has checked action and record authority. */
export function documentActionTarget(
  action: DocumentAction,
  state: State,
  scope: Scope
): State | null {
  switch (action) {
    case 'submit':
      return state === 'Available' ? targets.submit : null;
    case 'remove':
      return removalSources[scope].includes(state) ? targets.remove : null;
    case 'quarantine':
      return quarantineSources.includes(state) ? targets.quarantine : null;
    default:
      return state === 'SubmittedForReview' || (scope === 'solar-staff' && state === 'Available')
        ? targets[action]
        : null;
  }
}
