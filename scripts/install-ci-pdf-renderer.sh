#!/usr/bin/env bash
set -euo pipefail

if command -v pdftoppm >/dev/null; then
  pdftoppm -v
  exit
fi

sources=$(mktemp -d)
trap 'rm -rf "$sources"' EXIT
apt=(apt-get
  -o "Dir::Etc::SourceList=$sources/poppler.list"
  -o Dir::Etc::SourceParts=-
  -o Acquire::Languages=none
  -o Acquire::Retries=1
  -o Acquire::https::Timeout=12
  -o DPkg::Lock::Timeout=20
)
as_root=()
if (( EUID != 0 )); then as_root=(sudo); fi

# Retry downloads on another signed mirror before changing dpkg state.
for archive in \
  https://mirrors.edge.kernel.org/ubuntu/ \
  https://archive.ubuntu.com/ubuntu/ \
  https://mirror.its.umich.edu/ubuntu/; do
  for suite in noble noble-updates noble-security; do
    printf 'deb [signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] %s %s main\n' \
      "$archive" "$suite"
  done > "$sources/poppler.list"
  printf 'Installing Poppler from %s\n' "$archive"
  if "${as_root[@]}" timeout --kill-after=5s 60s "${apt[@]}" --error-on=any update &&
     "${as_root[@]}" timeout --kill-after=5s 45s "${apt[@]}" install --yes --no-install-recommends --download-only poppler-utils; then
    # The CI step's outer timeout still applies. Do not advance to another
    # mirror or interrupt dpkg with the retry timeout during installation.
    "${as_root[@]}" "${apt[@]}" install --yes --no-install-recommends --no-download poppler-utils
    pdftoppm -v
    exit
  fi
done

printf 'Could not install Poppler from the signed Ubuntu archives.\n' >&2
exit 1
