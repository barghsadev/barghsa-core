# Storage retention

`pnpm setup:bucket --bucket <name>` enables versioning and replaces the target
bucket's lifecycle policy. The command uses the S3 environment variables listed
by `pnpm setup:bucket --help`. Review existing custom rules before applying it.
Staging now has versioning and the exact standard tagged lifecycle policy.
The October 12 preflight confirmed the versioned application configuration
matches the tested provider. Disposable live objects proved distinct versions,
hold-aware classification, refused deletion while held, and exact-version
cleanup after releasing the synthetic hold. An isolated bucket first verified
policy compatibility. These receipts certify provider operations and policy
readback, not elapsed-day expiration or a complete business destruction manifest.
The current evidence is recorded under v0.4.0 in `kanban/board.json`.

Expiry requires both the exact prefix and an explicit object-version tag
`legal-hold=false`: `tmp/` and `uploads/` after 1 day, `previews/` after 7 days,
and `superseded/` after 90 days. Noncurrent expiry keeps the five newest
noncurrent versions. S3 aborts incomplete multipart uploads after 7 days as a
safety net for the worker described below.
Held and unclassified versions are retained. No archive transition is imposed.

The previous policy expired every object in these prefixes. Its separate legal
hold transition could not override expiry. Deploying this code does not change
an existing bucket policy. Inspect deployed rules and reconcile them before
relying on this protection. Policy changes also require provider propagation.

Do not bulk-tag existing uploads as disposable. Some recorded uploads remain
business files at their original keys. The worker classifies only unclaimed
upload reservations after their URL expires and the 65-minute safety window
passes. The worker commits `cleanup_operation='expire'` on the removed,
unsigned record before tagging eligible versions. Explicit removal of other
eligible objects commits `cleanup_operation='delete'` before requesting a
delete marker. The worker holds the same per-key advisory lock used for
multipart operations. Provider I/O runs after the row transaction commits.

The database keeps a claimed key removed and unsigned, including after the
worker records success. A copy must have an unclaimed reservation before it
writes bytes. A provider failure or lost completion receipt keeps the original
operation eligible for retry after the existing one-minute backoff. Expired
upload versions follow the bucket age rule. Active uploads, signed records and
held versions are excluded. Missing tags remain unclassified until this
workflow marks an eligible version.

Apply migration `0288_storage_cleanup_operation_claim` before starting the
updated API and worker. Keep the migration applied when reverting binaries.
Drain the existing cleanup worker before switching versions. Older workers
use row locks and cannot coordinate with the per-key advisory lock. Before
restarting an older worker or upload promotion code, reconcile rows with a
`cleanup_operation` and `metadata.deletionRequested=true` using the updated
worker. Keep their claims as the record of the cleanup decision.

Staff signing checks that the stored object exists between two short database
transactions. It checks staff permission and step-up again before signing,
and requires the same record and revision. Concurrent removal or edits require
the staff member to reload the record. Repeating a completed signature returns
the existing signature without writing another audit event.

The provider enumerates exact-key versions, preserves other tags, and retains
any existing legal-hold value other than false. Preview generation and document
supersession must call the same version-aware classification operation only
after their owning business workflow proves the object disposable. Those
document consumers are separate from the retention policy described below.

An object tag is an application retention signal, not S3 Object Lock. Tagging
is a read/modify/write operation: independent manual hold changes must not race
the worker. The approved destruction worker checks database holds under row
locks before committing destruction intent. Use provider Object Lock when an independent
legal-hold authority needs to prevent physical deletion. Direct delete
permissions and immutable business copies remain separate controls. A
bucket-wide custom expiry can defeat these
filters and must not coexist with a hold promise. For a configured key prefix,
pass its exact value using `--prefix tenant/`; no slash is added automatically.

For MinIO, pass `--backend minio`. Its lifecycle API rejects the S3 multipart
abort action. The command applies the four expiry rules and reports that
multipart cleanup requires separate server configuration. The local Compose
service sets `MINIO_API_STALE_UPLOADS_EXPIRY=168h` and
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

## Multipart uploads and orphan cleanup

Files larger than 5 MiB use presigned multipart parts. The authenticated API
reserves a scoped key, starts the provider upload and issues 15-minute part URLs.
The client can list provider-confirmed parts and resume after an interrupted
transfer. Completion accepts only the server-listed consecutive parts matching
the originally authorized file size. The completed object still passes normal
content inspection, scan and recording before it can be attached. Multipart
reservations expire after 24 hours; abort and completion are idempotent.

The worker lists in-progress provider uploads hourly. By default it aborts
uploads older than 24 hours, with a bounded scan and a durable cursor so later
pages are visited. Storage administrators can change the age from 1 to 168
hours under Storage settings; changes require step-up and are audited. Outcomes
are stored in `upload_cleanup_log`, and failed provider aborts are retried on a
later scan. An invalid saved cleanup age stops the worker's cleanup pass before
provider calls. Storage settings shows the paused state and lets an authorized
administrator save a valid age against the current policy version.
Reapply `pnpm setup:bucket` to install the seven-day S3 fallback
after reviewing deployed custom rules. MinIO uses its separate stale-upload
server settings; bucket setup cannot install the S3 abort rule there.

Multipart initialization, completion and abort commit their intent before S3
requests. A separate direct PostgreSQL pool owns the object’s advisory lock while the
request runs. The API and cleanup worker use the same lock. Their SQL transactions
finish before provider I/O. Business-document creation commits the document and
idempotent upload descriptor before initializing S3.

The reservation keeps `starting`, `completing` or `aborting` until that operation
finishes. Completion stores consecutive part identities and sizes. A retry can
refresh that receipt from valid provider parts, or reconcile an object whose
completion response was lost. Parts reads stay read-only. The client resumes a
pending completion through POST. Trusted recording requires completed multipart
state and the usual content, integrity and scan checks.

Cleanup resumes committed completions and aborts, including after the reservation
expires. Expiry still prevents attaching the file. Object-retention cleanup waits
for the multipart outcome. Finalization restores the cleanup flag so a later
completed object receives a fresh lifecycle classification. Provider failures retain the intent and a bounded
`lastErrorCode` under `storage_records.metadata.multipart`. The
`multipart_orphan_cleanup` background job records failed passes. Check those
records when investigating a stalled upload.

Orphan classification writes a `pending` row in `upload_cleanup_log` before
aborting S3. Pending and failed receipts remain eligible for retry even when the
provider no longer lists the upload. Signed, active and completed files stay
protected from orphan classification. A changed age policy applies to new
classifications. The owner can explicitly discard an interrupted completion
before trusted recording. This requires the same object lock and commits abort
intent. A running completion or a finalized completed upload rejects that abort.

Apply migration `0287_multipart_operation_recovery` before starting these
binaries. It adds pending cleanup status and recovery indexes. Before restoring
older binaries, drain pending operations where possible. Retain the additive
migration and pending records, and use a worker with this recovery handler to
finish interrupted operations.

Legal profile documents, branding images and conversation avatars prepare their
private copies between short authorization and publication transactions. The
copy reservation commits before upload. The worker and API serialize provider
operations for the reserved key with the same advisory lock. Publication
rechecks the upload revision and scan, the caller’s current authority and the
business revision before recording the immutable copy alongside the business
change and audit. A rejected or interrupted save leaves its unpublished copy
eligible for cleanup after the grace period.

Ticket creation and replies check the original request receipt before copying.
Requests with a replay key hold an advisory lock on the direct connection while
the copy is prepared. Other requests with that key wait for the receipt. The
ticket, profile and staff permission locks are acquired again for publication.
If ownership, assignment or ticket state changes during upload, the next
transaction applies the current rules and leaves rejected copies for cleanup.

Identity corrections, profile verification and lost-contact recovery use the
same provisional copy workflow. Publication rechecks the current staff grant
and step-up, the target identity or recovery authorization, and any applicable
verification policy. Evidence stays in the submitted order. A rejected save
keeps its private copies eligible for cleanup and leaves the case and audit
unchanged.

Business document confirmation commits `PendingScan` before inspecting the
upload. A keyed retry can resume the same confirmation. The provider copy
runs outside the document transaction. Publication rechecks the original
uploader, current profile and contract authority, the document and source
revisions, and any predecessor before it records the immutable object and
queues a configured document scan. A failed confirmation leaves `PendingScan` and
its cleanup receipt available for recovery.

Invoice and wallet bank receipts share an attachment advisory lock. They check
the current upload, review and available quota before reading storage. The
final transaction checks them again and charges the quota when it records the
receipt, attachment claim and audit. A retry of a committed receipt returns
its original copy. An interrupted copy remains private and may be reused until
cleanup claims it.

Contract template uploads commit the storage reservation before writing bytes.
The per-key advisory lock keeps cleanup from removing the file during the write.
Publication checks current staff authority and step-up, then locks the template
to allocate the next version. The immutable file, version and audit commit
together. A failed publication leaves its private reservation for cleanup.

Electricity order reviews read template bytes after committing the source
lookup. When an order uses a template, the API reserves the contract number
from the existing sequence and prepares both PDF objects before publication.
The final transaction checks current authority, pricing and template terms
again, then records the order, contract, invoice, PDF and scan state together.
An exact retry returns the recorded order without copying the PDF again.

Solar contract reviews fetch the selected template or uploaded document after
committing the source lookup. Issuance prepares the original and immutable copy
under committed cleanup reservations. The final transaction checks staff
authority, the selected source and the confirmed financial review again before
publishing the contract, invoice, document, scan state and audit together.
Exact retries reuse the recorded receipt.

## Upload inspection and scan state

Reservations record `Uploading`. Successful content inspection records provider
metadata and a durable `Pending scan` timestamp. Canonical business-document
confirmation seals the inspected bytes and creates a `PendingScan` document and
durable worker job when ClamAV is configured. A verified clean verdict makes that
document `Available`; infected files enter quarantine. Scanner errors retain
`PendingScan`, the failed attempt and a future retry deadline. Downloads remain
blocked until the document is available. Repeated verification does not reset it.

Generic storage-upload recording uses `Available` with `not_configured` metadata
as an intermediate byte-inspection result. This metadata is not a ClamAV verdict
and does not make its canonical document available. Consumers must use the
document's state and scan result for that decision. If the canonical document
scanner itself is unconfigured, its explicit fallback permits availability and
records why scanning was skipped; it does not claim a clean scan.

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

Financial, contractual and signed-document bytes are permanently retained,
including after removal and parent closure. Migration0272 enforces this policy
in eligibility, destruction and byte-clearing guards. Retention deadlines and
legal approval authorize destruction only for other eligible document types.

The release policy defaults to ten years for canonical audit, security and
financial evidence. The application has no automatic expiry for these
records. Log, metric and trace retention settings apply to operational data.
Document destruction uses its own eligibility and approval workflow.

Migration `0292_financial_evidence_retention` protects wallet ledger entries,
issued invoices, bank receipts and provider callbacks from hard deletion.
It keeps receipt status events append-only and rejects bulk truncation of
the protected finance tables, including refund history. Unissued drafts
with no payment or refund remain eligible for removal. Current application
writers can append receipts, advance states and post compensating entries.
When an actor account is deleted, the existing foreign key clears its
reference in receipt history. The event, actor type, reason and timestamp
remain intact. Direct updates to a retained event are rejected.
Apply the migration before traffic and retain it during binary rollback.
The production backup and recovery gate verifies the separate durability
of retained evidence.

The worker plans up to 25 eligible removed documents during its nightly 02:00
UTC window. It records an audit manifest and leaves every object untouched
until legal staff approve that specific manifest, with step-up verification and
a reason in the admin document workspace. The workspace shows queue counts,
approval state and retry status. A later nightly pass handles up to 25 approved
items; a newly active hold or changed policy cancels an unstarted approval and
requires a fresh manifest.

Standalone retention starts at removal. For unlinked, rejected or cancelled
solar requests it starts at the later of removal and request closure. The
current policy version supplies the retention years. A policy change
invalidates an unstarted approval.

The worker commits `destroying` before touching storage. New direct and profile
holds and policy changes for that record type are rejected while destruction
is in progress. A solar request cannot gain a contract link once destruction
of one of its documents starts. A session advisory lock on the manifest keeps
workers from processing it concurrently. With the database transaction
closed, the worker removes exact-key versions and delete markers for the sealed
copy and the original upload. A provider-held version blocks deletion. Missing
versions are safe to retry. A final transaction verifies the manifest and
clears file names, MIME types, checksums and storage metadata. It keeps the
document identity and history and records a destruction event. The worker
retries partially completed storage work from the durable manifest. Direct S3
deletes outside this workflow remain a separate administrative control.

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
