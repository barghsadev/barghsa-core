import { readFileSync } from 'node:fs';

const routeSource = readFileSync(
  new URL('../apps/web/src/routeTree.gen.ts', import.meta.url),
  'utf8'
);
const routeInterface = routeSource.match(/export interface FileRoutesByFullPath \{([^}]+)\}/);
const routes = [...(routeInterface?.[1].matchAll(/^ +'([^']+)':/gm) ?? [])].map((match) =>
  segments(match[1])
);
if (!routes.some((route) => route.length === 0)) {
  throw new Error('Could not read registered paths from the generated web router');
}

function segments(path) {
  return path === '/' ? [] : path.slice(1).replace(/\/$/, '').split('/');
}

export function isRegisteredWebPath(path) {
  const parts = segments(path);
  return routes.some(
    (route) =>
      route.length === parts.length &&
      route.every((part, index) => part === parts[index] || (part.startsWith('$') && parts[index]))
  );
}
