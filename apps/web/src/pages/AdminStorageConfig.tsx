import { useEffect, useState, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { Button, Input, Label } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  hasSecretKey: boolean;
  forcePathStyle: boolean;
  privateEndpointUrl: string;
  publicEndpointUrl: string;
  version: number;
}
const textFields = [
  'endpoint',
  'region',
  'bucket',
  'accessKeyId',
  'privateEndpointUrl',
  'publicEndpointUrl',
] as const;
export default function AdminStorageConfig() {
  const locale = useLocale(),
    label = (key: string) => t(`admin.storage.${key}`, locale);
  const [config, setConfig] = useState<StorageConfig | null>(null);
  const [secret, setSecret] = useState(''),
    [clearSecret, setClearSecret] = useState(false);
  const [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true);
  const [error, setError] = useState(false),
    [denied, setDenied] = useState(false);
  const [notice, setNotice] = useState<'saved' | 'tested' | null>(null);
  const [action, setAction] = useState<TeamAction | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setDenied(false);
    setConfig(null);
    void (async () => {
      try {
        const response = await fetch('/api/admin/storage/config', { signal: controller.signal });
        if (response.status === 403) {
          if (!controller.signal.aborted) setDenied(true);
          return;
        }
        if (!response.ok) throw new Error('Unavailable');
        const data = (await response.json()) as StorageConfig;
        if (!controller.signal.aborted) {
          setConfig(data);
          setSecret('');
          setClearSecret(false);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [revision]);
  function prepare(kind: 'save' | 'test', event?: FormEvent) {
    event?.preventDefault();
    if (!config) return;
    setNotice(null);
    const { hasSecretKey: _masked, ...fields } = config;
    const body = {
      ...fields,
      ...(clearSecret ? { secretAccessKey: '' } : secret ? { secretAccessKey: secret } : {}),
    };
    setAction({
      title: label(kind),
      description: label(kind === 'save' ? 'saveDescription' : 'testDescription'),
      path: `/api/admin/storage/${kind === 'save' ? 'config' : 'test-connection'}`,
      method: kind === 'save' ? 'PUT' : 'POST',
      body,
      conflictMessage: label('changed'),
      forbiddenMessage: label('forbidden'),
      errorMessages: {
        'STORAGE:CONFIG_CHANGED': label('changed'),
        'STORAGE:CONNECTION_FAILED': label('connectionFailed'),
        'STORAGE:LOCATION_IN_USE': label('locationInUse'),
        'STORAGE:SECRET_REENTRY_REQUIRED': label('secretReentry'),
        'STORAGE:CREDENTIAL_PAIR_REQUIRED': label('credentialPair'),
        'STORAGE:ENCRYPTION_UNAVAILABLE': label('encryptionUnavailable'),
        'VALIDATION:INPUT_INVALID': label('invalid'),
      },
    });
  }
  return (
    <section
      className="mx-auto max-w-3xl space-y-5 p-4 md:p-6"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{label('title')}</h1>
          <p className="mt-2 text-muted-foreground">{label('description')}</p>
        </div>
        <Button
          variant="outline"
          disabled={loading || !!action}
          onClick={() => {
            setNotice(null);
            setRevision((value) => value + 1);
          }}
        >
          {label('refresh')}
        </Button>
      </div>
      {loading && <p role="status">{label('loading')}</p>}
      {error && (
        <div role="alert">
          <p>{label('loadError')}</p>
          <Button onClick={() => setRevision((value) => value + 1)}>{label('reload')}</Button>
        </div>
      )}
      {denied && <p role="alert">{label('forbidden')}</p>}
      {notice && (
        <p role="status" className="rounded-md border p-3">
          {label(notice)}
        </p>
      )}
      {!loading && !error && !denied && config && (
        <form onSubmit={(event) => prepare('save', event)} className="space-y-5">
          <p className="text-sm text-muted-foreground">
            {label(config.version ? 'savedVersion' : 'deploymentVersion').replace(
              '{version}',
              new Intl.NumberFormat(locale).format(config.version)
            )}
          </p>
          <p className="rounded-md border bg-muted/30 p-3 text-sm">{label('locationWarning')}</p>
          <div className="grid gap-5 sm:grid-cols-2">
            {textFields.map((field) => (
              <div key={field} className="space-y-2">
                <Label htmlFor={`storage-${field}`}>{label(field)}</Label>
                <Input
                  id={`storage-${field}`}
                  dir="ltr"
                  value={config[field]}
                  autoComplete="off"
                  spellCheck={false}
                  required={field === 'region' || field === 'bucket'}
                  maxLength={field.includes('Endpoint') || field === 'endpoint' ? 2048 : 256}
                  disabled={!!action}
                  onChange={(event) => {
                    setConfig({ ...config, [field]: event.target.value });
                    setNotice(null);
                  }}
                />
              </div>
            ))}
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="storage-secret">{label('secret')}</Label>
              <Input
                id="storage-secret"
                type="password"
                dir="ltr"
                autoComplete="new-password"
                maxLength={4096}
                value={secret}
                disabled={!!action || clearSecret}
                onChange={(event) => {
                  setSecret(event.target.value);
                  setNotice(null);
                }}
                aria-describedby="storage-secret-help"
              />
              <p id="storage-secret-help" className="text-sm text-muted-foreground">
                {label(config.hasSecretKey ? 'secretStored' : 'secretMissing')}
              </p>
              {config.hasSecretKey && (
                <div className="flex items-center gap-2">
                  <input
                    id="storage-clear-secret"
                    type="checkbox"
                    checked={clearSecret}
                    disabled={!!action}
                    onChange={(event) => {
                      setClearSecret(event.target.checked);
                      setSecret('');
                    }}
                  />
                  <Label htmlFor="storage-clear-secret">{label('clearSecret')}</Label>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              id="storage-path-style"
              type="checkbox"
              checked={config.forcePathStyle}
              disabled={!!action}
              onChange={(event) => setConfig({ ...config, forcePathStyle: event.target.checked })}
            />
            <Label htmlFor="storage-path-style">{label('forcePathStyle')}</Label>
          </div>
          <p className="text-sm text-muted-foreground">{label('endpointHelp')}</p>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={!!action}>
              {label('save')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!!action}
              onClick={() => prepare('test')}
            >
              {label('test')}
            </Button>
          </div>
        </form>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            if (action.method === 'PUT') {
              setSecret('');
              setNotice('saved');
              setRevision((value) => value + 1);
            } else setNotice('tested');
          }}
        />
      )}
    </section>
  );
}
