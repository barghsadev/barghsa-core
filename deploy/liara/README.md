# Liara PaaS staging

The Liara account already has one private network, two managed databases, one
private bucket, and five Docker apps:

| Kind | ID | Role |
| --- | --- | --- |
| Network | `barghsa-network` | Private app and database traffic |
| Managed PostgreSQL | `barghsa-db` | Primary database |
| Managed Redis | `barghsa-redis` | Queues, cache, sessions |
| Object Storage | `barghsa-s3` | Private S3-compatible bucket |
| Docker | `barghsa-api` | HTTP API on port 4000 |
| Docker | `barghsa-worker` | Background workers; health server on port 9090 |
| Docker | `barghsa-web` | React assets served by Node on port 3000 |
| Docker | `barghsa-clamav` | Private clamd TCP on port 3310 |
| Docker | `barghsa-edge` | Public Nginx router on port 80 |

Liara's managed databases and bucket must not be replaced with Docker
containers. Every app and database belongs to `barghsa-network`. Attach
`app.barghsa.com` to `barghsa-edge`; `s3.barghsa.com` belongs to the bucket.
The edge routes `/api/` to `barghsa-api:4000` and other paths to
`barghsa-web:3000`. This keeps browser API calls on the same origin.

## Before deployment

1. Test reachability of a Liara PaaS `.liara.run` domain from the countries
   that could not reach the VPS. Creating PaaS apps alone does not establish
   cross-region access.
2. In `barghsa-db`, enable pgvector. Confirm that `pgcrypto` and `btree_gist`
   can be created. Migration 0080 defines the `uuid_generate_v7()` function.
   Migration 0210 uses HNSW in canonical SQL. Liara's pgvector does not support
   that index. `run-liara-migrations.cjs` runs a deterministic variant without
   that index; vector searches still work without an approximate index. Use
   this variant for every future migration run against this database.
   Do not use this variant on a database that already applied canonical 0210;
   its recorded checksum will differ.
3. Create a bucket access key scoped to `barghsa-s3`. Read its S3 endpoint and
   region from the bucket's **SDK access** page. Do not infer the S3 API
   endpoint from `s3.barghsa.com`; verify custom-domain signed uploads before
   using it for `S3_PUBLIC_ENDPOINT`.
4. Add a persistent Liara disk mounted at `/var/lib/clamav` to
   `barghsa-clamav`, so signature updates survive restarts.
5. Set app environment variables in Liara Console. Do not send or commit
   credentials. URL-encode special characters inside database URLs.

The API and worker both need `DATABASE_URL`, `PGDIRECT_URL`, `REDIS_URL`,
`S3_ENDPOINT`, `S3_PRIVATE_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`,
`S3_BUCKET=barghsa-s3`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and
`S3_FORCE_PATH_STYLE` using the values shown by Liara. Set
`DOCUMENT_CLAMAV_HOST=barghsa-clamav` and `DOCUMENT_CLAMAV_PORT=3310` on both.
Set `APP_PUBLIC_URL=https://app.barghsa.com`,
`API_PUBLIC_URL=https://app.barghsa.com`, `NODE_ENV=production`, and the
application's required secrets from `deploy/staging/runtime.env.example`.
Set `BARGHSA_DB_PROFILE=liara` on the API only. Its startup then runs the
Liara migration variant under the existing PostgreSQL advisory lock before
starting HTTP service. Set `PORT=4000` on API, `WORKER_PORT=9090` on worker,
and `PORT=3000` on web.

Start with Liara's canonical bucket endpoint for both private and public S3
endpoints. Once signed PUT, multipart upload, and GET work through
`s3.barghsa.com`, switch `S3_PUBLIC_ENDPOINT` to the custom domain. Configure
bucket CORS for `https://app.barghsa.com` before browser uploads.

## Deploy

Use Liara CLI 9.5.1 or newer, logged into the account containing these IDs.
From repository root, deploy in this order:

```bash
deploy/liara/deploy.sh clamav
deploy/liara/deploy.sh api
deploy/liara/deploy.sh worker
deploy/liara/deploy.sh web
deploy/liara/deploy.sh edge
```

If an Iranian build times out while downloading packages, retry with
`LIARA_BUILD_LOCATION=germany deploy/liara/deploy.sh web`. This changes the
build location, not the app's network or runtime region.

The CLI builds API, worker, ClamAV, and edge from repository root. For web,
the script builds assets locally and uploads a small runtime image. Liara's
remote build timed out while installing the monorepo's dependencies. The
worker uses a separate Dockerfile because Liara CLI has no build-target flag.
The API runs the Liara migration variant at startup only when
`BARGHSA_DB_PROFILE=liara` is set, so verify that variable before its first
PaaS deploy. A missing variable means no migration runs.

After each deploy, check logs and health. Test `barghsa-edge.liara.run/health`,
then `app.barghsa.com`, an `/api/` request, login/session cookies, a background
job, document scan, and an S3 upload and download. Keep API, worker, web, and
ClamAV default domains out of public documentation; only edge needs the app
custom domain.

The old `deploy/staging/release.sh` and Compose files operate a VPS and are
not Liara deployment entry points. Database and object backups also need a
separate managed-service policy before this staging environment holds
irreplaceable data.

The API currently trusts only explicitly configured proxy IPs. Liara can
change the edge app's private IP, so leave `API_TRUSTED_PROXY_IPS` unset for
this first staging rollout. Per-IP rate limits and audit IPs will then see
the proxy address. Resolve trusted client IP forwarding before production;
never set a wildcard trusted proxy value.
