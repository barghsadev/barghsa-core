/** Opt-in workflow targets. A configured workflow replaces its legacy target/tier policy. */
export const SERVICE_WORKFLOW_CONFIG_KEY = 'admin.service_workflows';
export const SERVICE_WORKFLOW_TARGETS = {
  ticket_low: { workType: 'ticket', priority: 'low' },
  ticket_normal: { workType: 'ticket', priority: 'normal' },
  ticket_high: { workType: 'ticket', priority: 'high' },
  ticket_urgent: { workType: 'ticket', priority: 'urgent' },
  verification: { workType: 'verification_case' },
  consultation: { workType: 'consultation' },
  electricity_order: { workType: 'order_fulfillment', service: 'electricity' },
  saving_order: { workType: 'order_fulfillment', service: 'savings' },
  solar_order: { workType: 'order_fulfillment', service: 'solar' },
  electricity_contract: { workType: 'contract_review', service: 'electricity' },
  saving_contract: { workType: 'contract_review', service: 'savings' },
  solar_contract: { workType: 'contract_review', service: 'solar' },
} as const;
export type ServiceWorkflowKey = keyof typeof SERVICE_WORKFLOW_TARGETS;
export const SERVICE_WORKFLOW_KEYS = Object.keys(SERVICE_WORKFLOW_TARGETS) as ServiceWorkflowKey[];
export type WorkflowAudience =
  { kind: 'role' | 'team'; id: string } | { kind: 'any' | 'admins'; id: null };
export interface WorkflowEscalation {
  condition: 'sla_breached' | 'ticket_priority';
  from: WorkflowAudience;
  to: WorkflowAudience;
  afterHours: number;
  email: boolean;
}
export interface ServiceWorkflowTarget {
  hours: number;
  notification: 'breach' | 'escalation';
  email: boolean;
  escalation: WorkflowEscalation | null;
}
export type ServiceWorkflowPolicy = Record<ServiceWorkflowKey, ServiceWorkflowTarget | null>;
export interface ServiceWorkflowView {
  policy: ServiceWorkflowPolicy;
  version: number;
  roles: { id: string; name: string }[];
  teams: { id: string; name: string }[];
}
export const DEFAULT_SERVICE_WORKFLOWS = Object.fromEntries(
  SERVICE_WORKFLOW_KEYS.map((key) => [key, null])
) as ServiceWorkflowPolicy;
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, expected: string[]) =>
  Object.keys(v).length === expected.length && expected.every((key) => Object.hasOwn(v, key));
const hours = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 8760;
function audience(v: unknown, source: boolean): v is WorkflowAudience {
  if (!record(v) || !keys(v, ['kind', 'id'])) return false;
  if (v.kind === (source ? 'any' : 'admins')) return v.id === null;
  return (
    (v.kind === 'role' || v.kind === 'team') &&
    typeof v.id === 'string' &&
    /^[a-zA-Z0-9_-]{1,100}$/.test(v.id) &&
    (v.kind !== 'team' || /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v.id))
  );
}
export function isServiceWorkflowPolicy(value: unknown): value is ServiceWorkflowPolicy {
  return (
    record(value) &&
    keys(value, SERVICE_WORKFLOW_KEYS) &&
    SERVICE_WORKFLOW_KEYS.every((key) => {
      const target = value[key];
      if (target === null) return true;
      if (
        !record(target) ||
        !keys(target, ['hours', 'notification', 'email', 'escalation']) ||
        !hours(target.hours) ||
        typeof target.email !== 'boolean' ||
        (target.notification !== 'breach' && target.notification !== 'escalation')
      )
        return false;
      const rule = target.escalation;
      if (rule === null) return target.notification === 'breach';
      return (
        record(rule) &&
        keys(rule, ['condition', 'from', 'to', 'afterHours', 'email']) &&
        (rule.condition === 'sla_breached' ||
          (key.startsWith('ticket_') && rule.condition === 'ticket_priority')) &&
        audience(rule.from, true) &&
        audience(rule.to, false) &&
        hours(rule.afterHours) &&
        typeof rule.email === 'boolean'
      );
    })
  );
}
export function serviceWorkflowBasis(value: ServiceWorkflowPolicy): string {
  return JSON.stringify(
    SERVICE_WORKFLOW_KEYS.map((key) => {
      const t = value[key],
        r = t?.escalation;
      return t
        ? [
            t.hours,
            t.notification,
            t.email,
            r
              ? [r.condition, r.from.kind, r.from.id, r.to.kind, r.to.id, r.afterHours, r.email]
              : null,
          ]
        : null;
    })
  );
}
export function managedServiceWorkflows(policy: ServiceWorkflowPolicy): Set<string> {
  return new Set(
    SERVICE_WORKFLOW_KEYS.filter((key) => policy[key] !== null).map(
      (key) => SERVICE_WORKFLOW_TARGETS[key].workType
    )
  );
}
export function isServiceWorkflowView(value: unknown): value is ServiceWorkflowView {
  if (
    !record(value) ||
    !isServiceWorkflowPolicy(value.policy) ||
    !Number.isSafeInteger(value.version) ||
    Number(value.version) < 0
  )
    return false;
  return ['roles', 'teams'].every(
    (key) =>
      Array.isArray(value[key]) &&
      value[key].every(
        (r: unknown) => record(r) && typeof r.id === 'string' && typeof r.name === 'string'
      ) &&
      new Set(value[key].map((r: { id: string }) => r.id)).size === value[key].length
  );
}
