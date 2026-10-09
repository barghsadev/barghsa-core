import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@barghsa/ui';
import { t } from '@barghsa/i18n/workspace';
import { useLocale } from '../hooks/useLocale.js';

interface Props {
  onSave: () => Promise<boolean>;
  saveDisabled?: boolean;
  errorMessage?: string | undefined;
  working: boolean;
  workingLabel: string;
  onStay: () => void;
  onLeave: () => void;
  onDiscardSaved?: () => Promise<boolean>;
}

export default function WizardLeaveDialog(props: Props) {
  const { onSave, saveDisabled, errorMessage, working, workingLabel, onStay, onLeave } = props;
  const locale = useLocale();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
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
    if (inFlight.current || working || saveDisabled) return;
    inFlight.current = true;
    setSaving(true);
    setFailed(false);
    try {
      const saved = await onSave();
      if (mounted.current) {
        if (saved) latest.current.onLeave();
        else setFailed(true);
      }
    } catch {
      if (mounted.current) setFailed(true);
    } finally {
      inFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  const discardSavedAndLeave = async () => {
    if (inFlight.current || working || !props.onDiscardSaved) return;
    inFlight.current = true;
    setSaving(true);
    setFailed(false);
    try {
      const discarded = await props.onDiscardSaved();
      if (mounted.current) {
        if (discarded) latest.current.onLeave();
        else setFailed(true);
      }
    } catch {
      if (mounted.current) setFailed(true);
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
          <p role="status">{saving ? t('electricity.order.savingDraft', locale) : workingLabel}</p>
        )}
        {!saving && !working && (failed || errorMessage) && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage || t('electricity.order.draftSaveFailed', locale)}
          </p>
        )}
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            onClick={() => void saveAndLeave()}
            disabled={saving || working || saveDisabled}
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
          {props.onDiscardSaved && (
            <Button
              type="button"
              variant="destructive"
              disabled={saving || working}
              onClick={() => void discardSavedAndLeave()}
            >
              {t('electricity.order.unsaved.discardSaved', locale)}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
