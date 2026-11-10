import { useState } from 'react';

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
