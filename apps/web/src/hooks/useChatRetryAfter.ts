import { useEffect, useRef, useState } from 'react';
import { retryAfterSeconds } from '../lib/auth-errors.js';

/** A displayed server cooldown also blocks new submits and captured retries. */
export function useChatRetryAfter() {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(Date.now);
  const deadline = useRef(0);
  useEffect(() => {
    if (!until) return;
    const interval = setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= until) setUntil(0);
    }, 1000);
    return () => clearInterval(interval);
  }, [until]);
  return {
    seconds: Math.max(0, Math.ceil((until - now) / 1000)),
    blocked: () => deadline.current > Date.now(),
    read: (response: Response) => {
      const seconds = retryAfterSeconds(response);
      const time = Date.now();
      deadline.current = seconds === null ? 0 : time + seconds * 1000;
      setNow(time);
      setUntil(deadline.current);
    },
  };
}
