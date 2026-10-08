import { useId, useState, type ReactNode } from 'react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@barghsa/ui';
import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

export interface SettingsVersion {
  id: string;
  version: number;
  status: 'active' | 'draft' | 'superseded';
  createdBy: string;
  updatedAt: string;
}
/** The domain owns receipts, current authorization and exact version mutation guards. */
export function VersionedSettingsCard<T extends SettingsVersion>({
  title,
  description,
  active,
  versions,
  renderConfig,
  formatDate,
  actions,
  onRollback,
  disabled = false,
}: {
  title: string;
  description?: ReactNode;
  active: T | null;
  versions: readonly T[];
  renderConfig: (version: T) => ReactNode;
  formatDate: (iso: string) => string;
  actions: ReactNode;
  onRollback: (version: T) => void;
  disabled?: boolean;
}) {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale),
    id = useId(),
    [history, setHistory] = useState(false);
  const word = (key: string) => t(`admin.settings.${key}`, locale);
  const versionLabel = (version: number) =>
    word('version').replace('{version}', numbers.number(version, { useGrouping: false }));
  const metadata = (version: T) => (
    <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
      <div>
        <dt className="text-muted-foreground">{word('updatedAt')}</dt>
        <dd>
          <time dateTime={version.updatedAt}>{formatDate(version.updatedAt)}</time>
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-muted-foreground">{word('updatedBy')}</dt>
        <dd className="break-all">
          <bdi>{version.createdBy}</bdi>
        </dd>
      </div>
    </dl>
  );
  return (
    <section aria-labelledby={id} className="min-w-0">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={id}>{title}</h2>
          </CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          {active ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span>{versionLabel(active.version)}</span>
                <Badge variant="secondary">{word('active')}</Badge>
              </div>
              {metadata(active)}
              {renderConfig(active)}
            </>
          ) : (
            <p>{word('noActive')}</p>
          )}
          <Button
            type="button"
            variant="outline"
            className="self-start"
            aria-expanded={history}
            aria-controls={`${id}-history`}
            onClick={() => setHistory((value) => !value)}
          >
            {word('history')}
          </Button>
          {history && (
            <div id={`${id}-history`} className="flex flex-col gap-3">
              {versions.length === 0 ? (
                <p>{word('noHistory')}</p>
              ) : (
                <ol className="flex flex-col gap-4">
                  {versions.map((version) => (
                    <li key={version.id} className="flex min-w-0 flex-col gap-3 border-t pt-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{versionLabel(version.version)}</span>
                        <Badge variant={version.status === 'active' ? 'secondary' : 'outline'}>
                          {word(version.status)}
                        </Badge>
                      </div>
                      {metadata(version)}
                      {renderConfig(version)}
                      {version.status === 'superseded' && (
                        <Button
                          type="button"
                          variant="outline"
                          className="self-start"
                          disabled={disabled}
                          onClick={() => onRollback(version)}
                          aria-label={`${word('rollback')} ${versionLabel(version.version)}`}
                        >
                          {word('rollback')}
                        </Button>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </CardContent>
        <CardFooter className="flex-wrap gap-3">{actions}</CardFooter>
      </Card>
    </section>
  );
}
