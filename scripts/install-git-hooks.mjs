import { existsSync } from 'node:fs';

if (
  process.env.CI === 'true' ||
  process.env.NODE_ENV === 'production' ||
  process.env.HUSKY === '0' ||
  !existsSync('.git')
) {
  process.exit(0);
}

const { default: husky } = await import('husky');
const error = husky();
if (error) throw new Error(error);
