# Staging on the Liara VPS

`stg.barghsa.com` is the only required DNS name. NGINX serves the web app at
`/`, forwards `/api/` to the API, and forwards `/barghsa-staging/` to the
private S3 gateway without changing the signed URL path. PostgreSQL (with
PostGIS and pgvector), Redis, SeaweedFS, ClamAV, API, web, and worker all run
as Docker Compose services on the same Ubuntu 24.04 VPS. Only NGINX ports 80
and 443 and the VPS SSH port 30222 are public.

## First host setup

Point the `stg.barghsa.com` A record to `89.42.199.13`. Allow inbound TCP 80,
443, and 30222 at the provider firewall. Install host packages:

```sh
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2 nginx certbot
mkdir -p /var/www/barghsa-acme /etc/nginx/snippets /opt/barghsa/staging /etc/barghsa/staging
```

Install `nginx-bootstrap.conf` as `/etc/nginx/conf.d/barghsa-staging.conf`,
remove `/etc/nginx/sites-enabled/default`, test and reload NGINX. Obtain the
one-domain certificate with HTTP-01 webroot validation:

```sh
certbot certonly --webroot -w /var/www/barghsa-acme \
  -d stg.barghsa.com --email majidnajafi.dev@gmail.com \
  --agree-tos --non-interactive
```

The automatic Certbot timer and `certbot-reload-nginx.sh` renewal hook keep
the certificate current. DNS challenge is not required while port 80 reaches
the host.

## Release

From a clean, committed checkout on a Docker-equipped machine with SSH key
access to the VPS:

```sh
deploy/staging/deploy.sh
```

The first release builds four `linux/amd64` images. Later releases build only
API/worker and web images, retaining the active PostgreSQL and ClamAV images
and all Docker volumes. The script transfers images over SSH, uploads
Compose and NGINX configuration, initializes root-only random staging secrets
on first deployment, runs the release script, and checks HTTPS plus a private
S3 write and public signed read. Subsequent
releases preserve `/etc/barghsa/staging/runtime.env` and Docker volumes.

On the server, view status and logs with:

```sh
docker compose --env-file /etc/barghsa/staging/runtime.env \
  --env-file /etc/barghsa/staging/active-images.env \
  -f /opt/barghsa/staging/compose.yml ps
docker compose --env-file /etc/barghsa/staging/runtime.env \
  --env-file /etc/barghsa/staging/active-images.env \
  -f /opt/barghsa/staging/compose.yml logs --tail=100 api worker
```

The API/worker app image is shared; the worker uses its own command and health
check. Database migrations run once per release before the API and worker are
replaced. The release restores the last app images after a failed rollout; a
database migration itself is not reversed.

The generated Zarinpal merchant ID is deliberately invalid. Configure a real
staging merchant before testing payments. SMS, email, and other external
providers also require their own settings in the app's admin UI.

## Data and backups

The initial runtime sets `BARGHSA_DISPOSABLE=true`: this staging server has
no offsite backup destination. Docker volumes survive container and image
releases, but losing this VPS loses PostgreSQL and uploaded objects. Do not
put irreplaceable data here. Add an offsite encrypted backup workflow and test
a restore before changing the release guard for non-disposable staging.

Check resource use with `docker stats`, `df -h`, and `docker system df`.
ClamAV may take several minutes to download signatures on first boot. Keep
one instance of each stateful service; do not scale PostgreSQL or SeaweedFS
with this single-host Compose file.
