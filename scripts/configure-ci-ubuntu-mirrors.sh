#!/usr/bin/env bash
set -euo pipefail

mirror_file=/etc/apt/apt-mirrors.txt
if [[ ! -s "$mirror_file" ]] || timeout 6s getent ahostsv4 azure.archive.ubuntu.com >/dev/null; then
  exit 0
fi

# Keep the runner's archive sources and Ubuntu signing keyring in place.
# APT verifies archive metadata and package hashes after selecting a mirror.
printf '%s\tpriority:%d\n' \
  'https://mirrors.edge.kernel.org/ubuntu/' 1 \
  'https://mirror.its.umich.edu/ubuntu/' 2 | sudo tee -a "$mirror_file" >/dev/null
