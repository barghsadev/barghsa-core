/** Optional product analytics use only fixed dimensions, never user input or identifiers. */
export type AnalyticsEvent =
  | { name: 'page_view'; area: 'customer' | 'admin' }
  | { name: 'catalogue_view'; service: 'electricity' | 'saving' | 'solar' }
  | { name: 'order_flow_start'; service: 'electricity' | 'saving' | 'solar' };

/** Project untrusted input onto the closed event contract. Extra keys and free text are discarded. */
export function redactAnalyticsEvent(value: unknown): AnalyticsEvent | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (data.name === 'page_view') {
    if (data.area !== 'customer' && data.area !== 'admin') return null;
    return { name: 'page_view', area: data.area };
  }
  if (data.name === 'catalogue_view' || data.name === 'order_flow_start') {
    if (data.service !== 'electricity' && data.service !== 'saving' && data.service !== 'solar')
      return null;
    return { name: data.name, service: data.service };
  }
  return null;
}

export interface AnalyticsAdapter {
  send(event: AnalyticsEvent): Promise<void> | void;
}

/** No optional analytics leave the client until the current account has opted in. */
export function createAnalytics(adapters: readonly AnalyticsAdapter[]) {
  let consent = false;
  return {
    setConsent(value: boolean) {
      consent = value;
    },
    async track(value: unknown): Promise<void> {
      if (!consent) return;
      const event = redactAnalyticsEvent(value);
      if (!event) return;
      await Promise.allSettled(
        adapters.map((adapter) => Promise.resolve().then(() => adapter.send(event)))
      );
    },
  };
}
