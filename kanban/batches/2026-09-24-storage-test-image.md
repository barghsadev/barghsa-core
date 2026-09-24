# Storage integration test image repair

The direct-main CI run for the staff consultation batch failed four unrelated S3 integration suites during setup: Docker returned `unauthorized` for the pinned `quay.io/minio/minio` digest. All 5,551 executed API tests passed; the four suites never reached their tests. The coverage gate failed because the test job failed.

Five S3 fixture suites now use the active multi-architecture `pgsty/minio` image, pinned to `sha256:b6bfe7239bfc83fb90d31612d9704d86039dd714f7904b3f1ad68f211e602372`. This is a community-maintained MinIO fork and preserves the existing `server /data`, credentials, readiness endpoint and S3 test behavior. The registry confirmed the digest and its amd64 config blob on September 24, 2026. No product storage code changed.

Validation: repository formatting, lint and type checks pass locally. The local Docker daemon could not finish pulling the new image, so the S3 integration suites require a successful GitHub CI run to confirm runtime compatibility.
