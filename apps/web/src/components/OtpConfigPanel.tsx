import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { verificationConfigText } from '@barghsa/i18n/verification-config';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

const TeamActionDialog = lazy(() =>
  import('./TeamActionDialog.js').then((module) => ({ default: module.TeamActionDialog }))
);
interface Config {
  ttlSeconds: number;
  version: number;
}
function readConfig(raw: unknown): Config {
  const config = raw as Partial<Config> | null;
  if (
    !config ||
    !Number.isInteger(config.ttlSeconds) ||
    config.ttlSeconds! < 60 ||
    config.ttlSeconds! > 900 ||
    !Number.isSafeInteger(config.version) ||
    config.version! < 0
  )
    throw new Error('Invalid OTP configuration');
  return config as Config;
}

export function OtpConfigPanel() {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const text = (key: Parameters<typeof verificationConfigText>[0]) =>
    verificationConfigText(key, locale);
  const [current, setCurrent] = useState<Config | null>(null);
  const [seconds, setSeconds] = useState('');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  const [proposal, setProposal] = useState<{ ttlSeconds: number; expectedVersion: number } | null>(
    null
  );
  const saveRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    setSaved(false);
    void (async () => {
      try {
        const response = await fetch('/api/admin/config/otp', { signal: controller.signal });
        if (!response.ok) throw new Error('Settings unavailable');
        const config = readConfig(await response.json());
        if (controller.signal.aborted) return;
        setCurrent(config);
        setSeconds(String(config.ttlSeconds));
      } catch {
        if (!controller.signal.aborted) {
          setFailed(true);
          setCurrent(null);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [reload]);
  const value = Number(seconds);
  const valid = seconds.trim() !== '' && Number.isInteger(value) && value >= 60 && value <= 900;
  return (
    <section className="mt-8 border-t border-border pt-6" aria-labelledby="otp-config-title">
      <h2 id="otp-config-title" className="text-xl font-semibold">
        {text('otpTitle')}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">{text('otpDescription')}</p>
      {loading && (
        <p role="status" className="mt-3">
          {text('otpLoading')}
        </p>
      )}
      {failed && (
        <p role="alert" className="mt-3 text-destructive">
          {text('otpLoadFailed')}
        </p>
      )}
      {saved && (
        <p role="status" className="mt-3">
          {text('otpSaved')}
        </p>
      )}
      <form
        className="mt-4 max-w-xl space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!current || !valid || loading || proposal || value === current.ttlSeconds) return;
          setSaved(false);
          setProposal({ ttlSeconds: value, expectedVersion: current.version });
        }}
      >
        <fieldset disabled={loading || current === null || proposal !== null} className="space-y-2">
          <legend className="sr-only">{text('otpTitle')}</legend>
          <label htmlFor="otp-lifetime" className="block text-sm font-medium">
            {text('otpLabel')}
          </label>
          <input
            id="otp-lifetime"
            type="number"
            min={60}
            max={900}
            step={1}
            required
            value={seconds}
            aria-describedby="otp-lifetime-hint"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            onChange={(event) => {
              setSeconds(event.target.value);
              setSaved(false);
            }}
          />
          <p id="otp-lifetime-hint" className="text-sm text-muted-foreground">
            {text('otpRange')
              .replace('{min}', numbers.number(60))
              .replace('{max}', numbers.number(900))}
          </p>
          <button
            ref={saveRef}
            type="submit"
            disabled={!valid || value === current?.ttlSeconds}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {text('otpSave')}
          </button>
        </fieldset>
        <button
          type="button"
          disabled={loading || proposal !== null}
          onClick={() => setReload((count) => count + 1)}
          className="text-sm underline disabled:opacity-50"
        >
          {text('otpReload')}
        </button>
      </form>
      {proposal && (
        <Suspense fallback={<p role="status">{text('loading')}</p>}>
          <TeamActionDialog
            finalFocus={saveRef}
            action={{
              title: text('otpSave'),
              description: text('otpDescription'),
              path: '/api/admin/config/otp',
              method: 'PUT',
              body: proposal,
              requiresPassword: true,
              conflictMessage: text('otpConflict'),
            }}
            onClose={() => setProposal(null)}
            onSuccess={async (raw) => {
              const config = readConfig(raw);
              if (
                config.ttlSeconds !== proposal.ttlSeconds ||
                config.version !== proposal.expectedVersion + 1
              )
                throw new Error('Mismatched OTP configuration');
              setCurrent(config);
              setSeconds(String(config.ttlSeconds));
              setSaved(true);
            }}
          />
        </Suspense>
      )}
    </section>
  );
}
