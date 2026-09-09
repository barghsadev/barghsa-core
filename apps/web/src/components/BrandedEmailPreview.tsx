import { normalizeEmailBranding, renderBrandedEmail } from '@barghsa/shared/notifications';
import { useBrandConfig } from '../providers/BrandThemeProvider.js';

/** Render authored email without giving its HTML access to the staff application. */
export default function BrandedEmailPreview({
  body,
  locale,
  title,
}: {
  body: string;
  locale: 'fa' | 'en';
  title: string;
}) {
  const { brandConfig } = useBrandConfig();
  const brand = normalizeEmailBranding(brandConfig, window.location.origin);
  const html = renderBrandedEmail(body, brand, locale);
  const document = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{margin:0;overflow-wrap:anywhere}</style></head><body>${html}</body></html>`;
  return (
    <iframe
      title={title}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={document}
      className="h-96 w-full rounded border-0"
    />
  );
}
