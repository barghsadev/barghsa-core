#!/usr/bin/env bash
set -euo pipefail
umask 077

stage=${1:?Missing staged NGINX configuration}
[[ $stage =~ ^/tmp/barghsa-staging-nginx\.[A-Za-z0-9]{8}$ && -d $stage && ! -L $stage ]]
sources=(nginx-api-proxy.conf nginx-s3-proxy.conf nginx.conf)
targets=(/etc/nginx/snippets/barghsa-api-proxy.conf /etc/nginx/snippets/barghsa-s3-proxy.conf
  /etc/nginx/conf.d/barghsa-staging.conf)
applying=false
reload_attempted=false

replace_file() {
  local source=$1 target=$2 pending
  pending="$(dirname -- "$target")/.${stage##*/}"
  rm -f -- "$pending" && cp -a -- "$source" "$pending" && mv -fT -- "$pending" "$target"
}

finish() {
  local status=$? restored=true i previous
  if (( status != 0 )) && [[ $applying == true ]]; then
    for i in "${!targets[@]}"; do
      previous="$stage/original/${targets[i]##*/}"
      if [[ -e $previous || -L $previous ]]; then
        replace_file "$previous" "${targets[i]}" || restored=false
      else
        rm -f -- "${targets[i]}" || restored=false
      fi
    done
    if [[ $restored == true && $reload_attempted == true ]]; then
      { nginx -t && systemctl reload nginx; } || restored=false
    fi
    if [[ $restored == false ]]; then
      printf 'NGINX recovery failed. Previous files retained in %s/original\n' "$stage" >&2
      return
    fi
    echo 'Restored the previous staging NGINX configuration' >&2
  fi
  rm -rf -- "$stage"
}

trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' HUP TERM
exec 9>/run/lock/barghsa-staging-nginx.lock
flock -n 9 || { echo 'Another staging NGINX update is running' >&2; exit 1; }

mkdir -- "$stage/original"
for i in "${!targets[@]}"; do
  chmod 0644 "$stage/${sources[i]}"
  if [[ -e ${targets[i]} || -L ${targets[i]} ]]; then
    cp -a -- "${targets[i]}" "$stage/original/"
  fi
done

applying=true
for i in "${!targets[@]}"; do
  replace_file "$stage/${sources[i]}" "${targets[i]}"
done
nginx -t
reload_attempted=true
systemctl reload nginx
