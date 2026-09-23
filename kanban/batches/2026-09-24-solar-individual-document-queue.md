# Solar individual document review queue — September 24, 2026

Canonical scope: remaining queue visibility in `03-core-business.md#T-03.12.02.01`.

The staff document dashboard now lists each pending, active file with its name, uploader, upload time and review status. Selecting a file opens its request and existing file preview/review controls. The separate request queue remains available for empty submissions and request-level decisions. The individual-file API uses stable pages of 100, validates cursors, and excludes reviewed, removed and superseded files.

Validation: focused solar document HTTP and dashboard tests, dictionary tests, API/web typechecks and builds, OpenAPI contract comparison, targeted lint/format, and backlog check. CI status follows the direct `main` push.
