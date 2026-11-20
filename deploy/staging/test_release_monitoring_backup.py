import subprocess
import unittest
from pathlib import Path


HELPER = Path(__file__).with_name("monitoring-backup-inputs.sh")
FIXTURE = r'''
set -euo pipefail
fixture_root=/opt/barghsa/staging/monitoring
primary=barghsa-staging-monitoring-prometheus-1
archive=barghsa-staging-monitoring-prometheus-archive-1

docker() {
  [[ "$1" == inspect && "$2" == --format ]]
  case "$3" in
    *config_files*)
      printf '%s' "$fixture_root/staging-compose.yml"
      if [[ "$mode" != legacy && ( "$4" == "$primary" || "$4" == "$archive" ) ]]; then
        printf ',%s' "$fixture_root/metrics-retention-compose.yml"
      fi
      ;;
    *environment_file*)
      [[ "$4" == "$archive" ]]
      printf '%s,%s' /etc/barghsa/staging/monitoring-compose.env "$archive_environment"
      ;;
    *Mounts*)
      if [[ "$4" == "$archive" ]]; then
        printf '%s\n' "$fixture_root/prometheus-archive.yml"
      else
        printf '%s\n' "$fixture_root/prometheus.yml"
      fi
      ;;
    *) return 1 ;;
  esac
}

realpath() { printf '%s\n' "$3"; }
stat() {
  if [[ "$mode" == world-readable && "$4" == "$archive_environment" ]]; then
    printf '0:644\n'
  else
    printf '0:600\n'
  fi
}
add_input() { printf '%s\t%s\n' "$1" "$2"; }
mode=$2
archive_environment=${3:-$fixture_root/archive.env}
source "$1"
capture_monitoring_inputs
'''


def run_inventory(mode, archive_environment=""):
    return subprocess.run(
        ["bash", "-c", FIXTURE, "monitoring-inventory", str(HELPER), mode, archive_environment],
        capture_output=True,
        text=True,
        check=False,
    )


class MonitoringBackupInputsTest(unittest.TestCase):
    def test_active_archive_backs_up_scrape_config_and_protected_environment(self):
        result = run_inventory("active")
        self.assertEqual(result.returncode, 0, result.stderr)
        lines = result.stdout.splitlines()
        self.assertIn("deploy\topt/barghsa/staging/monitoring/prometheus-archive.yml", lines)
        self.assertIn("env\topt/barghsa/staging/monitoring/archive.env", lines)
        self.assertEqual(lines.count("env\tetc/barghsa/staging/monitoring-compose.env"), 1)

    def test_legacy_primary_preserves_inventory_without_archive_inputs(self):
        result = run_inventory("legacy")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("deploy\topt/barghsa/staging/monitoring/prometheus.yml", result.stdout)
        self.assertNotIn("prometheus-archive.yml", result.stdout)
        self.assertNotIn("archive.env", result.stdout)

    def test_archive_environment_outside_the_staging_roots_is_rejected(self):
        result = run_inventory("active", "/etc/unrelated.env")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("unrelated.env", result.stdout)

    def test_world_readable_archive_environment_is_rejected(self):
        result = run_inventory("world-readable")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("archive.env", result.stdout)
