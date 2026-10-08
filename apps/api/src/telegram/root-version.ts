import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** The runtime API package is 0.0.0; use the immutable workspace manifest instead. */
export function rootReleaseVersion(): string | null {
  const paths = [resolve(process.cwd(), 'root-package.json')];
  let folder = __dirname;
  for (let i = 0; i < 8; i++) {
    paths.push(resolve(folder, 'package.json'));
    folder = dirname(folder);
  }
  for (const path of paths) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf8'));
      if (
        data.name === 'barghsa-core' &&
        typeof data.version === 'string' &&
        /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(data.version)
      )
        return data.version;
    } catch {
      /* Missing manifests are expected while walking the local workspace. */
    }
  }
  return null;
}
