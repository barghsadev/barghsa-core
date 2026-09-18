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
business files at their original keys. The worker classifies only unclaimed
upload reservations after their URL expires and the 65-minute safety window
passes. It locks the removed, unsigned record, tags eligible versions and
records the result before clearing cleanup intent. Objects then expire by
bucket age, rather than being deleted at classification time. A failed tagging
or database completion keeps retryable intent. Active uploads, signed records
and held versions are excluded. Missing tags are treated as unclassified until
this trusted workflow explicitly opts a version into expiry.

The provider enumerates exact-key versions, preserves other tags, and retains
any existing legal-hold value other than false. Preview generation and document
supersession must call the same version-aware classification operation only
after their owning business workflow proves the object disposable. Those
future document consumers remain unbuilt and are not verified by this repair.

An object tag is an application retention signal, not S3 Object Lock. Tagging
is a read/modify/write operation: independent manual hold changes must not race
the worker. A future application hold workflow must share the record lock;
use provider Object Lock when an independent legal-hold authority needs to
prevent physical deletion. Direct delete permissions and immutable business
copies remain separate controls. A bucket-wide custom expiry can defeat these
filters and must not coexist with a hold promise. For a configured key prefix,
pass its exact value using `--prefix tenant/`; no slash is added automatically.

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
