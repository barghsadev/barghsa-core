import { fileURLToPath } from 'node:url';
export default {
  resolve: {
    alias: {
      './vazirmatn-arabic.woff2': fileURLToPath(
        new URL('../src/fonts/vazirmatn-arabic.woff2', import.meta.url)
      ),
      './vazirmatn-latin.woff2': fileURLToPath(
        new URL('../src/fonts/vazirmatn-latin.woff2', import.meta.url)
      ),
    },
  },
};
