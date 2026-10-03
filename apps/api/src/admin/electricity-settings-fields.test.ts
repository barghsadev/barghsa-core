import { expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { InputFieldException } from '../common/input-field.exception.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { DEFAULT_GREEN_ELECTRICITY_CONFIG } from '@barghsa/shared/finance';
const admin = { session: { isAdmin: true } } as AuthenticatedRequest;
const denied = { session: { isAdmin: false } } as AuthenticatedRequest;
const controller = new AdminController(
  {} as never,
  {} as never,
  {} as never,
  {} as never,
  {} as never
);
const operations = [
  {
    field: 'days',
    body: { days: 'PRIVATE_VALUE' },
    run: (body: unknown, req: AuthenticatedRequest) =>
      controller.setElectricityOrderDraftTtl(body, req),
  },
  {
    field: 'versionId',
    body: { versionId: 'PRIVATE_VALUE' },
    run: (body: unknown, req: AuthenticatedRequest) =>
      controller.setElectricityContractTemplate(body, req),
  },
  {
    field: 'simpleThreshold',
    body: {
      ...DEFAULT_GREEN_ELECTRICITY_CONFIG,
      simpleOrder: {
        ...DEFAULT_GREEN_ELECTRICITY_CONFIG.simpleOrder,
        averagePowerThresholdKw: 'PRIVATE_VALUE',
      },
    },
    run: (body: unknown, req: AuthenticatedRequest) =>
      controller.setGreenElectricityRules(body, req),
  },
];
it.each(operations)(
  '$field is permission-gated and returns only public field identifiers',
  async ({ field, body, run }) => {
    const forbidden = await run(body, denied).catch((error: unknown) => error);
    expect(forbidden).toBeInstanceOf(HttpException);
    expect((forbidden as HttpException).getStatus()).toBe(403);
    expect(forbidden).not.toBeInstanceOf(InputFieldException);
    const invalid = await run(body, admin).catch((error: unknown) => error);
    expect(invalid).toBeInstanceOf(InputFieldException);
    expect((invalid as InputFieldException).fields).toEqual([field]);
    expect(JSON.stringify((invalid as HttpException).getResponse())).not.toContain('PRIVATE_VALUE');
  }
);
