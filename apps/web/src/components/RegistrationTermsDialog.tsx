import TosContent from './TosContent.js';
import type { RefObject } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@barghsa/ui';
import { t, type Locale } from '@barghsa/i18n/auth';

export default function RegistrationTermsDialog({
  locale,
  versionId,
  content,
  finalFocus,
  onClose,
}: {
  locale: Locale;
  versionId: string;
  content: string;
  finalFocus: RefObject<HTMLAnchorElement | null>;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-lg max-h-[80vh] flex flex-col"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
        finalFocus={finalFocus}
      >
        <DialogHeader>
          <DialogTitle>{t('tos.modal.title', locale)}</DialogTitle>
          <DialogDescription>{versionId}</DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto text-sm">
          <TosContent content={content} language={locale} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
