import type { FocusEvent, ReactNode } from 'react';
import { RecordEditorActions } from './RecordEditorLayout.js';

export const recordEditorFormSurface = 'min-w-0 rounded-xl border bg-card';

export function keepRecordFieldVisible({ currentTarget, target }: FocusEvent<HTMLFormElement>) {
  const actions = currentTarget.querySelector('.record-editor-sticky-actions');
  if (actions && !actions.contains(target)) {
    requestAnimationFrame(() => {
      if (
        document.activeElement === target &&
        target.getBoundingClientRect().bottom > actions.getBoundingClientRect().top
      ) {
        target.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
    });
  }
}

export function StickyRecordEditorActions({
  children,
  secondary,
}: {
  children: ReactNode;
  secondary?: ReactNode;
}) {
  return (
    <RecordEditorActions
      className="record-editor-sticky-actions sticky bottom-0 z-10 rounded-b-xl bg-card py-2"
      secondary={secondary}
    >
      {children}
    </RecordEditorActions>
  );
}
