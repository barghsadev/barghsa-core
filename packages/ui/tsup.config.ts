export default {
  // Keep component module boundaries so consumers can drop unused primitives.
  entry: ['src/index.ts', 'src/direction-provider.ts', 'src/components/**/*.tsx', '!src/**/*.test.tsx'],
  format: ['esm', 'cjs'],
  target: 'es2022',
  platform: 'neutral',
  splitting: true,
  sourcemap: true,
  clean: true,
  // The development wildcard alias would capture external React type imports.
  dts: { compilerOptions: { composite: false, paths: {} } },
};
