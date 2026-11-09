import { readFile } from 'node:fs/promises';
import { ESLint } from 'eslint';

const routeSource = await readFile('apps/web/src/routeTree.gen.ts', 'utf8');
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

const parameter = '\u0000';
function destination(attribute) {
  const value = attribute.value;
  const expression = value?.type === 'JSXExpressionContainer' ? value.expression : value;
  if (expression?.type === 'Literal' && typeof expression.value === 'string') {
    return expression.value;
  }
  if (expression?.type === 'TemplateLiteral') {
    return expression.quasis.map((part) => part.value.cooked).join(parameter);
  }
}

let checked = 0;
const parserConfig = await new ESLint().calculateConfigForFile(
  'apps/web/src/components/AppShell.tsx'
);
const checker = new ESLint({
  allowInlineConfig: false,
  overrideConfigFile: true,
  overrideConfig: [
    { ignores: ['**/*.{test,spec}.{jsx,tsx}', '**/test/**'] },
    {
      files: ['**/*.{jsx,tsx}'],
      languageOptions: parserConfig.languageOptions,
      plugins: {
        navigation: {
          rules: {
            destination: {
              meta: {
                messages: { unknown: 'Navigation points to an unregistered route: {{path}}' },
              },
              create(context) {
                return {
                  JSXAttribute(node) {
                    if (!['href', 'to'].includes(node.name.name)) return;
                    const url = destination(node);
                    if (!url?.startsWith('/') || url.startsWith('//')) return;
                    const [path] = url.split(/[?#]/, 1);
                    // API downloads are endpoint URLs rather than client routes.
                    if (path.startsWith('/api/')) return;
                    checked++;
                    const parts = segments(path);
                    const matches = routes.some(
                      (route) =>
                        route.length === parts.length &&
                        route.every((part, index) => part.startsWith('$') || part === parts[index])
                    );
                    if (!matches) {
                      context.report({
                        node,
                        messageId: 'unknown',
                        data: { path: path.replaceAll(parameter, '${…}') },
                      });
                    }
                  },
                };
              },
            },
          },
        },
      },
      rules: { 'navigation/destination': 'error' },
    },
  ],
});
const results = await checker.lintFiles([
  'apps/web/src/**/*.{jsx,tsx}',
  'packages/ui/src/**/*.{jsx,tsx}',
]);
if (results.some((result) => result.errorCount)) {
  const formatter = await checker.loadFormatter('stylish');
  console.error(formatter.format(results));
  process.exitCode = 1;
} else if (checked === 0) {
  throw new Error('No web navigation destinations were checked');
} else {
  console.log(`Checked ${checked} literal and template web navigation destinations`);
}
