# Completion evidence

Start with `audit/HANDOFF.md` and `audit/final-repair-checkpoint.json`. Read individual logs only when investigating a specific failure or reproducing a check. Earlier failed attempts are retained and do not override the recorded passing reruns.

The evidence index records SHA-256 hashes of both the gzip bytes and decompressed content. Coverage thresholds and critical-file classification are unchanged.

`browser-final-raw.json.gz` retains all 769 unminified coverage-run records. `browser-optimized-raw.json.gz` retains the separate optimized production run. Source strings and V8 function objects are interned to avoid repeated storage. To reconstruct an entry, replace `source_sha256` with `source = sources[hash]`, and replace `function_indices` with `functions = [archive.functions[i] for i in indices]`. The record envelope and remaining entry fields stay unchanged. All 769 final reconstructed records were compared with the original browser outputs and matched exactly. Do not feed these compact archives directly to the collector without reconstruction.

`final-revision-reuse.json.gz` proves byte equality for all 815 production files in the coverage groups between the browser checkout and final code commit. The intervening changes only add tests and conservative coverage measurement. See the final unit provenance for overlapping runs; test counts must not be summed across repeated suites.

`source-refresh.json` and `final-source-refresh.json` retain previous hashes when current acceptance bindings were refreshed. Historical review records remain evidence of their original revisions.
