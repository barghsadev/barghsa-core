import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import type { useOnboardingDraft } from '../hooks/useOnboardingDraft.js';

interface Props {
  draft: ReturnType<typeof useOnboardingDraft>;
  working: boolean;
  workingLabel: string;
  onStay: () => void;
  onLeave: () => void;
}

export default function OnboardingLeaveDialog(props: Props) {
  const { draft, working, workingLabel, onStay, onLeave } = props;
  const locale = useLocale();
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  }, [props]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const stay = () => {
    if (!inFlight.current) onStay();
  };
  const saveAndLeave = async () => {
    if (inFlight.current || working || !draft.ready || draft.status === 'conflict') return;
    inFlight.current = true;
    setSaving(true);
    try {
      const version = await draft.flush();
      if (mounted.current && version !== undefined && !latest.current.draft.hasUnsavedChanges())
        latest.current.onLeave();
    } finally {
      inFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && stay()}>
      <DialogContent
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
        showCloseButton={false}
        aria-busy={saving || working}
      >
        <DialogTitle>{t('electricity.order.unsaved.title', locale)}</DialogTitle>
        <DialogDescription>{t('electricity.order.unsaved.description', locale)}</DialogDescription>
        {(saving || working) && (
          <p role="status">{saving ? t('onboarding.draft.saving', locale) : workingLabel}</p>
        )}
        {!saving && !working && (draft.status === 'error' || draft.status === 'conflict') && (
          <p role="alert" className="text-sm text-destructive">
            {t(`onboarding.draft.${draft.status}`, locale)}
          </p>
        )}
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            onClick={() => void saveAndLeave()}
            disabled={saving || working || !draft.ready || draft.status === 'conflict'}
          >
            {t('electricity.order.unsaved.saveAndLeave', locale)}
          </Button>
          <Button type="button" variant="outline" disabled={saving} onClick={stay}>
            {t('electricity.order.unsaved.stay', locale)}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={saving || working}
            onClick={() => !inFlight.current && onLeave()}
          >
            {t('electricity.order.unsaved.leave', locale)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
