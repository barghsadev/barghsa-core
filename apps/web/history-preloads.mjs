import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const histories = [
  ['/electricity/orders', 'electricity/orders', 'ElectricityOrdersPage'],
  ['/savings/orders', 'savings.orders', 'SavingOrdersPage'],
  ['/solar/requests', 'solar.requests', 'SolarRequestsPage'],
  ['/consultations', 'consultations', 'ConsultationsPage'],
];

export async function writeHistoryPreloads(distDir) {
  const manifest = JSON.parse(await readFile(join(distDir, '.vite', 'manifest.json'), 'utf8'));
  const collect = (roots) => {
    const files = new Set();
    const visit = (key) => {
      const entry = manifest[key];
      if (!entry || !/^assets\/[a-zA-Z0-9_-]+\.js$/.test(entry.file)) {
        throw new Error(`Missing history preload entry: ${key}`);
      }
      if (files.has(entry.file)) return;
      files.add(entry.file);
      for (const dependency of entry.imports ?? []) visit(dependency);
    };
    for (const root of roots) visit(root);
    return files;
  };
  const bootstrap = collect(['index.html']);
  const preloads = Object.fromEntries(
    histories.map(([path, route, page]) => {
      const entries = collect([
        'src/lib/route-bootstrap-read.ts',
        'src/components/CustomerProfileWorkspace.tsx',
        `src/routes/_app/${route}.tsx?tsr-split=component`,
        `src/routes/_app/${route}.index.tsx?tsr-split=component`,
        `src/pages/${page}.tsx`,
      ]);
      return [path, [...entries].filter((file) => !bootstrap.has(file))];
    })
  );
  await writeFile(join(distDir, '.vite', 'history-preloads.json'), JSON.stringify(preloads));
}
