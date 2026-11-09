import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

RELEASE = Path(__file__).with_name("release.sh")


class ReleaseRollbackTests(unittest.TestCase):
    def run_rollback(self, simulate_failure=False):
        with tempfile.TemporaryDirectory(prefix="barghsa-rollback-") as directory:
            root = Path(directory)
            runtime = root / "runtime.env"
            runtime.touch()
            active = root / "active.env"
            active.write_text("BARGHSA_APP_IMAGE=barghsa-app:previous\n")
            compose = root / "compose.yml"
            compose.write_text(
                'services:\n  api:\n    image: "${BARGHSA_APP_IMAGE:?Set app image}"\n'
            )
            fake_docker = root / "docker"
            fake_docker.write_text(
                """#!/usr/bin/env bash
set -eu
args=()
while [[ $# -gt 0 && $1 != up ]]; do
  args+=("$1")
  shift
done
[[ $* == 'up -d --no-deps --wait --wait-timeout 240 api web worker ai-inference' ]]
"$REAL_DOCKER" "${args[@]}" config --format json
[[ "$SIMULATE_FAILURE" == 0 ]]
"""
            )
            fake_docker.chmod(0o755)
            text = RELEASE.read_text()
            function = text[text.index("rollback() {"):text.index("\ntrap rollback ERR")]
            env = {
                **os.environ,
                "PATH": f"{root}:{os.environ['PATH']}",
                "REAL_DOCKER": shutil.which("docker") or "docker",
                "BARGHSA_APP_IMAGE": "barghsa-app:failed-candidate",
                "SIMULATE_FAILURE": "1" if simulate_failure else "0",
            }
            script = (
                'set -euo pipefail\n'
                'runtime=$1\nactive=$2\ncompose=$3\n'
                f'{function}\n'
                "trap rollback ERR\nbash -c 'exit 17'\necho unreachable\n"
            )
            return subprocess.run(
                ["bash", "-c", script, "rollback-fixture", str(runtime), str(active), str(compose)],
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )

    def test_rollback_reads_previous_image_instead_of_exported_candidate(self):
        result = self.run_rollback()
        self.assertEqual(result.returncode, 17, result.stderr)
        self.assertEqual(json.loads(result.stdout)["services"]["api"]["image"], "barghsa-app:previous")
        self.assertNotIn("Restoring the previous staging app images failed", result.stderr)

    def test_unhealthy_rollback_reports_failure_and_preserves_original_status(self):
        result = self.run_rollback(simulate_failure=True)
        self.assertEqual(result.returncode, 17, result.stderr)
        self.assertIn("Restoring the previous staging app images failed", result.stderr)


if __name__ == "__main__":
    unittest.main()
