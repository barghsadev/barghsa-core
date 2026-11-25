import { useEffect, useRef } from 'react';
import { withCsrf } from '../lib/csrf.js';
import { ticketRepliesSeen } from '../lib/notifications.js';
import type { TicketComment } from './TicketCommentThread.js';

export function TicketRepliesSeen({
  ticketId,
  comments,
}: {
  ticketId: string;
  comments: readonly TicketComment[];
}) {
  const requested = useRef(new Set<string>());
  useEffect(() => {
    let active = true;
    const mark = async () => {
      if (document.visibilityState !== 'visible') return;
      const pending = comments.filter(
        (comment) =>
          comment.visibility === 'public' &&
          comment.unreadReply === true &&
          !requested.current.has(comment.id)
      );
      for (let start = 0; active && start < pending.length; start += 100) {
        const ids = pending
          .slice(start, start + 100)
          .map((comment) => comment.id)
          .filter((id) => !requested.current.has(id));
        if (!ids.length) continue;
        for (const id of ids) requested.current.add(id);
        try {
          const response = await fetch(
            `/api/tickets/${encodeURIComponent(ticketId)}/replies/seen`,
            {
              method: 'PATCH',
              credentials: 'include',
              headers: withCsrf({ 'Content-Type': 'application/json' }),
              body: JSON.stringify({ replyIds: ids }),
              keepalive: true,
            }
          );
          if (response.status !== 204) throw new Error('Reply read state was not confirmed');
          window.dispatchEvent(new Event(ticketRepliesSeen));
        } catch {
          // A failed acknowledgment leaves the server state intact and can be retried.
          for (const id of ids) requested.current.delete(id);
          return;
        }
      }
    };
    const onVisible = () => void mark();
    onVisible();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ticketId, comments]);
  return null;
}
