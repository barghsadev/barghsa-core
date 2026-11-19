#!/usr/bin/env bash
# Loaded by the staging configuration backup and restore scripts.
capture_monitoring_inputs() {
  local name text path
  local managed=/opt/barghsa/staging/monitoring/
  local -a mounted=()
  for name in barghsa-staging-monitoring-prometheus-1 barghsa-staging-monitoring-alertmanager-1; do
    text=$(docker inspect --format '{{range .Mounts}}{{if eq .Type "bind"}}{{println .Source}}{{end}}{{end}}' "$name")
    while IFS= read -r path; do
      if [[ "$path" == "$managed"* ]]; then mounted+=("$path"); fi
    done <<< "$text"
    text=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$name")
    while IFS= read -r path; do
      [[ "$path" == "$managed"* ]]
      mounted+=("$path")
    done <<< "${text//,/$'\n'}"
  done
  [[ "${#mounted[@]}" -gt 0 ]]
  text=$(printf '%s\n' "${mounted[@]}" | sort -u)
  while IFS= read -r path; do
    [[ "$path" =~ ^/opt/barghsa/staging/monitoring/[a-zA-Z0-9._/-]+\.(ya?ml|json)$ ]]
    [[ "$path" == "$(realpath -e -- "$path")" ]]
    add_input deploy "${path#/}"
  done <<< "$text"

  for path in monitoring-compose.env operations.env; do
    add_input env "etc/barghsa/staging/$path"
  done
  add_input encryption_key etc/barghsa/staging/operations-webhook-token
  add_input encryption_key etc/barghsa/staging/postgres-disk/issuer/ca.key
  add_input tls etc/barghsa/staging/postgres-disk/issuer/ca.pem
  for path in server/server.pem server/ca.pem scrape/client.pem scrape/ca.pem; do
    add_input tls "etc/barghsa/staging/postgres-disk/$path"
  done
  for path in server/server.key scrape/client-key.pem; do
    add_input encryption_key "etc/barghsa/staging/postgres-disk/$path"
  done
  for path in server/web.yml scrape/targets.yml; do
    add_input deploy "etc/barghsa/staging/postgres-disk/$path"
  done
  for path in barghsa-staging-postgres-offsite.service barghsa-staging-postgres-offsite.timer \
    barghsa-staging-postgres-offsite.service.d/50-backup-metrics.conf \
    barghsa-staging-postgres-disk-exporter.service \
    barghsa-staging-postgres-disk-exporter.service.d/50-backup-textfile.conf; do
    add_input deploy "etc/systemd/system/$path"
  done
  add_input deploy usr/local/lib/barghsa-staging/backup-postgres
  add_input deploy usr/local/lib/barghsa-staging/report-postgres-backup.py
  add_input deploy opt/barghsa/staging/postgres-backup-monitor/run_backup_job.py
  add_input deploy opt/barghsa/staging/config-backup/monitoring-inputs.sh
}
