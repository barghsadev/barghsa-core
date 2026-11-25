import { lazy, Suspense, useEffect, useRef, useState, type ComponentProps } from 'react';
import { Button, LoadingStatus } from '@barghsa/ui';
import { tOrderComments } from '@barghsa/i18n/order-comments';
import { useLocale } from '../hooks/useLocale.js';
import type { SavingOrderComments } from './SavingOrderComments.js';

type DiscussionProps = ComponentProps<typeof SavingOrderComments> & {
  kind: 'electricity' | 'saving';
};

const ElectricityDiscussion = lazy(() =>
  import('./SavingOrderComments.js').then((module) => ({
    default: module.ElectricityOrderComments,
  }))
);
const SavingDiscussion = lazy(() =>
  import('./SavingOrderComments.js').then((module) => ({ default: module.SavingOrderComments }))
);

export function OrderDiscussionSection({ kind, ...props }: DiscussionProps) {
  const Discussion = kind === 'electricity' ? ElectricityDiscussion : SavingDiscussion;
  const locale = useLocale();
  const section = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = section.current;
    if (visible || !node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          observer.disconnect();
          if (node.contains(document.activeElement)) node.focus({ preventScroll: true });
          setVisible(true);
        }
      },
      { rootMargin: '320px 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);
  return (
    <div ref={section} data-testid="order-discussion" tabIndex={-1}>
      {visible ? (
        <Suspense fallback={<LoadingStatus>{tOrderComments('loading', locale)}</LoadingStatus>}>
          <Discussion {...props} />
        </Suspense>
      ) : (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            section.current?.focus({ preventScroll: true });
            setVisible(true);
          }}
        >
          {tOrderComments('open', locale)}
        </Button>
      )}
    </div>
  );
}
