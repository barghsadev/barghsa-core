import { useEffect, useLayoutEffect, useState } from 'react';
import { toast } from 'sonner';
import { Toaster } from '@barghsa/ui/sonner';
import { feedbackText } from '@barghsa/i18n/feedback';
import { useLocale } from '../hooks/useLocale.js';
import { useTheme } from '../hooks/useTheme.js';
import { connectToast } from '../lib/toast-api.js';

/** Account banners can move the topbar; reserve its actual viewport bounds. */
function headerOffset() {
  return Math.max(16, (document.querySelector('header')?.getBoundingClientRect().bottom ?? 0) + 16);
}

function useToastTop() {
  const [top, setTop] = useState(headerOffset);
  useLayoutEffect(() => {
    let frame = 0;
    let header: Element | null = null;
    const update = () => {
      frame = 0;
      const next = document.querySelector('header');
      if (next !== header) {
        if (header) resize?.unobserve(header);
        header = next;
        if (header) resize?.observe(header);
      }
      setTop(headerOffset());
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
