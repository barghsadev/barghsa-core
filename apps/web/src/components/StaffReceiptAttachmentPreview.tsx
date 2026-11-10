import { useState } from 'react';
import { documentUrl } from '../lib/documents.js';

/** Signed attachment URLs remain usable when an inline preview cannot load. */
export function StaffReceiptAttachmentPreview({
  url,
  previewUrl,
  label,
  openLabel,
}: {
  url: string;
  previewUrl: string;
  label: string;
  openLabel: string;
}) {
  const [failedImage, setFailedImage] = useState<{ previewUrl: string; url: string } | null>(null);
  const previewFailed = failedImage?.previewUrl === previewUrl && failedImage.url === url;
  let original: string | null = null;
  try {
    documentUrl(url);
    original = url;
  } catch {
    // Keep the same-origin raster preview available for a malformed signed response.
  }
  return (
    <div className="min-w-0 space-y-2">
      {!previewFailed ? (
        <img
          src={previewUrl}
          alt={label}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailedImage({ previewUrl, url })}
          className="max-h-80 max-w-full rounded border border-border object-contain"
        />
      ) : null}
      {original && (
        <a
          href={original}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary underline underline-offset-4"
        >
          {openLabel}
        </a>
      )}
    </div>
  );
}
