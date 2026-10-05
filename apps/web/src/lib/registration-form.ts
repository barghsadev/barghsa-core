import { authResponseRecord } from './auth-responses.js';
export type RegistrationValues = { username: string; password: string; tos: boolean; otp: string };
export const emptyRegistration: RegistrationValues = {
  username: '',
  password: '',
  tos: false,
  otp: '',
};
export type RegistrationTerms = {
  id: string;
  versionId: string;
  content: string;
  updatedAt: string;
  publishedAt: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function registrationTerms(value: unknown): RegistrationTerms | null {
  const body = authResponseRecord(value);
  return body &&
    typeof body.id === 'string' &&
    uuid.test(body.id) &&
    ['content', 'versionId', 'updatedAt', 'publishedAt'].every(
      (key) => typeof body[key] === 'string' && !!body[key].trim()
    ) &&
    Number.isFinite(Date.parse(body.updatedAt as string)) &&
    Number.isFinite(Date.parse(body.publishedAt as string))
    ? {
        id: body.id,
        versionId: body.versionId as string,
        content: body.content as string,
        updatedAt: body.updatedAt as string,
        publishedAt: body.publishedAt as string,
      }
    : null;
}
export function registrationChallenge(value: unknown): string | null {
  const id = authResponseRecord(value)?.challengeId;
  return typeof id === 'string' && uuid.test(id) ? id : null;
}
export function registrationPasswordValid(value: string): boolean {
  // Registration has no backend maximum; recovery's separate maximum must not narrow this flow.
  return value.length >= 8 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value);
}
