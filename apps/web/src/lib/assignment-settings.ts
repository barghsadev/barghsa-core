import {
  SERVICE_RESPONSE_TARGET_TYPES,
  validateServiceResponseTargets,
  type ServiceResponseTargets,
} from '@barghsa/shared/admin';

// These fixed surfaces are seeded by migration 0046 and enforced by the slot API.
export const SLOT_KEYS = [
  'individual_chatbot',
  'legal_entity_chatbot',
  'staff_chatbot',
  'website_chatbot',
  'telegram_chatbot',
] as const;
export type SlotKey = (typeof SLOT_KEYS)[number];
export interface AgentRef {
  id: string;
  title: string;
  enabled: boolean;
}
export interface AssignmentAgent extends AgentRef {
  updatedAt: string;
}
export interface AgentSlot {
  slotKey: SlotKey;
  label: string;
  agent: AgentRef | null;
  alsoUsedIn: SlotKey[];
  updatedAt: string;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const date = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
export function isAgentRef(value: unknown): value is AgentRef {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.id) &&
    text(value.title) &&
    typeof value.enabled === 'boolean'
  );
}
export function isAssignmentAgent(value: unknown): value is AssignmentAgent {
  return isAgentRef(value) && date((value as AssignmentAgent).updatedAt);
}
export function isAssignmentAgents(value: unknown): value is AssignmentAgent[] {
  return (
    Array.isArray(value) &&
    value.every(isAssignmentAgent) &&
    new Set(value.map((agent) => agent.id)).size === value.length
  );
}
export function isAgentSlot(value: unknown): value is AgentSlot {
  return (
    record(value) &&
    SLOT_KEYS.includes(value.slotKey as SlotKey) &&
    text(value.label) &&
    (value.agent === null || isAgentRef(value.agent)) &&
    date(value.updatedAt) &&
    Array.isArray(value.alsoUsedIn) &&
    value.alsoUsedIn.every((key) => SLOT_KEYS.includes(key) && key !== value.slotKey) &&
    new Set(value.alsoUsedIn).size === value.alsoUsedIn.length &&
    (value.agent !== null || value.alsoUsedIn.length === 0)
  );
}
export function isAgentSlots(value: unknown): value is AgentSlot[] {
  if (
    !Array.isArray(value) ||
    value.length !== SLOT_KEYS.length ||
    !value.every(isAgentSlot) ||
    new Set(value.map((slot) => slot.slotKey)).size !== value.length
  )
    return false;
  return value.every((slot) => {
    const shared = value
      .filter(
        (other) => other.slotKey !== slot.slotKey && slot.agent && other.agent?.id === slot.agent.id
      )
      .map((other) => other.slotKey);
    return (
      slot.alsoUsedIn.length === shared.length &&
      slot.alsoUsedIn.every((key) => shared.includes(key))
    );
  });
}
export function slotBasis(slot: AgentSlot) {
  return JSON.stringify([
    slot.slotKey,
    slot.label,
    slot.agent?.id ?? null,
    slot.agent?.title ?? null,
    slot.agent?.enabled ?? null,
    slot.updatedAt,
    [...slot.alsoUsedIn].sort(),
  ]);
}
/** Read/acknowledgement maps must include every supported type; omitted values are not zero. */
export function isResponseTargets(value: unknown): value is ServiceResponseTargets {
  return (
    record(value) &&
    validateServiceResponseTargets(value).ok &&
    SERVICE_RESPONSE_TARGET_TYPES.every(
      (key) => Object.hasOwn(value, key) && value[key] !== undefined
    )
  );
}
export const targetBasis = (value: ServiceResponseTargets) =>
  JSON.stringify(SERVICE_RESPONSE_TARGET_TYPES.map((key) => value[key]));
