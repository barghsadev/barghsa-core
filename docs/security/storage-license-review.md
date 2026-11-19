# v0.6.0 storage image license review

The pinned SeaweedFS 4.54 build adds a separate `objectstore` distribution
scope. The exact image and SBOM identify 275 packages. The allowlist covers
238 packages. The remaining 37 entries identify exact versions and license
sets in the [approval policy](../../deploy/licenses/release-approvals.json).

## Owner confirmation on 2026-11-19

Majid Najafi confirmed all 37 `objectstore` exceptions with the conditions in
the supplemental workbook. Codex recorded the confirmation and preserved each
condition. The workbook includes 34 legal-review flags and 16 exact package
identities previously approved in other image scopes.

The matching source and notice bundle contains the pinned SeaweedFS source and
patch, notices and source archives for the 18 reviewed Go modules, and exact
Alpine recipes and source inputs for the 19 reviewed APK entries. All 1,164
payload files were verified after reopening the bundle. The strict storage
license check binds the bundle checksum, SBOM and running image to the
[reviewed inventory](../../deploy/licenses/objectstore-inventory.json).

The protected staging operator copy was read back on November 19, 2026. Its
archive and embedded manifest matched the reviewed checksums. The paired
Linux amd64 image was present on staging and contained the SeaweedFS and Go
license files and the Go patent notice.

Before distributing the image, verify the delivered notices and recipients'
access to the matching sources. Complete the package-specific review of the
library replacement or relinking paths named in the workbook. The source
availability conditions for the MPL-covered modules remain part of the
approval. [MPL 2.0 distribution terms](https://www.mozilla.org/en-US/MPL/2.0/).
