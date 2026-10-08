/** @type {import('@ladle/react').UserConfig} */
export default {
  viteConfig: new URL('./vite.config.mjs', import.meta.url).pathname,
  stories: 'stories/**/*.stories.tsx',
  host: '127.0.0.1',
  previewHost: '127.0.0.1',
  port: 61000,
  previewPort: 61000,
  outDir: 'story-build',
  addons: {
    rtl: { enabled: true, defaultState: true },
    theme: { enabled: true, defaultState: 'light' },
    msw: { enabled: false },
  },
};
