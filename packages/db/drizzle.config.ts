import { defineConfig } from 'drizzle-kit'

/**
 * Drizzle Kit configuration for the @barghsa/db package.
 *
 * - Schema source: `src/schema/** /*.ts`
 * - Output directory: `./drizzle`
 * - PostgreSQL dialect with camelCase introspection
 * - Connection string from `DATABASE_URL` environment variable
 */
export default defineConfig({
  schema: './src/schema/**/*.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/barghsa',
  },
  introspect: {
    casing: 'camel',
  },
  // extensions: { extensions: ['plv8'] }, // Uncomment if plv8 extension is used in the target database
})
