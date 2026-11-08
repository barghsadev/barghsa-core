import { useEffect, useLayoutEffect, useState } from 'react';
import { toast } from 'sonner';
import { Toaster } from '@barghsa/ui/sonner';
import { feedbackText } from '@barghsa/i18n/feedback';
import { useLocale } from '../hooks/useLocale.js';
import { useTheme } from '../hooks/useTheme.js';
import { connectToast } from '../lib/toast-api.js';

function toastAnchor() {
  return document.querySelector('[data-toast-anchor]') ?? document.querySelector('header');
}

function anchorOffset(anchor = toastAnchor()) {
  return Math.max(16, (anchor?.getBoundingClientRect().bottom ?? 0) + 16);
}

function useToastTop() {
  const [top, setTop] = useState(() => anchorOffset());
  useLayoutEffect(() => {
    let frame = 0;
    let anchor: Element | null = null;
    const update = () => {
      frame = 0;
      const next = toastAnchor();
      if (next !== anchor) {
        if (anchor) resize?.unobserve(anchor);
        anchor = next;
        if (anchor) resize?.observe(anchor);
      }
      setTop(anchorOffset(anchor));
    };
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(queue) : null;
    resize?.observe(document.body);
    const changes = new MutationObserver(queue);
    changes.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', queue);
    window.addEventListener('scroll', queue, true);
    update();
    return () => {
      changes.disconnect();
      resize?.disconnect();
      window.removeEventListener('resize', queue);
      window.removeEventListener('scroll', queue, true);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return top;
}

export default function SonnerToaster() {
  const locale = useLocale();
  const top = useToastTop();
  const { resolvedTheme } = useTheme();
  useEffect(() => connectToast(toast), []);
  return (
    <Toaster
      theme={resolvedTheme}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      position={locale === 'fa' ? 'top-left' : 'top-right'}
      richColors
      visibleToasts={3}
      offset={{ top }}
      mobileOffset={{ top: `calc(${top}px + env(safe-area-inset-top))` }}
      swipeDirections={locale === 'fa' ? ['left', 'top'] : ['right', 'top']}
      customAriaLabel={feedbackText('region', locale)}
      closeButton
      duration={6000}
      toastOptions={{ closeButtonAriaLabel: feedbackText('close', locale) }}
    />
  );
}
