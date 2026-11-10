#!/usr/bin/env bash
set -euo pipefail

config=/etc/barghsa/staging/clamav-mirror
gateway=$(docker network inspect barghsa-staging-private --format '{{(index .IPAM.Config 0).Gateway}}')
[[ "$gateway" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ && "$gateway" == "${BARGHSA_CLAMAV_MIRROR_GATEWAY:?Set the private bridge gateway}" ]] || {
  echo 'Staging ClamAV mirror gateway does not match the private bridge' >&2
  exit 1
}

exec ssh -F /dev/null -NT \
  -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
  -o ExitOnForwardFailure=yes -o ConnectTimeout=10 \
  -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
  -o GlobalKnownHostsFile=/dev/null -o HostKeyAlgorithms=ssh-ed25519 \
  -o "UserKnownHostsFile=$config/known_hosts" -i "$config/id_ed25519" \
  -L "$gateway:18443:127.0.0.1:18443" barghsa-clamav-read@eu.barghsa.com
