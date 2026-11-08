import { useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/app';
import { t as draftText } from '@barghsa/i18n/onboarding-drafts';
import { ErrorCodes } from '@barghsa/shared/errors';
import { useLocale } from './useLocale.js';
import { useCommandFeedback } from './useCommandFeedback.js';
import type { useOnboardingDraft } from './useOnboardingDraft.js';
import { withCsrf } from '../lib/csrf.js';
import { parseOnboardingProfile, type OnboardingProfile } from '../lib/onboarding-profile.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import { toast } from '../lib/toast-api.js';

export function useOnboardingSubmission(
  profileId: string,
  type: OnboardingProfile['profileType'],
  draft: ReturnType<typeof useOnboardingDraft>
) {
  const locale = useLocale();
  const router = useRouter();
  const request = useRef<AbortController | null>(null);
  const [operation, setOperation] = useState<'submit' | 'check' | null>(null);
  const [unconfirmedVersion, setUnconfirmedVersion] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unconfirmed = unconfirmedVersion !== null;
  const message = error ?? (unconfirmed ? draftText('submissionUnconfirmed', locale) : null);
  useCommandFeedback({ error: message, operation: profileId });
  useLayoutEffect(() => () => request.current?.abort(), []);
  const profilePath = encodeURIComponent(profileId);

  async function run(kind: 'submit' | 'check', work: (signal: AbortSignal) => Promise<void>) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setOperation(kind);
    setError(null);
    try {
      await work(controller.signal);
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setOperation(null);
    }
  }

  function openSavedProfile() {
    draft.markSubmitted();
    void router.navigate({ to: '/onboarding/complete', search: { profileId }, replace: true });
  }

  async function submit(data: Record<string, unknown>) {
    if (!draft.ready || unconfirmed) return;
    await run('submit', async (owner) => {
      const draftVersion = await draft.flush();
      if (draftVersion === undefined || owner.aborted) return;
      try {
        const { status, ok, body } = await readWithDeadline(owner, async (signal) => {
          const response = await fetch(`/api/onboarding/${type.toLowerCase()}/${profilePath}`, {
            method: 'POST',
            credentials: 'include',
            headers: withCsrf({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ ...data, draftVersion }),
            signal,
          });
          return {
            status: response.status,
            ok: response.ok,
            body: await response.json().catch(() => null),
          };
        });
        if (owner.aborted) return;
        if (status >= 500 || status === 408 || status === 404)
          throw new Error('Unconfirmed submission');
        if (!ok) {
          const code = typeof body?.error === 'string' ? body.error : body?.error?.code;
          if (code === ErrorCodes.CONFLICT_VERSION.code) {
            draft.markConflict();
            setError(t('onboarding.draft.conflict', locale));
          } else if (code === ErrorCodes.CONFLICT_DUPLICATE.code) {
            setError(
              type === 'INDIVIDUAL'
                ? t('onboarding.individual.error.duplicateNationalId', locale)
                : draftText('legalDuplicate', locale)
            );
          } else {
            setError(t('onboarding.individual.error.submit', locale));
          }
          return;
        }
        const profile = parseOnboardingProfile(body, profileId, type);
        const expectedName =
          type === 'LEGAL' ? data.legalName : `${data.firstName} ${data.lastName}`;
        if (profile.name !== expectedName) throw new Error('Unexpected saved identity');
      } catch {
        if (!owner.aborted) setUnconfirmedVersion(draftVersion);
        return;
      }
      toast.success(
        type === 'INDIVIDUAL'
          ? t('onboarding.individual.saved', locale)
          : draftText('legalSaved', locale)
      );
      openSavedProfile();
    });
  }

  async function check() {
    if (unconfirmedVersion === null) return;
    await run('check', async (owner) => {
      try {
        const version = await readWithDeadline(owner, async (signal) => {
          const profileResponse = await fetch(`/api/profiles/${profilePath}`, {
            credentials: 'include',
            cache: 'no-store',
            signal,
          });
          if (!profileResponse.ok) throw new Error('Profile unavailable');
          const profile = await profileResponse.json();
          if (profile?.id !== profileId || profile.profileType !== type)
            throw new Error('Unexpected profile');
          if (profile.status !== 'DRAFT') {
            parseOnboardingProfile(profile, profileId, type);
            return null;
          }
          const draftResponse = await fetch(`/api/onboarding/draft/${profilePath}`, {
            credentials: 'include',
            cache: 'no-store',
            signal,
          });
          if (!draftResponse.ok) throw new Error('Draft unavailable');
          const current = await draftResponse.json();
          if (!Number.isInteger(current?.version) || current.version < 0)
            throw new Error('Unexpected draft');
          return current.version as number;
        });
        if (owner.aborted) return;
        if (version === null) {
          openSavedProfile();
          return;
        }
        if (version !== unconfirmedVersion) {
          draft.markConflict();
          setError(t('onboarding.draft.conflict', locale));
        }
        setUnconfirmedVersion(null);
      } catch {
        if (!owner.aborted) setError(draftText('submissionCheckFailed', locale));
      }
    });
  }

  return {
    check,
    message,
    submit,
    unconfirmed,
    submitting: operation === 'submit',
    checking: operation === 'check',
  };
}
