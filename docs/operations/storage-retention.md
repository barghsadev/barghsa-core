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
document consumers are separate from the retention policy described below.

An object tag is an application retention signal, not S3 Object Lock. Tagging
is a read/modify/write operation: independent manual hold changes must not race
the worker. The document legal-hold workflow below does not yet coordinate with
object tagging; the future destruction worker must check holds under a record
lock before any delete. Use provider Object Lock when an independent legal-hold
authority needs to prevent physical deletion. Direct delete permissions and immutable business
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

## Upload inspection and scan state

Reservations record `Uploading`. Successful content inspection records provider
metadata and a durable `Pending scan` timestamp. With ClamAV configured, a
verified clean verdict moves the upload to `Available`; infected files enter
quarantine. Scanner errors leave the file pending for retry. Without a configured
scanner, the explicit `not_configured` fallback is recorded. It is not a
clean-file claim. Repeated verification does not reset an available file.

## Document policy and legal hold

The `document_retention_policies` table starts with 10-year terms for contracts,
invoices, payments, refunds and signed documents, and 5-year terms for other
document types. A legal staff member with document-edit permission, a fresh
step-up and a legal approval note can append a new effective policy version in
the admin document workspace. Earlier versions remain for audit.

Legal staff can create document-specific or profile-wide holds with a reason and
optional expiry, and release them with a recorded reason. The holds are retained
after release; their scope and reason cannot be edited. The `document_is_held`
database predicate checks active direct and profile holds plus the current
record-type policy hold. The admin workspace shows this result beside each
document.

## Approved document destruction

The worker plans up to 25 eligible removed documents during its nightly 02:00
UTC window. It records an audit manifest and leaves every object untouched
until legal staff approve that specific manifest, with step-up verification and
a reason in the admin document workspace. The workspace shows queue counts,
approval state and retry status. A later nightly pass handles up to 25 approved
items; a newly active hold or changed policy cancels an unstarted approval and
requires a fresh manifest.

Retention starts at the later of document removal and parent closure. Current
closure signals are completed/cancelled/rejected contracts, paid/cancelled/refunded
invoices, terminal electricity or saving orders, cancelled generic orders,
rejected/cancelled solar requests and solar requests whose linked contract has
completed or been cancelled. Standalone uploads start at removal. Other parent
states have no destruction deadline and are retained. The current policy version supplies the retention years; a
policy change invalidates an unstarted approval.

The worker records `destroying` before touching storage. New direct/profile
holds and policy changes for that record type are rejected while destruction
is in progress; they cannot restore an already deleted version. With the
profile and document locked, the worker removes every exact-key version and
delete marker for the sealed copy and the original upload. A provider-held
version blocks the operation. Missing versions are safe to retry. On success,
the worker clears file names, MIME types, checksums and storage metadata, keeps
the document identity and history as a minimal audit trail, and records a
destruction event. It retries partially completed storage work from the
durable manifest. Direct S3 deletes outside this workflow remain a separate
administrative control.

## Upload association

The browser supplies purpose and profile when requesting the upload URL. The
API checks staff permissions or current profile access before reserving storage,
binds that context to the reservation, and checks it again before recording the
inspected object. A reserved purpose or profile cannot be changed. Legacy
unscoped reservations still require current authorization when recorded.
Branding and knowledge-base uploads require their respective staff permission;
identity evidence requires CRM correction authority. Bank receipts and legal
profile documents require their domain-specific profile permission. Generic
business record IDs are rejected here. Attach through the business endpoint,
which must independently authorize and lock its target record.
