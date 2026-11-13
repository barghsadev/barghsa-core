# ClamAV signature freshness

A healthy daemon must also have current signature data. Compare the daemon's version with the vendor's signed update feed before selecting a scanner image. Record the loaded signature version and the result of clean and infected test uploads. A successful PING only proves the daemon is running.

The worker reads ClamD's private `VERSION` response every 30 seconds and exports the loaded signature database's UTC build time. The staging and production scanner services run in UTC. `ClamAvSignaturesStale` opens one P2 alert per environment and database after five minutes with a missing or invalid build time, or signatures at least 48 hours old. Compare the mirror, archive signatures and loaded version. Confirm the alert clears after a current database loads. [Storage and Uploads dashboard](../../deploy/monitoring/grafana-storage-uploads-dashboard.json) · [ClamD protocol](https://docs.clamav.net/manual/Usage/ClamdProtocol.html)

Set the scrape target label `clamav_signature_monitoring: required` on
workers expected to publish ClamAV signature data. Staging declares it on its
worker target. Drop that label from scraped samples with metric relabeling
to preserve existing alert identities. Prometheus retains the label on its
generated `up` series. The P2 alert fires when that worker is reachable and
omits the metric for five minutes. The worker availability alert covers a
failed scrape and excludes the new label from its identity. Apply the
Prometheus rules and target label with the worker
release that enables signature monitoring.

If FreshClam receives HTTP 403, preserve the vendor's cooldown and investigate the response. Resume after the cooldown or switch to an approved private mirror with its own official upstream. Restrict access to the scanner hosts, verify signatures and freshness before reload, and alert on overdue updates. [ClamAV private mirror documentation](https://docs.clamav.net/appendix/CvdPrivateMirror.html)

## Staging mirror

On `eu.barghsa.com`, Ubuntu's `clamav-freshclam.service` uses the official vendor feed and keeps tested databases in `/var/lib/clamav/barghsa-mirror`. Its configuration is `/etc/clamav/freshclam.conf` under the stock AppArmor policy. Keep `ScriptedUpdates no` on the mirror so FreshClam fetches complete vendor-signed archives. The separate `barghsa-clamav-mirror.service` runs NGINX with `/etc/clamav/barghsa-mirror-nginx.conf`. It serves the main, daily and bytecode `.cvd` archives and their versioned `.cvd.sign` files on loopback port 18443 and supports HTTP range requests. Verify all three archives with `sigtool --verify` using their matching detached signatures when provisioning the scanner or rehearsing a release.

The EU SSH account `barghsa-clamav-read` uses a dedicated staging key and can forward only to `127.0.0.1:18443` on the EU host. Its SSH rules are in `/etc/ssh/sshd_config.d/95-barghsa-clamav-mirror.conf`. Staging keeps the private key and pinned EU ED25519 host key in the root-only `/etc/barghsa/staging/clamav-mirror` directory. A host key rotation requires updating that trusted pin through an authenticated administrator connection.

Install the staging tunnel service into `/etc/systemd/system` and its launcher as `/usr/local/sbin/barghsa-staging-clamav-tunnel`. Set `BARGHSA_CLAMAV_MIRROR_GATEWAY` in the protected `tunnel.env` to the gateway of Docker network `barghsa-staging-private`. The launcher checks the address and binds only that interface. Verify a 512-byte range request returns 206 from the bridge. If the network is rebuilt with a new gateway, update both `tunnel.env` and the staging FreshClam configuration before restarting the tunnel. [Tunnel service](../../deploy/staging/barghsa-clamav-mirror-tunnel.service) · [Launcher](../../deploy/staging/clamav-mirror-tunnel.sh)

The protected staging `freshclam.conf` uses `PrivateMirror http://<private-bridge-gateway>:18443`, `ScriptedUpdates no`, `TestDatabases yes` and `NotifyClamd /etc/clamav/clamd.conf`. Set `BARGHSA_CLAMAV_FRESHCLAM_CONFIG` to its absolute path and `BARGHSA_CLAMAV_FRESHCLAM_CHECKS=6` in staging's `runtime.env` when activating the mirror. Compose mounts the configuration read-only. Other staging installations can use the checked-in official-feed default.

Before changing the scanner image, prewarm a disposable signature volume from the mirror and test it with the candidate image. Preserve the previous image and a signature-volume backup for rollback. Apply the new scanner configuration during scanner maintenance because normal application deploys retain the existing scanner container. Check that the live container runs FreshClam at the configured frequency and that its first check reaches the private feed. Check ClamD's loaded version after startup because the first FreshClam notification can precede the ClamD socket. After rollout, record the running image ID and signature version, test clean and EICAR inputs through the application, and verify the pending and retry behavior when the scanner is unavailable.

Use each image's normal startup when testing a disposable copy of the signature volume. The startup assigns ownership to the image's ClamAV user. Verify both directions when the user or group ID differs between images. Compare the resolved Compose service graph and recreate only the scanner. Promote the protected active-image manifest after the scanner is healthy and the worker can stream a clean file, the standard EICAR fixture and a 100 MiB file to it. For rollback, restore the previous manifest, recreate the scanner with the retained image and read back its image, loaded signatures and health.

## Sealed upload rehearsal

Start the candidate scanner in a disposable container and publish its TCP
port only on loopback. For an offline CI rehearsal with a preloaded signature
database, use `CLAMAV_NO_FRESHCLAMD=true`. Record the image ID and ClamD
`VERSION` response after the health check. [ClamAV container configuration](https://docs.clamav.net/manual/Installing/Docker.html#controlling-the-container)

With the candidate scanner listening at `127.0.0.1:13310`, run the focused
case against the integration suite's disposable PostgreSQL and object store.

```sh
pnpm exec turbo run build --filter=@barghsa/api --filter=@barghsa/worker
BARGHSA_TEST_PREBUILT=1 BARGHSA_TEST_CLAMD_PORT=13310 \
  pnpm --filter @barghsa/api exec vitest run --reporter=verbose \
  src/documents/document-http.integration.test.ts -t 'actual ClamAV clean verdict'
```

The case seals a clean text document and the standard EICAR fixture through
the document API. A separate loopback listener closes the connection to
exercise retry. Verify the case actually ran, retain its verdicts and
download results, and record the final deployment's loaded signature version
and mirror freshness separately.
