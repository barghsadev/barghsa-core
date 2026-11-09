#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo 'Usage: scripts/check-runtime-images.sh REPORT_DIRECTORY IMAGE [IMAGE ...]' >&2
  exit 2
fi

report_dir=$1
shift
version=0.76.2
case "$(uname -s)/$(uname -m)" in
  Linux/x86_64)
    platform=Linux-64bit
    checksum=bc0fc726e017b8927a62b2d3531d7a84ee01769daf5c99ed866dced54089fdbf
    ;;
  Darwin/arm64)
    platform=macOS-ARM64
    checksum=ae7ea358326960406b703c77b2ac490190797d80b306b5b50c2a27221da0a5b8
    ;;
  *)
    echo 'No checksum-pinned Trivy archive for this host' >&2
    exit 2
    ;;
esac

mkdir -p "$report_dir"
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
archive=trivy_${version}_${platform}.tar.gz
curl --fail --silent --show-error --location --max-time 120 --retry 2 \
  "https://github.com/aquasecurity/trivy/releases/download/v${version}/${archive}" \
  --output "$scratch/$archive"
printf '%s  %s\n' "$checksum" "$scratch/$archive" | shasum -a 256 --check --status
tar -xzOf "$scratch/$archive" trivy >"$scratch/trivy"
chmod 700 "$scratch/trivy"

status=0
index=0
for image in "$@"; do
  index=$((index + 1))
  report="$report_dir/$index-vulnerabilities.json"
  provenance="$report_dir/$index-image.json"
  if [[ -e "$report" || -e "$provenance" ]]; then
    echo "Refusing to reuse image scan output: $report" >&2
    exit 2
  fi
  if ! image_id=$(docker image inspect --format '{{.Id}}' "$image"); then
    status=1
    continue
  fi
  if ! "$scratch/trivy" --cache-dir "$scratch/cache" image \
    --image-src docker --scanners vuln --ignorefile /dev/null --no-progress \
    --db-repository ghcr.io/aquasecurity/trivy-db:2 \
    --db-repository public.ecr.aws/aquasecurity/trivy-db:2 \
    --list-all-pkgs --ignore-unfixed=false --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL \
    --format json --output "$report" "$image"; then
    echo "Scanner failed for $image" >&2
    status=1
    continue
  fi
  if [[ "$(docker image inspect --format '{{.Id}}' "$image")" != "$image_id" ]]; then
    echo "Image changed during scan: $image" >&2
    status=1
    continue
  fi
  if ! python3 - "$report" "$provenance" "$image" "$image_id" "$version" <<'PY'
import hashlib
import json
from pathlib import Path
import re
import sys

report_path, output_path, image, image_id, version = sys.argv[1:]
raw = Path(report_path).read_bytes()
report = json.loads(raw)
results = report.get("Results")
if (
    not re.fullmatch(r"sha256:[a-f0-9]{64}", image_id)
    or report.get("Metadata", {}).get("ImageID") != image_id
    or not isinstance(results, list)
    or not any(item.get("Class") == "os-pkgs" and item.get("Packages") for item in results)
):
    raise SystemExit(f"No complete OS vulnerability result for the exact image {image}")
levels = {}
for item in results:
    for finding in item.get("Vulnerabilities") or []:
        severity = finding["Severity"]
        levels[severity] = levels.get(severity, 0) + 1
blocked = levels.get("HIGH", 0) + levels.get("CRITICAL", 0)
Path(output_path).write_text(json.dumps({
    "image": image, "image_id": image_id, "scanner": f"Trivy {version}",
    "report_sha256": hashlib.sha256(raw).hexdigest(), "by_severity": levels,
    "blocked": blocked > 0,
}, indent=2) + "\n")
print(f"{image}: {blocked} high/critical vulnerabilities (image {image_id})")
sys.exit(1 if blocked else 0)
PY
  then
    status=1
  fi
done
exit "$status"
