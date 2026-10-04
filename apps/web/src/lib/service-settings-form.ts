import {
  SERVICE_RESPONSE_TARGET_TYPES,
  isValidServiceResponseTargetHours,
  isValidEscalationChannels,
  type ServiceResponseTargets,
  type EscalationPolicies,
} from '@barghsa/shared/admin';
import { boundedCatalogueInteger, record } from './catalogue-form.js';

export type ServiceSettingsKind = 'targets' | 'escalation';
export type ServiceSettings = ServiceResponseTargets | EscalationPolicies;
const prefixes = {
  ticket: 'ticket',
  verification_case: 'verificationCase',
  consultation: 'consultation',
} as const satisfies Record<(typeof SERVICE_RESPONSE_TARGET_TYPES)[number], string>;
type Prefix = (typeof prefixes)[keyof typeof prefixes];
type Tier =
  Exclude<Prefix, 'consultation'> | 'consultationTarget' | `${Prefix}Level2` | `${Prefix}Level3`;
export type ServiceDraft = Record<`${Tier}Hours`, string> &
  Record<`${Tier}Enabled` | `${Tier}Email`, boolean>;
export interface ServiceField {
  type: (typeof SERVICE_RESPONSE_TARGET_TYPES)[number];
  tier: 'level2' | 'level3' | undefined;
  prefix: Tier;
  hours: `${Tier}Hours`;
  enabled: `${Tier}Enabled`;
  email: `${Tier}Email`;
}
export function serviceFields(kind: ServiceSettingsKind): ServiceField[] {
  return SERVICE_RESPONSE_TARGET_TYPES.flatMap((type) => {
    const prefix = prefixes[type];
    const tiers = kind === 'targets' ? [undefined] : (['level2', 'level3'] as const);
    return tiers.map((tier) => {
      const name: Tier = tier
        ? `${prefix}${tier === 'level2' ? 'Level2' : 'Level3'}`
        : type === 'consultation'
          ? 'consultationTarget'
          : prefixes[type];
      return {
        type,
        tier,
        prefix: name,
        hours: `${name}Hours`,
        enabled: `${name}Enabled`,
        email: `${name}Email`,
      };
    });
  });
}
export const serviceDefaults = Object.fromEntries(
  [...serviceFields('targets'), ...serviceFields('escalation')].flatMap((field) => [
    [field.hours, '24'],
    [field.enabled, false],
    [field.email, false],
  ])
) as ServiceDraft;
export function validEscalationPolicy(value: unknown): value is EscalationPolicies {
  return (
    record(value) &&
    SERVICE_RESPONSE_TARGET_TYPES.every((type) => {
      if (!Object.hasOwn(value, type)) return false;
      const policy = value[type];
      return (
        policy === null ||
        (record(policy) &&
          ['level2', 'level3'].every((tier) => {
            const level = policy[tier];
            return (
              record(level) &&
              Object.hasOwn(level, 'delayHours') &&
              (level.delayHours === null || isValidServiceResponseTargetHours(level.delayHours)) &&
              isValidEscalationChannels(level.channels)
            );
          }))
      );
    })
  );
}
export function serviceValues(kind: ServiceSettingsKind, config: ServiceSettings): ServiceDraft {
  const draft = { ...serviceDefaults };
  for (const field of serviceFields(kind)) {
    const level = field.tier ? (config as EscalationPolicies)[field.type]?.[field.tier] : null;
    const hours = field.tier
      ? (level?.delayHours ?? null)
      : (config as ServiceResponseTargets)[field.type];
    draft[field.hours] = String(hours ?? 24);
    draft[field.enabled] = hours !== null;
    draft[field.email] = level?.channels.includes('email') ?? false;
  }
  return draft;
}
export function serviceBody(kind: ServiceSettingsKind, draft: ServiceDraft): ServiceSettings {
  const targets = Object.fromEntries(
    SERVICE_RESPONSE_TARGET_TYPES.map((type) => [type, null])
  ) as ServiceResponseTargets;
  const policies = Object.fromEntries(
    SERVICE_RESPONSE_TARGET_TYPES.map((type) => [type, null])
  ) as EscalationPolicies;
  for (const field of serviceFields(kind)) {
    const hours = draft[field.enabled]
      ? boundedCatalogueInteger(draft[field.hours], 1, 8760)
      : null;
    if (!field.tier) targets[field.type] = hours;
    else {
      const policy = policies[field.type] ?? {
        level2: { delayHours: null, channels: ['in_app'] },
        level3: { delayHours: null, channels: ['in_app'] },
      };
      policy[field.tier] = {
        delayHours: hours,
        channels: draft[field.email] ? ['in_app', 'email'] : ['in_app'],
      };
      policies[field.type] = policy;
    }
  }
  // A fully disabled work type has the API's explicit null representation.
  for (const type of SERVICE_RESPONSE_TARGET_TYPES) {
    if (policies[type]?.level2.delayHours === null && policies[type]?.level3.delayHours === null)
      policies[type] = null;
  }
  return kind === 'targets' ? targets : policies;
}
export const escalationBasis = (config: EscalationPolicies) =>
  JSON.stringify(
    SERVICE_RESPONSE_TARGET_TYPES.map((type) => {
      const policy = config[type];
      return policy
        ? [policy.level2, policy.level3].map((level) => [
            level.delayHours,
            level.channels.includes('email'),
          ])
        : null;
    })
  );
