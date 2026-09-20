import { lazy, Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { verificationConfigText } from '@barghsa/i18n/verification-config';
import { useLocale } from '../hooks/useLocale.js';
import { withCsrf } from '../lib/csrf.js';
import { OtpConfigPanel } from '../components/OtpConfigPanel.js';

const MODES = ['DISABLED', 'MANUAL', 'API'] as const;
type VerificationMode = (typeof MODES)[number];
interface Config {
  mode: VerificationMode;
  draft: VerificationMode | null;
  version: number;
}
const TeamActionDialog = lazy(() =>
  import('../components/TeamActionDialog.js').then((module) => ({
    default: module.TeamActionDialog,
  }))
);

function readConfig(body: unknown): Config {
  const config = body as Config | null;
  if (
    !config ||
    !MODES.includes(config.mode) ||
    (config.draft !== null && !MODES.includes(config.draft)) ||
    !Number.isSafeInteger(config.version) ||
    config.version < 0
  )
    throw new Error('Invalid verification configuration');
  return config;
}

export default function AdminVerificationConfig() {
  const locale = useLocale();
  const text = (key: Parameters<typeof verificationConfigText>[0]) =>
    verificationConfigText(key, locale);
  const [current, setCurrent] = useState<Config | null>(null);
  const currentMode = current?.mode ?? null;
  const [selectedMode, setSelectedMode] = useState<VerificationMode>('MANUAL');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activated, setActivated] = useState(false);
  const [proposal, setProposal] = useState<{
    mode: VerificationMode;
    expectedVersion: number;
    action: 'activate';
  } | null>(null);
  const activateRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadFailed(false);
    void (async () => {
      try {
        const response = await fetch('/api/admin/config/profile-verification-mode', {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Read failed');
        const config = readConfig(await response.json());
        if (controller.signal.aborted) return;
        setCurrent(config);
        setSelectedMode(config.draft ?? config.mode);
        setSaved(false);
        setActivated(false);
        setSaveFailed(false);
      } catch {
        if (!controller.signal.aborted) {
          setCurrent(null);
          setLoadFailed(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [reload]);

  const handleSave = useCallback(async () => {
    if (
      loading ||
      loadFailed ||
      current === null ||
      selectedMode === (current.draft ?? current.mode) ||
      selectedMode === 'API' ||
      savingRef.current
    )
      return;
    savingRef.current = true;
    setSaving(true);
    setSaved(false);
    setActivated(false);
    setSaveFailed(false);
    try {
      const response = await fetch('/api/admin/config/profile-verification-mode', {
        method: 'PUT',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          mode: selectedMode,
          expectedVersion: current.version,
          action: 'draft',
        }),
      });
      if (!response.ok) throw new Error('Save failed');
      const confirmed = readConfig(await response.json());
      if (
        confirmed.draft !== selectedMode ||
        confirmed.mode !== current.mode ||
        confirmed.version !== current.version + 1
      )
        throw new Error('Mismatched verification draft');
      setCurrent(confirmed);
      setSaved(true);
    } catch {
      setSaveFailed(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [current, selectedMode, loading, loadFailed]);

  return (
    <div
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      className="rounded-lg bg-background p-6 text-foreground"
    >
      <h1 className="text-2xl font-bold mb-6">{text('title')}</h1>
      <p className="text-sm text-muted-foreground mb-6">{text('description')}</p>
      <p className="mb-4 text-sm">{text('warning')}</p>
      {current && (
        <p className="mb-4 text-sm">
          {text('activeMode')}: {text(current.mode)}
        </p>
      )}
      {loading && <p role="status">{text('loading')}</p>}
      {loadFailed && (
        <div
          role="alert"
          className="mb-4 p-3 bg-destructive/10 border border-destructive/30 rounded text-foreground text-sm"
        >
          <p>{text('loadFailed')}</p>
          <button
            type="button"
            disabled={loading}
            onClick={() => setReload((value) => value + 1)}
            className="underline"
          >
            {text('retry')}
          </button>
        </div>
      )}
      {saveFailed && (
        <p role="alert" className="mb-4 text-foreground">
          {text('saveFailed')}
        </p>
      )}
      {saved && (
        <p role="status" className="mb-4 text-foreground">
          {text('saved')}
        </p>
      )}
      {activated && (
        <p role="status" className="mb-4">
          {text('activated')}
        </p>
      )}
      <fieldset
        disabled={loading || currentMode === null || saving || proposal !== null}
        className="space-y-4 max-w-xl"
      >
        <legend className="sr-only">{text('title')}</legend>
        {MODES.map((mode) => (
          <label
            key={mode}
            htmlFor={`verification-mode-${mode}`}
            className={`block p-4 border rounded-lg text-card-foreground transition-colors ${selectedMode === mode ? 'border-primary bg-primary/10' : 'border-border bg-card'}`}
          >
            <span className="flex items-center gap-3">
              <input
                type="radio"
                id={`verification-mode-${mode}`}
                name="verification-mode"
                value={mode}
                disabled={mode === 'API'}
                checked={currentMode !== null && selectedMode === mode}
                aria-describedby={`verification-mode-${mode}-description`}
                onChange={() => {
                  setSaveFailed(false);
                  setSaved(false);
                  setActivated(false);
                  setSelectedMode(mode);
                }}
                className="accent-primary focus-visible:outline-2 focus-visible:outline-ring"
              />
              <span>
                <span className="block font-medium text-sm">{text(mode)}</span>
                <span
                  id={`verification-mode-${mode}-description`}
                  className="block text-xs text-foreground/80 mt-0.5"
                >
                  {text(`${mode}_description`)}
                </span>
              </span>
            </span>
          </label>
        ))}
        <button
          type="button"
          onClick={handleSave}
          disabled={selectedMode === (current?.draft ?? currentMode) || selectedMode === 'API'}
          className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? text('saving') : text('save')}
        </button>
        {current?.draft && (
          <div className="space-y-3 border-t border-border pt-4">
            <p>
              {text('draftMode')}: {text(current.draft)}
            </p>
            <button
              ref={activateRef}
              type="button"
              disabled={selectedMode !== current.draft || current.draft === 'API'}
              onClick={() => {
                setSaved(false);
                setActivated(false);
                setProposal({
                  mode: current.draft!,
                  expectedVersion: current.version,
                  action: 'activate',
                });
              }}
              className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md disabled:opacity-50"
            >
              {text('activate')}
            </button>
          </div>
        )}
      </fieldset>
      <button
        type="button"
        disabled={loading || saving || proposal !== null}
        onClick={() => setReload((value) => value + 1)}
        className="mt-4 text-sm underline disabled:opacity-50"
      >
        {text('reload')}
      </button>
      {proposal && (
        <Suspense fallback={<p role="status">{text('loading')}</p>}>
          <TeamActionDialog
            finalFocus={activateRef}
            action={{
              title: text('activate'),
              description: `${text('warning')} ${text('draftMode')}: ${text(proposal.mode)}`,
              path: '/api/admin/config/profile-verification-mode',
              method: 'PUT',
              body: proposal,
              requiresPassword: true,
              conflictMessage: text('conflict'),
            }}
            onClose={() => setProposal(null)}
            onSuccess={async (raw) => {
              const confirmed = readConfig(raw);
              if (
                confirmed.mode !== proposal.mode ||
                confirmed.draft !== null ||
                confirmed.version !== proposal.expectedVersion + 1
              )
                throw new Error('Mismatched verification activation');
              setCurrent(confirmed);
              setSelectedMode(confirmed.mode);
              setActivated(true);
            }}
          />
        </Suspense>
      )}
      <OtpConfigPanel />
    </div>
  );
}
