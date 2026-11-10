import { expect, type Page, type TestInfo } from './coverage-fixture';

type Sample = { lcp: number | null; cls: number; blocking: number; populated: number };
type LayoutShift = PerformanceEntry & { value: number; hadRecentInput: boolean };

declare global {
  interface Window {
    barghsaMobileSample?: () => Sample;
  }
}

/** Run only in the isolated mobile lab. Existing journey assertions still run. */
export async function startPrimaryMobilePerformance(page: Page, info: TestInfo) {
  if (process.env['BARGHSA_PRIMARY_MOBILE_PERF'] !== '1') return async () => {};
  expect(info.project.name).toBe('mobile-chrome');
  const session = await page.context().newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.setCacheDisabled', { cacheDisabled: true });
  await session.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 100,
    downloadThroughput: 4_000_000 / 8,
    uploadThroughput: 1_000_000 / 8,
  });
  await session.send('Emulation.setCPUThrottlingRate', { rate: 2 });

  await page.addInitScript(() => {
    const track = (type: string) => {
      if (!PerformanceObserver.supportedEntryTypes.includes(type)) {
        throw new Error(`Missing lab performance entry: ${type}`);
      }
      const seen: PerformanceEntry[] = [];
      const observer = new PerformanceObserver((list) => seen.push(...list.getEntries()));
      observer.observe({ type, buffered: true });
      return () => {
        const entries = [...seen, ...observer.takeRecords()];
        observer.disconnect();
        return entries;
      };
    };
    const lcp = track('largest-contentful-paint');
    const shifts = track('layout-shift');
    const tasks = track('longtask');

    window.barghsaMobileSample = () => {
      const populated = performance.now();
      const firstPaint = performance.getEntriesByName('first-contentful-paint')[0]?.startTime;
      if (firstPaint === undefined) throw new Error('Missing first contentful paint');

      let cls = 0;
      let windowValue = 0;
      let windowStart = Number.NEGATIVE_INFINITY;
      let last = Number.NEGATIVE_INFINITY;
      for (const shift of shifts() as LayoutShift[]) {
        if (shift.hadRecentInput) continue;
        if (shift.startTime - last >= 1_000 || shift.startTime - windowStart >= 5_000) {
          windowStart = shift.startTime;
          windowValue = 0;
        }
        last = shift.startTime;
        windowValue += shift.value;
        cls = Math.max(cls, windowValue);
      }

      let blocking = 0;
      for (const task of tasks()) {
        const start = Math.max(firstPaint, task.startTime);
        const end = Math.min(populated, task.startTime + task.duration);
        blocking += Math.max(0, end - start - 50);
      }
      return { lcp: lcp().at(-1)?.startTime ?? null, cls, blocking, populated };
    };
  });

  return async () => {
    const sample = await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
      if (!window.barghsaMobileSample) throw new Error('Mobile lab collection did not start');
      return window.barghsaMobileSample();
    });
    await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await session.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await session.send('Network.setCacheDisabled', { cacheDisabled: false });
    await session.detach();
    const route = new URL(page.url()).pathname;
    await info.attach('primary-mobile-performance', {
      body: JSON.stringify({ route, ...sample }),
      contentType: 'application/json',
    });
    expect(sample.lcp, `${route} LCP`).not.toBeNull();
    expect(sample.lcp!, `${route} LCP`).toBeLessThan(2_500);
    expect(sample.populated, `${route} populated render`).toBeLessThan(2_500);
    expect(sample.cls, `${route} CLS`).toBeLessThanOrEqual(0.1);
    expect(sample.blocking, `${route} blocking time`).toBeLessThanOrEqual(200);
  };
}
