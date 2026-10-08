import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { TabsList } from './tabs';
import { Button } from './button';
import { cn } from '../../lib/utils';

/** Horizontal tabs with physical overflow measurement and logical RTL scroll controls. */
export function ScrollableTabsList({
  previousLabel,
  nextLabel,
  className,
  ...props
}: Omit<ComponentProps<typeof TabsList>, 'ref'> & {
  previousLabel: string;
  nextLabel: string;
}) {
  const viewport = useRef<HTMLDivElement>(null),
    list = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ previous: false, next: false });
  function measure() {
    if (!viewport.current || !list.current) return;
    const clip = viewport.current.getBoundingClientRect();
    const tabs = list.current.querySelectorAll('[role="tab"]');
    const first = tabs[0]?.getBoundingClientRect() ?? list.current.getBoundingClientRect();
    const last = tabs[tabs.length - 1]?.getBoundingClientRect() ?? first;
    const rtl = getComputedStyle(viewport.current).direction === 'rtl';
    const previous = rtl ? first.right > clip.right + 1 : first.left < clip.left - 1;
    const next = rtl ? last.left < clip.left - 1 : last.right > clip.right + 1;
    setEdges((old) => (old.previous === previous && old.next === next ? old : { previous, next }));
  }
  useEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (viewport.current) observer.observe(viewport.current);
    if (list.current) observer.observe(list.current);
    const direction = new MutationObserver(measure);
    direction.observe(document.documentElement, { attributes: true, attributeFilter: ['dir'] });
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      direction.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  function move(forward: boolean) {
    const node = viewport.current;
    if (!node) return;
    const rtl = getComputedStyle(node).direction === 'rtl';
    node.scrollBy({
      left: (forward !== rtl ? 1 : -1) * Math.max(node.clientWidth * 0.8, 1),
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }
  const overflowing = edges.previous || edges.next;
  return (
    <div data-slot="scrollable-tabs" className="flex min-w-0 max-w-full items-center gap-1">
      {overflowing && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={previousLabel}
          disabled={!edges.previous}
          onClick={() => move(false)}
        >
          <ChevronLeftIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
        </Button>
      )}
      <div
        ref={viewport}
        data-slot="tabs-viewport"
        className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain p-1 scroll-px-1"
        onScroll={measure}
        onFocusCapture={(event) => {
          if (event.target instanceof HTMLElement && event.target.getAttribute('role') === 'tab')
            event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }}
      >
        <TabsList {...props} ref={list} className={cn('min-w-max', className)} />
      </div>
      {overflowing && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={nextLabel}
          disabled={!edges.next}
          onClick={() => move(true)}
        >
          <ChevronRightIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
        </Button>
      )}
    </div>
  );
}
