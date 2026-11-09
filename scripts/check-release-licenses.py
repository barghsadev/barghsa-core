#!/usr/bin/env python3
"""Check the license policy against the exact CI runtime images and browser output."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
from urllib.parse import quote


ALLOWED = frozenset({'MIT', 'Apache-2.0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause'})
IMAGE_SCOPES = ('app', 'web', 'clamav', 'postgres')
FIRST_PARTY = {
    'pkg:npm/%40barghsa/' + package + '@0.0.0'
    for package in ('api', 'db', 'i18n', 'shared', 'ui', 'web', 'worker')
}
FONT_FILES = {
    '84a382e46c30fb4f73d0e3800c16d0af15888e2731e57fa5f93e2c29a2c6a957': 'vazirmatn@5.3.0',
    'd29c041cd4294af893cf3c01dfab6d47202c667ab55d702f68782599918c651d': 'vazirmatn@5.3.0',
    '3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62': 'inter@5.3.0',
}
NOTICES = {
    'Vazirmatn-OFL.txt': 'e6f4ce7b6c830d5a25a4f8ac777c267cd7d3c180bc2a7150ca57cbb9b280c4b7',
    'Inter-OFL.txt': '3b0a5fca3d17942cde889069889dedbbbd075e9b599968c82a95f4d944e9b345',
    'DOMPurify-Apache-2.0.txt': 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
}
FONT_EXTENSIONS = {'.woff', '.woff2', '.ttf', '.otf', '.eot', '.ttc'}
APP_MIT_NOTICES = {
    'pkg:npm/busboy@1.6.0': 'd06b5d27bbbbe22c36b1fd88406b1208876e2d37d795f5b8eaed951a459a3111',
    'pkg:npm/png-js@2.0.0': 'bdb26a2ec815931ed6a38f3416362566204ee85ecdef96702b636402da4c75c3',
    'pkg:npm/streamsearch@1.1.0': '7c28463b739e2e73a49bf127d0bda427f8c55f0b37365a044c3c3f254716118b',
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def docker(*args):
    return subprocess.check_output(['docker', *args], timeout=60)


def read_sbom(directory, index, scope, commit):
    receipt = json.loads((directory / f'{index}-image.json').read_bytes())
    data = (directory / f'{index}-sbom.cdx.json').read_bytes()
    bom = json.loads(data)
    subject = bom['metadata']['component']
    image = f'barghsa-ci-{scope}:{commit}'
    image_id = receipt['image_id']
    ids = [p['value'] for p in subject['properties'] if p['name'] == 'aquasecurity:trivy:ImageID']
    require(
        receipt['image'] == subject['name'] == image
        and bom['bomFormat'] == 'CycloneDX'
        and receipt['blocked'] is False
        and digest(data) == receipt['sbom_sha256']
        and re.fullmatch(r'sha256:[0-9a-f]{64}', image_id)
        and ids == [image_id]
        and docker('image', 'inspect', '--format', '{{.Id}}', image).decode().strip() == image_id,
        f'Invalid SBOM receipt or changed image for {scope}',
    )
    require(isinstance(bom['components'], list) and bom['components'], f'Empty SBOM for {scope}')
    return image_id, bom


def image_components(bom, verified_mit=()):
    components = bom['components']
    package_refs = {entry['bom-ref'] for entry in components if entry.get('purl')}
    dependencies = {entry['ref']: entry['dependsOn'] for entry in bom['dependencies']}
    for entry in components:
        # This is the distribution label. Its installed packages have individual entries.
        if entry['type'] == 'operating-system' and entry.get('purl') is None:
            continue
        identity = entry.get('purl')
        if identity in FIRST_PARTY:
            continue
        if identity is None and entry['type'] == 'application' and not entry.get('licenses'):
            # Trivy emits a Go executable node above the package representing its main module.
            children = dependencies.get(entry['bom-ref'], [])
            if (children and set(children) <= package_refs
                    and {'name': 'aquasecurity:trivy:Type', 'value': 'gobinary'} in entry.get('properties', [])):
                continue
        require(isinstance(identity, str) and identity.startswith('pkg:'), 'Missing SBOM package URL')
        licenses = []
        for entry_license in entry.get('licenses', []):
            license_data = entry_license.get('license', {})
            value = entry_license.get('expression') or license_data.get('id') or license_data.get('name')
            require(isinstance(value, str) and bool(value.strip()), f'Invalid license entry for {identity}')
            licenses.append(value)
        yield identity, tuple(sorted(set(licenses))) or (('MIT',) if identity in verified_mit else ())


def archive_files(container, path):
    with tarfile.open(fileobj=io.BytesIO(docker('cp', f'{container}:{path}', '-'))) as archive:
        return {
            str(PurePosixPath(*PurePosixPath(member.name).parts[1:])): archive.extractfile(member).read()
            for member in archive.getmembers() if member.isfile()
        }


def verify_app_notices(image_id, components):
    container = docker('create', image_id).decode().strip()
    try:
        sharp_packages = [entry['purl'] for entry in components
                          if (entry.get('purl') or '').startswith('pkg:npm/%40img/sharp-libvips-')]
        if sharp_packages:
            require(all(purl.endswith('@1.3.4') for purl in sharp_packages), 'Unverified libvips notice version')
            sharp = archive_files(container, '/app/licenses/sharp-libvips/1.3.4')
            require(digest(sharp['LICENSE.txt']) == 'b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1'
                    and digest(sharp['THIRD-PARTY-NOTICES.txt']) == '6f0d5086e3bcbee12bcdacf5878b31d1104002aeecaeb241d3fff466108082fe',
                    'Incorrect libvips notices')
        verified = set()
        for entry in components:
            identity = entry.get('purl')
            if identity not in APP_MIT_NOTICES or entry.get('licenses'):
                continue
            paths = [p['value'] for p in entry['properties'] if p['name'] == 'aquasecurity:trivy:FilePath']
            require(len(paths) == 1 and paths[0].startswith('app/')
                    and PurePosixPath(paths[0]).name == 'package.json'
                    and '..' not in PurePosixPath(paths[0]).parts, f'Invalid package path for {identity}')
            notice = PurePosixPath('/', paths[0]).with_name('LICENSE')
            contents = list(archive_files(container, str(notice)).values())
            require(len(contents) == 1 and digest(contents[0]) == APP_MIT_NOTICES[identity],
                    f'Incorrect MIT notice for {identity}')
            verified.add(identity)
        return verified
    finally:
        docker('rm', '-v', container)


def browser_components(manifests, dist, commit):
    for shell, prefix in (('app', ''), ('auth', 'auth/')):
        require(json.loads(dist[prefix + 'release.json'])['commit'] == commit, f'Wrong {shell} build')
        for notice, expected in NOTICES.items():
            require(
                digest(dist[prefix + 'assets/licenses/' + notice]) == expected,
                f'Incorrect {notice} in {shell} shell',
            )
        fonts = [digest(data) for path, data in dist.items()
                 if path.startswith('auth/') == (shell == 'auth')
                 and PurePosixPath(path).suffix.lower() in FONT_EXTENSIONS]
        require(sorted(fonts) == sorted(FONT_FILES), f'Unknown or missing font files in {shell} shell')
        for font in set(FONT_FILES.values()):
            yield shell, f'pkg:npm/%40fontsource-variable/{font}', ('OFL-1.1',)

        inventory = json.loads(manifests[shell + '.json'])
        require(inventory['shell'] == shell and isinstance(inventory['packages'], list)
                and inventory['packages'], f'Empty or wrong package inventory for {shell}')
        for package in inventory['packages']:
            name, version, license_name = package['name'], package['version'], package['license']
            require(isinstance(name, str) and name and isinstance(version, str) and version
                    and (license_name is None or isinstance(license_name, str)), 'Invalid browser package metadata')
            identity = f'pkg:npm/{quote(name, safe="/")}@{quote(version, safe="")}'
            if identity in FIRST_PARTY:
                continue
            # Select the exact Apache option only after checking its bundled notice above.
            if identity == 'pkg:npm/dompurify@3.4.17' and license_name == '(MPL-2.0 OR Apache-2.0)':
                license_name = 'Apache-2.0'
            yield shell, identity, (license_name,) if license_name else ()


def read_approvals(path):
    approvals = {}
    entries = json.loads(path.read_bytes())
    require(isinstance(entries, list), 'Package approvals must be an array')
    for entry in entries:
        scope, identity, licenses = entry['scope'], entry['purl'], entry['licenses']
        require(scope in (*IMAGE_SCOPES, 'browser') and isinstance(identity, str)
                and re.fullmatch(r'pkg:[^\s*]+@[^\s*]+', identity)
                and isinstance(licenses, list) and all(isinstance(x, str) and x for x in licenses),
                'Approval must match an exact package, scope and observed license set')
        require(all(isinstance(entry[key], str) and entry[key].strip()
                    for key in ('approvedBy', 'reference', 'conditions')), 'Incomplete package approval')
        key = (scope, identity, tuple(sorted(set(licenses))))
        require(key not in approvals, 'Duplicate package approval')
        approvals[key] = entry
    return approvals


def disposition(scope, identity, licenses, approvals):
    if licenses and ALLOWED.issuperset(licenses):
        return 'allowed', None
    approval = approvals.get((scope, identity, licenses))
    if approval:
        return 'approved', approval['reference']
    return 'review-required', None


def audit(directory, commit, approvals):
    scopes = {}
    items = {}
    for index, scope in enumerate(IMAGE_SCOPES, 1):
        image_id, bom = read_sbom(directory, index, scope, commit)
        scopes[scope] = image_id
        verified_mit = verify_app_notices(image_id, bom['components']) if scope == 'app' else ()
        for identity, licenses in image_components(bom, verified_mit):
            items.setdefault((scope, identity, licenses), set()).add(scope)
    container = docker('create', scopes['web']).decode().strip()
    try:
        manifests = archive_files(container, '/app/browser-license-inventory')
        dist = archive_files(container, '/app/dist')
    finally:
        docker('rm', '-v', container)
    for shell, identity, licenses in browser_components(manifests, dist, commit):
        items.setdefault(('browser', identity, licenses), set()).add(shell)
    records = []
    for (scope, identity, licenses), locations in sorted(items.items()):
        status, reference = disposition(scope, identity, licenses, approvals)
        records.append({'scope': scope, 'purl': identity, 'licenses': licenses,
                        'locations': sorted(locations), 'status': status, 'approval': reference})
    return {'commit': commit, 'images': scopes, 'packages': records}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('scan_directory', type=Path)
    parser.add_argument('commit')
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--report-only', action='store_true', help='Report policy blockers during ordinary direct-main development')
    args = parser.parse_args()
    try:
        require(re.fullmatch(r'[0-9a-f]{40}', args.commit), 'Expected a full release commit SHA')
        policy = Path(__file__).resolve().parents[1] / 'deploy/licenses/release-approvals.json'
        result = audit(args.scan_directory, args.commit, read_approvals(policy))
        args.report.write_text(json.dumps(result, indent=2) + '\n')
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError, tarfile.TarError) as error:
        print(f'License inventory check failed: {error}', file=sys.stderr)
        return 2
    blockers = sum(entry['status'] == 'review-required' for entry in result['packages'])
    print(f'Licenses: {len(result["packages"])} exact package/scope entries, {blockers} require review')
    return 1 if blockers and not args.report_only else 0


if __name__ == '__main__':
    sys.exit(main())
