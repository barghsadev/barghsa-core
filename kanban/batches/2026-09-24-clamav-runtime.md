# Production ClamAV runtime batch

Follow-up to `05-notifications-documents-ai.md#T-05.11.03`.

The production Compose overlay now starts an official ClamAV 1.5 daemon,
waits for its health check before starting the API and worker, and points
both services at its private TCP address. The scanner port is not published
to the host. A named volume retains signature updates. The image enables
50 MiB INSTREAM scans and flags ClamAV scan-limit exceedances instead of
silently accepting partially inspected files.

Validation: Docker image build; resolved production Compose configuration;
live scanner smoke test with a clean 26 MiB stream and an EICAR test signature;
formatting and backlog checks. The preceding application batch passed its
full document HTTP suite, protocol tests, build, typecheck and schema checks.
