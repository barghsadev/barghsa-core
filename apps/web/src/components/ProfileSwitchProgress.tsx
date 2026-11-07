import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@barghsa/ui';
import { t, type Locale } from '@barghsa/i18n/workspace';
export interface ProfileSwitchProgressProps {
  locale: Locale;
  busy: boolean;
  error: string;
  recheck: () => Promise<boolean>;
}
/** Modal presentation loads on selection; the captured command stays in its owner. */
export default function ProfileSwitchProgress({
  locale,
  busy,
  error,
  recheck,
}: ProfileSwitchProgressProps) {
  const switching = t('dashboard.profile.switching', locale);
  return (
    <Dialog open onOpenChange={() => {}} preventCloseOnOverlayClick>
      <DialogContent
        size="fullscreen"
        showCloseButton={false}
        className="place-content-center text-center data-open:animate-none data-closed:animate-none"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
      >
        <DialogTitle>{switching}</DialogTitle>
        <DialogDescription role={busy ? 'status' : 'alert'}>
          {busy
            ? switching
            : t(
                error === 'confirmationMismatch'
                  ? 'dashboard.profile.mismatch'
                  : 'dashboard.profile.uncertain',
                locale
              )}
        </DialogDescription>
        {!busy && (
          <div className="flex flex-wrap justify-center gap-3">
            <Button onClick={() => void recheck()}>{t('dashboard.profile.recheck', locale)}</Button>
            <Button variant="outline" onClick={() => window.location.reload()}>
              {t('dashboard.profile.reloadWorkspace', locale)}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
