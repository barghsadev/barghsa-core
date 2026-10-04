import type { EscalationPolicies } from '@barghsa/shared/admin';
import { expect, it } from 'vitest';
import {
  serviceFields,
  serviceDefaults,
  serviceValues,
  serviceBody,
  validEscalationPolicy,
  escalationBasis,
} from './service-settings-form.js';
import { serviceSettingsSchema } from './catalogue-form-schemas.js';
import { boundedCatalogueInteger } from './catalogue-form.js';
import { isResponseTargets, targetBasis } from './assignment-settings.js';

it('validates enabled hours exactly and retains irrelevant disabled draft values', () => {
  const fields = serviceFields('targets');
  const schema = serviceSettingsSchema(
    fields,
    Object.fromEntries(Object.keys(serviceDefaults).map((key) => [key, 'Invalid'])) as Record<
      keyof typeof serviceDefaults,
      string
    >,
    boundedCatalogueInteger
  );
  for (const raw of ['', '0', '1.5', '1e3', '8761', '9007199254740992', '1,234']) {
    const draft = { ...serviceDefaults, ticketEnabled: true, ticketHours: raw };
    expect(schema.safeParse(draft).success).toBe(false);
    expect(schema.safeParse({ ...draft, ticketEnabled: false }).success).toBe(true);
  }
  for (const raw of ['1', '۸۷۶۰', ' ٧٢ '])
    expect(
      schema.safeParse({ ...serviceDefaults, ticketEnabled: true, ticketHours: raw }).success
    ).toBe(true);
});
it('requires complete read policies and mandatory in-app channels', () => {
  const level = { delayHours: 24, channels: ['in_app'] };
  expect(validEscalationPolicy({ ticket: null, verification_case: null, consultation: null })).toBe(
    true
  );
  for (const value of [
    {},
    { ticket: null },
    { ticket: { level2: level }, verification_case: null, consultation: null },
    {
      ticket: { level2: { ...level, delayHours: 0 }, level3: level },
      verification_case: null,
      consultation: null,
    },
    {
      ticket: { level2: { ...level, channels: ['email'] }, level3: level },
      verification_case: null,
      consultation: null,
    },
  ])
    expect(validEscalationPolicy(value)).toBe(false);
});
it('round-trips level-three-only policy without enabling level two, and uses explicit null for disabled work types', () => {
  const config = {
    ticket: {
      level2: { delayHours: null, channels: ['in_app'] },
      level3: { delayHours: 48, channels: ['in_app', 'email'] },
    },
    verification_case: null,
    consultation: null,
  } satisfies EscalationPolicies;
  const raw = serviceValues('escalation', config);
  expect(raw.ticketLevel2Enabled).toBe(false);
  expect(raw.ticketLevel3Enabled).toBe(true);
  expect(serviceBody('escalation', { ...raw, ticketLevel3Hours: ' ۴۸ ' })).toEqual(config);
  expect(serviceBody('escalation', { ...raw, ticketLevel3Enabled: false })).toEqual({
    ticket: null,
    verification_case: null,
    consultation: null,
  });
  expect(escalationBasis(config)).toBe(
    escalationBasis({
      ...config,
      ticket: {
        ...config.ticket,
        level3: { delayHours: 48, channels: ['email', 'in_app', 'email'] },
      },
    })
  );
});

it('uses explicit consultation field IDs and complete response-target receipts', () => {
  expect(serviceFields('targets').map((field) => field.hours)).toEqual([
    'ticketHours',
    'verificationCaseHours',
    'consultationTargetHours',
  ]);
  expect(
    serviceFields('escalation')
      .filter((field) => field.type === 'consultation')
      .map((field) => field.hours)
  ).toEqual(['consultationLevel2Hours', 'consultationLevel3Hours']);
  const config = { ticket: 24, verification_case: null, consultation: 72 };
  expect(isResponseTargets(config)).toBe(true);
  expect(isResponseTargets({ ticket: 24, verification_case: null })).toBe(false);
  expect(isResponseTargets({ ...config, consultation: undefined })).toBe(false);
  expect(isResponseTargets({ ...config, consultation: 8761 })).toBe(false);
  expect(targetBasis(config)).not.toBe(targetBasis({ ...config, consultation: 73 }));
  const draft = serviceValues('targets', config);
  expect(draft.consultationTargetEnabled).toBe(true);
  expect(serviceBody('targets', { ...draft, consultationTargetHours: ' ۷۲ ' })).toEqual(config);
  expect(serviceBody('targets', { ...draft, consultationTargetEnabled: false })).toEqual({
    ...config,
    consultation: null,
  });
});
it('round-trips consultation escalation channels and binds receipts to both levels', () => {
  const config = {
    ticket: null,
    verification_case: null,
    consultation: {
      level2: { delayHours: 24, channels: ['in_app', 'email'] },
      level3: { delayHours: 48, channels: ['in_app'] },
    },
  } satisfies EscalationPolicies;
  expect(validEscalationPolicy(config)).toBe(true);
  expect(validEscalationPolicy({ ticket: null, verification_case: null })).toBe(false);
  expect(
    validEscalationPolicy({
      ...config,
      consultation: { ...config.consultation, level3: { delayHours: 8761, channels: ['in_app'] } },
    })
  ).toBe(false);
  const draft = serviceValues('escalation', config);
  expect(draft.consultationLevel2Email).toBe(true);
  expect(serviceBody('escalation', { ...draft, consultationLevel3Hours: ' ۴۸ ' })).toEqual(config);
  expect(escalationBasis(config)).not.toBe(
    escalationBasis({
      ...config,
      consultation: { ...config.consultation, level3: { delayHours: 49, channels: ['in_app'] } },
    })
  );
  expect(
    serviceBody('escalation', {
      ...draft,
      consultationLevel2Enabled: false,
      consultationLevel3Enabled: false,
    })
  ).toEqual({ ticket: null, verification_case: null, consultation: null });
});
