import { expect, it } from 'vitest';
import {
  DEFAULT_SERVICE_WORKFLOWS,
  isServiceWorkflowPolicy,
  managedServiceWorkflows,
  serviceWorkflowBasis,
} from './service-workflows.js';
it('rejects unsupported routes, invalid durations and escalation without a valid current reference shape', () => {
  const policy = structuredClone(DEFAULT_SERVICE_WORKFLOWS);
  policy.ticket_urgent = {
    hours: 1,
    notification: 'breach',
    email: false,
    escalation: {
      condition: 'ticket_priority',
      from: { kind: 'any', id: null },
      to: { kind: 'role', id: 'support-reviewer' },
      afterHours: 1,
      email: true,
    },
  };
  expect(isServiceWorkflowPolicy(policy)).toBe(true);
  for (const hours of [0, 8761, 1.5, '1', true])
    expect(
      isServiceWorkflowPolicy({ ...policy, ticket_urgent: { ...policy.ticket_urgent, hours } })
    ).toBe(false);
  expect(isServiceWorkflowPolicy({ ...policy, unknown: null })).toBe(false);
  expect(
    isServiceWorkflowPolicy({
      ...policy,
      ticket_urgent: { ...policy.ticket_urgent, notification: ['breach'] },
    })
  ).toBe(false);
  expect(
    isServiceWorkflowPolicy({
      ...policy,
      ticket_urgent: { ...policy.ticket_urgent, notification: 'escalation', escalation: null },
    })
  ).toBe(false);
  expect(isServiceWorkflowPolicy({ ...policy, electricity_order: policy.ticket_urgent })).toBe(
    false
  );
});
it('keeps existing workflows unmanaged by default and compares configuration independent of property insertion order', () => {
  expect([...managedServiceWorkflows(DEFAULT_SERVICE_WORKFLOWS)]).toEqual([]);
  const policy = structuredClone(DEFAULT_SERVICE_WORKFLOWS);
  policy.ticket_low = { hours: 24, notification: 'breach', email: false, escalation: null };
  expect([...managedServiceWorkflows(policy)]).toEqual(['ticket']);
  expect(
    serviceWorkflowBasis(Object.fromEntries(Object.entries(policy).reverse()) as typeof policy)
  ).toBe(serviceWorkflowBasis(policy));
});
