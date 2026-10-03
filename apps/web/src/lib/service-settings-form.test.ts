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
  expect(validEscalationPolicy({ ticket: null, verification_case: null })).toBe(true);
  for (const value of [
    {},
    { ticket: null },
    { ticket: { level2: level }, verification_case: null },
    { ticket: { level2: { ...level, delayHours: 0 }, level3: level }, verification_case: null },
    {
      ticket: { level2: { ...level, channels: ['email'] }, level3: level },
      verification_case: null,
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
  } satisfies EscalationPolicies;
  const raw = serviceValues('escalation', config);
  expect(raw.ticketLevel2Enabled).toBe(false);
  expect(raw.ticketLevel3Enabled).toBe(true);
  expect(serviceBody('escalation', { ...raw, ticketLevel3Hours: ' ۴۸ ' })).toEqual(config);
  expect(serviceBody('escalation', { ...raw, ticketLevel3Enabled: false })).toEqual({
    ticket: null,
    verification_case: null,
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
