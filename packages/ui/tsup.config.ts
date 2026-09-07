export default {
  entry: { index: 'src/index.ts', 'direction-provider': 'src/direction-provider.ts' },
  format: ['esm', 'cjs'],
  target: 'es2022',
  platform: 'neutral',
  splitting: false,
  sourcemap: true,
  clean: true,
  // The development wildcard alias would capture external React type imports.
  dts: { compilerOptions: { composite: false, paths: {} } },
};
