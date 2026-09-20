/** V8/source-map conversion can derive a negative implicit arm count.
 * Such a branch is unmeasurable: retain every arm in the denominator and
 * give none of them execution credit. Keep the raw measurements for diagnosis.
 */
export function retainUnmeasuredBranches(coverage) {
  const unmeasured = [];
  for (const filename of coverage.files()) {
    const file = coverage.fileCoverageFor(filename);
    for (const [id, hits] of Object.entries(file.b)) {
      if (!hits.every(Number.isSafeInteger) || !hits.some((hit) => hit < 0)) continue;
      unmeasured.push({
        file: filename,
        branch: id,
        location: file.branchMap[id],
        hits: [...hits],
      });
      file.b[id] = hits.map(() => 0);
    }
  }
  return unmeasured;
}
