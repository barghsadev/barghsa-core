import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@barghsa/ui';
import type { Locale } from '@barghsa/i18n/workspace';
export interface ProfileSwitchProgressProps {
  locale: Locale;
  busy: boolean;
  error: string;
  messages: {
    switching: string;
    uncertain: string;
    mismatch: string;
    recheck: string;
    reload: string;
  };
  recheck: () => Promise<boolean>;
}
/** Modal presentation loads on selection; the captured command stays in its owner. */
export default function ProfileSwitchProgress({
  locale,
  busy,
  error,
  messages,
  recheck,
}: ProfileSwitchProgressProps) {
  return (
    <Dialog open onOpenChange={() => {}} preventCloseOnOverlayClick>
      <DialogContent
        size="fullscreen"
        showCloseButton={false}
        className="place-content-center text-center data-open:animate-none data-closed:animate-none"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
      >
        <DialogTitle>{messages.switching}</DialogTitle>
        <DialogDescription role={busy ? 'status' : 'alert'}>
          {busy
            ? messages.switching
            : error === 'confirmationMismatch'
              ? messages.mismatch
              : messages.uncertain}
        </DialogDescription>
        {!busy && (
          <div className="flex flex-wrap justify-center gap-3">
            <Button onClick={() => void recheck()}>{messages.recheck}</Button>
            <Button variant="outline" onClick={() => window.location.reload()}>
              {messages.reload}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
