import { useRef } from 'react';
import { uploadInvoiceReceiptAttachment } from '../lib/invoice-bank-receipt-upload.js';

/** A lost receipt acknowledgement must retry the same server attachment identity. */
export function useReceiptAttachmentUpload() {
  const uploaded = useRef<{ file: File; profileId: string; key: string } | null>(null);
  return async (file: File, profileId: string): Promise<string | null> => {
    const cached = uploaded.current;
    if (cached?.file === file && cached.profileId === profileId) return cached.key;
    const key = await uploadInvoiceReceiptAttachment(file, profileId);
    if (key) uploaded.current = { file, profileId, key };
    return key;
  };
}
