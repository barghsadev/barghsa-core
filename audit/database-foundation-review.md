# Database foundation review

Scope: canonical tasks T-02.01.01 through T-02.03.04 in 01-platform-infrastructure.md. This is an in-progress evidence review, not a completion certificate for the full database story.

## Confirmed query cancellation defect and repair

The wrapper called cancel on the active pg Client. The installed driver's cancellation method connects a new protocol socket on its receiver, so using the query client corrupted the existing protocol stream. A real PostgreSQL reproduction returned 08P01 instead of query-cancelled 57014. The wrapper also captured the running query before a newly queued query, so a queued timeout could target unrelated work.

Cancellation now uses a separate short-lived connection, bound to the original query identity. It rechecks that identity when the cancellation connection opens, closes its socket on completion or after a bounded deadline, and handles transport errors. A timed-out queued query is removed and rejected without cancelling the running query. Application pools use the driver's default non-pipelined mode. Cancellation transport still depends on the configured endpoint's support; this review does not certify a live TLS/PgBouncer deployment or network-partition recovery. Existing server statement_timeout remains the fallback.

Four real PostgreSQL tests verify running Promise cancellation, callback cancellation exactly once, queued-query isolation, connection reuse and rollback without committing prior writes. The final focused run passed 19 tests. The earlier full database suite passed 623 tests in 83 files before the fourth transaction case was added; application database code did not change afterward. Database types and targeted lint passed after correcting a test-only overload error. Mock cancellation assertions that had endorsed the broken protocol use were replaced by real database cases; timer cleanup tests now inspect pending timers.

A broader API run passed 3171 assertions but failed with an unhandled 57P01 during contract-template fixture teardown. Pool shutdown can finish before PostgreSQL observes its final socket close. That fixture now waits until its database has zero sessions, then drops without FORCE. Its four checks, API types and targeted lint pass. An initial teardown assertion used a test-only polling helper in afterAll; it was corrected to the lifecycle-compatible wait helper. A prematurely launched broader run was interrupted and supplies no evidence. The final full API rerun passed all 3171 tests in 239 files, with exit status zero and no unhandled errors.

## Acceptance gaps still under review

- Pool startup currently applies one 30-second statement timeout. The story requires different read/write defaults, 10 and 30 seconds. No general classification or per-query implementation was found.
- dbHealth returns after five seconds with pool statistics, but its Promise.race does not itself cancel the underlying query or acquisition. Its negative-path resource behavior needs a real-pool check.
- Custom types define UUIDv7, timestamptz, bigint IRR, numeric(20,6) and tstzrange. Existing tests verify these declarations. The range builder requires per-column database checks; it is not itself universal enforcement.
- Base columns have an ORM timestamp hook. Many production tables have individual timestamp triggers, but the universal modify_updated_at contract and coverage of every domain table are not yet established.
- UUID migration uses millisecond time plus random bits. Same-millisecond UUID values are not strictly monotonic. Existing tests cover version, variant, time prefix and uniqueness; concurrent production-baseline evidence should be recorded separately.
- ADR 001 still describes some timestamp triggers as future work and links historical migration paths. Review it against the production baseline before certifying all column-convention claims.
- Migration generation targets drizzle/production and excludes schema tests. Clean/upgrade tests passed in the database suite. Live backup/restore and rollout remain operational requirements outside these local checks.

## Task ledger checkpoint

At 6c435c4, T-02.01.01, T-02.01.03 and T-02.02.01 are acceptance_verified for their specific package, cancellation/logging and type-definition requirements. T-02.01.02 and T-02.01.04 remain partial for the stated timeout-default and health-resource gaps. Both real slow-query logging cases pass; the latest focused run has 28 tests. The remaining foundation tasks are still under review.

## Health-probe resource repair

A real exhausted pool reproduced a health response after five seconds with one probe still queued. Health checks now decline to queue behind a saturated application pool. Concurrent callers share one probe and its deadline until its underlying work settles. A late checkout is released without running expired SQL; an active query gets a separate cancellation deadline using the reviewed cancellation helper.

Four real-pool checks cover healthy statistics, saturation, twenty concurrent callers sharing one stalled query, server cancellation followed by an idle reusable connection, and late acquisition without executing SELECT 1. The final full database suite passes 627 tests in 84 files. Real HTTP checks pass for twenty concurrent readiness requests with PostgreSQL status and pool statistics. Database/API types and targeted lint pass after correcting test-only optional-environment and unknown-JSON typing errors. The initial red test needed a timeout longer than the required five-second probe deadline; its corrected run reproduced the queued work directly. Older mock-only health tests were replaced with these resource-level checks.

A cancellation-network failure still relies on the configured server timeout and connection-acquisition timeout. Concurrent probes cannot accumulate additional work while that first attempt settles. Live proxy/network outage behavior is not certified.


## Preserve connection startup options

Real PostgreSQL tests reproduced two URL-construction errors. Appending a second options parameter discarded the configured search_path and application_name. Appending after a URL fragment left statement, lock and idle-transaction timeouts at zero. The builder now parses the URL, keeps the driver's effective last options value, appends the configured guards within that value and writes one options parameter before any fragment. Existing credentials and unrelated URL fields remain intact.

Three regression cases pass, including actual server setting readback, server-side cancellation and connection reuse. The focused connection/cancellation suite passes 21 tests; database typechecking and explicit lint pass. This repair does not add the still-missing distinct ten-second read and thirty-second write defaults.
