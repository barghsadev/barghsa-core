import { t, type Locale } from '@barghsa/i18n/workspace';
import { withCsrf } from './csrf.js';
import { getProfileContextRevision, refreshProfileContext } from './profile-context.js';
import { sendToast } from './toast-api.js';

/** Load only after submission, and never apply a receipt to another workspace. */
export async function saveDefaultProfile(
  target: string,
  revision: number,
  locale: Locale,
  signal: AbortSignal
) {
  const current = () => !signal.aborted && getProfileContextRevision() === revision;
  if (!current()) return;
  const response = await fetch(`/api/profiles/switch/${target}`, {
    method: 'POST',
    credentials: 'include',
    headers: withCsrf({ 'Content-Type': 'application/json' }),
    signal,
  });
  const receipt: { activeProfileId?: unknown } | null = response.ok ? await response.json() : null;
  if (!current()) return;
  if (receipt?.activeProfileId !== target) throw new Error();
  refreshProfileContext();
  sendToast('success', t('dashboard.profile.default.saved', locale));
}
