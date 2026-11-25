import { lazy, Suspense, useEffect, useState } from 'react';

const TableActionTooltipPopup = lazy(() => import('./TableActionTooltipPopup.js'));

const actionSelector = 'table [data-table-action-tooltip]';
const popupSelector = '[data-table-action-tooltip-popup]';

function actionFrom(target: EventTarget | null) {
  return target instanceof Element ? target.closest<HTMLElement>(actionSelector) : null;
}

/** A single portal keeps tooltips above sticky cells and outside table overflow. */
export function TableActionTooltips() {
  const [tooltip, setTooltip] = useState<{
    anchor: HTMLElement;
    label: string;
    onDismiss: () => void;
  } | null>(null);

  useEffect(() => {
    let anchor: HTMLElement | null = null;
    let timer: number | undefined;
    const dismiss = () => {
      if (!anchor) return;
      window.clearTimeout(timer);
      anchor = null;
      setTooltip(null);
    };
    const show = (control: HTMLElement, delay: number) => {
      dismiss();
      const label = control.dataset.tableActionTooltip?.trim();
      if (!label) return;
      anchor = control;
      const open = () => {
        if (control.isConnected)
          setTooltip({
            anchor: control,
            label,
            onDismiss: () => {
              if (anchor === control) dismiss();
            },
          });
      };
      if (delay) timer = window.setTimeout(open, delay);
      else open();
    };
    const isPopup = (target: EventTarget | null) =>
      target instanceof Element && !!target.closest(popupSelector);
    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      if (isPopup(event.target)) {
        window.clearTimeout(timer);
        return;
      }
      const control = actionFrom(event.target);
      if (control && control !== actionFrom(event.relatedTarget)) show(control, 350);
    };
    const onPointerOut = (event: PointerEvent) => {
      if (!anchor || (actionFrom(event.target) !== anchor && !isPopup(event.target))) return;
      if (actionFrom(event.relatedTarget) === anchor || isPopup(event.relatedTarget)) return;
      if (anchor.matches(':focus-visible')) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(dismiss, 120);
    };
    const onFocusIn = (event: FocusEvent) => {
      const control = actionFrom(event.target);
      if (control?.matches(':focus-visible')) show(control, 0);
    };
    const onFocusOut = (event: FocusEvent) => {
      if (actionFrom(event.target) === anchor) dismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    const events = new AbortController();
    const options = { signal: events.signal, capture: true };
    document.addEventListener('pointerover', onPointerOver, options);
    document.addEventListener('pointerout', onPointerOut, options);
    document.addEventListener('pointerdown', dismiss, options);
    document.addEventListener('focusin', onFocusIn, options);
    document.addEventListener('focusout', onFocusOut, options);
    document.addEventListener('keydown', onKeyDown, options);
    return () => {
      events.abort();
      window.clearTimeout(timer);
    };
  }, []);

  if (!tooltip) return null;
  return (
    <Suspense fallback={null}>
      <TableActionTooltipPopup {...tooltip} />
    </Suspense>
  );
}
