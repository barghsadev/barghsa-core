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
                with self.assertRaisesRegex(ValueError, 'Invalid SBOM receipt'):
                    licenses.read_sbom(root, 1, 'app', commit, staging=True)
            with patch.object(licenses, 'docker', return_value=b'other-image'):
                with self.assertRaisesRegex(ValueError, 'changed image'):
                    licenses.read_sbom(root, 1, 'app', commit)
            (root / '1-sbom.cdx.json').write_bytes(raw + b' ')
            with self.assertRaisesRegex(ValueError, 'Invalid SBOM receipt'):
                licenses.read_sbom(root, 1, 'app', commit)

    def test_local_staging_receipts_use_exact_tags_and_staging_postgres_scope(self):
        commit = 'a' * 40
        image_id = 'sha256:' + 'b' * 64
        with tempfile.TemporaryDirectory() as directory, patch.object(
            licenses, 'docker', return_value=image_id.encode()
        ) as docker:
            root = Path(directory)
            for index, (scope, image) in enumerate((
                ('postgres-staging', f'barghsa-postgres:vps-{commit}'),
                ('clamav', f'barghsa-clamav:vps-{commit}'),
                ('app', f'barghsa-app:vps-{commit}-' + 'b' * 64),
                ('web', f'barghsa-web:vps-{commit}-' + 'b' * 64),
            ), 1):
                bom = {'bomFormat': 'CycloneDX', 'metadata': {'component': {'name': image, 'properties': [
                    {'name': 'aquasecurity:trivy:ImageID', 'value': image_id}
                ]}}, 'components': [{'purl': 'pkg:npm/example@1.2.3'}]}
                raw = json.dumps(bom).encode()
                (root / f'{index}-sbom.cdx.json').write_bytes(raw)
                (root / f'{index}-image.json').write_text(json.dumps({
                    'image': image, 'image_id': image_id, 'blocked': False, 'sbom_sha256': licenses.digest(raw),
                }))
                self.assertEqual(licenses.read_sbom(root, index, scope, commit, staging=True)[0], image_id)
                docker.assert_called_with('image', 'inspect', '--format', '{{.Id}}', image)

    def test_retained_audit_binds_scan_scope_and_installed_notice_to_exact_ids(self):
        ids = {scope: 'sha256:' + digit * 64 for scope, digit in zip(licenses.RETAINED_SCOPES, '12')}
        identity = 'pkg:golang/example@1.2.3'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for index, (scope, image_id) in enumerate(ids.items(), 1):
                name = 'postgres' if scope == 'postgres-staging' else scope
                image = f'barghsa-{name}:vps-previous'
                bom = {'bomFormat': 'CycloneDX', 'metadata': {'component': {'name': image, 'properties': [
                    {'name': 'aquasecurity:trivy:ImageID', 'value': image_id}
                ]}}, 'components': [{'type': 'library', 'bom-ref': identity, 'purl': identity,
                                     'licenses': [{'license': {'id': 'LGPL-3.0-or-later'}}]}],
                       'dependencies': []}
                raw = json.dumps(bom).encode()
                (root / f'{index}-sbom.cdx.json').write_bytes(raw)
                (root / f'{index}-image.json').write_text(json.dumps({
                    'image': image, 'image_id': image_id, 'blocked': False, 'sbom_sha256': licenses.digest(raw),
                }))
            commit = 'a' * 40
            approvals = {('clamav', identity, ('LGPL-3.0-or-later',)): {'reference': 'review-1'}}
            with patch.object(licenses, 'docker', side_effect=lambda *args: args[-1].encode()) as docker, \
                 patch.object(licenses, 'verify_postgres_notices', return_value={}) as notices:
                report = licenses.audit(root, commit, approvals, retained_ids=ids)
                self.assertEqual(report['images'], ids)
                self.assertEqual(report['commit'], commit)
                self.assertEqual({row['scope'] for row in report['packages']}, set(ids))
                self.assertIn(('postgres-staging', identity, 'review-required'), [
                    (row['scope'], row['purl'], row['status']) for row in report['packages']
                ])
                self.assertIn(('clamav', identity, 'approved'), [
                    (row['scope'], row['purl'], row['status']) for row in report['packages']
                ])
                notices.assert_called_once_with(ids['postgres-staging'], staging=True)
                self.assertEqual([call.args[-1] for call in docker.call_args_list], list(ids.values()))
                with self.assertRaisesRegex(ValueError, 'does not match the expected image'):
                    licenses.audit(root, commit, approvals,
                                   retained_ids=ids | {'postgres-staging': ids['clamav']})
                swapped = json.loads((root / '1-image.json').read_text())
                swapped['image'] = 'barghsa-clamav:vps-previous'
                (root / '1-image.json').write_text(json.dumps(swapped))
                with self.assertRaisesRegex(ValueError, 'does not match the expected image'):
                    licenses.audit(root, commit, approvals, retained_ids=ids)

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

    def test_first_party_telemetry_keeps_its_third_party_runtime_in_the_inventory(self):
        internal = 'pkg:npm/%40barghsa/telemetry@0.0.0'
        sdk = 'pkg:npm/%40opentelemetry/sdk-trace@2.11.0'
        bom = {'components': [
            {'bom-ref': 'internal', 'type': 'library', 'purl': internal},
            {'bom-ref': 'sdk', 'type': 'library', 'purl': sdk},
        ], 'dependencies': [{'ref': 'internal', 'dependsOn': ['sdk']}]}
        self.assertEqual(list(licenses.image_components(bom)), [(sdk, ())])
        self.assertEqual(licenses.disposition('web', sdk, (), {}), ('review-required', None))

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
            with patch.object(licenses, 'audit', return_value=result) as audit, \
                 patch.object(licenses, 'read_approvals', return_value={}), \
                 patch.object(licenses.sys, 'argv', args + ['--staging-local', 'initialized']):
                self.assertEqual(licenses.main(), 1)
                audit.assert_called_once_with(Path(directory), '1' * 40, {}, 'initialized')


    def test_staging_postgres_requires_its_source_component_notices(self):
        self.assertIn('postgres-staging', licenses.IMAGE_SCOPES)
        components = {identity: (name, directory, licenses.digest(directory.encode()))
                      for identity, (name, directory, _) in licenses.STAGING_POSTGRES_COMPONENTS.items()}
        notices = [{}, *({'LICENSE': directory.encode()} for _, directory, _ in components.values())]
        with patch.object(licenses, 'POSTGRES_GO_NOTICES', {}), \
             patch.object(licenses, 'STAGING_POSTGRES_COMPONENTS', components), \
             patch.object(licenses, 'docker', return_value=b'container') as docker, \
             patch.object(licenses, 'archive_files', side_effect=notices) as archive:
            self.assertEqual(licenses.verify_postgres_notices('image', staging=True), licenses.POSTGRES_GO_LICENSES)
            for index in range(1, len(notices)):
                archive.side_effect = [*notices[:index], {'LICENSE': b'wrong license'}]
                with self.assertRaisesRegex(ValueError, 'Incorrect staging PostgreSQL license'):
                    licenses.verify_postgres_notices('image', staging=True)
                docker.assert_called_with('rm', '-v', 'container')


if __name__ == '__main__':
    unittest.main()
