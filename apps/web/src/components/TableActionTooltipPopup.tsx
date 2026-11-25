import { Tooltip, TooltipContent } from '@barghsa/ui';
import { useLayoutEffect } from 'react';

export default function TableActionTooltipPopup({
  anchor,
  label,
  onDismiss,
}: {
  anchor: HTMLElement;
  label: string;
  onDismiss: () => void;
}) {
  useLayoutEffect(() => {
    function checkAnchor() {
      if (!anchor.isConnected || !anchor.getClientRects().length) onDismiss();
    }
    checkAnchor();
    const observer = new MutationObserver(checkAnchor);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [anchor, onDismiss]);

  if (!anchor.isConnected) return null;
  return (
    <Tooltip open>
      <TooltipContent
        anchor={anchor}
        data-table-action-tooltip-popup=""
        dir={anchor.closest('[dir]')?.getAttribute('dir') ?? 'auto'}
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
