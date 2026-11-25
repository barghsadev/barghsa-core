import { useId, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@barghsa/ui';
import { notificationFormText } from '@barghsa/i18n/notification-forms';
import { normalizeEmailBranding, renderBrandedEmail } from '@barghsa/shared/notifications';
import { useBrandConfig } from '../providers/BrandThemeProvider.js';

/** Render authored email without giving its HTML access to the staff application. */
export default function BrandedEmailPreview({
  body,
  locale,
  uiLocale,
  title,
}: {
  body: string;
  locale: 'fa' | 'en';
  uiLocale: 'fa' | 'en';
  title: string;
}) {
  const frameId = useId();
  const [expanded, setExpanded] = useState(false);
  const { brandConfig } = useBrandConfig();
  const brand = normalizeEmailBranding(brandConfig, window.location.origin);
  const html = renderBrandedEmail(body, brand, locale);
  const document = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{margin:0;overflow-wrap:anywhere}</style></head><body>${html}</body></html>`;
  return (
    <div className="min-w-0">
      <div className="flex justify-end px-2 py-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-controls={frameId}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="text-xs text-muted-foreground"
        >
          {expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
          {notificationFormText(expanded ? 'previewCompact' : 'previewExpand', uiLocale)}
        </Button>
      </div>
      <iframe
        id={frameId}
        title={title}
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={document}
        className={`block w-full rounded border-0 ${expanded ? 'h-[clamp(28rem,70svh,48rem)]' : 'h-64'}`}
      />
    </div>
  );
}
