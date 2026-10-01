import { useState } from 'react';
import { isImageAttachment, isPdfAttachment } from '../lib/bank-receipt-confirmation.js';

/** Signed attachment URLs remain usable when an inline preview cannot load. */
export function StaffReceiptAttachmentPreview({
  url,
  attachmentKey,
  label,
  openLabel,
}: {
  url: string;
  attachmentKey?: string | null | undefined;
  label: string;
  openLabel: string;
}) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  return (
    <div className="min-w-0 space-y-2">
      {isImageAttachment(attachmentKey) && failedImage !== url ? (
        <img
          src={url}
          alt={label}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailedImage(url)}
          className="max-h-80 max-w-full rounded border border-border object-contain"
        />
      ) : isPdfAttachment(attachmentKey) ? (
        <iframe
          title={label}
          src={url}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-80 w-full rounded border border-border"
        />
      ) : null}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-primary underline underline-offset-4"
      >
        {openLabel}
      </a>
    </div>
  );
}
