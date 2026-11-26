import { useCallback } from 'react';
import { Link } from '@tanstack/react-router';
import { Alert, Button } from '@barghsa/ui';
import { contractTemplatesText } from '@barghsa/i18n/contract-templates';
import { useLocale } from '../hooks/useLocale.js';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { contractTemplateRoutes } from '../lib/template-catalogue-routes.js';
import { RecordDetailSkeleton } from '../components/RecordSkeleton.js';

interface VersionPreview {
  templateId: string;
  templateName: string;
  versionNumber: number;
  fileName: string;
  createdAt: string;
  placeholders: string[];
  text: string;
  truncated: boolean;
}

export default function ContractTemplateVersionPage({
  templateId,
  versionNumber,
}: {
  templateId: string;
  versionNumber: number;
}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const time = useAccountTime(locale);
  const label = (key: string) => contractTemplatesText(`admin.templates.${key}`, locale);
  const scope = useCatalogueScope();
  const validate = useCallback(
    (value: unknown): value is VersionPreview => {
      if (!value || typeof value !== 'object') return false;
      const version = value as Partial<VersionPreview>;
      return (
        version.templateId === templateId &&
        version.versionNumber === versionNumber &&
        typeof version.templateName === 'string' &&
        typeof version.fileName === 'string' &&
        typeof version.createdAt === 'string' &&
        Number.isFinite(Date.parse(version.createdAt)) &&
        Array.isArray(version.placeholders) &&
        version.placeholders.every((key) => typeof key === 'string') &&
        typeof version.text === 'string' &&
        version.text.length <= 256 * 1024 &&
        typeof version.truncated === 'boolean'
      );
    },
    [templateId, versionNumber]
  );
  const resource = useCatalogueResource(
    scope,
    `/api/admin/contract-templates/${templateId}/versions/${versionNumber}/preview`,
    validate,
    { clearOnMissing: true }
  );
  const preview = resource.data;
  return (
    <section className="mx-auto max-w-4xl space-y-4">
      <Link
        to={contractTemplateRoutes.detail}
        params={{ templateId }}
        className="touch-action text-sm text-primary underline underline-offset-4"
      >
        {preview?.templateName ?? label('title')}
      </Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">
          {label('version')} {numbers.number(versionNumber)}
        </h1>
        {preview && (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <bdi className="wrap-anywhere font-medium">{preview.fileName}</bdi>
            <time dateTime={preview.createdAt}>{time.format(preview.createdAt)}</time>
          </div>
        )}
      </header>
      {scope.denied ? (
        <Alert variant="destructive">{label('denied')}</Alert>
      ) : resource.loading ? (
        <RecordDetailSkeleton label={label('loading')} />
      ) : resource.error ? (
        <Alert variant="destructive">
          <p>{label('previewUnavailable')}</p>
          <Button type="button" variant="outline" onClick={resource.retry}>
            {label('detailRetry')}
          </Button>
        </Alert>
      ) : (
        preview && (
          <>
            {time.notice}
            <article className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
              <h2 className="text-lg font-semibold">{label('sourcePreview')}</h2>
              <pre
                dir="auto"
                className="whitespace-pre-wrap rounded-lg bg-muted p-4 text-sm leading-relaxed [overflow-wrap:anywhere]"
              >
                {preview.text}
              </pre>
              {preview.truncated && (
                <p className="text-sm text-muted-foreground">{label('previewTruncated')}</p>
              )}
            </article>
            <section
              aria-label={label('placeholders')}
              className="space-y-2 rounded-xl border bg-card p-4"
            >
              <h2 className="font-semibold">{label('placeholders')}</h2>
              {preview.placeholders.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {preview.placeholders.map((key) => (
                    <li
                      key={key}
                      className="max-w-full rounded bg-muted px-2 py-1 text-sm [overflow-wrap:anywhere]"
                    >
                      <code dir="ltr">{'{{' + key + '}}'}</code>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{label('noPlaceholders')}</p>
              )}
            </section>
          </>
        )
      )}
    </section>
  );
}
