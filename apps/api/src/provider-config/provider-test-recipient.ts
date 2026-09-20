import { HttpException } from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';
import { z } from 'zod';
import type { PoolClient } from './provider-config.di.js';
import type { ProviderMutationSession } from './provider-mutation.js';

/** Call inside the provider mutation, while its staff account/session locks are held. */
export async function resolveProviderTestRecipient(
  client: Pick<PoolClient, 'query'>,
  actor: ProviderMutationSession,
  channel: 'email' | 'sms',
  requested?: string
): Promise<string> {
  const normalize = (value: string): string => {
    const trimmed = value.trim();
    return channel === 'email'
      ? trimmed.toLowerCase()
      : trimmed.startsWith('+')
        ? trimmed
        : `+${trimmed}`;
  };
  const schema =
    channel === 'email' ? z.string().email().max(320) : z.string().regex(/^\+[1-9][0-9]{9,14}$/);
  const target = requested?.trim() ? normalize(requested) : undefined;
  if (target && !schema.safeParse(target).success) {
    throw new HttpException(
      { error: ErrorCodes.VALIDATION_PARSE_ZOD.code, message: 'Invalid test recipient' },
      400
    );
  }
  const result = await client.query(
    `SELECT
      CASE WHEN EXISTS (SELECT 1 FROM account_login_identifiers i WHERE i.user_id=u.user_id
        AND i.kind='primary' AND i.destination=lower(u.username)) THEN u.username END AS username,
      CASE WHEN EXISTS (SELECT 1 FROM account_login_identifiers i WHERE i.user_id=u.user_id
        AND i.kind='email' AND i.destination=lower(u.email) AND i.verified_at IS NOT NULL) THEN u.email END AS email,
      CASE WHEN EXISTS (SELECT 1 FROM account_login_identifiers i WHERE i.user_id=u.user_id
        AND i.kind='mobile' AND i.destination=u.mobile AND i.verified_at IS NOT NULL) THEN u.mobile END AS mobile
    FROM users u WHERE u.user_id=$1 AND u.disabled_at IS NULL AND u.activation_token IS NULL`,
    [actor.userId]
  );
  const account = result.rows[0];
  const contacts = account
    ? [channel === 'email' ? account.email : account.mobile, account.username]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map(normalize)
        .filter((value) => schema.safeParse(value).success)
    : [];
  if (target && !contacts.includes(target)) {
    throw new HttpException(
      {
        error: ErrorCodes.AUTHZ_FORBIDDEN.code,
        message: 'Test recipient must be your own verified contact',
      },
      403
    );
  }
  const recipient = target ?? contacts[0];
  if (!recipient) {
    throw new HttpException(
      {
        error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
        message: `Add a verified ${channel === 'email' ? 'email address' : 'mobile number'} before testing this provider`,
      },
      400
    );
  }
  return recipient;
}
