# Supply-chain checks

The required GitHub check is `Verify monorepo integrity`. It fails if the build and application checks, source scan, secret scan, or runtime image scan fail, are cancelled, or are skipped. The application checks also validate the dependency audit report and refuse high or critical advisories. Keep the lockfile frozen and use the scan artifacts when diagnosing a failure.

Semgrep checks production app, worker and shared source for direct request data in SQL text, outbound URLs and redirects, unsafe HTML, and literal credentials. The SQL rule includes typed Nest request parameters and Drizzle `sql.raw`. Keep values bound through Drizzle's SQL templates or driver placeholders. The rules do not replace review of cross-file data flows or dynamically chosen identifiers.

Gitleaks scans all Git history and verifies its own redaction with a synthetic credential. Its reports must never contain recovered secrets. When changing web build inputs, scan the built frontend separately for unintentionally embedded credentials.

Trivy scans the actual API/worker, web, ClamAV, and PostgreSQL backup images built from the checked source. The reports retain all severities and record the exact local image ID. Scanner errors, missing inventory and high or critical vulnerabilities fail the check. Before promoting a release, scan the exact immutable images that will be deployed; a rebuild from the same commit can resolve different base layers.

Triage medium findings within the current sprint. Record the affected component, production reachability, owner and remediation date. Resolve high and critical findings with a credible production path before release. An accepted risk needs explicit approval with a reason, a compensating control and an expiry.

## Dependency license review

The release specification allows MIT, Apache-2.0, ISC, BSD-2-Clause and BSD-3-Clause. Resolve compound expressions against that list: DOMPurify offers Apache-2.0 as an alternative. A package manifest alone does not establish how its license obligations are met. Review the exact shipped version and retain any required notices.

The v0.5 staging image and the built web shells identified the following concrete exceptions to review before launch:

| Shipped dependency                                                    | Declared license                          | Use                                                                            |
| --------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------ |
| `vazirmatn` and `@fontsource-variable/inter`                          | OFL / OFL-1.1                             | Persian and English fonts in the browser; Vazirmatn also renders contract PDFs |
| `@img/sharp-libvips-linux-x64` and `@img/sharp-libvips-linuxmusl-x64` | LGPL-3.0-or-later                         | Native image processing in the API image                                       |
| `nodemailer`, `tslib`, `isexe` 3.x and `argparse`                     | MIT-0, 0BSD, BlueOak-1.0.0 and Python-2.0 | Email and packaged runtime support                                             |

Prefer package-specific review and approval over widening the license allowlist globally. The dependency inventory also includes packages used only during builds and platform-specific copies. Check the exact Linux images and built frontend before deciding which exceptions apply.

The [package review](release-license-review.md) records the exact versions, notices and open decisions. The owner approved removing GeoLite2; the session list uses its [unavailable fallback](session-location.md).
