import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { verificationConfigText } from '@barghsa/i18n/verification-config';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { Button, Input, Label } from '@barghsa/ui';
import { SettingsFormSection } from './SettingsFormSection.js';
import { AuditLogViewer } from './AuditLogViewer.js';

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
  const generation = useRef(0),
    completionGeneration = generation.current;
  function closeReview() {
    generation.current++;
    setProposal(null);
  }
  useEffect(() => {
    generation.current++;
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
    return () => {
      generation.current++;
      controller.abort();
    };
  }, [reload]);
  const value = Number(seconds);
  const valid = seconds.trim() !== '' && Number.isInteger(value) && value >= 60 && value <= 900;
  return (
    <>
      <SettingsFormSection
        title={text('otpTitle')}
        headingId="otp-config-title"
        description={text('otpDescription')}
        className="mt-8 max-w-xl"
        saved={saved}
        savedMessage={text('otpSaved')}
        onSubmit={(event) => {
          event.preventDefault();
          if (!current || !valid || loading || proposal || value === current.ttlSeconds) return;
          setSaved(false);
          setProposal({ ttlSeconds: value, expectedVersion: current.version });
        }}
        actions={
          <>
            <Button
              ref={saveRef}
              type="submit"
              disabled={loading || !current || !!proposal || !valid || value === current.ttlSeconds}
            >
              {text('otpSave')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={loading || !!proposal}
              onClick={() => setReload((count) => count + 1)}
            >
              {text('otpReload')}
            </Button>
          </>
        }
      >
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
        <fieldset disabled={loading || current === null || proposal !== null} className="space-y-2">
          <legend className="sr-only">{text('otpTitle')}</legend>
          <Label htmlFor="otp-lifetime">{text('otpLabel')}</Label>
          <Input
            id="otp-lifetime"
            type="number"
            min={60}
            max={900}
            step={1}
            required
            value={seconds}
            aria-describedby="otp-lifetime-hint"
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
        </fieldset>
      </SettingsFormSection>
      {current && (
        <AuditLogViewer
          scope="otp"
          refreshKey={current.version}
          onDenied={() => {
            generation.current++;
            setCurrent(null);
            setSeconds('');
            setSaved(false);
            setProposal(null);
            setFailed(true);
          }}
        />
      )}
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
            onClose={closeReview}
            onSuccess={async (raw) => {
              if (generation.current !== completionGeneration) return;
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
    </>
  );
}
