import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('release_licenses', Path(__file__).with_name('check-release-licenses.py'))
licenses = importlib.util.module_from_spec(spec)
spec.loader.exec_module(licenses)


class LicenseCheckTests(unittest.TestCase):
    def test_approval_cannot_cover_a_different_version_scope_or_license(self):
        identity = 'pkg:npm/example@1.2.3'
        observed = ('LGPL-3.0-or-later',)
        approvals = {('app', identity, observed): {'reference': 'legal-review-1'}}
        self.assertEqual(licenses.disposition('app', identity, observed, approvals), ('approved', 'legal-review-1'))
        for scope, purl, license_set in (
            ('web', identity, observed),
            ('app', 'pkg:npm/example@1.2.4', observed),
            ('app', identity, ('LGPL-2.1-or-later',)),
            ('app', identity, ()),
        ):
            self.assertEqual(licenses.disposition(scope, purl, license_set, approvals), ('review-required', None))
        self.assertEqual(licenses.disposition('app', identity, ('MIT', 'ISC'), approvals), ('allowed', None))

    def test_blank_or_wildcard_approval_is_invalid(self):
        with tempfile.TemporaryDirectory() as directory:
            policy = Path(directory) / 'approvals.json'
            entry = {'scope': 'app', 'purl': 'pkg:npm/example@1.2.3', 'licenses': ['OFL-1.1'],
                     'approvedBy': 'reviewer', 'reference': 'review-1', 'conditions': 'notice included'}
            policy.write_text(json.dumps([entry]))
            self.assertEqual(len(licenses.read_approvals(policy)), 1)
            for changed in ({'purl': 'pkg:npm/example@*'}, {'approvedBy': ''}):
                policy.write_text(json.dumps([entry | changed]))
                with self.assertRaises(ValueError):
                    licenses.read_approvals(policy)

    def test_sbom_cannot_be_reused_for_a_changed_image_or_changed_contents(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            commit = '1' * 40
            image = f'barghsa-ci-app:{commit}'
            image_id = 'sha256:' + '2' * 64
            bom = {'bomFormat': 'CycloneDX', 'metadata': {'component': {'name': image, 'properties': [
                {'name': 'aquasecurity:trivy:ImageID', 'value': image_id}
            ]}}, 'components': [{'purl': 'pkg:npm/example@1.2.3'}]}
            raw = json.dumps(bom).encode()
            (root / '1-sbom.cdx.json').write_bytes(raw)
            (root / '1-image.json').write_text(json.dumps({'image': image, 'image_id': image_id,
                                                         'blocked': False, 'sbom_sha256': licenses.digest(raw)}))
            with patch.object(licenses, 'docker', return_value=image_id.encode()):
                self.assertEqual(licenses.read_sbom(root, 1, 'app', commit)[0], image_id)
            with patch.object(licenses, 'docker', return_value=b'other-image'):
                with self.assertRaisesRegex(ValueError, 'changed image'):
                    licenses.read_sbom(root, 1, 'app', commit)
            (root / '1-sbom.cdx.json').write_bytes(raw + b' ')
            with self.assertRaisesRegex(ValueError, 'Invalid SBOM receipt'):
                licenses.read_sbom(root, 1, 'app', commit)

    def test_browser_checks_notice_and_all_font_bytes_in_each_shell(self):
        commit = '1' * 40
        packages = [{'name': 'dompurify', 'version': '3.4.17', 'license': '(MPL-2.0 OR Apache-2.0)'},
                    {'name': 'unidentified', 'version': '1.2.3', 'license': None}]
        manifests = {f'{shell}.json': json.dumps({'shell': shell, 'packages': packages}) for shell in ('app', 'auth')}
        dist = {}
        for prefix in ('', 'auth/'):
            dist[prefix + 'release.json'] = json.dumps({'commit': commit}).encode()
            dist[prefix + 'assets/licenses/DOMPurify-Apache-2.0.txt'] = b'notice'
            dist[prefix + 'assets/font.woff2'] = b'font'
        with patch.object(licenses, 'NOTICES', {'DOMPurify-Apache-2.0.txt': licenses.digest(b'notice')}), \
             patch.object(licenses, 'FONT_FILES', {licenses.digest(b'font'): 'example@1.2.3'}):
            entries = list(licenses.browser_components(manifests, dist, commit))
            self.assertIn(('app', 'pkg:npm/dompurify@3.4.17', ('Apache-2.0',)), entries)
            self.assertIn(('auth', 'pkg:npm/unidentified@1.2.3', ()), entries)
            with self.assertRaisesRegex(ValueError, 'Unknown or missing font'):
                list(licenses.browser_components(manifests, dist | {'auth/untracked.ttf': b'font'}, commit))
            with self.assertRaisesRegex(ValueError, 'Incorrect DOMPurify'):
                list(licenses.browser_components(manifests, dist | {
                    'auth/assets/licenses/DOMPurify-Apache-2.0.txt': b'wrong notice'
                }, commit))

    def test_go_executable_group_requires_the_scanned_main_module(self):
        group = {'bom-ref': 'binary', 'type': 'application', 'properties': [
            {'name': 'aquasecurity:trivy:Type', 'value': 'gobinary'}
        ]}
        root = {'bom-ref': 'module', 'type': 'library', 'purl': 'pkg:golang/example@1.2.3'}
        bom = {'components': [group, root], 'dependencies': [{'ref': 'binary', 'dependsOn': ['module']}]}
        self.assertEqual(list(licenses.image_components(bom)), [('pkg:golang/example@1.2.3', ())])
        with self.assertRaisesRegex(ValueError, 'Missing SBOM package URL'):
            list(licenses.image_components(bom | {'dependencies': []}))

    def test_postgres_go_license_fallback_requires_exact_notices_and_versions(self):
        files = {'gosu.LICENSE': b'license', 'go-stdlib.PATENTS': b'patents'}
        expected = {name: licenses.digest(data) for name, data in files.items()}
        gosu = 'pkg:golang/github.com/tianon/gosu@v0.0.0-20261025094355-29b939aa5bd4'
        unknown = 'pkg:golang/github.com/tianon/gosu@1.99.0'
        bom = {'components': [
            {'bom-ref': 'gosu', 'type': 'library', 'purl': gosu},
            {'bom-ref': 'unknown', 'type': 'library', 'purl': unknown},
        ], 'dependencies': []}
        with patch.object(licenses, 'POSTGRES_GO_NOTICES', expected), \
             patch.object(licenses, 'docker', return_value=b'container') as docker, \
             patch.object(licenses, 'archive_files', return_value=files) as archive:
            verified = licenses.verify_postgres_notices('image')
            self.assertEqual(list(licenses.image_components(bom, verified)), [
                (gosu, ('Apache-2.0',)), (unknown, ())
            ])
            archive.assert_called_once_with('container', '/usr/local/share/licenses/gosu')
            for invalid in ({'gosu.LICENSE': files['gosu.LICENSE']}, files | {'gosu.LICENSE': b'other'}):
                archive.return_value = invalid
                with self.assertRaisesRegex(ValueError, 'Missing or incorrect PostgreSQL Go notices'):
                    licenses.verify_postgres_notices('image')
                docker.assert_called_with('rm', '-v', 'container')

    def test_strict_run_rejects_pending_licenses_and_preserves_the_report(self):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / 'result.json'
            result = {'packages': [{'status': 'review-required'}]}
            args = ['check-release-licenses.py', directory, '1' * 40, '--report', str(report)]
            with patch.object(licenses, 'audit', return_value=result), patch.object(licenses.sys, 'argv', args):
                self.assertEqual(licenses.main(), 1)
                self.assertEqual(json.loads(report.read_text()), result)
            with patch.object(licenses, 'audit', return_value=result), \
                 patch.object(licenses.sys, 'argv', args + ['--report-only']):
                self.assertEqual(licenses.main(), 0)
                self.assertEqual(json.loads(report.read_text()), result)


if __name__ == '__main__':
    unittest.main()
