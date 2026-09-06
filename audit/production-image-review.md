# Production image review

The application image and shutdown repair is implemented and tested locally. No production deployment or push was performed.

## Repeatable checks

Build from the repository root:

```sh
docker build -f Dockerfile.base --target production -t barghsa-audit-api:f18 .
docker build -f Dockerfile.base --target worker -t barghsa-audit-worker:f18 .
docker build -f Dockerfile.web -t barghsa-audit-web:f18 .
python3 scripts/test-production-images.py
```

The test creates an isolated PostgreSQL 17 database and Docker network, publishes no host ports, uses no external provider, and removes its containers/network on completion. It verifies non-root/read-only boot, the packaged migration runner, optional Redis fallback, database readiness loss/recovery, concurrent notification/invoice draining, bounded forced exit with retry, and web/API shutdown. The deadline case explicitly closes disconnected sleeping database sessions and shortens a test lease, so natural network-loss and lease-expiry timing is not claimed.

All checks passed. Additional validation: workspace typechecks, ten tests importing the production web server, and merged compose configuration parsing.

## Packaging decisions

Node 24 runs all three applications. Each API/worker package is deployed with production dependencies from the frozen workspace lockfile. The old legacy packaging path re-resolved dependencies and was discarded. Production DB migrations remain next to the compiled DB package. Worker starts dist/main.js, which is the actual fresh compiler output. Web has one implementation, apps/web/server.js, including shutdown and security headers.

API and worker receive provider configuration from an external runtime environment file named by BARGHSA_RUNTIME_ENV_FILE. The same file is supplied to Compose with --env-file for required interpolation. Do not commit the file. Database URL, public application/API origins, delivery encryption key and payment merchant configuration must be supplied. Provider-specific variables in the file reach both applications; unavailable identity verification remains fail-closed.

## Limits

The full backing-service stack inherited from docker-compose.yml still contains development-oriented credentials and service choices. This check is not a production deployment certification. Before rollout, configure the actual backing services, providers, secrets, backup/restore and migration procedure. Do not restart the other-machine orchestrator as part of this repair.
