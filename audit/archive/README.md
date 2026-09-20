# Historical audit evidence

These files preserve earlier findings, reports and repair notes. They are not the current work queue. Start with [the current plan](../fix-plan.md) and [progress](../progress.json).

Archived files retain their exact bytes and original revision claims. Relative paths in an old report are relative to its original location. [The cleanup manifest](../cleanup-manifest.json) maps every original path to its retained location and records its checksum. Three duplicate copies map to their identical retained originals. Historical Git revision `612434d` also retains the pre-cleanup directory.

`make-report.py` is an archived baseline generator with historical temporary input dependencies. Do not run it to update current acceptance. The supported requirement and skip generators remain in the parent directory.
