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

## Signed callback image on 2026-11-20

The signed callback build retains the same 275 package identities and license
sets. The 37 confirmed exceptions retain the workbook's conditions. The
matching archive includes both repository patches and the exact image recipe.
All 1,167 archive members passed checksum readback. The reconstructed image
retains the SeaweedFS and Go notices and passed the strict artifact check.
Use the exact image and matching archive in the current inventory when
distributing this build. [Reviewed inventory](../../deploy/licenses/objectstore-inventory.json).

## Library substitution check

On November 19, 2026, the exact image passed the same check locally and on
staging Linux amd64. Isolated containers used a read-only root filesystem, no
network and a temporary directory of byte-distinct library copies. The test
added inert markers to those copies to verify which files the loader mapped.

`curl` selected the alternate `libidn2` and `libunistring` files through
`LD_LIBRARY_PATH`, reported IDN support and read a local fixture. The musl
loader mapped the alternate `libfuse`, `libulockmgr` and `libgcc_s` files in a
separate process. The `fuse-common` package supplies `/etc/fuse.conf`, which
the test replaced through a read-only bind mount and verified by checksum.
The SeaweedFS executable reported version 4.54 and uses the static build from
the reviewed image recipe.

Before distributing the image, verify the delivered notices and recipients'
access to the matching sources. The workbook retains the package-specific
conditions, including source availability for the MPL-covered modules.
[MPL 2.0 distribution terms](https://www.mozilla.org/en-US/MPL/2.0/).
