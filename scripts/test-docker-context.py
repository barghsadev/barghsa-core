#!/usr/bin/env python3
"""Check real Docker ignore semantics using synthetic files only."""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
excluded = [
    '.env', 'apps/api/.env.production', 'packages/db/node_modules/secret',
    'apps/api/dist/stale.js', 'apps/api/src/example.test.ts', 'apps/web/e2e/login.ts',
    '.vscode/settings.json', 'apps/web/vitest.config.ts', 'notes.md',
    'packages/db/drizzle/production/meta/0134_snapshot.json', 'output/private.txt',
]
required = [
    '.npmrc', 'pnpm-lock.yaml', 'patches/runtime.patch', 'apps/api/src/main.ts',
    'packages/db/drizzle/production/0134_system_product_identity.sql',
    'packages/db/drizzle/production/meta/_journal.json',
    'packages/shared/scripts/package-exports.check.mjs',
]
with tempfile.TemporaryDirectory(prefix='barghsa-context-') as temporary:
    context, exported = Path(temporary) / 'context', Path(temporary) / 'export'
    context.mkdir()
    (context / '.dockerignore').write_bytes((root / '.dockerignore').read_bytes())
    (context / 'Dockerfile').write_text('FROM scratch\nCOPY . /context\n')
    for name in excluded + required:
        path = context / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('synthetic fixture only')
    subprocess.run(['docker', 'build', '--progress=plain', '--output',
                    f'type=local,dest={exported}', str(context)], check=True,
                   stdout=subprocess.DEVNULL)
    leaked = [p for p in excluded if (exported / 'context' / p).exists()]
    missing = [p for p in required if not (exported / 'context' / p).exists()]
    assert not leaked, f'Excluded files reached Docker context: {leaked}'
    assert not missing, f'Build-essential files missing: {missing}'
    print(f'PASS {len(excluded)} excluded and {len(required)} required context paths')
