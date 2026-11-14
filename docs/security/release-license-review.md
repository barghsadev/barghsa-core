# v0.6.0 package-specific license review

This is the owner-requested review packet. It proposes specific dispositions against the existing MIT, Apache-2.0, ISC, BSD-2-Clause and BSD-3-Clause allowlist. The GeoLite2 fallback is owner approved. All other package exceptions still need approval.

## Staging PostgreSQL supplement

The five-image preflight at `212cb619` adds the Ubuntu `postgres-staging`
scope. The original 594 package rows match the earlier packet by scope,
package URL, reported licenses, locations and disposition. The fifth scope
adds 241 rows, of which 217 require review. The two packets therefore contain
387 pending dispositions. The supplement includes exact versions, source
package metadata and notice locations. Bind sign-off to the final image and
the applicable distribution conditions. [Five-image preflight](https://github.com/barghsadev/barghsa-core/actions/runs/43143811872)

The consolidated reviewer workbook matches all 387 entries to the exact
package URLs, scopes and observed license sets from `e6da94c9`. Its packet
includes the full scanner inventory, image IDs, per-package evidence and
available notices. Where the scanner found no license, the package stays in
the review list and the underlying inventory retains the empty license set.
[Matching preflight inventory](https://github.com/barghsadev/barghsa-core/actions/runs/43157243591)

The `40ac6449` preflight added twelve permitted runtime entries and identified
`transport@0.0.1` in Pino's published test fixture in both application package
trees. The fixture has no license metadata. The production build now removes
that directory from both trees before copying the runtime layers. The rebuilt
application SBOM retains Pino and omits the fixture. The existing 387 review
entries still require their named dispositions and final candidate checks.
[Application image verification](https://github.com/barghsadev/barghsa-core/actions/runs/43170460090)

The image job at `736bcb0c` reported 848 package and scope entries. The 387
pending entries match the reviewer workbook by scope, exact package URL,
observed licenses and installation location. The other 461 entries pass the
current allowlist. The report SHA-256 is
`20cff858e60c357c84d1dacb1139b4916b83c6d51284240d1a9c909ec572376d`.
[Earlier image inventory](https://github.com/barghsadev/barghsa-core/actions/runs/43286083146)

The report-only image job at `c0487559` records 387 pending entries. Use the
refreshed workbook for decisions. It includes `libc-bin`, `libc6` and
`locales` at `2.39-0ubuntu8.12` in the staging PostgreSQL image. The signed
Ubuntu indices verify the exact package and source archives, and the review
packet includes the notices extracted from those packages. The report SHA-256
is `b304ae4006e1f5eab3c70a33b7e7f1c277d426a0c2b696e43f251b3cc1312d95`.
Named dispositions and the strict check on the final immutable images are
required for release.
[Hosted image inventory](https://github.com/barghsadev/barghsa-core/actions/runs/43299081923) · [Ubuntu source archive](https://security.ubuntu.com/ubuntu/pool/main/g/glibc/glibc_2.39-0ubuntu8.12.dsc)

The retained Linux amd64 PostgreSQL image `dbb54d6c8c53` contains readable
notices for all 217 entries awaiting review. The readback matched 216 binary
packages by version, epoch and architecture and verified pgvector 0.8.6
through its extension control file. The supplement records the full installed
Debian source versions for 196 rows where the workbook lists the upstream
version, and includes 144 distinct notice files. Nine GnuPG notices point to
`GPL-2.0` and the gzip notice points to `GFDL-3`. The image contains the
specified versions under `GPL-2` and `GFDL-1.3`, respectively. The receipt
records both sets of paths and the texts' checksums for review. Repeat the
readback on the final release image and verify how the approved notices will
accompany distribution.

## Web telemetry supplement

The hosted image job at `b11f41263` produced five image-bound reports. Its
848 package and scope entries match the refreshed `c0487559` inventory by
scope, package URL, observed license set, location and disposition. The
report SHA-256 is
`5c79a3829905120068b67ece13b76aa43a685c0d93b7467ff5e0dc928fd62fae`.
[Hosted image job](https://github.com/barghsadev/barghsa-core/actions/runs/43456360315/job/131991434894).

A subsequent Linux arm64 web fixture added 11 OpenTelemetry npm packages to
the web runtime. Their exact versions and Apache-2.0 declarations match
packages already in the hosted application image inventory. The fixture's
CycloneDX SBOM identified all 11, and the original `LICENSE` file was
read back from every installed package. Each of these web package entries
passes the existing allowlist. The fixture scan found one medium zlib
finding and zero high or critical findings. Its SBOM SHA-256 is
`30cdbd1c2c7387e1cff56c3fce81762a2de562d2cc6d7c4c340ac49dd6548922`.
Hosted preflight `0614369c` reproduced all 848 earlier rows on Linux amd64
and added the same 11 Apache-2.0 web packages. All five CycloneDX SBOMs and
vulnerability reports match their image receipts, with zero high or
critical findings. The report-only license inventory contains 859 rows,
including 472 allowed and the same 387 awaiting named disposition. Its
SHA-256 is
`8daf77014ddbdd918a1170609be3b881571f6c2cfc4ee355d56c86b14aceede6`.
Read back the installed notices and strict gate results on the final
immutable release images. [Hosted Linux amd64 image job](https://github.com/barghsadev/barghsa-core/actions/runs/43468289014/job/132033194129).

## Reviewer and approval

The release gate accepts named owner or legal-reviewer sign-off on exact package exceptions. The owner can provide the policy approval once the stated obligations have been verified. For GPL/LGPL source and replacement questions, the recommended reviewer is a lawyer experienced in open-source software licensing. An internal compliance lead with access to that expertise can coordinate the review. OpenChain's guidance describes access to internal or external legal expertise and assignment of review and approval responsibilities. [OpenChain resource guidance](https://openchain-project.github.io/OpenChain-KWG/en/guide/iso5230_guide/2-relevant-tasks/2-resourced/).

Record the reviewer and approver, exact package versions and image scopes, applicable license options, required notices and source or replacement conditions, and the dated disposition. Reviewer assignment and the remaining exception approvals are pending.

## Package inventory

The original review used the read-only Linux app and worker image from staging v0.5.0 at `dae51e34b4e54625dfe8b5d2b9747bc23e5c5b3c` and checked both built browser shells. The first complete CI inventory at `3732c1ad143e6a216ed29cae76c7fc4ec5a0412f` adds the exact OS, scanner and database packages. Its `release-licenses.json` records 594 package and distribution-scope entries. It flags 161 Alpine entries for 133 distinct package URLs, nine npm entries and four Go entries. The four Go entries have exact upstream notice evidence as described below. Recheck the final v0.6.0 images and browser assets before publishing. Base image changes can affect shipped binaries independently of the npm lockfile. [CI inventory and image receipts](https://github.com/barghsadev/barghsa-core/actions/runs/42638068584).

| Exact package or asset                                                                         | Observed use and notices                                                                                                                                                      | Recommendation for review                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vazirmatn@33.0.3`; Arabic and Latin WOFF2 subsets from `@fontsource-variable/vazirmatn@5.3.0` | Contract PDF fonts in the API package include `OFL.txt` and `AUTHORS.txt`. Both web shells serve the two unmodified, pinned Fontsource subsets with the original OFL notice.  | Review the exact PDF and browser font copies. Verify the notice in the final web image.                                                                                                |
| `@fontsource-variable/inter@5.3.0`                                                             | Both web shells emit the Latin variable font from this package. Both v0.6.0 candidate web builds include the exact package OFL-1.1 notice.                                    | Approve this exact font after confirming the notice in the final web image.                                                                                                            |
| `@img/sharp-libvips-linux-x64@1.3.4` and `@img/sharp-libvips-linuxmusl-x64@1.3.4`              | The baseline API image contains both variants with `libvips-cpp.so.8.18.7`. Neither package root had a license file in that image. Sharp `0.35.5` itself declares Apache-2.0. | Verify which native variants actually ship, the notices and corresponding source for the bundled libraries, and the replacement or relinking method before approving the LGPL package. |
| `nodemailer@10.0.12`                                                                           | API and worker include the original MIT-0 notice. The repository patch changes TypeScript declarations.                                                                       | Approve this version after retaining the notice and recording the patch in the distribution inventory.                                                                                 |
| `tslib@2.8.1`                                                                                  | API and worker include the 0BSD `LICENSE.txt`.                                                                                                                                | Approve this version and retain the packaged notice.                                                                                                                                   |
| `isexe@3.1.5`                                                                                  | API and worker include the BlueOak-1.0.0 `LICENSE.md`. The API also contains `isexe@2.0.0` under already allowed ISC.                                                         | Approve only the 3.1.5 exception and include its license text or required link when conveying the package.                                                                             |
| `argparse@2.0.1`                                                                               | The API includes the original `LICENSE` declaring Python-2.0.                                                                                                                 | Approve this version if the final image retains the original license and copyright notices.                                                                                            |
| `geoip-country@5.0.202609050122`                                                               | The API image includes the IPv4/IPv6 GeoLite2 country dataset and the software/data license file. The parser code is Apache-2.0; that option does not cover the data.         | Owner approved removal and the unavailable fallback. Verify the final images exclude this package and data.                                                                            |

Both browser builds place the notices under `assets/licenses/` (under `/auth/` for the auth shell). The original bytes were also retrieved from the built app’s HTTP server.

The [SIL OFL guidance](https://openfontlicense.org/ofl-faq/) distinguishes distributing browser font files from embedding fonts in documents. Use the notice for each distributed font; the separately collected API and web Vazirmatn notice files are not byte-identical. The [Sharp installation guide](https://sharp.pixelplumbing.com/install/) describes the prebuilt native variants and the custom-library option. Review the [LGPL-3.0-or-later text](https://spdx.org/licenses/LGPL-3.0-or-later.html), the [libvips 8.18.7 source release](https://github.com/libvips/libvips/releases/tag/v8.18.7), and the [Sharp binary build source](https://github.com/lovell/sharp-libvips) together. The upstream version link alone does not establish what accompanies the bundled native files. The [Blue Oak](https://blueoakcouncil.org/license/1.0.0) and [Python-2.0](https://spdx.org/licenses/Python-2.0.html) texts are the reviewer references for those two notices.

The repository’s older Vazirmatn subsets first appeared in commit `9eac6554`. Neither matched the tested Google Fonts copies or any of the 29 published Fontsource Variable archives. The candidate uses the unmodified Arabic and Latin subsets from [Fontsource Variable Vazirmatn 5.3.0](https://www.npmjs.com/package/@fontsource-variable/vazirmatn/v/5.3.0), whose registry archive integrity is `sha512-ZA68W8JHbMdNzzwjYHUWKB2PH22QpxNEnk0ukcXM+XiqYMV6ZWJZAKuNXcrMR2JjuIAwsfAU3KknCXPI6wXUvw==`. The archive’s OFL notice matches the existing repository copy byte for byte.

The replacement files still identify themselves as Vazirmatn 33.003. The Arabic and Latin subsets retain their exact sets of 366 and 229 mapped characters and the 100–900 variable weight range. Arabic positioning and font hints differ, so the candidate requires browser layout and transfer checks. The contract PDF font comes from the separately pinned npm package.

The isolated Node Alpine app still contains both libvips variants. Its active Sharp module reports libvips 8.18.7 and the same component versions as the [signed v1.3.4 binary release](https://github.com/lovell/sharp-libvips/releases/tag/v1.3.4) at commit `ebb95f8add54eee8bed840e3fb587e4cbec857d7`. The upstream release includes [its build instructions](https://github.com/lovell/sharp-libvips/blob/v1.3.4/README.md) and a [third-party notice](https://github.com/lovell/sharp-libvips/blob/v1.3.4/THIRD-PARTY-NOTICES.md) identifying additional bundled LGPL components. The app image recipe now includes the exact upstream license and third-party notice under `/app/licenses/sharp-libvips/1.3.4/`; both original bytes were verified from an isolated image as the nonroot runtime user. Verify them again in the final distribution. Have the reviewer verify corresponding source for both binaries and how recipients can replace or relink them. Matching the component version list alone is insufficient.

Both npm archives match the lockfile integrity values. For Linux x64 glibc and
musl, the library, loader, GLib header and component version file each match
the corresponding file in the publisher's `npm-workspace.tar.xz` byte for
byte. GitHub verified the annotated tag signature and published the workspace
archive checksum. The glibc and musl Dockerfiles and the POSIX build script
come from the signed commit. The source archive's notices match the copies
shipped by the image recipe. [Publisher's release](https://github.com/lovell/sharp-libvips/releases/tag/v1.3.4).

The source packet contains the eight versioned archives named for the LGPL
components in the vendor notices, including the musl-only Linux dependency
`proxy-libintl`. It also records the three upstream patches for GLib, librsvg
and libvips, the bundled GVDB license, and the librsvg source archive's
original Cargo lockfile. The build changes the librsvg manifest and regenerates
its lockfile. To verify the complete inputs, capture the resulting dependency
resolution and check the static link inputs, source edits and other build
dependencies. Verify both installed binaries and their notices on the final
app image. The prior Alpine probe loaded a compatible replacement file.
Verify a replacement built from modified source and submit the package and
distribution conditions for reviewer sign-off. [Exact POSIX build recipe](https://github.com/lovell/sharp-libvips/blob/ebb95f8add54eee8bed840e3fb587e4cbec857d7/build/posix.sh).

The review packet also includes the publisher's glibc, musl and npm publish
logs for the signed tag. `npm audit signatures` verified the registry
signatures and provenance attestations for both locked archives. The
attestation subjects match the downloaded archives and identify that exact
build and source commit. A non-root readback of a prior isolated amd64 app
image verified both installed binaries and both notices by checksum.
[Publisher build and publish run](https://github.com/lovell/sharp-libvips/actions/runs/36315646015).

The packet retains all 28 source archives and five patches downloaded directly
by the POSIX build recipe. It also includes all 105 library build crate archives
logged for both x64 platforms. Each archive matches its checksum in the
librsvg source release lockfile. The publisher's lock update logged four
removals and zero additions. Its rewritten lockfile was not published. The
build logs identify the static archives listed in the linker visibility flags.
Use those flags as evidence of build inputs alongside the exact recipe and
crate records. Complete the compatible modified rebuild and final image
readback before accepting the package conditions.

A dry run of the production and auth builds identified 74 and 28 npm packages, respectively, with JavaScript present in emitted chunks. Only DOMPurify needed a license expression check; the separately emitted font assets are reviewed above. DOMPurify `3.4.17` declares MPL-2.0 **or** Apache-2.0. Use the already allowed Apache-2.0 option and retain the corresponding notices. Do not treat other workspace inventory entries as shipped solely because the dependency resolver lists them. Base OS and tooling notices, including Poppler and ClamAV, still need the final image inventory and distribution review.

The combined app image SBOM identified three third-party packages without a normalized license field: `busboy@1.6.0`, `png-js@2.0.0`, and `streamsearch@1.1.0`. Their original MIT license files were read from the isolated app image and matched the pinned package copies byte for byte. Internal Barghsa workspace entries without a third-party license field are first-party code.

The PostgreSQL image also ships the rebuilt `gosu` executable. Its SBOM identifies four components without normalized license metadata. The PostgreSQL build copies the original notices from the pinned Go toolchain and module cache to `/usr/local/share/licenses/gosu/`. The release check hashes all six files in the actual image before filling the missing fields for the four exact package URLs. The observed license options fall within the existing allowlist. [gosu module archive](https://proxy.golang.org/github.com/tianon/gosu/@v/v0.0.0-20261025094355-29b939aa5bd4.zip), [moby/sys/user module archive](https://proxy.golang.org/github.com/moby/sys/user/@v/v0.4.1.zip), [x/sys module archive](https://proxy.golang.org/golang.org/x/sys/@v/v0.1.0.zip), [Go toolchain license](https://github.com/golang/go/blob/go1.27.3/LICENSE), [Go patent notice](https://github.com/golang/go/blob/go1.27.3/PATENTS).

## GeoLite2 decision

The feature shows a country estimate in the signed-in user's session list. It does not decide authentication, payments, verification, permissions or device trust. [The existing session policy](session-location.md) already permits the location to display as unavailable when there is no acceptable dataset.

The September 5, 2026 package was present in the verified v0.5.0 staging image. The upstream September 9 package has a different GeoLite2 source-archive checksum, verified against the published npm tarball integrity. The current [MaxMind GeoLite EULA](https://www.maxmind.com/en/geolite/eula) requires attribution and prompt updates and describes a 30-day retirement period for outdated data. It also addresses disclosure, personal data and export controls. The project has not established which rights cover the planned operating entity and distribution, or how to meet the retirement period when old data is embedded in immutable images and retained for rollback.

On 2026-11-09 the owner approved removing the bundled data and using the existing unavailable display for v0.6.0. This decision does not approve other exceptions. A later approved source should keep data outside rollback images, preserve the local country-only lookup, and have a verified refresh and retirement procedure. No remote IP lookup is proposed.

## Acceptance evidence

The `e47415d3` scan reproduced the same 170 review entries. The accompanying `release-license-review-candidate-e47415d3-apk-evidence.json` packet matches all 161 Alpine entries to installed package metadata by exact package digest, version and architecture. It records the original license expression, upstream URL, and Alpine packaging origin and commit for 159 entries. Six entries have zero installed bytes and zero packaged files. These are the generated `.postgis-rundeps` and `.postgresql-rundeps` records and the upstream `ncurses-libs`, `gnupg`, `pyc` and `python3-pyc` records. Their dependencies are inventoried separately. Review their disposition with the package list. [Exact CI inventory and image receipts](https://github.com/barghsadev/barghsa-core/actions/runs/42647680762).

The `42d2c407` preflight inventory contains 594 entries. All 170 review entries match the prepared packet by distribution scope, exact package URL and observed licenses. The other 424 entries pass the existing allowlist, and the inventory contains no GeoLite2 dataset package. The CI artifact records the four built image IDs and their scan receipts. Package-specific approval and verification against the final release images remain pending. [Current inventory and image receipts](https://github.com/barghsadev/barghsa-core/actions/runs/42701427330).

The strict image gate at `bf48f69f42e83998689f681968b4f6b33037c4ca` failed at “Check shipped component licenses” after building and scanning all four images. Its 594 entries match the previous strict inventory by package URL, distribution scope, reported license and disposition. The 170 entries requiring review are ready for a package-specific decision. The SHA-256 of `release-licenses.json` is `5449e265f2cf89ec932aabe6be06e8f053593e3d4224075fbb3360550f15c594`. [Strict gate job and inventory](https://github.com/barghsadev/barghsa-core/actions/runs/42751525133/job/129616022358).

The later strict image gate at `f0f9434c3a396ee80c20243cfed15c972e5b680f` also reports 594 entries and 170 requiring review. Of those review entries, 169 retain the previous exact package, scope and reported licenses. The PostgreSQL image now ships `libxslt@1.1.43-r4` in place of `1.1.43-r3`, still reported as X-11. Review the updated package version and its original notices. The allowed MIT package `krb5-libs` also changed from `1.22.2-r1` to `1.22.3-r0`. The report SHA-256 is `05b0d2394fe14dae9d1c52ebfaf1e413bda20b608ad7011bb15b5c233357c411`. [Image gate and current inventory](https://github.com/barghsadev/barghsa-core/actions/runs/42902282297/job/130131117350).

The report-only preflight at `fc55c82a7b7060fb88b179a749edde553853f051` reproduced all 594 rows by package URL, distribution scope, location, reported licenses and disposition. The updated review packet keeps the 170 exceptions and records all 161 Alpine package metadata entries. It includes 159 original license expressions and identifies the two generated PostgreSQL dependency records that have no license expression and ship no files. The current SBOM checksums match the 160 retained package metadata records. For PostgreSQL `libxslt@1.1.43-r4`, the checksum matches the official Alpine index and the downloaded package's control archive. The original expression is `X11` and the packaging commit is `e85ecba78539486bd0a685963ca5da3e1652fbd0`. The preflight report SHA-256 is `f25ed65450e6f89a66c9d7925a9d57d27d2507d5441040219e1800957739c24e`. Reviewer, date, disposition, conditions and references remain open for each exception. [Current image inventory](https://github.com/barghsadev/barghsa-core/actions/runs/43128471381) · [Alpine package metadata](https://pkgs.alpinelinux.org/packages?branch=v3.24&name=libxslt).

- Record an owner or legal reviewer, approved package names, exact versions, platforms, conditions, and the GeoLite2 decision.
- Use the original Alpine license expressions in the packet to review the terms. Trivy can report several license tokens without the original expression's operators. Record the applicable notice, source and replacement conditions for each exact package and image scope.
- Build the final web and native images and verify the notices actually accompany the approved assets and packages. Include corresponding-source and distribution evidence where the reviewer requires it.
- Enforce the existing allowlist plus only the recorded package-specific dispositions. Unknown versions, architectures, license expressions and missing required notices stay open until reviewed.
