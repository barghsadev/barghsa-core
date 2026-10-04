import type { KeyboardEvent } from 'react';

/** Safari does not consistently scroll focused viewports with horizontal arrows. */
export function scrollHorizontalViewport(event: KeyboardEvent<HTMLElement>) {
  // Preserve nested controls, modified shortcuts and native vertical scrolling.
  if (
    event.target !== event.currentTarget ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
  )
    return;
  event.preventDefault();
  event.currentTarget.scrollBy({ left: event.key === 'ArrowRight' ? 80 : -80 });
}
