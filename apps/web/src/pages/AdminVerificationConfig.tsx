import { useState, useEffect, useCallback, useRef } from 'react';
import { verificationConfigText } from '@barghsa/i18n/verification-config';
import { useLocale } from '../hooks/useLocale.js';
import { withCsrf } from '../lib/csrf.js';
import { OtpConfigPanel } from '../components/OtpConfigPanel.js';

const MODES = ['DISABLED', 'MANUAL', 'API'] as const;
type VerificationMode = (typeof MODES)[number];

function readMode(body: unknown): VerificationMode {
  const mode = (body as { mode?: unknown } | null)?.mode;
  if (!MODES.some((value) => value === mode)) throw new Error('Invalid verification mode');
  return mode as VerificationMode;
}

export default function AdminVerificationConfig() {
  const locale = useLocale();
  const text = (key: Parameters<typeof verificationConfigText>[0]) =>
    verificationConfigText(key, locale);
  const [currentMode, setCurrentMode] = useState<VerificationMode | null>(null);
  const [selectedMode, setSelectedMode] = useState<VerificationMode>('MANUAL');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saved, setSaved] = useState(false);

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
        const mode = readMode(await response.json());
        if (controller.signal.aborted) return;
        setCurrentMode(mode);
        setSelectedMode(mode);
      } catch {
        if (!controller.signal.aborted) {
          setCurrentMode(null);
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
      currentMode === null ||
      selectedMode === currentMode ||
      selectedMode === 'API' ||
      savingRef.current
    )
      return;
    savingRef.current = true;
    setSaving(true);
    setSaved(false);
    setSaveFailed(false);
    try {
      const response = await fetch('/api/admin/config/profile-verification-mode', {
        method: 'PUT',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ mode: selectedMode }),
      });
      if (!response.ok) throw new Error('Save failed');
      const confirmed = readMode(await response.json());
      if (confirmed !== selectedMode) throw new Error('Mismatched verification mode');
      setCurrentMode(confirmed);
      setSaved(true);
    } catch {
      setSaveFailed(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [currentMode, selectedMode, loading, loadFailed]);

  return (
    <div
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      className="rounded-lg bg-background p-6 text-foreground"
    >
      <h1 className="text-2xl font-bold mb-6">{text('title')}</h1>
      <p className="text-sm text-muted-foreground mb-6">{text('description')}</p>
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
      <fieldset disabled={loading || currentMode === null || saving} className="space-y-4 max-w-xl">
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
          disabled={selectedMode === currentMode || selectedMode === 'API'}
          className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? text('saving') : text('save')}
        </button>
      </fieldset>
      <OtpConfigPanel />
    </div>
  );
}
