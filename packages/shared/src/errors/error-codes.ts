/**
 * Stable error code hierarchy for the Barghsa platform.
 *
 * Format: `DOMAIN:SUBDOMAIN:ERROR_NAME`
 * Codes are stable across releases — never renumber or repurpose a code.
 * Deprecate by adding NEW codes, never rename existing ones.
 */

/** Error severity levels for logging */
export type ErrorSeverity = 'debug' | 'info' | 'warn' | 'error' | 'critical';

/** A single stable error code definition */
export interface ErrorCodeDef {
  /** Machine-readable code, e.g. 'VALIDATION:INPUT:INVALID_EMAIL' */
  code: string;
  /** Default HTTP status for this error type */
  httpStatus: number;
  /** i18n key for the localized message */
  messageKey: string;
  /** Default severity for logging */
  severity: ErrorSeverity;
}

/** Error code definitions */
export const ErrorCodes = {
  // ── Validation ──────────────────────────────────────────
  VALIDATION_INPUT_INVALID: {
    code: 'VALIDATION:INPUT:INVALID',
    httpStatus: 400,
    messageKey: 'error.validation.input.invalid',
    severity: 'debug' as ErrorSeverity,
  },
  VALIDATION_INPUT_MISSING: {
    code: 'VALIDATION:INPUT:MISSING',
    httpStatus: 400,
    messageKey: 'error.validation.input.missing',
    severity: 'debug' as ErrorSeverity,
  },
  VALIDATION_PARSE_ZOD: {
    code: 'VALIDATION:PARSE:ZOD_ERROR',
    httpStatus: 400,
    messageKey: 'error.validation.parse.zod',
    severity: 'debug' as ErrorSeverity,
  },
  VALIDATION_PARSE_JSON: {
    code: 'VALIDATION:PARSE:JSON_ERROR',
    httpStatus: 400,
    messageKey: 'error.validation.parse.json',
    severity: 'debug' as ErrorSeverity,
  },

  // ── Authentication ──────────────────────────────────────
  AUTH_UNAUTHENTICATED: {
    code: 'AUTH:UNAUTHENTICATED',
    httpStatus: 401,
    messageKey: 'error.auth.unauthenticated',
    severity: 'debug' as ErrorSeverity,
  },
  AUTH_TOKEN_EXPIRED: {
    code: 'AUTH:TOKEN_EXPIRED',
    httpStatus: 401,
    messageKey: 'error.auth.token.expired',
    severity: 'debug' as ErrorSeverity,
  },
  AUTH_TOKEN_INVALID: {
    code: 'AUTH:TOKEN_INVALID',
    httpStatus: 401,
    messageKey: 'error.auth.token.invalid',
    severity: 'info' as ErrorSeverity,
  },
  AUTH_SESSION_REVOKED: {
    code: 'AUTH:SESSION_REVOKED',
    httpStatus: 401,
    messageKey: 'error.auth.session.revoked',
    severity: 'info' as ErrorSeverity,
  },
  AUTH_MFA_REQUIRED: {
    code: 'AUTH:MFA_REQUIRED',
    httpStatus: 401,
    messageKey: 'error.auth.mfa.required',
    severity: 'debug' as ErrorSeverity,
  },
  AUTH_MFA_INVALID: {
    code: 'AUTH:MFA_INVALID',
    httpStatus: 401,
    messageKey: 'error.auth.mfa.invalid',
    severity: 'info' as ErrorSeverity,
  },
  AUTH_REGISTER_USERNAME_TAKEN: {
    code: 'AUTH:REGISTER:USERNAME_TAKEN',
    httpStatus: 409,
    messageKey: 'auth.register.error.usernameTaken',
    severity: 'debug' as ErrorSeverity,
  },
  AUTH_REGISTER_INVALID_USERNAME: {
    code: 'AUTH:REGISTER:INVALID_USERNAME',
    httpStatus: 400,
    messageKey: 'auth.register.error.invalidUsername',
    severity: 'debug' as ErrorSeverity,
  },
  AUTH_REGISTER_WEAK_PASSWORD: {
    code: 'AUTH:REGISTER:WEAK_PASSWORD',
    httpStatus: 422,
    messageKey: 'auth.register.error.weakPassword',
    severity: 'debug' as ErrorSeverity,
  },
  AUTH_REGISTER_TOS_NOT_ACCEPTED: {
    code: 'AUTH:REGISTER:TOS_NOT_ACCEPTED',
    httpStatus: 400,
    messageKey: 'auth.register.error.tosNotAccepted',
    severity: 'debug' as ErrorSeverity,
  },

  // ── OTP ────────────────────────────────────────────
  AUTH_OTP_INVALID: {
    code: 'AUTH:OTP:INVALID',
    httpStatus: 401,
    messageKey: 'auth.otp.error.invalid',
    severity: 'info' as ErrorSeverity,
  },
  AUTH_OTP_EXPIRED: {
    code: 'AUTH:OTP:EXPIRED',
    httpStatus: 401,
    messageKey: 'auth.otp.error.expired',
    severity: 'info' as ErrorSeverity,
  },
  AUTH_OTP_MAX_ATTEMPTS: {
    code: 'AUTH:OTP:MAX_ATTEMPTS',
    httpStatus: 401,
    messageKey: 'auth.otp.error.maxAttempts',
    severity: 'info' as ErrorSeverity,
  },
  AUTH_OTP_CONSUMED: {
    code: 'AUTH:OTP:ALREADY_CONSUMED',
    httpStatus: 409,
    messageKey: 'auth.otp.error.alreadyConsumed',
    severity: 'info' as ErrorSeverity,
  },

  // ── Authorization ───────────────────────────────────────
  AUTHZ_FORBIDDEN: {
    code: 'AUTHZ:FORBIDDEN',
    httpStatus: 403,
    messageKey: 'error.authz.forbidden',
    severity: 'info' as ErrorSeverity,
  },
  AUTHZ_INSUFFICIENT_ROLE: {
    code: 'AUTHZ:INSUFFICIENT_ROLE',
    httpStatus: 403,
    messageKey: 'error.authz.insufficient.role',
    severity: 'info' as ErrorSeverity,
  },
  AUTHZ_RESOURCE_OWNER: {
    code: 'AUTHZ:NOT_RESOURCE_OWNER',
    httpStatus: 403,
    messageKey: 'error.authz.not.resource.owner',
    severity: 'info' as ErrorSeverity,
  },

  // ── Not Found ───────────────────────────────────────────
  NOT_FOUND_RESOURCE: {
    code: 'NOT_FOUND:RESOURCE',
    httpStatus: 404,
    messageKey: 'error.not_found.resource',
    severity: 'debug' as ErrorSeverity,
  },
  NOT_FOUND_ROUTE: {
    code: 'NOT_FOUND:ROUTE',
    httpStatus: 404,
    messageKey: 'error.not_found.route',
    severity: 'debug' as ErrorSeverity,
  },

  // ── Conflict ────────────────────────────────────────────
  CONFLICT_DUPLICATE: {
    code: 'CONFLICT:DUPLICATE_ENTRY',
    httpStatus: 409,
    messageKey: 'error.conflict.duplicate',
    severity: 'debug' as ErrorSeverity,
  },
  CONFLICT_STATE: {
    code: 'CONFLICT:INVALID_STATE',
    httpStatus: 409,
    messageKey: 'error.conflict.state',
    severity: 'debug' as ErrorSeverity,
  },
  CONFLICT_VERSION: {
    code: 'CONFLICT:VERSION_CONFLICT',
    httpStatus: 409,
    messageKey: 'error.conflict.version',
    severity: 'debug' as ErrorSeverity,
  },

  // ── CSRF ─────────────────────────────────────────────────
  AUTHZ_CSRF_INVALID: {
    code: 'AUTHZ:CSRF_TOKEN_INVALID',
    httpStatus: 403,
    messageKey: 'error.authz.csrf.invalid',
    severity: 'warn' as ErrorSeverity,
  },
  AUTHZ_STEP_UP_REQUIRED: {
    code: 'AUTHZ:STEP_UP_REQUIRED',
    httpStatus: 403,
    messageKey: 'error.authz.step_up.required',
    severity: 'debug' as ErrorSeverity,
  },
  AUTHZ_PROFILE_NOT_VERIFIED: {
    code: 'AUTHZ:PROFILE_NOT_VERIFIED',
    httpStatus: 403,
    messageKey: 'error.authz.profile.not_verified',
    severity: 'info' as ErrorSeverity,
  },

  // ── Rate Limit ──────────────────────────────────────────
  RATE_LIMIT_EXCEEDED: {
    code: 'RATE_LIMIT:EXCEEDED',
    httpStatus: 429,
    messageKey: 'error.rate_limit.exceeded',
    severity: 'info' as ErrorSeverity,
  },
  AUTH_OTP_RATE_LIMITED: {
    code: 'AUTH:OTP:RATE_LIMITED',
    httpStatus: 429,
    messageKey: 'auth.otp.error.rateLimited',
    severity: 'info' as ErrorSeverity,
  },

  // ── Provider / External Service ─────────────────────────
  PROVIDER_DOWNSTREAM: {
    code: 'PROVIDER:DOWNSTREAM_ERROR',
    httpStatus: 502,
    messageKey: 'error.provider.downstream',
    severity: 'error' as ErrorSeverity,
  },
  PROVIDER_TIMEOUT: {
    code: 'PROVIDER:TIMEOUT',
    httpStatus: 504,
    messageKey: 'error.provider.timeout',
    severity: 'error' as ErrorSeverity,
  },
  PROVIDER_RATE_LIMITED: {
    code: 'PROVIDER:RATE_LIMITED',
    httpStatus: 429,
    messageKey: 'error.provider.rate_limited',
    severity: 'warn' as ErrorSeverity,
  },

  // ── Internal ────────────────────────────────────────────
  INTERNAL_SERVER: {
    code: 'INTERNAL:SERVER_ERROR',
    httpStatus: 500,
    messageKey: 'error.internal.server',
    severity: 'error' as ErrorSeverity,
  },
  INTERNAL_DATABASE: {
    code: 'INTERNAL:DATABASE_ERROR',
    httpStatus: 500,
    messageKey: 'error.internal.database',
    severity: 'error' as ErrorSeverity,
  },
  INTERNAL_UNEXPECTED: {
    code: 'INTERNAL:UNEXPECTED',
    httpStatus: 500,
    messageKey: 'error.internal.unexpected',
    severity: 'critical' as ErrorSeverity,
  },
  AUTH_REGISTER_FAILED: {
    code: 'AUTH:REGISTER:FAILED',
    httpStatus: 500,
    messageKey: 'auth.register.error.generic',
    severity: 'error' as ErrorSeverity,
  },

  // ── Login ─────────────────────────────────────
  AUTH_LOGIN_INVALID_CREDENTIALS: {
    code: 'AUTH:LOGIN:INVALID_CREDENTIALS',
    httpStatus: 401,
    messageKey: 'auth.login.error.invalidCredentials',
    severity: 'info' as ErrorSeverity,
  },
  AUTH_LOGIN_MUST_CHANGE_PASSWORD: {
    code: 'AUTH:LOGIN:MUST_CHANGE_PASSWORD',
    httpStatus: 400,
    messageKey: 'auth.login.error.mustChangePassword',
    severity: 'info' as ErrorSeverity,
  },
  AUTH_LOGIN_PASSWORD_REUSED: {
    code: 'AUTH:LOGIN:PASSWORD_REUSED',
    httpStatus: 422,
    messageKey: 'auth.login.error.passwordReused',
    severity: 'info' as ErrorSeverity,
  },
  AUTH_LOGIN_FAILED: {
    code: 'AUTH:LOGIN:FAILED',
    httpStatus: 500,
    messageKey: 'auth.login.error.generic',
    severity: 'error' as ErrorSeverity,
  },

  // ── Username / Contact Change ──────────────────────────
  AUTH_CHANGE_USERNAME_INVALID: {
    code: 'AUTH:CHANGE_USERNAME:INVALID',
    httpStatus: 400,
    messageKey: 'auth.changeUsername.error.invalid',
    severity: 'info' as ErrorSeverity,
  },
  AUTH_CHANGE_USERNAME_SAME: {
    code: 'AUTH:CHANGE_USERNAME:SAME',
    httpStatus: 400,
    messageKey: 'auth.changeUsername.error.same',
    severity: 'debug' as ErrorSeverity,
  },
  AUTH_CHANGE_USERNAME_TAKEN: {
    code: 'AUTH:CHANGE_USERNAME:TAKEN',
    httpStatus: 409,
    messageKey: 'auth.changeUsername.error.taken',
    severity: 'debug' as ErrorSeverity,
  },
  AUTH_CHANGE_USERNAME_NO_EMAIL: {
    code: 'AUTH:CHANGE_USERNAME:NO_EMAIL',
    httpStatus: 400,
    messageKey: 'auth.changeUsername.error.noEmail',
    severity: 'info' as ErrorSeverity,
  },
  AUTH_CHANGE_USERNAME_NO_MOBILE: {
    code: 'AUTH:CHANGE_USERNAME:NO_MOBILE',
    httpStatus: 400,
    messageKey: 'auth.changeUsername.error.noMobile',
    severity: 'info' as ErrorSeverity,
  },
  AUTH_CHANGE_USERNAME_ALREADY_HAS_EMAIL: {
    code: 'AUTH:CHANGE_USERNAME:ALREADY_HAS_EMAIL',
    httpStatus: 409,
    messageKey: 'auth.changeUsername.error.alreadyHasEmail',
    severity: 'debug' as ErrorSeverity,
  },
  AUTH_CHANGE_USERNAME_ALREADY_HAS_MOBILE: {
    code: 'AUTH:CHANGE_USERNAME:ALREADY_HAS_MOBILE',
    httpStatus: 409,
    messageKey: 'auth.changeUsername.error.alreadyHasMobile',
    severity: 'debug' as ErrorSeverity,
  },
} as const satisfies Record<string, ErrorCodeDef>;

/** Union type of all error code strings */
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]['code'];

/** Get an error code definition by its HTTP status – useful as a fallback */
export function errorCodeForHttpStatus(status: number): ErrorCodeDef {
  const matched = Object.values(ErrorCodes).find((def) => def.httpStatus === status);
  return matched ?? ErrorCodes.INTERNAL_UNEXPECTED;
}

/** Get a default error code for a given HTTP status */
export function defaultErrorCode(status: number): string {
  return errorCodeForHttpStatus(status).code;
}
