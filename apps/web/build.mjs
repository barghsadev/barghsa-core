import { build } from 'vite';

// Build the application first: its clean output directory contains the auth build.
await build({ mode: 'production' });
await build({ mode: 'auth' });
