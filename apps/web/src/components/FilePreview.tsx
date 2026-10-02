import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { documentText } from '@barghsa/i18n/documents';
import type { Locale } from '@barghsa/i18n/app';
import { documentUrl, DocumentRequestError } from '../lib/documents.js';
import { selectedPdfPreview } from '../lib/file-preview.js';

/** Inline previews are images; selected PDFs use the existing bounded transient renderer. */
export function FilePreview({
  name,
  locale,
  imageUrl,
  file,
  contentType,
  onError,
  onAccessDenied,
}: {
  name: string;
  locale: Locale;
  imageUrl?: string | undefined;
  file?: File | undefined;
  contentType?: string | undefined;
  onError?: (() => void) | undefined;
  onAccessDenied?: (() => void) | undefined;
}) {
  const [owned, setOwned] = useState<{ file: File; url: string } | null>(null);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [failedFile, setFailedFile] = useState<File | null>(null);
  const mime = contentType ?? file?.type;
  const image = file && ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime ?? '');
  const pdf = !!file && mime === 'application/pdf';
  useEffect(() => {
    if (!file || (!image && !pdf)) return;
    const controller = new AbortController();
    let url: string | null = null;
    setFailedFile(null);
    setOwned(null);
    void (
      pdf
        ? selectedPdfPreview(file, controller.signal)
        : Promise.resolve(new Blob([file], { type: mime ?? '' }))
    )
      .then((blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setOwned({ file, url });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setFailedFile(file);
        if (error instanceof DocumentRequestError && [401, 403].includes(error.status))
          onAccessDenied?.();
        onError?.();
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [file, image, pdf, mime, onAccessDenied, onError]);
  let remote: string | null = null;
  if (imageUrl) {
    try {
      remote = documentUrl(imageUrl);
    } catch {
      // Never load untrusted protocols or embedded URL credentials.
    }
  }
  const source = file ? (owned?.file === file ? owned.url : null) : remote;
  const available = source && failedSource !== source && failedFile !== file;
  const label = `${documentText('preview', locale)}: ${name}`;
  return (
    <div data-slot="file-preview" className="min-w-0 max-w-full">
      {available ? (
        <img
          src={source}
          alt={label}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="max-h-48 max-w-full rounded-md border object-contain"
          onError={() => {
            setFailedSource(source);
            if (file) setFailedFile(file);
            onError?.();
          }}
        />
      ) : file && (image || pdf) && failedFile !== file ? (
        <p role="status" className="text-sm text-muted-foreground">
          {documentText('previewLoading', locale)}
        </p>
      ) : (
        <span
          role="img"
          aria-label={documentText('previewUnavailable', locale)}
          className="inline-flex size-12 items-center justify-center rounded-md border text-muted-foreground"
        >
          <FileText aria-hidden="true" className="size-6" />
        </span>
      )}
    </div>
  );
}
