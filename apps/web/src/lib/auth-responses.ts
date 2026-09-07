function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function authResponseRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function hasSessionAcknowledgement(value: unknown): boolean {
  const body = authResponseRecord(value);
  return (
    !!body &&
    ['userId', 'sessionId', 'csrfToken', 'expiresAt'].every((key) => nonEmptyString(body[key])) &&
    Number.isFinite(Date.parse(body.expiresAt as string))
  );
}

type LoginAcknowledgement =
  | { kind: 'password-change'; token: string }
  | { kind: 'otp'; challengeId: string }
  | { kind: 'session' };

export function parseLoginAcknowledgement(value: unknown): LoginAcknowledgement | null {
  const body = authResponseRecord(value);
  if (
    !body ||
    typeof body.requiresOtp !== 'boolean' ||
    (body.mustChangePassword !== undefined && typeof body.mustChangePassword !== 'boolean')
  )
    return null;
  if (body.mustChangePassword) {
    return !body.requiresOtp && nonEmptyString(body.passwordChangeToken)
      ? { kind: 'password-change', token: body.passwordChangeToken }
      : null;
  }
  if (body.requiresOtp) {
    return nonEmptyString(body.challengeId) ? { kind: 'otp', challengeId: body.challengeId } : null;
  }
  return hasSessionAcknowledgement(body) ? { kind: 'session' } : null;
}
