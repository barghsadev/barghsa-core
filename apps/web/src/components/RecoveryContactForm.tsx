import { OtpInput } from './OtpInput.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Input, Label } from '@barghsa/ui';
import { t } from '@barghsa/i18n/recovery';
import { useLocale } from '../hooks/useLocale.js';
import { publicAuthFetch } from '../lib/public-auth-fetch.js';
import { authResponseRecord } from '../lib/auth-responses.js';
import { readWithDeadline } from '../lib/server-query-client.js';
export default function RecoveryContactForm() {
  const locale = useLocale();
  const [caseId, setCaseId] = useState(''),
    [challengeId, setChallengeId] = useState(''),
    [code, setCode] = useState('');
  const [busy, setBusy] = useState(false),
    [result, setResult] = useState<'verified' | 'error' | 'unconfirmed' | null>(null);
  const controller = useRef<AbortController | null>(null);
  const closed = useRef(false);
  const terminal = result === 'verified' || result === 'unconfirmed';
  useEffect(() => () => controller.current?.abort(), []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (controller.current || closed.current || !caseId || !challengeId || code.length !== 6)
      return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setResult(null);
    const publish = (outcome: NonNullable<typeof result>) => {
      if (request.signal.aborted) return;
      if (outcome !== 'error') {
        closed.current = true;
        setCode('');
      }
      setResult(outcome);
    };
    try {
      const { status, receipt } = await readWithDeadline(request.signal, async (signal) => {
        const response = await publicAuthFetch('/api/auth/recovery/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept-Language': locale },
          body: JSON.stringify({ caseId, challengeId, code }),
          signal,
        });
        return {
          status: response.status,
          receipt: response.status === 200 ? await response.json() : null,
        };
      });
      if (status === 200 && authResponseRecord(receipt)?.verified === true) publish('verified');
      else if ([400, 401, 403, 404, 422, 429].includes(status)) publish('error');
      else publish('unconfirmed');
    } catch {
      publish('unconfirmed');
    } finally {
      if (controller.current === request) {
        controller.current = null;
        if (!request.signal.aborted) setBusy(false);
      }
    }
  }
  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-busy={busy}
      className="space-y-3 rounded border py-4 min-[375px]:px-4 [&_input]:min-w-0"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <h2 className="font-semibold">{t('auth.recovery.title', locale)}</h2>
      <p className="text-sm">{t('auth.recovery.instructions', locale)}</p>
      <fieldset disabled={busy || terminal} className="min-w-0 space-y-3">
        {[
          { value: caseId, set: setCaseId, key: 'caseId' },
          { value: challengeId, set: setChallengeId, key: 'challengeId' },
        ].map(({ value, set, key }) => (
          <div key={key}>
            <Label htmlFor={`recovery-${key}`}>{t(`auth.recovery.${key}`, locale)}</Label>
            <Input
              id={`recovery-${key}`}
              required
              aria-required="true"
              value={value}
              dir="ltr"
              autoComplete="off"
              onChange={(e) => {
                set(e.target.value);
                setResult(null);
              }}
            />
          </div>
        ))}
        {!terminal && (
          <>
            <Label htmlFor="recovery-code">{t('auth.recovery.code', locale)}</Label>
            <OtpInput
              id="recovery-code"
              autoFocus={false}
              locale={locale}
              disabled={busy}
              onChange={(value) => {
                setCode(value);
                setResult(null);
              }}
              onClearError={() => setResult(null)}
            />
            <Button type="submit" disabled={code.length !== 6}>
              {t('auth.recovery.verify', locale)}
            </Button>
          </>
        )}
      </fieldset>
      {busy && <p role="status">{t('auth.recovery.loading', locale)}</p>}
      {result && (
        <p role={result === 'verified' ? 'status' : 'alert'}>
          {t(`auth.recovery.${result}`, locale)}
        </p>
      )}
    </form>
  );
}
