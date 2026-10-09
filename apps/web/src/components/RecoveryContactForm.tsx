import { OtpInput } from './OtpInput.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Input, Label } from '@barghsa/ui';
import { t } from '@barghsa/i18n/recovery';
import { useLocale } from '../hooks/useLocale.js';
import { publicAuthFetch } from '../lib/public-auth-fetch.js';
export default function RecoveryContactForm() {
  const locale = useLocale();
  const [caseId, setCaseId] = useState(''),
    [challengeId, setChallengeId] = useState(''),
    [code, setCode] = useState('');
  const [busy, setBusy] = useState(false),
    [result, setResult] = useState<'verified' | 'error' | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setResult(null);
    try {
      const response = await publicAuthFetch('/api/auth/recovery/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': locale },
        body: JSON.stringify({ caseId, challengeId, code }),
        signal: request.signal,
      });
      const receipt: unknown = await response.json();
      if (!request.signal.aborted)
        setResult(
          response.ok &&
            typeof receipt === 'object' &&
            receipt !== null &&
            'verified' in receipt &&
            receipt.verified === true
            ? 'verified'
            : 'error'
        );
    } catch {
      if (!request.signal.aborted) setResult('error');
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
      className="space-y-3 rounded border p-4 [&_input]:min-w-0"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <h2 className="font-semibold">{t('auth.recovery.title', locale)}</h2>
      <p className="text-sm">{t('auth.recovery.instructions', locale)}</p>
      <fieldset disabled={busy} className="min-w-0 space-y-3">
        {[
          { value: caseId, set: setCaseId, key: 'caseId' },
          { value: challengeId, set: setChallengeId, key: 'challengeId' },
        ].map(({ value, set, key }) => (
          <div key={key}>
            <Label htmlFor={`recovery-${key}`}>{t(`auth.recovery.${key}`, locale)}</Label>
            <Input
              id={`recovery-${key}`}
              required
              value={value}
              dir="ltr"
              autoComplete={key === 'code' ? 'one-time-code' : 'off'}
              inputMode={key === 'code' ? 'numeric' : 'text'}
              onChange={(e) => {
                set(e.target.value);
                setResult(null);
              }}
            />
          </div>
        ))}
        <Label htmlFor="recovery-code">{t('auth.recovery.code', locale)}</Label>
        <OtpInput
          id="recovery-code"
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
      </fieldset>
      {busy && <p role="status">{t('auth.recovery.loading', locale)}</p>}
      {result && (
        <p role={result === 'error' ? 'alert' : 'status'}>{t(`auth.recovery.${result}`, locale)}</p>
      )}
    </form>
  );
}
