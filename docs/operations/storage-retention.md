# Storage retention

`pnpm setup:bucket --bucket <name>` enables versioning and replaces the target
bucket's lifecycle policy. The command uses the S3 environment variables listed
by `pnpm setup:bucket --help`. Review existing custom rules before applying it.
This audit has not applied the policy to a deployed bucket.

Expiry requires both the exact prefix and an explicit object-version tag
`legal-hold=false`: `tmp/` and `uploads/` after 1 day, `previews/` after 7 days,
and `superseded/` after 90 days. Noncurrent expiry keeps the five newest
noncurrent versions. Incomplete multipart uploads are aborted after 1 day.
Held and unclassified versions are retained. No archive transition is imposed.

The previous policy expired every object in these prefixes. Its separate legal
hold transition could not override expiry. Deploying this code does not change
an existing bucket policy. Inspect deployed rules and reconcile them before
relying on this protection. Policy changes also require provider propagation.

Do not bulk-tag existing uploads as disposable. Some recorded uploads remain
business files at their original keys. The application has not yet implemented
a complete version-aware retention classifier. Existing untagged objects stay
retained under the repaired policy; abandoned upload cleanup continues through
the database-backed worker. Retention automation remains an open audit item.

An object tag is an application retention signal, not S3 Object Lock. Direct
delete permissions, bucket policy, version-specific holds and immutable business
copies remain separate controls. Any future classifier must preserve every
held version, use durable business state, and exclude signed or referenced
files. A bucket-wide custom expiry can defeat these filters and must not coexist
with a hold promise. For a configured storage key prefix, lifecycle paths must
match the full physical key; the default setup uses the four root prefixes.

For MinIO, pass `--backend minio`. Its lifecycle API rejects the S3 multipart
abort action. The command applies the four expiry rules and reports that
multipart cleanup requires separate server configuration. The local Compose
service sets `MINIO_API_STALE_UPLOADS_EXPIRY=24h` and
`MINIO_API_STALE_UPLOADS_CLEANUP_INTERVAL=1h`. Verify those settings on every
deployed server; bucket setup cannot configure them. A completed local setup
does not prove deployed cleanup or elapsed-day expiry.

References: [AWS lifecycle conflicts](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-conflicts.html),
[MinIO S3 compatibility](https://docs.min.io/aistor/developers/s3-api-compatibility/).

## Direct upload immutability rollout

New presigned PUT URLs require a signed `If-None-Match: *` header. The three
application upload helpers send it; the presign response also lists the required
header for other clients. An existing object returns412, and stripping or
changing the condition invalidates the signature. A retry after a completed
upload must verify the existing result or request a fresh upload key.

Ship the upload helpers and API/provider together. Allow `If-None-Match` in
the bucket CORS configuration alongside Content-Type for approved origins.
Drain old API writers and wait at least the previous maximum PUT URL lifetime
of one hour before relying on this guarantee for existing original uploads.
Old URLs remain usable until expiration. Do not delete signed originals: a
delete marker would allow a conditional create at that key again. Existing
sealed business copies remain the canonical objects for their own workflows.
Privileged server credentials can still overwrite objects; this repair closes
the browser URL replay path, not provider-level administrative mutation.
