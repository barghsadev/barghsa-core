import { test } from 'node:test';
import assert from 'node:assert/strict';
import coverageLibrary from 'istanbul-lib-coverage';
const { createCoverageMap } = coverageLibrary;
import { retainUnmeasuredBranches } from './conservative-branch-coverage.mjs';
function fixture(hits) {
  return createCoverageMap({
    '/source.ts': {
      path: '/source.ts',
      statementMap: {},
      fnMap: {},
      s: {},
      f: {},
      branchMap: {
        0: {
          type: 'if',
          loc: { start: { line: 1, column: 0 }, end: { line: 2, column: 0 } },
          locations: [
            { start: { line: 1, column: 0 }, end: { line: 2, column: 0 } },
            { start: { line: 1, column: 0 }, end: { line: 2, column: 0 } },
          ],
        },
      },
      b: { 0: hits },
    },
  });
}
test('inconsistent converted branches retain both uncovered arms and original diagnostic evidence', () => {
  const coverage = fixture([5, -3]);
  const evidence = retainUnmeasuredBranches(coverage);
  assert.deepEqual(evidence[0].hits, [5, -3]);
  assert.deepEqual(coverage.fileCoverageFor('/source.ts').b[0], [0, 0]);
  assert.equal(coverage.getCoverageSummary().branches.total, 2);
  assert.equal(coverage.getCoverageSummary().branches.covered, 0);
  assert.deepEqual(retainUnmeasuredBranches(coverage), []);
});
test('valid measurements are unchanged and no execution credit is invented', () => {
  for (const hits of [
    [0, 0],
    [3, 0],
    [0, 2],
    [3, 2],
  ]) {
    const coverage = fixture(hits);
    const original = JSON.stringify(coverage.toJSON());
    assert.deepEqual(retainUnmeasuredBranches(coverage), []);
    assert.equal(JSON.stringify(coverage.toJSON()), original);
  }
});

test('other invalid counters remain visible to the coverage validator', () => {
  for (const hits of [
    [-1, NaN],
    [-1, Infinity],
    [-1, '2'],
    [-1, 0.5],
  ]) {
    const coverage = fixture(hits);
    assert.deepEqual(retainUnmeasuredBranches(coverage), []);
    assert.deepEqual(coverage.fileCoverageFor('/source.ts').b[0], hits);
  }
});
