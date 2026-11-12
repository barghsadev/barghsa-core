# Supply-chain checks

The required GitHub check is `Verify monorepo integrity`. It requires successful build and application checks, tests, static analysis, secret scanning, runtime image scanning and the coverage job. A cancelled, skipped or failed job blocks the check. The Actions run summary shows all six results with the source SHA, test mode and license enforcement mode. Full CI enforces combined source coverage, and fast CI records its limited scope. The application checks also validate the dependency audit report and refuse high or critical advisories. Keep the lockfile frozen and use the scan artifacts when diagnosing a failure.

Static analysis, secret scanning and image scanning run independently of the application checks and tests. The API integration and browser fixtures use compiled outputs, so their builds run before those suites. Required source coverage and the complete browser matrix are verified for the frozen release candidate. Domain review and package-specific approval remain part of release acceptance.

Semgrep checks production app, worker and shared source for direct request data in SQL text, outbound URLs and redirects, unsafe HTML, and literal credentials. The SQL rule includes typed Nest request parameters and Drizzle `sql.raw`. Keep values bound through Drizzle's SQL templates or driver placeholders. The rules do not replace review of cross-file data flows or dynamically chosen identifiers.

The shared ESLint configuration requires static SQL text at Drizzle `sql.raw` and PostgreSQL `query` calls. It recognizes literal text, compositions of literals and local constants, and choices between static statements. Bind runtime values with the Drizzle SQL tag or PostgreSQL placeholders.

The PostgreSQL rule records exact source digests for reviewed query builders,
driver adapters and shared fragments. A source change invalidates its digest.
Review the changed SQL text and its inputs before renewing an entry. Remove the
entry when the file no longer requires review. The rule checks query syntax and
known aliases. Follow imported fragments, data flows and migration SQL in source
review.

Gitleaks scans all Git history and verifies its own redaction with a synthetic credential. Its reports must never contain recovered secrets. When changing web build inputs, scan the built frontend separately for unintentionally embedded credentials.

Trivy scans the actual API/worker, web, ClamAV, and PostgreSQL backup images built from the checked source. The reports retain all severities and record the exact local image ID. The same package inventory produces a CycloneDX SBOM for each image; its image ID and checksum are verified before upload. Scanner errors, missing inventory and high or critical vulnerabilities fail the check. Before promoting a release, scan the exact immutable images that will be deployed; a rebuild from the same commit can resolve different base layers.

Triage medium findings within the current sprint. Record the affected component, production reachability, owner and remediation date. Resolve high and critical findings with a credible production path before release. An accepted risk needs explicit approval with a reason, a compensating control and an expiry.

## SQL text review

The v0.6.0 review at `f7782888` inventoried 3,926 query, execution and raw
SQL call candidates across 1,920 JavaScript and TypeScript source files. It
traced computed text in the API, worker, shared code and database adapter.
It also covered SQL executed by migrations and the backup and restore tools.
The board records the reviewed source and the focused test receipts.

Keep request values and stored business data in PostgreSQL parameters.
Keep SQL identifiers and operators in source-controlled mappings. The review
verified closed sort and column mappings, fixed lock modes, locally generated
placeholder indexes and SQL fragments composed from source literals. The
transaction pool and driver wrapper forward text and values together. Their
extra queries use a bound trace context and validated numeric timeouts.
[node-postgres query parameters](https://node-postgres.com/features/queries).

The migration review checked PostgreSQL `%I` quoting for dynamic identifiers,
`USING` for rate-limit arguments and literal receipt backfill statements.
Configuration backup and restore use a fixed table inventory and load the
restored JSON through `COPY` data framing. Repeat the data-flow review for
new SQL text builders, driver forwarding or migration execution paths.

## Dependency license review

The release specification allows MIT, Apache-2.0, ISC, BSD-2-Clause and BSD-3-Clause. Resolve compound expressions against that list: DOMPurify offers Apache-2.0 as an alternative. A package manifest alone does not establish how its license obligations are met. Review the exact shipped version and retain any required notices.

CI inventories the packages in both browser builds and the four immutable runtime images. The license check verifies both shells' font files and notice bytes, including the Apache notice used for the pinned DOMPurify version. An unrecognized compound expression or missing license is listed for review. The report is part of the runtime image scan artifact.

Ordinary direct-main pushes publish pending decisions while the license review is open. Pull requests and manually dispatched CI runs fail on any unapproved component. Run that strict check for the final release candidate before recording acceptance. Each exception in `deploy/licenses/release-approvals.json` requires an exact package URL, inventory scope and observed license set, plus the reviewer, approval reference and conditions. Confirm that every recorded condition is met by the distributed images, including source availability where applicable.

The v0.5 staging image and the built web shells identified the following concrete exceptions to review before launch:

| Shipped dependency                                                    | Declared license                          | Use                                                                            |
| --------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------ |
| `vazirmatn` and `@fontsource-variable/inter`                          | OFL / OFL-1.1                             | Persian and English fonts in the browser; Vazirmatn also renders contract PDFs |
| `@img/sharp-libvips-linux-x64` and `@img/sharp-libvips-linuxmusl-x64` | LGPL-3.0-or-later                         | Native image processing in the API image                                       |
| `nodemailer`, `tslib`, `isexe` 3.x and `argparse`                     | MIT-0, 0BSD, BlueOak-1.0.0 and Python-2.0 | Email and packaged runtime support                                             |

Prefer package-specific review and approval over widening the license allowlist globally. The dependency inventory also includes packages used only during builds and platform-specific copies. Check the exact Linux images and built frontend before deciding which exceptions apply.

The [package review](release-license-review.md) records the exact versions, notices and open decisions. The owner approved removing GeoLite2; the session list uses its [unavailable fallback](session-location.md).
